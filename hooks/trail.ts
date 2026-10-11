// The Flow tab as a log of events: for each request, what Pingo actually did, in the order it happened. The
// message, the controlled advisor's decision (its branch, marked down its lines, when it was on), every Jev call,
// every model request with its model and effort, every tool with its result, each subagent's work and result, the
// native advisor's calls and the answer, each with its glyph and its time, its details indented under it. Pure: the
// pane draws exactly these lines, and a test reads them.
import { localeFor, formatClock, text } from "./i18n.ts";
import { GLYPH } from "./theme.ts";
import { adviceEvents, messageEvents, runEvents, C, since, type TrailInput } from "./trail/events.ts";
import { draw } from "./trail/draw.ts";
import { wrap, type TrailSegment } from "./trail/format.ts";

export { prettyModel } from "./trail/format.ts";
export type { TrailInput } from "./trail/events.ts";
const RUNS_SHOWN = 6;

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
