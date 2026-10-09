// The Flow tab: one run as observed, from the message through Jev and the main loop, out to tools,
// subagents and advisor calls, to the answer and its edits; earlier runs listed under it. The
// branches appear in the order they first happened, since tools, subagents and the advisor can
// come in any order and more than once. Drawn as a grid of characters so the trunk lines up; pure,
// so a test sees exactly what the pane draws.
import type { TraceAgent, TraceMessage, TraceRun, TraceState } from "../types";
import { DOT, hex } from "./dots.ts";
import { GLYPH, PAINT } from "./theme.ts";
import { formatClock, formatDuration, formatNumber, localeFor, text, type Locale, type LocaleKey } from "./i18n.ts";
import { displayWidth } from "./layout.ts";
import { confirmedModels, isDone, runTiming } from "./trace.ts";

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

/** One cell of the drawing: a character and how it is painted. */
type Style = { color: string; bold?: boolean; bg?: string };
export type FlowSegment = { text: string } & Style;

// Text in the drawing follows the person's theme (PAINT); the hues that name a node keep their mid-tone hex.
const C: Record<"ink" | "dim" | "faint" | "blue" | "orange" | "you" | "green" | "fail" | "pass", string> = {
  ink: PAINT.text,
  dim: PAINT.muted,
  faint: PAINT.rule,
  blue: hex(DOT.base),
  orange: PAINT.claude,
  you: PAINT.you,
  green: PAINT.ok,
  fail: PAINT.fail,
  pass: PAINT.warn,
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
    let x = Math.max(0, cx - Math.floor(length / 2));
    for (const { text, ...style } of parts) {
      this.put(x, y, text, style);
      x += displayWidth(text);
    }
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

/** Word-wrapped to `width` columns, at most `max` lines: the last one cut with "…" when more is left. */
function wrap(text: string, width: number, max = 3): string[] {
  const room = Math.max(1, width);
  const lines: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    const joined = line ? `${line} ${word}` : word;
    if (displayWidth(joined) <= room) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    // A word wider than the room takes lines of its own.
    while (displayWidth(line) > room) {
      let head = "";
      for (const ch of line) {
        if (head && displayWidth(head + ch) > room) break;
        head += ch;
      }
      lines.push(head);
      line = line.slice(head.length);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), fit(lines.slice(max - 1).join(" ") + " …", room)];
}

/** One line of a node's details: a sentence in one color. */
type Detail = { text: string; color: string; bold?: boolean };

/** A node of the run: its glyph on the trunk, its name, and what it came to. */
export type NodeId = "message" | "jev" | "main" | "tools" | "agents" | "advisor" | "answer";

interface FlowNode {
  id: NodeId;
  glyph: string;
  color: string;
  label: string;
  details: Detail[];
  /** Tools, subagents and the advisor branch off the trunk; the rest sit on it. */
  branch?: boolean;
}

const LABELS: readonly LocaleKey[] = ["flow.node.message", "flow.node.jev", "flow.node.main", "flow.node.tools", "flow.node.agents", "flow.node.advisor", "flow.node.answer"];
const MAX_AGENT_LINES = 6;
/** Columns between boxes side by side. */
const GAP = 2;
/** The narrowest a subagent card gets before the row wraps. */
const AGENT_CARD = 22;
const MAX_ADVISOR_LINES = 4;
const MAX_RECEIVED_LINES = 3;

export interface FlowInput {
  trace: TraceState;
  now: number;
  width: number;
  locale?: Locale;
}

const duration = (from: number, to: number, locale: Locale) => formatDuration(to - from, locale);
const unit = (count: number, one: LocaleKey, many: LocaleKey, locale: Locale) => text(count === 1 ? one : many, locale);
const list = (items: readonly string[]) => items.join(", ");

/** The run the tab draws: the one running, else the latest. */
export const shownRun = (trace: TraceState): TraceRun | undefined => trace.runs.find((run) => run.id === trace.active) ?? trace.runs.at(-1);

function messageNode(run: TraceRun, locale: Locale): FlowNode {
  const details: Detail[] = [];
  if (run.kind === "message" && run.message) {
    details.push({ text: text("flow.message.text", locale, { text: run.message.text }), color: C.ink, bold: true });
    const origin = run.message.origin !== "composer" ? ` · ${text("flow.message.origin", locale, { origin: run.message.origin })}` : "";
    details.push({ text: formatClock(run.message.at, locale) + origin, color: C.faint });
  } else if (run.kind === "continuation") {
    details.push({ text: text("flow.message.continuation", locale), color: C.dim });
  } else {
    details.push({ text: run.text ? text("flow.message.unlinked", locale, { text: run.text }) : text("flow.message.noText", locale), color: C.dim });
  }
  for (const message of run.received.slice(-MAX_RECEIVED_LINES)) details.push({ text: text("flow.message.received", locale, { text: message.text }), color: C.pass });
  return { id: "message", glyph: "●", color: C.you, label: text("flow.node.message", locale), details };
}

