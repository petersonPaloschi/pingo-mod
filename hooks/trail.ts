// The Flow tab as a log of events: for each request, what Pingo actually did, in the order it happened. The
// message, the controlled advisor's decision (its branch, marked down its lines, when it was on), every Jev call,
// every model request with its model and effort, every tool with its result, each subagent's work and result, the
// native advisor's calls and the answer, each with its glyph and its time, its details indented under it. Pure: the
// pane draws exactly these lines, and a test reads them.
import type { TraceAdvice, TraceAgent, TraceMessage, TraceRun, TraceState } from "../types";
import { CLAUDE_MODEL, MODEL_NAMES, TIERS } from "./core/contracts.ts";
import { formatClock, formatCompact, formatDuration, localeFor, text, type Locale, type LocaleKey } from "./i18n.ts";
import { displayWidth } from "./layout.ts";
import { css, GLYPH, HUE, PAINT } from "./theme.ts";

// Four hues of the identity name the events; text takes the person's theme.
const C = {
  ink: PAINT.text,
  dim: PAINT.muted,
  rule: PAINT.rule,
  brand: css(HUE.brand),
  amber: css(HUE.warn),
  rose: css(HUE.fail),
  info: css(HUE.info),
} as const;

/** The advisor's branch: a heavy bar in its color down the lines that belong to it. */
const BRANCH = "┃";
const ADVISOR = "◈";
/** Requests drawn, newest first; the trace keeps more. */
const RUNS_SHOWN = 6;
const HEAD_LINES = 2;
const DETAIL_LINES = 3;

type TrailSegment = { text: string; color: string; bold?: boolean; bg?: string };
type Line = { text: string; color: string; bold?: boolean };

