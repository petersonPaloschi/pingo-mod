// Sift: the pure half of the bulk-judgment script (scripts/sift.ts). Claude hands Jev many small
// yes/no, pick-a-label or relevance calls and reads back only a shortlist. Nothing here touches
// the disk or the network, so the plugin test runtime covers the questions and the output.
import type { Answer, ChoiceAnswer, ChoiceQuestion, Json, NoulQuestion, Questions } from "./types.ts";

export interface Item {
  id: string;
  text: string;
  /** Cut at --max-chars: Jev only saw the start. */
  truncated?: boolean;
}

export type Flags = Record<string, string | true>;

/** Flags that never take a value, so `--lines src` keeps `src` as an input. */
const BOOLEAN_FLAGS = new Set(["lines", "json", "all", "help", "fast", "verbose", "no-collapse", "no-secrets-guard"]);

export function parseArgs(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") { pos.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith("--")) { pos.push(arg); continue; }
    const eq = arg.indexOf("=");
    if (eq > 0) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
    const name = arg.slice(2);
    const next = argv[i + 1];
    flags[name] = BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--") ? true : (i++, next);
  }
  return { pos, flags };
}

/** A numeric flag, or the default when it is missing, bare or not a number. */
export const num = (value: string | true | undefined, fallback: number): number => {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const estTokens = (text: string) => Math.ceil(text.length / 4);
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export const f2 = (value: number) => value.toFixed(2);
export const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const oneLine = (text: string) => text.trim().replace(/\s+/g, " ");

/** `"bug:Something broken,feature"` → `{ bug: "Something broken", feature: null }`. */
export function parseLabels(spec: string): Record<string, Json> {
  return Object.fromEntries(spec.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...description] = part.split(":");
    return [name!.trim(), description.length ? description.join(":").trim() : null];
  }));
}

/**
 * One item per request by default: packing items into a shared state measurably hurts accuracy
 * (Quicksilver's bench: CI triage 76% packed vs 100% unpacked). --fast packs small items for throughput.
 */
export function batches(items: Item[], flags: Flags): Item[][] {
  const budget = num(flags["pack-tokens"], 3000);
  const maxItems = num(flags["pack-items"], flags.fast ? 40 : 1);
  const out: Item[][] = [];
  let current: Item[] = [];
  let tokens = 0;
  for (const item of items) {
    const cost = estTokens(item.text) + 20;
    if (current.length && (tokens + cost > budget || current.length >= maxItems)) {
      out.push(current);
      current = [];
      tokens = 0;
    }
    current.push(item);
    tokens += cost;
  }
  if (current.length) out.push(current);
  return out;
}

/** Builds the question for one item; `ref` is how the instructions point at it in the state. */
export type MakeQuestion = (ref: string, packed: boolean) => ChoiceQuestion | NoulQuestion;

/** The state and questions of one request over a group of items: answer `q<j>` is about item j. */
export function groupRequest(group: Item[], make: MakeQuestion, extra: { [key: string]: Json } = {}): { state: { [key: string]: Json }; questions: Questions } {
  const packed = group.length > 1;
  const state: { [key: string]: Json } = packed
    ? { ...extra, items: Object.fromEntries(group.map((item, j) => [`i${j}`, { source: item.id, content: item.text }])) }
    : { ...extra, source: group[0]!.id, content: group[0]!.text };
  const questions: Questions = Object.fromEntries(group.map((_, j) => [`q${j}`, make(packed ? `\`items.i${j}\`` : "`content`", packed)]));
  return { state, questions };
}

const aboutOnly = (ref: string, packed: boolean) => (packed ? ` Answer only about ${ref}; ignore the other items.` : "");

export const filterQuestion = (question: string): MakeQuestion => (ref, packed) => ({
  type: "noul",
  instructions: `${question}${aboutOnly(ref, packed)}`,
});

export const classifyQuestion = (question: string, criteria: Record<string, Json>): MakeQuestion => (ref, packed) => ({
  type: "choice",
  instructions: `${question}${aboutOnly(ref, packed)}`,
  criteria,
});

/** Relevance as a five-level choice; the expected level over Jev's probabilities is the score. */
export const RANK_LEVELS: Record<string, string> = {
  unrelated: "Unrelated to the query",
  topical: "Shares a topic with the query but does not help answer it",
  partial: "Partially relevant: contains some useful information for the query",
  relevant: "Relevant: substantially addresses the query",
  exact: "Directly and specifically answers or matches the query",
};