function jevNode(run: TraceRun, locale: Locale): FlowNode {
  const plan = run.message?.plan;
  const details: Detail[] = [];
  let color = C.dim;
  if (plan) {
    const key: LocaleKey = plan.outcome === "consulted" ? "flow.jev.consulted" : plan.outcome === "declined" ? "flow.jev.declined" : plan.outcome === "failed" ? "flow.jev.failed" : "flow.jev.skipped";
    color = plan.outcome === "consulted" ? C.green : plan.outcome === "failed" ? C.fail : C.dim;
    details.push({ text: text(key, locale, { summary: plan.summary, reason: plan.summary }), color });
  } else {
    details.push({ text: text(run.consultCount ? "flow.jev.noMainCall" as LocaleKey : "flow.jev.notAsked", locale), color: C.dim });
  }
  if (run.consultCount) {
    const failed = run.consults.filter((one) => one.error).length;
    const asking = run.consults.some((one) => one.endedAt === undefined);
    details.push({
      text: [
        text("flow.jev.calls", locale, { count: formatNumber(run.consultCount, locale), unit: unit(run.consultCount, "unit.jevCall", "unit.jevCalls", locale) }),
        failed ? text("flow.jev.callsFailed", locale, { count: formatNumber(failed, locale) }) : "",
        asking ? `◉ ${text("flow.jev.asking", locale)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      color: failed ? C.fail : C.dim,
    });
  }
  return { id: "jev", glyph: "◆", color, label: text("flow.node.jev", locale), details };
}

function mainNode(run: TraceRun, now: number, locale: Locale): FlowNode {
  const { original, sent, observed, effort, requests } = run.main;
  const models = [
    original ? prettyModel(original) : "—",
    sent.some((model) => model !== original) ? text("flow.main.sent", locale, { model: list(sent.map(prettyModel)) }) : "",
    observed.length ? text("flow.main.answered", locale, { model: list(observed.map(prettyModel)) }) : text("flow.main.noAnswer", locale),
  ].filter(Boolean);
  const last = run.steps.findLast((step) => !step.agentId);
  const responding = run.endedAt === undefined && last !== undefined && last.endedAt === undefined;
  return {
    id: "main",
    glyph: "◆",
    color: C.orange,
    label: text("flow.node.main", locale),
    details: [
      { text: models.join(" → "), color: C.ink, bold: true },
      {
        text: [
          text("flow.main.requests", locale, { count: formatNumber(requests, locale), unit: unit(requests, "unit.request", "unit.requests", locale) }),
          effort ? text("flow.main.effort", locale, { effort }) : "",
          responding ? `${Math.floor(now / 1000) % 2 ? "◉" : "●"} ${text("flow.main.responding", locale)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        color: responding ? C.green : C.dim,
      },
    ],
  };
}

function toolsNode(run: TraceRun, locale: Locale): FlowNode {
  const groups = Object.entries(run.toolSources)
    .sort(([, a], [, b]) => b - a)
    .map(([source, count]) => {
      const n = formatNumber(count, locale);
      if (source.startsWith("mcp:")) return text("flow.tools.mcp", locale, { server: source.slice(4), count: n });
      if (source.startsWith("server:")) return text("flow.tools.server", locale, { name: source.slice(7), count: n });
      return text("flow.tools.builtin", locale, { count: n });
    });
  const running = run.tools.filter((tool) => tool.endedAt === undefined && !tool.source.startsWith("server:")).map((tool) => tool.name);
  const trouble = [
    run.denied ? text("flow.tools.denied", locale, { count: formatNumber(run.denied, locale) }) : "",
    run.failed ? text("flow.tools.failed", locale, { count: formatNumber(run.failed, locale) }) : "",
  ].filter(Boolean);
  return {
    id: "tools",
    glyph: "▸",
    color: C.blue,
    label: text("flow.node.tools", locale),
    branch: true,
    details: [
      { text: groups.join(" · "), color: C.ink },
      ...(trouble.length ? [{ text: trouble.join(" · "), color: run.failed ? C.fail : C.pass }] : []),
      ...(running.length ? [{ text: `◉ ${text("flow.tools.running", locale, { tool: list([...new Set(running)]) })}`, color: C.green }] : []),
    ],
  };
}

function agentStatus(agent: TraceAgent, now: number, locale: Locale): [string, string] {
  const took = duration(agent.startedAt, agent.endedAt ?? now, locale);
  return agent.state === "running"
    ? [text("flow.agent.running", locale, { duration: took }), C.green]
    : agent.state === "done"
      ? [text("flow.agent.done", locale, { duration: took }), C.dim]
      : agent.state === "error"
        ? [text("flow.agent.error", locale), C.fail]
        : [text("flow.agent.aborted", locale, { duration: took }), C.pass];
}

function agentLine(agent: TraceAgent, now: number, locale: Locale): Detail {
  const [state, color] = agentStatus(agent, now, locale);
  const models = agent.observed.length
    ? text("flow.agent.observed" as LocaleKey, locale, { models: list(agent.observed.map(prettyModel)) })
    : text("flow.agent.noModel", locale);
  return {
    text: [
      agent.description ? `${agent.type} “${agent.description}”` : agent.type,
      state,
      agent.model ? text("flow.agent.startedModel" as LocaleKey, locale, { model: prettyModel(agent.model) }) : "",
      agent.effort ? text("flow.agent.effort" as LocaleKey, locale, { effort: agent.effort }) : "",
      models,
      agent.background ? text("flow.agent.background", locale) : "",
    ].filter(Boolean).join(" · "),
    color,
  };
}

function agentsNode(run: TraceRun, now: number, locale: Locale): FlowNode {
  const shown = run.agents.slice(-MAX_AGENT_LINES);
  const hidden = run.agents.length - shown.length;
  return {
    id: "agents",
    glyph: "◇",
    color: C.blue,
    label: text("flow.node.agents", locale),
    branch: true,
    details: [...(hidden > 0 ? [{ text: `+${formatNumber(hidden, locale)}`, color: C.faint }] : []), ...shown.map((agent) => agentLine(agent, now, locale))],
  };
}

function advisorNode(run: TraceRun, trace: TraceState, locale: Locale): FlowNode {
  const calls = run.advisor;
  const details: Detail[] = [];
  if (calls.length) {
    const ended = calls.filter((call) => call.endedAt !== undefined).length;
    details.push({ text: text("flow.advisor.calls", locale, { count: formatNumber(calls.length, locale), unit: unit(calls.length, "unit.call", "unit.calls", locale) }), color: C.ink, bold: true });
    details.push({
      text: [
        ended ? text("flow.advisor.withResult", locale, { count: formatNumber(ended, locale) }) : "",
        calls.length - ended ? text("flow.advisor.noResult", locale, { count: formatNumber(calls.length - ended, locale) }) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      color: C.dim,
    });
    for (const call of calls.slice(-MAX_ADVISOR_LINES)) {
      const owner = call.agentId ? (run.agents.find((agent) => agent.id === call.agentId)?.type ?? call.agentId) : text("flow.advisor.main", locale);
      details.push({
        text: text("flow.advisor.call", locale, { owner, step: formatNumber(call.step + 1, locale), state: text(call.endedAt !== undefined ? "flow.advisor.received" : "flow.advisor.notObserved", locale) }),
        color: call.endedAt !== undefined ? C.dim : C.pass,
      });
    }
  } else {
    details.push({ text: text("flow.advisor.none", locale), color: C.dim });
  }
  if (trace.advisor?.configured) details.push({ text: text("flow.advisor.configured", locale, { model: prettyModel(trace.advisor.configured) }), color: C.dim });
  const blocked = trace.advisor?.blocked;
  if (blocked) details.push({ text: text("flow.advisor.blocked", locale, { reason: text(`flow.advisor.blocked.${blocked.kind}`, locale, { variable: blocked.variable }) }), color: C.pass });
  if (calls.length) details.push({ text: text("flow.advisor.unexposed", locale), color: C.faint });
  return { id: "advisor", glyph: "◈", color: C.pass, label: text("flow.node.advisor", locale), branch: true, details };
}

function answerNode(run: TraceRun, now: number, locale: Locale): FlowNode {
  const details: Detail[] = [];
  let color = C.green;
  let glyph = "●";
  if (run.endedAt === undefined) {
    glyph = Math.floor(now / 1000) % 2 ? "◉" : "●";
    details.push({ text: text("flow.answer.running", locale, { duration: duration(run.startedAt, now, locale) }), color: C.green });
  } else {
    const reason = run.reason ?? "answer";
    color = reason === "answer" ? C.green : reason === "aborted" ? C.pass : reason === "superseded" ? C.dim : C.fail;
    details.push({ text: text(`flow.answer.${reason}` as LocaleKey, locale, { duration: duration(run.startedAt, run.endedAt, locale) }), color, bold: true });
  }
  details.push({
    text: run.edits
      ? text("flow.answer.edits", locale, {
          edits: formatNumber(run.edits, locale),
          editUnit: unit(run.edits, "unit.edit", "unit.edits", locale),
          files: formatNumber(run.files.length, locale),
          fileUnit: unit(run.files.length, "unit.file", "unit.files", locale),
        })
      : text("flow.answer.noEdits", locale),
    color: run.edits ? C.green : C.dim,
  });
  const running = run.agents.filter((agent) => agent.state === "running").length;
  if (run.endedAt !== undefined && running) details.push({ text: text("flow.answer.agentsRunning", locale, { count: formatNumber(running, locale) }), color: C.green });
  // Only the models a response named: an advisor whose model is not exposed is not one of them.
  const models = confirmedModels(run);
  details.push({
    text: models.length ? text("flow.models", locale, { unit: unit(models.length, "unit.model", "unit.models", locale), models: list(models.map(prettyModel)) }) : text("flow.models.none", locale),
    color: C.faint,
  });
  return { id: "answer", glyph, color, label: text("flow.node.answer", locale), details };
}

/** The run's nodes in order: message, Jev, main, then each branch as it first happened, then the answer. */
export function runNodes(run: TraceRun, trace: TraceState, now: number, locale: Locale): FlowNode[] {
  const branches: [number, FlowNode][] = [];
  if (run.toolCount) branches.push([Math.min(...run.tools.map((tool) => tool.startedAt), Infinity), toolsNode(run, locale)]);
  if (run.agents.length) branches.push([Math.min(...run.agents.map((agent) => agent.startedAt)), agentsNode(run, now, locale)]);
  if (run.advisor.length) branches.push([Math.min(...run.advisor.map((call) => call.startedAt)), advisorNode(run, trace, locale)]);
  branches.sort(([a], [b]) => a - b);
  return [messageNode(run, locale), jevNode(run, locale), mainNode(run, now, locale), ...branches.map(([, node]) => node), answerNode(run, now, locale)];
}

/** What the Flow draws at `now`: the run, its nodes, and the one at work. */
export interface FlowScene {
  run?: TraceRun;
  nodes: FlowNode[];
  /** The node at work, by index. Absent when nothing is. */
  active?: number;
}

/**
 * What a run is busy with, from what has been observed: Jev being asked, a tool running, a main
 * response on its way, subagents, or an answer still to come. An advisor call is never inferred
 * from a pause: it is known only once its response has arrived.
 */
function atWork(run: TraceRun): NodeId | undefined {
  if (isDone(run)) return undefined;
  if (run.consults.some((one) => one.endedAt === undefined)) return "jev";
  if (run.tools.some((tool) => tool.endedAt === undefined && !tool.source.startsWith("server:"))) return "tools";
  const last = run.steps.findLast((step) => !step.agentId);
  if (run.endedAt === undefined && last !== undefined && last.endedAt === undefined) return "main";
  if (run.agents.some((agent) => agent.state === "running")) return "agents";
  return run.endedAt === undefined ? "answer" : undefined;
}

/** The scene at `now`, pure: no timer-driven animation. */
export function flowScene(trace: TraceState, now: number, locale: Locale = localeFor()): FlowScene {
  const run = shownRun(trace);
  if (!run) return { nodes: [] };
  const nodes = runNodes(run, trace, now, locale);
  const work = atWork(run);
  const active = work ? nodes.findIndex((node) => node.id === work) : -1;
  return { run, nodes, ...(active > 0 ? { active } : {}) };
}

/** Messages not tied to a run that are worth showing: waiting ones, and ones refused since the run began. */
function inboxShown(trace: TraceState, run: TraceRun | undefined): TraceMessage[] {
  return trace.inbox.filter((message) => message.state === "waiting" || (message.state === "dropped" && (!run || message.at >= run.startedAt)));
}

/** One line for an earlier run: its number, how it ended, what started it, and its figures. */
function earlierLine(run: TraceRun, now: number, locale: Locale): { text: string; color: string } {
  const mark = run.endedAt === undefined ? "◉" : run.reason === "answer" ? GLYPH.ok : run.reason === "aborted" ? "⊘" : run.reason === "superseded" ? "·" : GLYPH.fail;
  const what = run.kind === "message" && run.message ? `“${run.message.text}”` : run.kind === "continuation" ? text("flow.earlier.continuation", locale) : run.text ? `“${run.text}”` : "—";
  const figures = [
    text("flow.earlier.line", locale, {
      requests: formatNumber(run.main.requests, locale),
      requestUnit: unit(run.main.requests, "unit.request", "unit.requests", locale),
      tools: formatNumber(run.toolCount, locale),
      toolUnit: unit(run.toolCount, "unit.toolCall", "unit.toolCalls", locale),
    }),
    run.agents.length ? text("flow.earlier.agents", locale, { count: formatNumber(run.agents.length, locale), unit: unit(run.agents.length, "unit.agent", "unit.agents", locale) }) : "",
    duration(run.startedAt, run.endedAt ?? now, locale),
  ].filter(Boolean);
  const color = run.endedAt === undefined ? C.green : run.reason === "answer" ? C.dim : run.reason === "superseded" ? C.faint : run.reason === "aborted" ? C.pass : C.fail;
  return { text: `#${run.n} ${mark} ${what} · ${figures.join(" · ")}`, color };
}

/** How long a new event stays highlighted in the activity log. */
const FRESH_MS = 2000;

const CHECKPOINT_KINDS = ["plan", "recovery", "completion"] as const;

function checkpointDetails(run: TraceRun, locale: Locale): Detail[] {
  const checkpoints = [...(run.message?.plan?.checkpoints ?? []), ...(run.checkpoints ?? [])];
  return CHECKPOINT_KINDS.flatMap((kind) => {
    const checkpoint = checkpoints.findLast((one) => one.kind === kind);
    if (!checkpoint) return [];
    const label = text(`flow.checkpoint.${kind}` as LocaleKey, locale);
    const owner = checkpoint.agentId
      ? run.agents.find((agent) => agent.id === checkpoint.agentId)?.type ?? checkpoint.agentId.slice(0, 8)
      : "";
    const extra = [owner, checkpoint.tool, checkpoint.attempts ? `×${formatNumber(checkpoint.attempts, locale)}` : ""].filter(Boolean).map((part) => ` · ${part}`).join("");
    return [{ text: `${label} · ${text("flow.checkpoint.detail" as LocaleKey, locale, { at: formatClock(checkpoint.at, locale), detail: extra })}`, color: C.ink }];
  });
}

function drawCard(
  g: Canvas,
  x: number,
  y: number,
  width: number,
  title: string,
  glyph: string,
  color: string,
  details: readonly Detail[],
  active = false,
  maxLinesPerDetail = 2,
  minBottom = 0,
): number {
  // One blank column inside each border, so the text never touches the box.
  const pad = width >= 8 ? 1 : 0;
  const inside = Math.max(1, width - 2 - pad * 2);
  g.put(x, y, `┌${"─".repeat(Math.max(0, width - 2))}┐`, { color, bold: true });
  const heading = fit(` ${glyph ? `${glyph} ` : ""}${title}${active ? " •" : ""} `, Math.max(1, width - 3));
  g.put(x + 1 + pad, y, heading, { color, bold: true });
  let row = y + 1;
  for (const detail of details) {
    if (!detail.text) continue;
    for (const part of wrap(detail.text, inside, maxLinesPerDetail)) {
      g.put(x, row, "│", { color });
      g.put(x + 1 + pad, row++, fit(part, inside), { color: detail.color, ...(detail.bold ? { bold: true } : {}) });
      g.put(x + width - 1, row - 1, "│", { color });
    }
  }
  const bottom = Math.max(row, minBottom);
  while (row < bottom) {
    g.put(x, row, "│", { color });
    g.put(x + width - 1, row++, "│", { color });
  }
  g.put(x, bottom, `└${"─".repeat(Math.max(0, width - 2))}┘`, { color, bold: true });
  return bottom + 1;
}

function agentCardDetails(agent: TraceAgent, now: number, locale: Locale): Detail[] {
  const [state, color] = agentStatus(agent, now, locale);
  return [
    ...(agent.description ? [{ text: agent.description, color: C.dim }] : []),
    { text: state, color },
    ...(agent.model ? [{ text: text("flow.agent.startedModel" as LocaleKey, locale, { model: prettyModel(agent.model) }), color: C.ink }] : []),
    ...(agent.effort ? [{ text: text("flow.agent.effort" as LocaleKey, locale, { effort: agent.effort }), color: C.dim }] : []),
    ...(agent.observed.length
      ? [{ text: text("flow.agent.observed" as LocaleKey, locale, { models: list(agent.observed.map(prettyModel)) }), color: C.ink }]
      : []),
    ...(agent.background ? [{ text: text("flow.agent.background", locale), color: C.faint }] : []),
  ];
}

function recentActivity(run: TraceRun, now: number, locale: Locale): Detail[] {
  const events: { at: number; detail: Detail }[] = [];
  const plan = run.message?.plan;
  if (run.message && plan?.summary) events.push({ at: run.message.at, detail: { text: `${text("flow.node.jev", locale)} · ${plan.summary}`, color: plan.outcome === "failed" ? C.fail : C.dim } });
  for (const tool of run.tools) {
    const result = tool.result;
    const marker = result === "error" ? "✗" : result === "denied" ? "⊘" : result === "ok" ? GLYPH.ok : "◉";
    events.push({ at: tool.endedAt ?? tool.startedAt, detail: { text: `${marker} ${tool.name}`, color: result === "error" ? C.fail : result === "denied" ? C.pass : result === "ok" ? C.dim : C.green } });
  }
  for (const call of run.advisor) {
    const owner = call.agentId ? run.agents.find((agent) => agent.id === call.agentId)?.type ?? call.agentId : text("flow.advisor.main", locale);
    events.push({
      at: call.endedAt ?? call.startedAt,
      detail: {
        text: `${text("flow.node.advisor", locale)} · ${owner} · ${text(call.endedAt !== undefined ? "flow.advisor.received" : "flow.advisor.notObserved", locale)}`,
        color: call.endedAt !== undefined ? C.dim : C.pass,
      },
    });
  }
  for (const agent of run.agents) {
    const [state, color] = agentStatus(agent, agent.endedAt ?? now, locale);
    events.push({ at: agent.endedAt ?? agent.startedAt, detail: { text: `${agent.type} · ${state}`, color } });
  }
  // What just happened flashes for a moment, so the log is seen to move.
  return events
    .sort((a, b) => a.at - b.at)
    .slice(-4)
    .map(({ at, detail }) => {
      const fresh = now - at >= 0 && now - at < FRESH_MS;
      return { ...detail, text: `${formatClock(at, locale)} · ${detail.text}`, ...(fresh ? { color: C.green, bold: true } : {}) };
    });
}

function drawTimeline(g: Canvas, x: number, y: number, width: number, run: TraceRun, now: number, locale: Locale): number {
  const events = [
    ...run.steps.map((step) => {
      const agent = step.agentId ? run.agents.find((one) => one.id === step.agentId) : undefined;
      const owner = step.agentId ? agent?.type ?? text("flow.node.agents", locale) : text("flow.node.lead" as LocaleKey, locale);
      return {
        label: `${owner} · ${prettyModel(step.observed ?? step.sent ?? step.original)}`,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        color: step.agentId ? C.blue : C.orange,
      };
    }),
    ...run.tools.map((tool) => ({
      label: tool.name,
      startedAt: tool.startedAt,
      endedAt: tool.endedAt,
      color: tool.result === "error" ? C.fail : tool.result === "denied" ? C.pass : C.blue,
    })),
    ...run.advisor.map((call) => ({
      label: text("flow.node.advisor", locale),
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      color: C.pass,
    })),
  ].sort((a, b) => a.startedAt - b.startedAt).slice(-8);
  if (events.length === 0) return y;

  g.put(x, y++, text("flow.panel.timeline" as LocaleKey, locale), { color: C.dim, bold: true });
  const labelWidth = Math.min(18, Math.max(8, Math.floor(width * 0.28)));
  const durationWidth = 6;
  const barWidth = Math.max(5, width - labelWidth - durationWidth - 3);
  const minAt = Math.min(...events.map((event) => event.startedAt));
  const maxAt = Math.max(...events.map((event) => event.endedAt ?? now));
  const span = Math.max(1, maxAt - minAt);
  for (const event of events) {
    const finish = event.endedAt ?? now;
    const startAt = Math.max(0, Math.min(barWidth - 1, Math.round(((event.startedAt - minAt) / span) * (barWidth - 1))));
    const endAt = Math.max(startAt, Math.min(barWidth - 1, Math.round(((finish - minAt) / span) * (barWidth - 1))));
    g.put(x, y, fit(event.label, labelWidth), { color: event.color });
    g.put(x + labelWidth + 1, y, "·".repeat(barWidth), { color: C.faint });
    const running = event.endedAt === undefined;
    if (endAt > startAt) {
      g.put(x + labelWidth + 1 + startAt, y, "━".repeat(endAt - startAt + 1), { color: event.color });
    }
    g.put(x + labelWidth + 1 + endAt, y, running ? "●" : "◆", { color: event.color, bold: true });
    g.put(x + labelWidth + 1 + barWidth + 1, y, fit(duration(event.startedAt, finish, locale), durationWidth), { color: C.dim });
    y++;
  }
  return y;
}

function drawWideFlow(g: Canvas, trace: TraceState, scene: FlowScene, now: number, locale: Locale, y: number, width: number): void {
  const run = scene.run;
  if (!run) return;
  // Every gap between boxes is the same: GAP columns side by side, one row stacked.
  const panelWidth = Math.max(32, Math.floor(width * 0.3) + 2);
  const panelX = width - panelWidth;
  const centerWidth = Math.max(1, panelX - GAP);
  const centerX = 0;
  const center = Math.floor(centerWidth / 2);
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const active = scene.active === undefined ? undefined : scene.nodes[scene.active]?.id;
  let end = y;
  /** A box under the one before, one row apart; the active node is marked in place. */
  let first = true;
  const card = (id: NodeId, title: string, glyph: string, color: string, details: readonly Detail[], lines = 1) => {
    if (!first) {
      const atWork = active === id;
      g.put(center, end++, atWork ? "•" : "↓", { color: atWork ? C.green : C.faint, bold: atWork });
    }
    first = false;
    end = drawCard(g, centerX, end, centerWidth, title, glyph, color, details, active === id && id !== "message", lines);
  };

  const message = nodes.get("message");
  if (message) card("message", message.label, message.glyph, message.color, message.details, 2);

  const main = nodes.get("main");
  if (main) {
    const model = run.main.observed.at(-1) ?? run.main.sent.at(-1) ?? run.main.original;
    card("main", `${text("flow.node.lead" as LocaleKey, locale)}${model ? ` · ${prettyModel(model)}` : ""}`, main.glyph, main.color, main.details);
  }

  const jev = nodes.get("jev");
  if (jev) card("jev", jev.label, jev.glyph, jev.color, jev.details);

  const tools = nodes.get("tools");
  if (tools) card("tools", tools.label, tools.glyph, tools.color, tools.details);

  const agents = run.agents.slice(-MAX_AGENT_LINES);
  const hidden = run.agents.length - agents.length;
  if (agents.length) {
    card("agents", text("flow.node.dispatcher" as LocaleKey, locale), "◇", C.blue, [
      { text: text("flow.dispatcher.count" as LocaleKey, locale, { count: formatNumber(run.agents.length, locale) }) + (hidden ? ` · +${formatNumber(hidden, locale)}` : ""), color: C.ink, bold: true },
    ]);
    // As many subagent cards to a row as fit, the rows one row apart like every other box.
    const columns = Math.min(agents.length, Math.max(1, Math.floor((centerWidth + GAP) / (AGENT_CARD + GAP))));
    const cardWidth = Math.floor((centerWidth - GAP * (columns - 1)) / columns);
    for (let i = 0; i < agents.length; i += columns) {
      const row = agents.slice(i, i + columns);
      g.put(center, end++, "↓", { color: C.faint });
      let rowEnd = end;
      row.forEach((agent, column) => {
        const [_, color] = agentStatus(agent, now, locale);
        // The last card takes the columns left over, so every row ends where the boxes above do.
        const left = centerX + column * (cardWidth + GAP);
        const span = column === columns - 1 ? centerX + centerWidth - left : cardWidth;
        rowEnd = Math.max(rowEnd, drawCard(g, left, end, span, agent.type, "◇", color, agentCardDetails(agent, now, locale), agent.state === "running", 1));
      });
      end = rowEnd;
    }
  }

  const answer = nodes.get("answer");
  if (answer) card("answer", text("flow.node.return" as LocaleKey, locale), answer.glyph, answer.color, answer.details);

  // Under the tree, in its column: the summary, the timeline and the live log; the advisor runs beside them.
  end++;
  g.put(0, end++, fit(flowSummary(trace, locale, now), centerWidth), { color: C.dim });
  end = drawTimeline(g, 0, end, centerWidth, run, now, locale);
  end = drawCard(g, 0, end + 1, centerWidth, text("flow.panel.log" as LocaleKey, locale), "·", C.dim, recentActivity(run, now, locale), false, 1);
  const treeEnd = end;

  const earlier = trace.runs.filter((one) => one.id !== run.id).reverse();
  const advisor = advisorNode(run, trace, locale);
  const checkpoints = checkpointDetails(run, locale);
  const sideDetails: Detail[] = [
    ...checkpoints,
    ...(run.advisor.length ? [...(checkpoints.length ? [{ text: advisor.label, color: C.dim, bold: true }] : []), ...advisor.details] : []),
  ];
  const panelEnd = sideDetails.length
    ? drawCard(
        g,
        panelX,
        y,
        panelWidth,
        checkpoints.length ? text("flow.panel.checkpoints" as LocaleKey, locale) : advisor.label,
        checkpoints.length ? "·" : advisor.glyph,
        checkpoints.length ? C.dim : advisor.color,
        sideDetails,
        false,
        6,
        treeEnd - 1,
      )
    : y;

  let lower = Math.max(treeEnd, panelEnd);
  if (earlier.length) {
    lower++;
    g.put(0, lower++, fit(text("flow.earlier", locale), width), { color: C.dim, bold: true });
    for (const one of earlier) {
      const line = earlierLine(one, now, locale);
      g.put(0, lower++, fit(line.text, width), { color: line.color });
    }
  }
}

/** The whole tab, line by line, at most `width` columns each. */
export function flowLines(input: FlowInput): FlowSegment[][] {
  const locale = input.locale ?? localeFor();
  const W = Math.max(1, input.width);
  const { trace, now } = input;
  const scene = flowScene(trace, now, locale);
  const run = scene.run;
  const waiting = inboxShown(trace, run);
  const g = new Canvas(W);
  let y = 0;

  if (!run && waiting.length === 0) {
    for (const line of wrap(text("flow.empty", locale), W, 8)) g.put(0, y++, line, { color: C.dim });
    return g.lines();
  }

  // Title and rule.
  const title: FlowSegment[] = run
    ? [
        { text: text("flow.title", locale, { n: formatNumber(run.n, locale) }), color: C.ink, bold: true },
        ...(isDone(run) ? [] : [{ text: text("flow.title.running", locale), color: C.green, bold: true }]),
      ]
    : [{ text: "FLOW", color: C.ink, bold: true }];
  g.center(Math.floor(W / 2), y++, title);
  g.put(0, y++, "=".repeat(W), { color: C.faint });

  for (const message of waiting) {
    const line = message.state === "dropped" ? text("flow.message.dropped", locale, { text: message.text, reason: message.dropped ?? "" }) : text("flow.message.waiting", locale, { text: message.text });
    for (const part of wrap(line, W, 2)) g.put(0, y++, part, { color: message.state === "dropped" ? C.fail : C.you });
  }
  if (!run) return g.lines();
  if (W >= 90) {
    drawWideFlow(g, trace, scene, now, locale, y, W);
    return g.lines();
  }
  y++;

  // The nodes on the trunk. Wide panes put the details beside the label; narrow ones under it.
  const labelWidth = Math.min(11, Math.max(...LABELS.map((key) => displayWidth(text(key, locale)))));
  const besideX = 3 + labelWidth + 1;
  const beside = W - besideX >= 24;
  const detailX = beside ? besideX : 3;
  const nodes = scene.nodes;
  /** The row each node's glyph sits on, for the active marker. */
  const rows: number[] = [];
  nodes.forEach((node, i) => {
    rows.push(y);
    const last = i === nodes.length - 1;
    const trunk = () => {
      if (!last) g.put(0, y, "│", { color: C.faint });
    };
    g.put(0, y, node.branch ? "├" : node.glyph, { color: node.branch ? C.faint : node.color, bold: true });
    if (node.branch) g.put(1, y, node.glyph, { color: node.color, bold: true });
    g.put(3, y, fit(node.label, Math.max(1, W - 3)), { color: node.color, bold: true });
    let first = beside;
    if (!beside) y++;
    for (const detail of node.details) {
      for (const part of wrap(detail.text, W - detailX)) {
        if (!first) trunk();
        g.put(detailX, y++, part, { color: detail.color, ...(detail.bold ? { bold: true } : {}) });
        first = false;
      }
    }
    if (first) y++;
    if (!last) g.put(0, y++, "│", { color: C.faint });
  });
  // Mark the active node in the gap above it.
  if (scene.active !== undefined) {
    const row = rows[scene.active]! - 1;
    if (row > rows[scene.active - 1]!) g.put(0, row, "•", { color: C.green, bold: true });
  }

  const checkpoints = checkpointDetails(run, locale);
  if (checkpoints.length) {
    y++;
    g.put(0, y++, fit(text("flow.panel.checkpoints" as LocaleKey, locale), W), { color: C.dim, bold: true });
    for (const detail of checkpoints) {
      for (const part of wrap(detail.text, W, 2)) g.put(0, y++, part, { color: detail.color });
    }
  }

  // Earlier runs, newest first.
  const earlier = trace.runs.filter((one) => one.id !== run.id).reverse();
  if (earlier.length) {
    y++;
    g.put(0, y++, fit(text("flow.earlier", locale), W), { color: C.dim, bold: true });
    for (const one of earlier) {
      const line = earlierLine(one, now, locale);
      g.put(0, y++, fit(line.text, W), { color: line.color });
    }
  }
  return g.lines();
}

/** One line for the surfaces that draw no diagram, and for `/jev status`. */
export function flowSummary(trace: TraceState, locale: Locale = localeFor(), now = Date.now()): string {
  const run = shownRun(trace);
  if (!run) return text("flow.status.empty", locale);
  const timing = runTiming(run, now);
  const requests = run.main.requests + run.agents.reduce((sum, agent) => sum + agent.requests, 0);
  return text("flow.status.line", locale, {
    n: formatNumber(run.n, locale),
    state: timing.complete ? text("flow.state.ended", locale) : text("flow.state.running", locale),
    main: timing.mainResponseMs === undefined ? text("ui.flow.timing.pending", locale) : formatDuration(timing.mainResponseMs, locale),
    total: formatDuration(timing.totalMs, locale),
    requests: formatNumber(requests, locale),
    requestUnit: unit(requests, "unit.request", "unit.requests", locale),
    tools: formatNumber(run.toolCount, locale),
    toolUnit: unit(run.toolCount, "unit.toolCall", "unit.toolCalls", locale),
    agents: formatNumber(run.agents.length, locale),
    agentUnit: unit(run.agents.length, "unit.agent", "unit.agents", locale),
    advisor: formatNumber(run.advisor.length, locale),
    advisorUnit: text(run.advisor.length === 1 ? "flow.status.advisorCall" : "flow.status.advisorCalls", locale),
  });
}
