// The Flow tab: the latest batch of subagents drawn as one diagram. The main session sends a
// wave of subagents out, each works its task, the answers come back to the main session, you
// confirm, and the main loop makes the edits in one pass. Drawn as a grid of characters so the
// lines and branches line up like ASCII art; pure, so a test sees exactly what the pane draws.
import type { AgentRun, FlowState } from "../types";
import { AGENT_MASCOTS, isMascot } from "./mascots/agents.ts";
import { DOT, hex } from "./dots.ts";
import { formatDuration, formatNumber, localeFor, text, type Locale, type LocaleKey } from "./i18n.ts";
import { displayWidth } from "./layout.ts";

export type FlowStep = "plan" | "check" | "review" | "fix" | "done";

/** Where the wave is: nothing sent, subagents working, answers back, edits under way, done. */
export function flowStep(flow: FlowState, wave: readonly AgentRun[]): FlowStep {
  if (wave.length === 0) return "plan";
  if (wave.some((run) => run.state === "running")) return "check";
  if (flow.confirmed || flow.edits > 0) return flow.working ? "fix" : "done";
  return "review";
}

const STAGE: Record<FlowStep, number> = { plan: 0, check: 1, review: 2, fix: 3, done: 4 };

/** The wave's subagents still kept on the Agents tab, in the order they started. */
export function waveOf(flow: FlowState, agents: readonly AgentRun[]): AgentRun[] {
  // A number listed twice is one subagent, drawn once.
  const members = [...new Set(flow.wave)].map((n) => agents.find((run) => run.n === n)).filter((run): run is AgentRun => run !== undefined);
  const inWave = new Set(members.map((run) => run.n));
  return [...members, ...agents.filter((run) => run.state === "running" && !inWave.has(run.n))];
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5", "claude-3-5-sonnet-20241022" → "Sonnet 3.5". */
export function prettyModel(id: string | undefined): string {
  if (!id) return "Claude";
  const capital = (family: string) => family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  // Version numbers are one or two digits; a date suffix is never taken for one.
  const match = /(opus|sonnet|haiku|fable)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/i.exec(id);
  if (match) return `${capital(match[1]!)} ${match[2]}${match[3] ? `.${match[3]}` : ""}`;
  // The older ids put the version first: claude-3-5-sonnet, claude-3-opus.
  const old = /claude-(\d{1,2})(?:-(\d{1,2}))?-(opus|sonnet|haiku)/i.exec(id);
  if (old) return `${capital(old[3]!)} ${old[1]}${old[2] ? `.${old[2]}` : ""}`;
  return id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

const WORDS: readonly LocaleKey[] = ["flow.word.zero", "flow.word.one", "flow.word.two", "flow.word.three", "flow.word.four", "flow.word.five", "flow.word.six", "flow.word.seven", "flow.word.eight", "flow.word.nine", "flow.word.ten"];
const word = (n: number, locale: Locale) => (WORDS[n] ? text(WORDS[n]!, locale) : formatNumber(n, locale));

/** One cell of the drawing: a character and how it is painted. */
type Style = { color: string; bold?: boolean; bg?: string };
export type FlowSegment = { text: string } & Style;

const C = {
  ink: hex(DOT.ink),
  dim: hex(DOT.dim),
  faint: hex(DOT.faint),
  blue: hex(DOT.base),
  orange: hex(DOT.claude),
  you: hex(DOT.you),
  green: hex(DOT.route),
  fail: hex(DOT.fail),
  pass: hex(DOT.pass),
  pill: "#2c2f36",
};

/** A grid of characters, each with its own style, turned into runs of one style per line. */
class Canvas {
  readonly cells: { ch: string; style: Style }[][] = [];
  constructor(readonly width: number) {}
  row(y: number) {
    while (this.cells.length <= y) this.cells.push(Array.from({ length: this.width }, () => ({ ch: " ", style: { color: C.faint } })));
    return this.cells[y]!;
  }
  put(x: number, y: number, text: string, style: Style) {
    const row = this.row(y);
    // A wide character takes two cells, the second left empty; a combining mark joins the one before.
    const blank = (at: number) => {
      if (at >= 0 && at < this.width) row[at] = { ch: " ", style: row[at]!.style };
    };
    let at = x;
    for (const ch of text) {
      const w = displayWidth(ch);
      if (w === 0) {
        if (at > 0 && at - 1 < this.width && at - 1 >= x) row[at - 1]!.ch += ch;
        continue;
      }
      if (at >= 0 && at + w <= this.width) {
        // Half of a wide character left behind would shift the rest of the line.
        if (row[at]!.ch === "") blank(at - 1);
        if (row[at + w]?.ch === "") blank(at + w);
        row[at] = { ch, style };
        if (w === 2) row[at + 1] = { ch: "", style };
      }
      at += w;
    }
  }
  /** Several runs in a row, starting at x; returns where they end. */
  write(x: number, y: number, parts: readonly FlowSegment[]): number {
    for (const { text, ...style } of parts) {
      this.put(x, y, text, style);
      x += displayWidth(text);
    }
    return x;
  }
  /** Runs centered on column cx; cut to the width when they do not fit in it. */
  center(cx: number, y: number, parts: readonly FlowSegment[]) {
    let length = parts.reduce((sum, part) => sum + displayWidth(part.text), 0);
    if (length > this.width) {
      let room = this.width;
      parts = parts.map((part) => {
        const text = room > 0 ? fit(part.text, room) : "";
        room -= displayWidth(text);
        return { ...part, text };
      });
      length = this.width - room;
    }
    return this.write(Math.max(0, cx - Math.floor(length / 2)), y, parts);
  }
  lines(): FlowSegment[][] {
    return this.cells.map((row) => {
      const out: FlowSegment[] = [];
      for (const { ch, style } of row) {
        const last = out.at(-1);
        if (last && last.color === style.color && last.bold === style.bold && last.bg === style.bg) last.text += ch;
        else out.push({ text: ch, ...style });
      }
      // Trailing blanks carry nothing; trimming keeps the tree small.
      const tail = out.at(-1);
      if (tail && !tail.bg) tail.text = tail.text.trimEnd();
      return out.filter((part) => part.text.length > 0);
    });
  }
}

/** The text on one line of at most `width` columns, wide characters counted twice. */
const fit = (text: string, width: number) => {
  const line = text.replace(/\s+/g, " ");
  if (displayWidth(line) <= width) return line;
  let out = "";
  let used = 0;
  for (const ch of line) {
    const w = displayWidth(ch);
    if (out && used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return out + "…";
};

/** One column of the fan: who it is, how it is doing, what it runs on. */
interface Column {
  label: string;
  color: string;
  state: string;
  stateColor: string;
  tune: string;
  tuneColor: string;
}

function column(run: AgentRun, now: number, locale: Locale): Column {
  const mascot = isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined;
  const took = formatDuration((run.endedAt ?? now) - run.startedAt, locale);
  const [state, stateColor] =
    run.state === "running"
      ? [`${Math.floor(now / 1000) % 2 ? "◉" : "●"} ${took}`, C.green]
      : run.state === "done"
        ? [`${text("flow.status.done", locale)} ${took}`, C.dim]
        : run.state === "error"
          ? [text("flow.status.error", locale), C.fail]
          : [text("flow.status.aborted", locale, { duration: took }), C.pass];
  return {
    label: run.description.trim() || run.type,
    color: mascot ? hex(mascot.color) : C.blue,
    state,
    stateColor,
    tune: run.effort ?? prettyModel(run.model).split(" ")[0]!.toLowerCase(),
    // Orange where Jev picked it, as in a pre-ship check where one group runs hotter.
    tuneColor: run.jev ? C.orange : C.dim,
  };
}

/** The pre-ship check the tab shows before any subagent has run: what a wave looks like. */
const SAMPLE: readonly (readonly [LocaleKey, LocaleKey, string])[] = [
  ["flow.sample.design", "flow.sample.checks5", "medium"],
  ["flow.sample.mobile", "flow.sample.checks4", "medium"],
  ["flow.sample.states", "flow.sample.checks4", "medium"],
  ["flow.sample.realUser", "flow.sample.checks3", "high"],
  ["flow.sample.launch", "flow.sample.checks4", "medium"],
];

export interface FlowInput {
  flow: FlowState;
  agents: readonly AgentRun[];
  /** The main session's model and effort. */
  model?: string;
  effort?: string;
  /** The session's directory, for the prompt line at the bottom. */
  cwd?: string;
  now: number;
  width: number;
  locale?: Locale;
}

/** The whole diagram, line by line. */
export function flowLines(input: FlowInput): FlowSegment[][] {
  const locale = input.locale ?? localeFor();
  // As wide as the pane: a narrow one drops the side panel and shortens lines rather than clip them.
  const W = Math.max(20, input.width);
  const wave = waveOf(input.flow, input.agents);
  const sample = wave.length === 0;
  const step = flowStep(input.flow, wave);
  const stage = STAGE[step];
  const cols = sample
    ? SAMPLE.map(([label, state, tune]) => ({ label: text(label, locale), color: C.blue, state: text(state, locale), stateColor: C.ink, tune, tuneColor: tune === "high" ? C.orange : C.dim }))
    : wave.map((run) => column(run, input.now, locale));
  const total = cols.length;
  const toolCalls = wave.reduce((sum, run) => sum + run.tools, 0);
  const returned = wave.filter((run) => run.state !== "running").length;
  const model = prettyModel(input.model);
  const effort = input.effort ?? text("flow.effort.default", locale);

  // Columns of at least 11 characters; the ones that do not fit are counted under the fan.
  const fits = Math.max(1, Math.floor((W - 2) / 11));
  const shown = cols.slice(0, fits);
  const hidden = total - shown.length;
  const colW = Math.min(16, Math.floor((W - 2) / shown.length));
  const D = colW * shown.length;
  const left = Math.floor((W - D) / 2);
  const centers = shown.map((_, i) => left + i * colW + Math.floor(colW / 2));
  const X = left + Math.floor(D / 2);

  // A stage the wave has reached is in color; one still ahead is faint. The sample is all lit.
  const lit = (from: number, color: string) => (sample || stage >= from ? color : C.faint);
  const line = (from: number) => (stage > from || sample ? C.dim : C.faint);

  const g = new Canvas(W);
  let y = 0;

  // Title and rule; a title too long for the pane drops its first words.
  const title: FlowSegment[] = [
    { text: text(sample ? "flow.title.sample" : "flow.title.live", locale), color: C.ink, bold: true },
    { text: model.toUpperCase(), color: C.orange, bold: true },
    { text: " + ", color: C.ink, bold: true },
    { text: `${formatNumber(total, locale)} ${text(total === 1 ? "flow.subagent" : "flow.subagents", locale)}`, color: C.blue, bold: true },
  ];
  g.center(Math.floor(W / 2), y++, title.reduce((s, part) => s + displayWidth(part.text), 0) > W ? title.slice(1) : title);
  g.put(0, y++, "=".repeat(W), { color: C.faint });
  y++;

  // The main session, and beside it what the wave is.
  const pill = ` ${model} · ${effort} `;
  const types = [...new Set(wave.map((run) => run.type))].join(", ");
  const side = [
    [
      { text: text(total === 1 ? "flow.count.subagent" : "flow.count.subagents", locale, { count: formatNumber(total, locale) }), color: C.blue, bold: true },
      { text: " · ", color: C.dim },
      { text: sample ? text("flow.sample.readOnly", locale) : types || text("flow.live.subagents", locale), color: C.blue, bold: true },
    ],
    [{ text: text(sample ? "flow.sample.groups" : "flow.live.tasks", locale), color: C.ink }],
    [],
    [{ text: text("flow.eachOne", locale), color: C.dim }],
    ...(
      [
        [text(sample ? "flow.sample.checksGroup" : "flow.live.worksTask", locale), 1],
        [sample ? text("flow.sample.noEdits", locale) : text("flow.live.toolCalls", locale, { count: formatNumber(toolCalls, locale), unit: text(toolCalls === 1 ? "unit.toolCall" : "unit.toolCalls", locale) }), -1],
        [text(sample ? "flow.sample.returnsList" : "flow.live.reportsBack", locale), 2],
      ] as const
    ).map(([text, at]) =>
      (sample ? at === 1 : stage === at)
        ? [
            { text: "> ", color: C.ink, bold: true },
            { text, color: C.ink, bold: true, bg: C.pill },
          ]
        : [
            { text: "• ", color: C.blue },
            { text, color: C.ink },
          ],
    ),
  ] as FlowSegment[][];
  // The panel sits at the right edge; the pill moves left of the trunk when it needs the room,
  // and a dashed line joins the two, as in the pre-ship check.
  const pillLength = displayWidth(pill);
  const sideWidth = Math.min(28, Math.max(...side.map((parts) => parts.reduce((s, part) => s + displayWidth(part.text), 0))));
  const sideX = W - sideWidth - 1;
  const pillX = Math.min(X - Math.floor(pillLength / 2), sideX - 4 - pillLength);
  const withSide = sideX >= X + 3 && pillX >= 1;
  const sideRoom = W - sideX;
  const top = y;
  if (withSide) {
    const pillEnd = g.write(pillX, y, [{ text: pill, color: C.ink, bold: true, bg: C.pill }]);
    g.put(pillEnd + 1, y, "- ".repeat(Math.ceil((sideX - pillEnd - 2) / 2)).slice(0, sideX - pillEnd - 2), { color: C.dim });
    side.forEach((parts, i) => {
      let room = sideRoom;
      const clipped = parts.map((part) => {
        const text = room > 0 ? fit(part.text, room) : "";
        room -= displayWidth(text);
        return { ...part, text };
      });
      g.write(sideX, top + i, clipped.filter((part) => part.text));
    });
  } else {
    g.center(X, y, [{ text: pill, color: C.ink, bold: true, bg: C.pill }]);
  }
  y++;
  g.center(X, y++, [{ text: text("flow.mainSession", locale), color: C.ink, bg: C.pill }]);
  if (!withSide) g.center(X, y++, side[0]!.map((part) => ({ ...part, text: fit(part.text, W - 4) })));
  g.put(X, y++, "/", { color: C.orange, bold: true });
  while (y < top + (withSide ? side.length : 0)) g.put(X, y++, "|", { color: C.dim });
  g.put(X, y++, "|", { color: C.dim });

  const turnText = input.flow.text ? `“${fit(input.flow.text, Math.max(10, W - 8))}”` : "";
  g.center(X, y++, [
    { text: text("flow.send", locale), color: C.ink },
    { text: sample ? text("flow.sample.checks", locale) : text("flow.tasks", locale, { count: formatNumber(total, locale), unit: text(total === 1 ? "unit.task" : "unit.tasks", locale) }), color: C.blue, bold: true },
  ]);
  g.center(X, y++, [{ text: sample ? text("flow.sample.beforeShip", locale) : turnText || text("flow.fromPrompt", locale), color: sample ? C.ink : C.dim }]);
  g.put(X, y++, "|", { color: C.dim });

  // The fan: a bar out to every column, three rows each, a bar back in.
  const bar = (row: number, color: string) => {
    const from = centers[0]!;
    const to = centers.at(-1)!;
    g.put(from, row, "-".repeat(Math.max(1, to - from + 1)), { color });
    for (const cx of centers) g.put(cx, row, "+", { color });
    g.put(X, row, "+", { color });
  };
  const fanColor = line(0);
  bar(y++, fanColor);
  const pipes = (row: number) => centers.forEach((cx) => g.put(cx, row, "|", { color: fanColor }));
  pipes(y++);
  shown.forEach((col, i) => g.center(centers[i]!, y, [{ text: fit(col.label, colW - 2), color: col.color, bold: true }]));
  y++;
  pipes(y++);
  shown.forEach((col, i) => g.center(centers[i]!, y, [{ text: fit(col.state, colW - 2), color: col.stateColor }]));
  y++;
  pipes(y++);
  shown.forEach((col, i) => g.center(centers[i]!, y, [{ text: fit(col.tune, colW - 2), color: col.tuneColor, bold: col.tuneColor === C.orange }]));
  y++;
  pipes(y++);
  bar(y++, line(1));
  if (hidden > 0) g.center(X, y++, [{ text: text("flow.moreAgents", locale, { count: formatNumber(hidden, locale) }), color: C.dim }]);
  g.put(X, y++, "|", { color: line(1) });

  // Back to the main session, you confirm, one pass of edits.
  const edits = input.flow.edits;
  const files = input.flow.files.length;
  g.center(X, y++, [{ text: text("flow.back", locale), color: lit(2, C.orange), bold: true }]);
  g.center(X, y++, [
    {
      text: sample
        ? text("flow.sample.issues", locale)
        : `${text("flow.answers", locale, { count: formatNumber(returned, locale), total: formatNumber(total, locale), unit: text(returned === 1 ? "unit.answer" : "unit.answers", locale) })} · ${edits ? text("flow.edits", locale, { count: formatNumber(edits, locale), unit: text(edits === 1 ? "unit.edit" : "unit.edits", locale) }) : text("flow.noEdits", locale)}`,
      color: stage >= 2 || sample ? C.ink : C.faint,
    },
  ]);
  g.put(X, y++, "|", { color: line(2) });
  g.center(X, y++, [{ text: text("flow.confirm", locale), color: lit(3, C.you), bold: true }]);
  g.put(X, y++, "\\", { color: lit(3, C.orange), bold: true });
  g.center(X, y++, [
    { text: " " + model.split(" ")[0], color: lit(3, C.orange), bold: true, bg: C.pill },
    { text: text("flow.fixes", locale), color: stage >= 3 || sample ? C.ink : C.faint, bg: C.pill },
  ]);
  g.center(X, y++, [{ text: text("flow.ownsEdits", locale), color: stage >= 3 || sample ? C.ink : C.faint, bg: C.pill }]);
  g.put(X, y++, step === "fix" ? "◉" : "•", { color: step === "fix" ? C.green : line(3) });
  g.center(X, y++, [
    {
      text: sample || !edits ? text("flow.screenshots", locale) : text("flow.files", locale, { edits: formatNumber(edits, locale), editUnit: text(edits === 1 ? "unit.edit" : "unit.edits", locale), files: formatNumber(files, locale), fileUnit: text(files === 1 ? "unit.file" : "unit.files", locale) }),
      color: lit(4, C.green),
      bold: true,
      bg: C.pill,
    },
  ]);
  y++;

  // The motto and the prompt line; on a narrow pane the motto takes a line per sentence.
  const motto: FlowSegment[] = [
    { text: text("flow.checkWith", locale, { count: word(total, locale) }), color: C.blue, bold: true },
    { text: text("flow.confirmMotto", locale), color: C.you, bold: true },
    { text: text("flow.fixWithOne", locale), color: C.green, bold: true },
  ];
  if (motto.reduce((s, part) => s + displayWidth(part.text), 0) <= W) g.center(Math.floor(W / 2), y++, motto);
  else for (const part of motto) g.center(Math.floor(W / 2), y++, [{ ...part, text: part.text.trim() }]);
  y++;
  const labelled: FlowSegment[] = [
    { text: text("flow.step", locale), color: C.dim },
    { text: `[${text(("flow.step." + step) as LocaleKey, locale)}]`, color: C.ink, bold: true },
    { text: text("flow.agents", locale), color: C.dim },
    { text: `[${sample ? 0 : returned}/${total}]`, color: C.blue, bold: true },
    { text: text("flow.editsLabel", locale), color: C.dim },
    { text: `[${edits}]`, color: edits ? C.green : C.dim, bold: edits > 0 },
  ];
  // Too long for the pane, the status keeps its figures and drops their labels.
  const status = displayWidth(labelled.map((part) => part.text).join("")) <= W ? labelled : labelled.filter((_, i) => i % 2).flatMap((part, i) => (i ? [{ text: " ", color: C.dim }, part] : [part]));
  const statusLength = status.reduce((s, part) => s + displayWidth(part.text), 0);
  const dir = input.cwd ? "~/" + (input.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "") : "~";
  const promptRoom = W - statusLength - 2;
  if (promptRoom >= 6) {
    g.write(0, y, [
      { text: fit(`${dir} $`, promptRoom - 2), color: C.green, bold: true },
      { text: " ▌", color: C.ink },
    ]);
    g.write(W - statusLength, y, status);
  } else {
    g.write(Math.max(0, W - statusLength), y, status);
  }
  return g.lines();
}