export const rankQuestion: MakeQuestion = (ref, packed) => ({
  type: "choice",
  instructions: `How relevant is ${ref} to \`query\`?${packed ? " Ignore the other items." : ""}`,
  criteria: RANK_LEVELS,
});

/** 0 for "unrelated" up to 1 for "exact", weighted by how sure Jev is of each level. */
export function relevance(answer: ChoiceAnswer, levels: string[] = Object.keys(RANK_LEVELS)): number {
  const top = levels.length - 1;
  return levels.reduce((sum, level, index) => sum + (answer.probabilities[level] ?? 0) * index, 0) / top;
}

/** The two questions asked of each chunk of a large file: which line matches, and whether any does. */
export function findRequest(query: string, lines: [string, string][]): { state: { [key: string]: Json }; questions: Questions } {
  return {
    state: { query, lines: Object.fromEntries(lines.map(([n, text]) => [n, clip(text, 400)])) },
    questions: {
      where: {
        type: "choice",
        instructions: "Which line number in `lines` best matches `query`?",
        criteria: { ...Object.fromEntries(lines.map(([n]) => [n, null])), none: "No line matches `query`" },
      },
      exists: { type: "noul", instructions: "Does any line in `lines` match `query`?" },
    },
  };
}

/** Every line of a chunk scored as P(this line is the match) × P(some line matches). */
export function findHits(file: string, lines: [string, string][], answers: Record<string, Answer>): { file: string; line: string; text: string; score: number }[] {
  const where = answers.where;
  const exists = answers.exists;
  if (where?.type !== "choice" || exists?.type !== "noul") return [];
  const byLine = new Map(lines);
  return Object.entries(where.probabilities)
    .filter(([n]) => n !== "none" && byLine.has(n))
    .map(([n, p]) => ({ file, line: n, text: byLine.get(n)!, score: p * exists.noul }));
}

// --- Output ---

/** An item as Claude sees it: the id, and for lines or JSONL items its text on one line. */
export function label(item: Item, flags: Flags): string {
  const mark = item.truncated ? "~" : "";
  return flags.lines || flags.items ? `${item.id}${mark}  ${clip(oneLine(item.text), num(flags.width, 160))}` : `${item.id}${mark}`;
}