/** "claude-opus-5-5" → "Opus 5.5", including older IDs and date suffixes. */
export function prettyModel(id: string | undefined): string {
  if (!id) return "Claude";
  const canonical = Object.values(CLAUDE_MODEL).find((model) => model.id === id);
  if (canonical) return canonical.label;
  const capital = (family: string) => family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  const match = new RegExp(`(${MODEL_NAMES.join("|")})-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`, "i").exec(id);
  if (match) return `${capital(match[1]!)} ${match[2]}${match[3] ? `.${match[3]}` : ""}`;
  const old = new RegExp(`claude-(\\d{1,2})(?:-(\\d{1,2}))?-(${TIERS.join("|")})`, "i").exec(id);
  if (old) return `${capital(old[3]!)} ${old[1]}${old[2] ? `.${old[2]}` : ""}`;
  return id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

const fit = (value: string, width: number) => {
  const line = value.replace(/\s+/g, " ");
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

/** Wraps at word boundaries, breaks long words, and caps details to `max` lines. */
function wrap(value: string, width: number, max = 3): string[] {
  const room = Math.max(1, width);
  const lines: string[] = [];
  let line = "";
  for (const word of value.replace(/\s+/g, " ").trim().split(" ")) {
    const joined = line ? `${line} ${word}` : word;
    if (displayWidth(joined) <= room) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = word;
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

/** One thing that happened: when, its node, its sentence, and the lines under it. */
interface Event {
  at: number;
  /** Ties at the same instant keep the order things happen in: message, advisor, Jev, request, tool, agent, answer. */
  rank: number;
  glyph: string;
  color: string;
  head: string;
  bold?: boolean;
  details: Line[];
  /** The subagent whose loop it ran in, named before the sentence. */
  agent?: string;
  /** Part of the advisor's branch: drawn with its bar. */
  branch?: boolean;
}

export interface TrailInput {
  trace: TraceState;
  now: number;
  width: number;
  locale?: Locale;
}

const since = (from: number, to: number, locale: Locale) => formatDuration(Math.max(0, to - from), locale);
const quote = (value: string) => `“${value.replace(/\s+/g, " ").trim()}”`;
const modelText = (model: string | undefined, effort: string | undefined) => [model ? prettyModel(model) : "", effort ?? ""].filter(Boolean).join(" · ");

function messageEvents(message: TraceMessage | undefined, run: TraceRun | undefined, locale: Locale): Event[] {
  if (!message) {
    if (!run) return [];
    const key: LocaleKey = run.kind === "continuation" ? "trail.message.continuation" : "trail.message.unlinked";
    return [{ at: run.startedAt, rank: 0, glyph: GLYPH.off, color: C.info, head: text(key, locale, { text: run.text }), details: [] }];
  }
  const you = message.origin === "composer" || message.origin === "bridge" || message.origin === "sdk";
  return [{
    at: message.at,
    rank: 0,
    glyph: GLYPH.on,
    color: C.info,
    head: text(you ? "trail.message.you" : "trail.message.from", locale, { text: quote(message.text), origin: message.origin }),
    bold: true,
    details: message.state === "dropped" ? [{ text: text("trail.message.dropped", locale, { why: message.dropped ?? "" }), color: C.rose }] : [],
  }];
}

/** The controlled advisor: its branch when it was on, one line saying why when it was off. */
function adviceEvents(advice: TraceAdvice | undefined, at: number, locale: Locale): Event[] {
  if (!advice) return [{ at, rank: 1, glyph: GLYPH.off, color: C.dim, head: text("trail.advice.none", locale), details: [] }];
  const why = text(`feed.advice.why.${advice.why}` as LocaleKey, locale, {
    score: String(advice.score ?? 0),
    need: String(advice.need ?? 0),
    tier: advice.tier ? text(`feed.advice.tier.${advice.tier}` as LocaleKey, locale) : "",
    purpose: advice.purpose ?? "",
  });
  const decider = text("feed.advice.decider", locale, { decider: text(`feed.advice.decider.${advice.decider}` as LocaleKey, locale) });
  if (!advice.on) {
    return [{ at: advice.at, rank: 1, glyph: GLYPH.off, color: C.dim, head: text("trail.advice.off", locale, { why }), details: [{ text: decider, color: C.dim }] }];
  }
  const details: Line[] = [
    { text: text("trail.advice.why", locale, { why }), color: C.ink },
    { text: decider, color: C.dim },
  ];
  if (advice.signals?.length) details.push({ text: text("feed.advice.signals", locale, { signals: advice.signals.map((signal) => text(`feed.advice.signal.${signal}` as LocaleKey, locale)).join(", ") }), color: C.dim });
  if (advice.source) details.push({ text: text("feed.advice.source", locale, { source: text(`feed.advice.source.${advice.source}` as LocaleKey, locale) }), color: C.dim });
  const events: Event[] = [{
    at: advice.at,
    rank: 1,
    glyph: ADVISOR,
    color: C.amber,
    bold: true,
    branch: true,
    head: advice.model
      ? text("trail.advice.on", locale, { model: modelText(advice.model, advice.effort) })
      : text("trail.advice.onByJev", locale),
    details,
  }];
  if (advice.outcome === "given") {
    events.push({
      at: advice.endedAt ?? advice.at,
      rank: 1,
      glyph: GLYPH.ok,
      color: C.amber,
      branch: true,
      head: text("trail.advice.given", locale, { duration: since(advice.at, advice.endedAt ?? advice.at, locale) }),
      details: advice.guidance ? [{ text: quote(advice.guidance), color: C.ink }] : [],
    });
  } else if (advice.outcome === "failed") {
    events.push({ at: advice.endedAt ?? advice.at, rank: 1, glyph: GLYPH.fail, color: C.rose, branch: true, head: text("trail.advice.failed", locale, { why: advice.problem ?? "" }), details: [] });
  } else {
    events.push({ at: advice.at, rank: 1, glyph: GLYPH.run, color: C.amber, branch: true, head: text("trail.advice.waiting", locale), details: [] });
  }
  return events;
}

function agentName(run: TraceRun, agentId: string | undefined): string | undefined {
  if (!agentId) return undefined;
  return run.agents.find((agent) => agent.id === agentId)?.type ?? agentId;
}

/** What became of a message typed during the turn: read inside it, carried by a later request, or taken back. */
function receivedFate(message: TraceMessage, numberOf: (runId: string) => number | undefined, locale: Locale): Line[] {
  if (message.state === "delivered") return [{ text: text("trail.message.delivered", locale), color: C.dim }];
  if (message.state === "withdrawn") return [{ text: text("trail.message.withdrawn", locale), color: C.amber }];
  if (message.state === "linked" && message.ranIn) {
    const n = numberOf(message.ranIn);
    return [{ text: n === undefined ? text("trail.message.ranLater", locale) : text("trail.message.ranAs", locale, { n: String(n) }), color: C.dim }];
  }
  return [];
}

function runEvents(run: TraceRun, now: number, locale: Locale, numberOf: (runId: string) => number | undefined): Event[] {
  const events: Event[] = [...messageEvents(run.message, run, locale)];
  // queued messages the engine ran together with the first, each as typed
  for (const message of run.also ?? []) events.push(...messageEvents(message, run, locale));
  if (run.message) events.push(...adviceEvents(run.message.advice, run.message.at, locale));
  for (const message of run.received) {
    events.push({ at: message.at, rank: 0, glyph: GLYPH.off, color: C.info, head: text("trail.message.received", locale, { text: quote(message.text) }), details: receivedFate(message, numberOf, locale) });
  }
  for (const consult of run.consults) {
    const purpose = text(`trail.jev.origin.${consult.origin}` as LocaleKey, locale);
    const ended = consult.endedAt !== undefined;
    events.push({
      at: consult.startedAt,
      rank: 2,
      glyph: consult.error ? GLYPH.fail : ended ? GLYPH.on : GLYPH.run,
      color: consult.error ? C.rose : C.brand,
      head: consult.error
        ? text("trail.jev.failed", locale, { purpose, error: consult.error })
        : ended
          ? text("trail.jev.done", locale, { purpose, duration: since(consult.startedAt, consult.endedAt!, locale) })
          : text("trail.jev.asking", locale, { purpose }),
      details: consult.questions.length ? [{ text: text("trail.jev.questions", locale, { questions: consult.questions.join(", ") }), color: C.dim }] : [],
    });
  }
  for (const step of run.steps) {
    const details: Line[] = [];
    if (step.route) details.push({ text: text(`trail.step.route.${step.route}` as LocaleKey, locale), color: step.route === "orchestrated" ? C.ink : C.dim });
    if (step.original !== step.sent) details.push({ text: text("trail.step.switched", locale, { from: prettyModel(step.original), to: prettyModel(step.sent) }), color: C.ink });
    if (step.endedAt !== undefined) {
      const usage = step.usage;
      details.push({
        text: text("trail.step.usage", locale, {
          input: usage?.input === undefined ? "–" : formatCompact(usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0), locale),
          output: usage?.output === undefined ? "–" : formatCompact(usage.output, locale),
          duration: since(step.startedAt, step.endedAt, locale),
        }),
        color: C.dim,
      });
    }
    const agent = agentName(run, step.agentId);
    events.push({
      at: step.startedAt,
      rank: 3,
      glyph: step.endedAt === undefined ? GLYPH.run : GLYPH.on,
      color: C.info,
      head: text("trail.step", locale, { number: String(step.index + 1), model: modelText(step.sent, step.effort) }),
      details,
      ...(agent ? { agent } : {}),
    });
  }
  for (const tool of run.tools) {
    const result = tool.result ?? "running";
    const agent = agentName(run, tool.agentId);
    events.push({
      at: tool.startedAt,
      rank: 4,
      glyph: result === "ok" ? GLYPH.ok : result === "error" ? GLYPH.fail : result === "denied" ? GLYPH.warn : GLYPH.run,
      color: result === "error" ? C.rose : result === "denied" ? C.amber : C.brand,
      head: text("trail.tool", locale, {
        tool: tool.name,
        result: text(`trail.tool.result.${result}` as LocaleKey, locale),
        duration: tool.endedAt === undefined ? "" : ` · ${since(tool.startedAt, tool.endedAt, locale)}`,
      }),
      details: [],
      ...(agent ? { agent } : {}),
    });
  }
  for (const agent of run.agents) events.push(...agentEvents(run, agent, now, locale));
  for (const call of run.advisor) {
    const agent = agentName(run, call.agentId);
    events.push({
      at: call.startedAt,
      rank: 3.5,
      glyph: ADVISOR,
      color: C.amber,
      branch: true,
      head: text("trail.native", locale, {
        step: String(call.step + 1),
        state: text(call.endedAt !== undefined ? "flow.advisor.received" : "flow.advisor.notObserved", locale),
      }),
      details: [],
      ...(agent ? { agent } : {}),
    });
  }
  events.push(answerEvent(run, now, locale));
  return events.sort((a, b) => a.at - b.at || a.rank - b.rank);
}

function agentEvents(run: TraceRun, agent: TraceAgent, now: number, locale: Locale): Event[] {
  const parent = agentName(run, agent.parent);
  const start: Event = {
    at: agent.startedAt,
    rank: 5,
    glyph: GLYPH.on,
    color: C.info,
    bold: true,
    head: text("trail.agent.start", locale, { type: agent.type, description: agent.description }),
    details: agent.model ? [{ text: text("trail.agent.model", locale, { model: prettyModel(agent.model) }), color: C.dim }] : [],
    ...(parent ? { agent: parent } : {}),
  };
  if (agent.state === "running") {
    return [start, { at: now, rank: 5.5, glyph: GLYPH.run, color: C.brand, head: text("trail.agent.running", locale, { type: agent.type, duration: since(agent.startedAt, now, locale) }), details: [], ...(parent ? { agent: parent } : {}) }];
  }
  const failed = agent.state !== "done";
  return [start, {
    at: agent.endedAt ?? agent.startedAt,
    rank: 5.5,
    glyph: failed ? GLYPH.fail : GLYPH.ok,
    color: failed ? C.rose : C.brand,
    head: text(`trail.agent.end.${agent.state}` as LocaleKey, locale, {
      type: agent.type,
      duration: since(agent.startedAt, agent.endedAt ?? agent.startedAt, locale),
      tools: String(agent.tools),
      requests: String(agent.requests),
    }),
    details: agent.result ? [{ text: quote(agent.result), color: C.ink }] : [],
    ...(parent ? { agent: parent } : {}),
  }];
}

function answerEvent(run: TraceRun, now: number, locale: Locale): Event {
  if (run.endedAt === undefined) {
    return { at: now, rank: 9, glyph: GLYPH.run, color: C.brand, head: text("trail.answer.running", locale, { duration: since(run.startedAt, now, locale) }), details: [] };
  }
  const reason = run.reason ?? "answer";
  const ok = reason === "answer";
  return {
    at: run.endedAt,
    rank: 9,
    glyph: ok ? GLYPH.ok : reason === "aborted" || reason === "superseded" ? GLYPH.warn : GLYPH.fail,
    color: ok ? C.brand : reason === "aborted" || reason === "superseded" ? C.amber : C.rose,
    bold: true,
    head: text("trail.answer", locale, { state: text(`flow.answer.${reason}` as LocaleKey, locale, { duration: since(run.startedAt, run.endedAt, locale) }) }),
    details: run.answer ? [{ text: quote(run.answer), color: C.ink }] : [],
  };
}

/** One request's lines: its title, then each event with its time and glyph, what wraps indented under its words. */
function draw(title: Line, events: readonly Event[], width: number, locale: Locale): TrailSegment[][] {
  const times = events.map((event) => formatClock(event.at, locale));
  const timeWidth = Math.max(0, ...times.map(displayWidth));
  // Narrow panes drop the time column before they drop the sentence.
  const timed = width - timeWidth - 3 >= 18;
  const lead = timed ? timeWidth + 1 : 0;
  const room = Math.max(1, width - lead - 2);
  const pad = (value: string) => value + " ".repeat(Math.max(0, timeWidth - displayWidth(value)));
  const lines: TrailSegment[][] = wrap(title.text, width, HEAD_LINES).map((line) => [{ text: line, color: title.color, bold: true }]);
  events.forEach((event, index) => {
    const bar = event.branch ? { text: BRANCH, color: C.amber } : { text: " ", color: C.rule };
    const blank = timed ? [{ text: " ".repeat(lead), color: C.dim }] : [];
    const tag = event.agent ? text("trail.agent.tag", locale, { agent: event.agent }) : "";
    wrap(`${tag}${event.head}`, room, HEAD_LINES).forEach((line, i) => {
      lines.push(i === 0
        ? [...(timed ? [{ text: `${pad(times[index]!)} `, color: C.dim }] : []), { text: event.glyph, color: event.color, bold: true }, { text: ` ${line}`, color: event.branch ? C.amber : C.ink, bold: event.bold ?? false }]
        : [...blank, bar, { text: ` ${line}`, color: event.branch ? C.amber : C.ink, bold: event.bold ?? false }]);
    });
    for (const detail of event.details) {
      for (const line of wrap(detail.text, room, DETAIL_LINES)) lines.push([...blank, bar, { text: ` ${line}`, color: detail.color, bold: detail.bold ?? false }]);
    }
  });
  return lines;
}

/** The Flow tab's lines: a message still entering, then each kept request, newest first. */
export function trailLines(input: TrailInput): TrailSegment[][] {
  const locale = input.locale ?? localeFor();
  const width = Math.max(1, input.width);
  const { trace, now } = input;
  const sections: TrailSegment[][][] = [];
  // A pending message can be waiting for its run, or refused since the latest run began. Old unlinked waits do not
  // stay at the top forever.
  const latest = trace.runs.at(-1)?.startedAt ?? -Infinity;
  const messages = trace.inbox.filter((message) => message.state === "waiting"
    ? message.id === trace.entering || message.at > latest
    : message.state === "dropped" && message.at >= latest);
  for (const message of messages) {
    const entering = message.state === "waiting";
    sections.push(draw(
      { text: text(entering ? "trail.entering" : "trail.refused", locale), color: entering ? C.brand : C.rose },
      [...messageEvents(message, undefined, locale), ...adviceEvents(message.advice, message.at, locale)].sort((a, b) => a.at - b.at || a.rank - b.rank),
      width,
      locale,
    ));
  }
  const runs = [...trace.runs].reverse().slice(0, RUNS_SHOWN);
  const numberOf = (runId: string) => trace.runs.find((run) => run.id === runId)?.n;
  for (const run of runs) {
    const running = run.endedAt === undefined;
    const title = text(running ? "trail.run.running" : "trail.run", locale, {
      n: String(run.n),
      time: formatClock(run.startedAt, locale),
      duration: since(run.startedAt, run.endedAt ?? now, locale),
    });
    sections.push(draw({ text: `${running ? GLYPH.run : GLYPH.on} ${title}`, color: running ? C.brand : C.ink }, runEvents(run, now, locale, numberOf), width, locale));
  }
  if (!sections.length) return wrap(text("trail.empty", locale), width, 4).map((line) => [{ text: line, color: C.dim }]);
  const out: TrailSegment[][] = [];
  sections.forEach((section, index) => {
    if (index) out.push([]);
    out.push(...section);
  });
  if (trace.runs.length > RUNS_SHOWN) {
    out.push([]);
    out.push(...wrap(text("trail.more", locale, { count: String(trace.runs.length - RUNS_SHOWN) }), width, 2).map((line) => [{ text: line, color: C.dim }]));
  }
  return out;
}
