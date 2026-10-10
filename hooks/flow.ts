// The Flow tab's compact status line; its detailed chronological view is rendered by trail.ts.
import type { TraceRun, TraceState } from "../types";
import { formatDuration, formatNumber, localeFor, text, type Locale, type LocaleKey } from "./i18n.ts";
import { runTiming } from "./trace.ts";

const unit = (count: number, one: LocaleKey, many: LocaleKey, locale: Locale) => text(count === 1 ? one : many, locale);
const shownRun = (trace: TraceState): TraceRun | undefined => trace.runs.find((run) => run.id === trace.active) ?? trace.runs.at(-1);
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