/** Log lines repeat with different numbers and ids; one template per pattern lets Claude read it once. */
export const template = (text: string) =>
  text.replace(/0x[0-9a-f]+/gi, "#").replace(/[0-9a-f]{8,}/gi, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** [3,4,5,9] → "3-5,9", stopping after `max` numbers with a pointer to --save for the rest. */
export function ranges(nums: number[], max: number): string {
  const parts: string[] = [];
  let shown = 0;
  for (let i = 0; i < nums.length && shown < max; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++;
    parts.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
    shown += j - i + 1;
    i = j;
  }
  return parts.join(",") + (shown < nums.length ? `,… (+${nums.length - shown}; use --save for all)` : "");
}

export interface Scored {
  item: Item;
  score: number;
}

/** Score lines; with --lines, repeats of one pattern fold into the first with the other line numbers. */
export function renderScored(rows: Scored[], flags: Flags): string[] {
  if (!flags.lines || flags["no-collapse"]) return rows.map((row) => `${f2(row.score)}  ${label(row.item, flags)}`);
  const groups = new Map<string, Scored[]>();
  for (const row of rows) {
    const source = row.item.id.slice(0, row.item.id.lastIndexOf(":"));
    const key = `${source}\0${template(row.item.text)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group) => {
    const [first, ...rest] = group;
    if (!rest.length) return `${f2(first!.score)}  ${label(first!.item, flags)}`;
    const others = rest.map((row) => Number(row.item.id.split(":").pop())).sort((a, b) => a - b);
    return `${f2(first!.score)}  ×${group.length}  ${label(first!.item, flags)}\n        also lines ${ranges(others, 300)}`;
  });
}

/** Sure matches first, then the borderline band Claude should read itself. */
export function renderFilter(rows: Scored[], flags: Flags): { lines: string[]; matched: Scored[]; borderline: Scored[] } {
  const threshold = num(flags.threshold, 0.5);
  const band = num(flags.band, 0.15);
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const sure = sorted.filter((row) => row.score >= threshold + band);
  const borderline = sorted.filter((row) => Math.abs(row.score - threshold) < band);
  const lines = [
    ...renderScored(sure, flags),
    ...(borderline.length ? [`? borderline (${f2(threshold - band)}–${f2(threshold + band)}) — check these yourself:`, ...renderScored(borderline, flags)] : []),
  ];
  if (!lines.length) lines.push("(no matches)");
  return { lines, matched: sorted.filter((row) => row.score >= threshold), borderline };
}

export interface Labeled {
  item: Item;
  answer: ChoiceAnswer;
}

/** Counts per label, confident ids per label, then each low-confidence item with its runner-up. */
export function renderClassify(rows: Labeled[], labels: string[], flags: Flags): { lines: string[]; low: Labeled[] } {
  const minConfidence = num(flags["min-confidence"], 0.6);
  const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((name) => name.trim())) : undefined;
  const groups = new Map<string, Labeled[]>();
  for (const row of rows) groups.set(row.answer.choice, [...(groups.get(row.answer.choice) ?? []), row]);
  const low = rows.filter((row) => row.answer.confidence < minConfidence);
  const lines = [labels.map((name) => `${name} ${groups.get(name)?.length ?? 0}`).join(" · ")];
  for (const name of labels) {
    const group = groups.get(name);
    if (!group || (only && !only.has(name))) continue;
    group.sort((a, b) => b.answer.confidence - a.answer.confidence);
    if (flags.verbose) {
      lines.push(`[${name}]`);
      for (const row of group) lines.push(`${row.answer.confidence < minConfidence ? "?" : " "}${f2(row.answer.confidence)}  ${label(row.item, flags)}`);
    } else {
      const confident = group.filter((row) => row.answer.confidence >= minConfidence).map((row) => row.item.id);
      if (confident.length) lines.push(`[${name}] ${confident.join(" ")}`);
    }
  }
  const shownLow = low.filter((row) => !only || only.has(row.answer.choice));
  if (!flags.verbose && shownLow.length) {
    lines.push("? low confidence — check these yourself:");
    for (const row of shownLow) {
      const runnerUp = Object.entries(row.answer.probabilities).sort((a, b) => b[1] - a[1])[1]?.[0];
      lines.push(`?${f2(row.answer.confidence)}  ${row.answer.choice}${runnerUp ? ` (or ${runnerUp})` : ""}  ${row.item.id}  ${clip(oneLine(row.item.text), num(flags.width, 160))}`);
    }
  }
  return { lines, low };
}

/** One line per answer of a raw `ask`. */
export function renderAnswer(id: string, answer: Answer): string {
  if (answer.type === "noul") return `${id}  noul ${f2(answer.noul)}`;
  return `${id}  choice ${answer.choice} (conf ${f2(answer.confidence)})`;
}

/** TypeSafe's list price per input token; other providers bill differently, so only it gets a cost. */
export const TYPESAFE_PRICE_PER_TOKEN = 0.042 / 1e6;

export interface RunStats {
  scanned: number;
  contentTokens: number;
  jevTokens: number;
  seconds: number;
  provider: string;
  failed: { id: string; error: string }[];
  skipped: string[];
}

/** The summary line: what was judged, what it cost, and roughly what Claude did not have to read. */
export function footer(stats: RunStats, extra: string[], output: string, scanned = true): string {
  const saved = Math.max(0, stats.contentTokens - estTokens(output));
  const cost = stats.provider === "typesafe" ? ` ($${(stats.jevTokens * TYPESAFE_PRICE_PER_TOKEN).toFixed(4)})` : "";
  const parts = [
    ...(scanned ? [`${stats.scanned} scanned`] : []),
    ...extra,
    `${stats.seconds.toFixed(1)}s`,
    `jev ${fmtK(stats.jevTokens)} tok${cost}`,
    `~${fmtK(saved)} Claude tokens not read`,
  ];
  let text = `— ${parts.join(" · ")}`;
  if (stats.failed.length) {
    const ids = clip(stats.failed.map((failure) => failure.id).join(", "), 400);
    text += `\n! ${stats.failed.length} not judged (${clip(stats.failed[0]!.error, 200)}): ${ids} — read these yourself or re-run`;
  }
  if (stats.skipped.length) text += `\n— skipped ${stats.skipped.length}: ${clip(stats.skipped.join(", "), 400)}`;
  return text;
}
