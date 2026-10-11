import { validateKey } from "../../hooks/core/jev.ts";
import { classifyQuestion, clip, f2, filterQuestion, findHits, findRequest, footer, label, num, parseLabels, rankQuestion, relevance, renderAnswer, renderClassify, renderFilter, renderTally, estTokens, toTally, type Flags, type Labeled, type RunStats, type Scored } from "../../hooks/core/sift.ts";
import type { Json, SystemOneRequest, SystemOneResult } from "../../hooks/core/types.ts";
import { fail } from "./errors.ts";
import { PROVIDERS, asker, authFail, channel, isAuthError, message, newUsageStats, pool, settings, transport, usageFields } from "./runtime.ts";
import { collect, readInput, readStdin, requireInputs } from "./input.ts";
import { emit, finish, readTally, runPerItem, runStats, save } from "./results.ts";
// --- Commands ---

export async function cmdFilter(pos: string[], flags: Flags) {
  const question = pos.shift();
  if (!question) fail('usage: filter "<yes/no question>" <inputs...>');
  const started = Date.now();
  const { items, skipped } = collect(pos, flags);
  requireInputs(items, "filter");
  const run = await runPerItem(items, flags, filterQuestion(question!));
  const scored: Scored[] = run.rows.flatMap((row) => (row.answer.type === "noul" ? [{ item: row.item, score: row.answer.noul }] : []));
  const { lines, matched, borderline } = renderFilter(scored, flags);
  const stats = runStats(run.provider, run, run.failed, items, skipped, started);
  const saved = save(flags, scored.map((row) => ({ id: row.item.id, p: row.score })));
  const foot = footer(stats, [`${matched.length} matched`, `${borderline.length} borderline`], lines.join("\n")) + saved;
  const shown = (rows: Scored[]) => rows.map((row) => ({ id: row.item.id, p: row.score }));
  emit(flags, { matched: shown(matched), borderline: shown(borderline), failed: run.failed }, lines, foot);
  finish(stats, lines.join("\n"));
}

function labelsFrom(flags: Flags): Record<string, Json> {
  if (typeof flags["labels-json"] === "string") {
    const raw = flags["labels-json"];
    return JSON.parse(raw.startsWith("@") ? readInput(raw.slice(1), flags) : raw);
  }
  if (typeof flags.labels !== "string") fail('classify needs --labels "a,b,c" or --labels-json \'{"a":"description"}\'');
  return parseLabels(flags.labels as string);
}

export async function cmdClassify(pos: string[], flags: Flags) {
  const criteria = labelsFrom(flags);
  const labels = Object.keys(criteria);
  if (labels.length < 2 || labels.length > 255) fail("classify needs 2–255 labels");
  const question = typeof flags.question === "string" ? flags.question : "Which label best describes this item?";
  const started = Date.now();
  const { items, skipped } = collect(pos, flags);
  requireInputs(items, "classify");
  const run = await runPerItem(items, flags, classifyQuestion(question, criteria));
  const labeled: Labeled[] = run.rows.flatMap((row) => (row.answer.type === "choice" ? [{ item: row.item, answer: row.answer }] : []));
  const { lines, low } = renderClassify(labeled, labels, flags);
  const stats = runStats(run.provider, run, run.failed, items, skipped, started);
  const saved = save(flags, labeled.map((row) => ({ id: row.item.id, label: row.answer.choice, confidence: row.answer.confidence })));
  const foot = footer(stats, [`${low.length} low-confidence (?)`], lines.join("\n")) + saved;
  emit(flags, labeled.map((row) => ({ id: row.item.id, label: row.answer.choice, confidence: row.answer.confidence, probabilities: row.answer.probabilities })), lines, foot);
  finish(stats, lines.join("\n"));
}

export async function cmdRank(pos: string[], flags: Flags) {
  const query = pos.shift();
  if (!query) fail('usage: rank "<query>" <inputs...> [--top 10 | --all]');
  const started = Date.now();
  const { items, skipped } = collect(pos, flags);
  requireInputs(items, "rank");
  const run = await runPerItem(items, flags, rankQuestion, { query: query! });
  const scored = run.rows.flatMap((row) => (row.answer.type === "choice" ? [{ item: row.item, score: relevance(row.answer), confidence: row.answer.confidence }] : []));
  scored.sort((a, b) => b.score - a.score);
  const shown = flags.all ? scored : scored.slice(0, num(flags.top, 10));
  const lines = shown.map((row) => `${f2(row.score)}  ${label(row.item, flags)}`);
  const stats = runStats(run.provider, run, run.failed, items, skipped, started);
  const saved = save(flags, scored.map((row) => ({ id: row.item.id, relevance: row.score, confidence: row.confidence })));
  const foot = footer(stats, [`top ${shown.length}`], lines.join("\n")) + saved;
  emit(flags, shown.map((row) => ({ id: row.item.id, relevance: row.score, confidence: row.confidence })), lines, foot);
  finish(stats, lines.join("\n"));
}

