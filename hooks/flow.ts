// The Flow tab: the latest batch of subagents drawn as one diagram. The main session sends a
// wave of subagents out, each works its task, the answers come back to the main session, you
// confirm, and the main loop makes the edits in one pass. Drawn as a grid of characters so the
// lines and branches line up like ASCII art; pure, so a test sees exactly what the pane draws.
import type { AgentRun, FlowState } from "../types";
import { AGENT_MASCOTS, isMascot } from "./mascots/agents.ts";
import { DOT, hex } from "./dots.ts";

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
  return flow.wave.map((n) => agents.find((run) => run.n === n)).filter((run): run is AgentRun => run !== undefined);
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function prettyModel(id: string | undefined): string {
  if (!id) return "Claude";
  const match = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id);
  if (!match) return id.replace(/^claude-/, "");
  const family = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1).toLowerCase();
  return `${family} ${match[2]}${match[3] && match[3].length < 3 ? `.${match[3]}` : ""}`;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);

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
    [...text].forEach((ch, i) => {
      if (x + i >= 0 && x + i < this.width) row[x + i] = { ch, style };
    });
  }
  /** Several runs in a row, starting at x; returns where they end. */
  write(x: number, y: number, parts: readonly FlowSegment[]): number {
    for (const { text, ...style } of parts) {
      this.put(x, y, text, style);
      x += [...text].length;
    }
    return x;
  }
  /** Runs centered on column cx. */
  center(cx: number, y: number, parts: readonly FlowSegment[]) {
    const length = parts.reduce((sum, part) => sum + [...part.text].length, 0);
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

const fit = (text: string, width: number) => {
  const chars = [...text.replace(/\s+/g, " ")];
  return chars.length > width ? chars.slice(0, Math.max(1, width - 1)).join("") + "…" : chars.join("");
};

function secs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`;
}

/** One column of the fan: who it is, how it is doing, what it runs on. */
interface Column {
  label: string;
  color: string;
  state: string;
  stateColor: string;
  tune: string;
  tuneColor: string;
}

function column(run: AgentRun, now: number): Column {
  const mascot = isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined;
  const took = secs((run.endedAt ?? now) - run.startedAt);
  const [state, stateColor] =
    run.state === "running"
      ? [`● ${took}`, C.green]
      : run.state === "done"
        ? [`✓ ${took}`, C.dim]
        : run.state === "error"
          ? [`× error`, C.fail]
          : [`⊘ ${took}`, C.pass];
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
const SAMPLE: Column[] = [
  ["design", "5 checks", "medium"],
  ["mobile", "4 checks", "medium"],
  ["states", "4 checks", "medium"],
  ["real user", "3 checks", "high"],
  ["launch", "4 checks", "medium"],
].map(([label, state, tune]) => ({
  label: label!,
  color: C.blue,
  state: state!,
  stateColor: C.ink,
  tune: tune!,
  tuneColor: tune === "high" ? C.orange : C.dim,
}));

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
}

/** The whole diagram, line by line. */
export function flowLines(input: FlowInput): FlowSegment[][] {
  const W = Math.max(40, input.width);
  const wave = waveOf(input.flow, input.agents);
  const sample = wave.length === 0;
  const step = flowStep(input.flow, wave);
  const stage = STAGE[step];
  const cols = sample ? SAMPLE : wave.map((run) => column(run, input.now));
  const total = cols.length;
  const model = prettyModel(input.model);
  const effort = input.effort ?? "default";

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

  // Title and rule.
  g.center(Math.floor(W / 2), y++, [
    { text: sample ? "PRE-SHIP CHECK · " : "FLOW · ", color: C.ink, bold: true },
    { text: model.toUpperCase(), color: C.orange, bold: true },
    { text: " + ", color: C.ink, bold: true },
    { text: `${total} SUBAGENT${total === 1 ? "" : "S"}`, color: C.blue, bold: true },
  ]);
  g.put(0, y++, "=".repeat(W), { color: C.faint });
  y++;

  // The main session, and beside it what the wave is.
  const pill = ` ${model} · ${effort} `;
  const types = [...new Set(wave.map((run) => run.type))].join(", ");
  const side = [
    [
      { text: `${total} subagent${total === 1 ? "" : "s"}`, color: C.blue, bold: true },
      { text: " · ", color: C.dim },
      { text: sample ? "read-only" : types || "subagents", color: C.blue, bold: true },
    ],
    [{ text: sample ? "one per group" : "one per task", color: C.ink }],
    [],
    [{ text: "Each one:", color: C.dim }],
    ...(
      [
        [sample ? "checks its group" : "works its task", 1],
        [sample ? "edits nothing" : ((n: number) => `${n} tool call${n === 1 ? "" : "s"} so far`)(wave.reduce((s, run) => s + run.tools, 0)), -1],
        [sample ? "returns a list" : "reports back", 2],
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
  const pillLength = [...pill].length;
  const sideWidth = Math.min(28, Math.max(...side.map((parts) => parts.reduce((s, part) => s + [...part.text].length, 0))));
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
        const text = fit(part.text, room);
        room -= [...text].length;
        return { ...part, text };
      });
      g.write(sideX, top + i, clipped.filter((part) => part.text));
    });
  } else {
    g.center(X, y, [{ text: pill, color: C.ink, bold: true, bg: C.pill }]);
  }
  y++;
  g.center(X, y++, [{ text: " main session ", color: C.ink, bg: C.pill }]);
  if (!withSide) g.center(X, y++, side[0]!.map((part) => ({ ...part, text: fit(part.text, W - 4) })));
  g.put(X, y++, "/", { color: C.orange, bold: true });
  while (y < top + (withSide ? side.length : 0)) g.put(X, y++, "|", { color: C.dim });
  g.put(X, y++, "|", { color: C.dim });

  const turnText = input.flow.text ? `“${fit(input.flow.text, Math.max(10, W - 8))}”` : "";
  g.center(X, y++, [
    { text: "send them over ", color: C.ink },
    { text: sample ? "20 checks" : `${total} task${total === 1 ? "" : "s"}`, color: C.blue, bold: true },
  ]);
  g.center(X, y++, [{ text: sample ? "before you ship" : turnText || "from one prompt", color: sample ? C.ink : C.dim }]);
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
  if (hidden > 0) g.center(X, y++, [{ text: `+${hidden} more on the Agents tab`, color: C.dim }]);
  g.put(X, y++, "|", { color: line(1) });

  // Back to the main session, you confirm, one pass of edits.
  const edits = input.flow.edits;
  const files = input.flow.files.length;
  g.center(X, y++, [{ text: "back to main session", color: lit(2, C.orange), bold: true }]);
  g.center(X, y++, [
    {
      text: sample
        ? "one list of issues · no edits yet"
        : `${wave.filter((run) => run.state !== "running").length}/${total} answers · ${edits ? `${edits} edit${edits === 1 ? "" : "s"}` : "no edits yet"}`,
      color: stage >= 2 || sample ? C.ink : C.faint,
    },
  ]);
  g.put(X, y++, "|", { color: line(2) });
  g.center(X, y++, [{ text: "you confirm", color: lit(3, C.you), bold: true }]);
  g.put(X, y++, "\\", { color: lit(3, C.orange), bold: true });
  g.center(X, y++, [
    { text: " " + model.split(" ")[0], color: lit(3, C.orange), bold: true, bg: C.pill },
    { text: " fixes it all in one pass ", color: stage >= 3 || sample ? C.ink : C.faint, bg: C.pill },
  ]);
  g.center(X, y++, [{ text: " main session owns the edits ", color: stage >= 3 || sample ? C.ink : C.faint, bg: C.pill }]);
  g.put(X, y++, step === "fix" ? "◉" : "•", { color: step === "fix" ? C.green : line(3) });
  g.center(X, y++, [
    {
      text: sample || !edits ? " before + after screenshots " : ` ${edits} edit${edits === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"} `,
      color: lit(4, C.green),
      bold: true,
      bg: C.pill,
    },
  ]);
  y++;

  // The motto and the prompt line.
  g.center(Math.floor(W / 2), y++, [
    { text: `Check with ${word(total)}.`, color: C.blue, bold: true },
    { text: "  Confirm.", color: C.you, bold: true },
    { text: "  Fix with one.", color: C.green, bold: true },
  ]);
  y++;
  const done = wave.filter((run) => run.state !== "running").length;
  const status: FlowSegment[] = [
    { text: "step ", color: C.dim },
    { text: `[${step}]`, color: C.ink, bold: true },
    { text: "  agents ", color: C.dim },
    { text: `[${sample ? 0 : done}/${total}]`, color: C.blue, bold: true },
    { text: "  edits ", color: C.dim },
    { text: `[${edits}]`, color: edits ? C.green : C.dim, bold: edits > 0 },
  ];
  const statusLength = status.reduce((s, part) => s + part.text.length, 0);
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