export async function cmdFind(pos: string[], flags: Flags) {
  const query = pos.shift();
  if (!query || !pos.length) fail('usage: find "<what you are looking for>" <files...> [--top 5]');
  const started = Date.now();
  const chunkLines = Math.max(10, Math.min(num(flags.chunk, 150), 250));
  const { items: files, skipped } = collect(pos, { ...flags, lines: false, "max-chars": String(Number.MAX_SAFE_INTEGER) } as Flags);
  requireInputs(files, "find");
  const chunks: { file: string; lines: [string, string][] }[] = [];
  for (const file of files) {
    const all = file.text.split(/\r?\n/).map((text, i): [string, string] => [String(i + 1), text]).filter(([, text]) => text.trim());
    for (let i = 0; i < all.length; i += chunkLines) chunks.push({ file: file.id, lines: all.slice(i, i + chunkLines) });
  }
  const counter = newUsageStats();
  const { ask, provider } = asker(flags, counter);
  const failed: RunStats["failed"] = [];
  const perChunk = await pool(chunks.map((chunk) => async () => {
    try {
      const result = await ask(findRequest(query!, chunk.lines));
      if (result.answers.where?.type !== "choice" || result.answers.exists?.type !== "noul") throw new Error("no usable line judgment");
      return findHits(chunk.file, chunk.lines, result.answers);
    } catch (error) {
      if (isAuthError(error)) authFail(error);
      failed.push({ id: `${chunk.file}:${chunk.lines[0]![0]}-${chunk.lines.at(-1)![0]}`, error: message(error) });
      return [];
    }
  }), num(flags.concurrency, 16));
  const minScore = num(flags["min-score"], 0.05);
  const allHits = perChunk.flat().filter((hit) => hit.score >= minScore).sort((a, b) => b.score - a.score);
  const hits = allHits.slice(0, num(flags.top, 5));
  const lines = hits.map((hit) => `${f2(hit.score)}  ${hit.file}:${hit.line}  ${clip(hit.text.trim(), num(flags.width, 160))}`);
  if (!lines.length) lines.push("(no matching lines)");
  const stats = runStats(provider, counter, failed, files, skipped, started);
  const foot = footer(stats, [`${chunks.length} chunks`], lines.join("\n")) + save(flags, allHits);
  emit(flags, hits, lines, foot);
  finish(stats, lines.join("\n"), chunks.length > 0 && failed.length >= chunks.length);
}

function stateArg(value: string | true | undefined, flags: Flags): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "-") return readStdin();
  return value.startsWith("@") ? readInput(value.slice(1), flags) : value;
}

export async function cmdAsk(pos: string[], flags: Flags) {
  const started = Date.now();
  const first = pos[0];
  let request: Omit<SystemOneRequest, "model">;
  if (first && (first === "-" || first.endsWith(".json")) && flags.state === undefined) {
    const spec = JSON.parse(first === "-" ? readStdin() : readInput(first, flags));
    if (!spec?.state || !spec?.questions) fail('a spec needs "state" and "questions"');
    request = { state: typeof spec.state === "string" ? { content: spec.state } : spec.state, questions: spec.questions };
  } else {
    const question = pos.join(" ");
    if (!question) fail('usage: ask "<question>" --state @file|text|- [--choice "a,b"]  or  ask spec.json');
    const state = stateArg(flags.state, flags);
    if (state === undefined) fail("ask needs --state (@file, literal text, or - for stdin)");
    const instructions = `${question} (about \`content\`)`;
    request = {
      state: { content: state! },
      questions: { answer: typeof flags.choice === "string" ? { type: "choice", instructions, criteria: parseLabels(flags.choice) } : { type: "noul", instructions } },
    };
  }
  const counter = newUsageStats();
  const { ask, provider } = asker(flags, counter);
  let result: SystemOneResult;
  try {
    result = await ask(request);
  } catch (error) {
    return isAuthError(error) ? authFail(error) : fail(message(error), 5);
  }
  const lines = Object.entries(result.answers).map(([id, answer]) => renderAnswer(id, answer));
  for (const id of Object.keys(request.questions)) if (!Object.hasOwn(result.answers, id)) lines.push(`${id}  no usable answer`);
  for (const drop of result.dropped ?? []) lines.push(`${drop.name}  unusable (${drop.why})`);
  const stateText = JSON.stringify(request.state);
  const stats: RunStats = { scanned: 1, contentTokens: estTokens(stateText), ...usageFields(counter), seconds: (Date.now() - started) / 1000, provider, failed: [], skipped: [] };
  emit(flags, result, lines, footer(stats, [], lines.join("\n"), false) + save(flags, result));
  finish(stats, lines.join("\n"), !Object.keys(result.answers).length);
}

export async function cmdStatus(flags: Flags) {
  const config = settings(flags);
  const info = PROVIDERS[config.provider];
  if (!config.apiKey) fail(`not configured: run /jev setup in Claude Code, or set ${info.keyEnv} (key from ${info.keyUrl})`, 3);
  const check = await validateKey(config.provider, config.apiKey, transport, config.jevModel, config.locale, channel());
  if (!check.ok) fail(`${info.label} · key from ${config.source} · ${check.message}`, check.refused ? 3 : 5);
  console.log(`ready · ${info.label} · key from ${config.source} · model ${config.jevModel} · ${check.ms} ms`);
  const tally = toTally(readTally());
  if (tally) console.log(renderTally(tally));
}
