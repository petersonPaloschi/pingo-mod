// The request log and the dashboard's arithmetic: one RouteEvent per model request, metadata
// only (no prompts, arguments or keys).
import type { RouteEvent, TraceConsult } from "../types";
import { formatAge, formatDecimal, formatNumber, formatPercent, localeFor, reasonTitle, text, type Locale, type LocaleKey } from "./i18n.ts";
import { isJevFailure, reasonCode } from "./core/reasons.ts";
import { GLYPH } from "./theme.ts";

export type { RouteEvent };

export const KEPT_EVENTS = 500;
export const IDLE_MS = 5 * 60 * 1000;

export const RANGES: readonly (readonly [LocaleKey, number])[] = [
  ["range.15m", 15 * 60e3],
  ["range.1h", 60 * 60e3],
  ["range.24h", 24 * 60 * 60e3],
  ["range.all", 0],
];

export type Category = "hint" | "passthrough" | "failed";
const CATEGORY_KEYS: readonly (readonly [Category, LocaleKey])[] = [
  ["hint", "category.hint"],
  ["passthrough", "category.passthrough"],
  ["failed", "category.failed"],
];
export const categories = (locale?: Locale) => CATEGORY_KEYS.map(([id, key]) => [id, text(key, locale)] as const);

/** [who made the call, what it means], for each reason a request was not routed. */
const REASON_KEYS: Record<string, readonly [LocaleKey, LocaleKey]> = {
  no_tools: ["reason.who.notAsked", "reason.no_tools.meaning"],
  no_messages: ["reason.who.notAsked", "reason.no_messages.meaning"],
  unsafe_tool_name: ["reason.who.notAsked", "reason.unsafe_tool_name.meaning"],
  too_many_tools: ["reason.who.notAsked", "reason.too_many_tools.meaning"],
  duplicate_tool_names: ["reason.who.notAsked", "reason.duplicate_tool_names.meaning"],
  reserved_tool_name: ["reason.who.notAsked", "reason.reserved_tool_name.meaning"],
  routing_disabled: ["reason.who.notAsked", "reason.routing_disabled.meaning"],
  no_api_key: ["reason.who.notAsked", "reason.no_api_key.meaning"],
  subagent: ["reason.who.notAsked", "reason.subagent.meaning"],
  not_asked: ["reason.who.notAsked", "reason.not_asked.meaning"],
  features_off: ["reason.who.notAsked", "reason.features_off.meaning"],
  jev_declined: ["reason.who.asked", "reason.jev_declined.meaning"],
  participation_unavailable: ["reason.who.asked", "reason.participation_unavailable.meaning"],
  tools_feature_off: ["reason.who.asked", "reason.tools_feature_off.meaning"],
  low_confidence: ["reason.who.asked", "reason.low_confidence.meaning"],
  jev_answers_disagree: ["reason.who.asked", "reason.jev_answers_disagree.meaning"],
  no_tool_needed: ["reason.who.asked", "reason.no_tool_needed.meaning"],
  hosted_tool_selected: ["reason.who.asked", "reason.hosted_tool_selected.meaning"],
  jev_unknown_tool: ["reason.who.asked", "reason.jev_unknown_tool.meaning"],
  jev_error: ["reason.who.failed", "reason.jev_error.meaning"],
  jev_unexpected_answer: ["reason.who.failed", "reason.jev_unexpected_answer.meaning"],
  router_error: ["reason.who.routerFailed", "reason.router_error.meaning"],
  unknown: ["reason.who.notAsked", "reason.unknown.meaning"],
};

export const failed = (event: RouteEvent) => event.mode === "passthrough" && isJevFailure(event.reason ?? "");
export const category = (event: RouteEvent): Category => (failed(event) ? "failed" : event.mode);
export const routed = (event: RouteEvent) => event.mode !== "passthrough";
export const at = (event: RouteEvent) => Date.parse(event.time);

export const int = (n: number, locale?: Locale) => formatNumber(Math.round(n), locale ?? localeFor());
export const pct = (part: number, whole: number, locale?: Locale) => formatPercent(part, whole, locale ?? localeFor());
export const sum = (events: readonly RouteEvent[], pick: (event: RouteEvent) => number | undefined) =>
  events.reduce((total, event) => total + (pick(event) ?? 0), 0);

export function tally(keys: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const name of keys) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export type StatusKind = "baseline" | "idle" | "failing" | "routing" | "passthrough";
export interface Status {
  kind: StatusKind;
  icon: string;
  title: string;
  text: string;
}

/** The status card: what routing is doing right now. */
export function status(events: readonly RouteEvent[], routing: boolean, now: number, locale?: Locale): Status {
  const recent = events.filter((event) => now - at(event) < IDLE_MS);
  if (!routing) {
    const n = recent.length;
    return {
      kind: "baseline",
      icon: GLYPH.baseline,
      title: text("status.baseline.title", locale),
      text: text("status.baseline.text", locale, {
        count: formatNumber(n, locale ?? "en"),
        requests: text(n === 1 ? "unit.request" : "unit.requests", locale),
      }),
    };
  }
  if (recent.length === 0) {
    const last = events.at(-1);
    return {
      kind: "idle",
      icon: GLYPH.idle,
      title: text("status.idle.title", locale),
      text: text("status.idle.text", locale, {
        last: last ? text("status.idle.last", locale, { age: formatAge(now - at(last), locale ?? localeFor()), mode: text(`category.mode.${last.mode}` as LocaleKey, locale) }) : "",
      }),
    };
  }
  const asked = recent.filter((event) => event.jev || failed(event));
  const latest = asked.at(-1);
  if (latest && failed(latest)) {
    return {
      kind: "failing",
      icon: GLYPH.warn,
      title: text("status.failing.title", locale),
      text: text("status.failing.text", locale, { reason: reasonTitle(latest.reason ?? "unknown", locale) }),
    };
  }
  const decided = recent.filter(routed).length;
  if (decided) {
    return {
      kind: "routing",
      icon: GLYPH.ok,
      title: text("status.routing.title", locale),
      text: text("status.routing.text", locale, {
        decided: formatNumber(decided, locale ?? "en"),
        count: formatNumber(recent.length, locale ?? "en"),
        requests: text(recent.length === 1 ? "unit.request" : "unit.requests", locale),
      }),
    };
  }
  const reasons = tally(recent.map((event) => reasonCode(event.reason ?? "unknown")));
  return {
    kind: "passthrough",
    icon: GLYPH.route,
    title: text("status.passthrough.title", locale),
    text: text("status.passthrough.text", locale, {
      count: formatNumber(recent.length, locale ?? "en"),
      requests: text(recent.length === 1 ? "unit.request" : "unit.requests", locale),
      reason: reasonTitle(reasons[0]?.[0] ?? "unknown", locale),
    }),
  };
}

/** Which Overview section a figure sits in: what happened to requests, Jev's own calls, tokens spent. */
export type TileGroup = "routing" | "jev" | "tokens";

export interface Tile {
  label: string;
  value: string;
  sub: string;
  group: TileGroup;
  /** The note reports a problem, such as failed Jev calls. */
  alert?: boolean;
}

export function tiles(events: readonly RouteEvent[], locale: Locale = localeFor(), consults?: readonly TraceConsult[]): Tile[] {
  const asked = events.filter((event) => event.jev);
  const calls = consults?.length ?? asked.length + events.filter(failed).length;
  const failures = consults ? consults.filter((consult) => consult.error).length : events.filter(failed).length;
  const latencies = (consults
    ? consults.flatMap((consult) => consult.endedAt === undefined ? [] : [Math.max(0, consult.endedAt - consult.startedAt)])
    : asked.map((event) => event.jev!.latencyMs)).sort((a, b) => a - b);
  const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined);
  const tokens = consults
    ? consults.reduce((total, consult) => total + (consult.usage?.input ?? 0), 0)
    : sum(asked, (event) => event.jev?.inputTokens);
  const reportedUsage = consults
    ? consults.filter((consult) => consult.usage?.input !== undefined).length
    : asked.filter((event) => event.jev?.inputTokens !== undefined).length;
  const inputReports = events.filter((event) => event.usage?.input !== undefined || event.usage?.cached !== undefined || event.usage?.cacheWrite !== undefined).length;
  const outputReports = events.filter((event) => event.usage?.output !== undefined).length;
  const completeInputReports = events.filter((event) => event.usage?.input !== undefined && event.usage?.cached !== undefined && event.usage?.cacheWrite !== undefined);
  const input = events.reduce((total, event) => total + (event.usage?.input ?? 0) + (event.usage?.cached ?? 0) + (event.usage?.cacheWrite ?? 0), 0);
  const cacheInput = completeInputReports.reduce((total, event) => total + (event.usage?.input ?? 0) + (event.usage?.cached ?? 0) + (event.usage?.cacheWrite ?? 0), 0);
  const cached = sum(completeInputReports, (event) => event.usage?.cached);
  const cachePercent = cacheInput > 0 ? pct(cached, cacheInput, locale) : "–";
  const decided = events.filter(routed).length;
  const avgLatency = mean(latencies);
  const confidences = consults ? [] : asked.flatMap(({ jev }) => jev?.confidence === undefined ? [] : [jev.confidence]);
  const avgConfidence = mean(confidences);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  return [
    { label: text("tile.requests.label", locale), value: int(events.length, locale), sub: text("tile.requests.sub", locale), group: "routing" },
    { label: text("tile.routed.label", locale), value: pct(decided, events.length, locale), sub: text("tile.routed.sub", locale, { count: int(decided, locale), requests: text(decided === 1 ? "unit.request" : "unit.requests", locale) }), group: "routing" },
    { label: text("tile.passed.label", locale), value: pct(events.length - decided, events.length, locale), sub: text("tile.passed.sub", locale, { count: int(events.length - decided, locale), requests: text(events.length - decided === 1 ? "unit.request" : "unit.requests", locale) }), group: "routing" },
    { label: text("tile.calls.label", locale), value: int(calls, locale), sub: failures ? text("tile.calls.failed", locale, { count: int(failures, locale) }) : text("tile.calls.noneFailed", locale), group: "jev", alert: failures > 0 },
    {
      label: text("tile.latency.label", locale),
      value: avgLatency === undefined ? "–" : int(avgLatency, locale) + " ms",
      sub: p95 === undefined ? text("tile.latency.none", locale) : text("tile.latency.p95", locale, { value: int(p95, locale) }),
      group: "jev",
    },
    ...(consults === undefined ? [{ label: text("tile.confidence.label", locale), value: avgConfidence === undefined ? "–" : formatDecimal(avgConfidence, locale), sub: text("tile.confidence.sub", locale), group: "jev" as const }] : []),
    {
      label: text("tile.input.label", locale),
      value: inputReports ? int(input, locale) : "–",
      sub: completeInputReports.length < events.length
        ? text("tile.input.partial", locale, { percent: cachePercent, reported: int(completeInputReports.length, locale), total: int(events.length, locale) })
        : text("tile.input.sub", locale, { percent: cachePercent }),
      group: "tokens",
    },
    {
      label: text("tile.output.label", locale),
      value: outputReports ? int(sum(events, (event) => event.usage?.output), locale) : "–",
      sub: outputReports < events.length
        ? text("tile.output.partial", locale, { reported: int(outputReports, locale), total: int(events.length, locale) })
        : text("tile.output.sub", locale),
      group: "tokens",
    },
    {
      label: text("tile.jevInput.label", locale),
      value: reportedUsage ? int(tokens, locale) : "–",
      sub: reportedUsage < calls
        ? text("tile.jevInput.partial", locale, { reported: int(reportedUsage, locale), total: int(calls, locale) })
        : text("tile.jevInput.sub", locale),
      group: "tokens",
    },
  ];
}

/** Why requests were not routed, most common first. */
export function reasons(events: readonly RouteEvent[], locale: Locale = localeFor()): { name: string; count: number; who: string; meaning: string }[] {
  const passed = events.filter((event) => !routed(event));
  return tally(passed.map((event) => reasonCode(event.reason ?? "unknown"))).map(([name, count]) => {
    const [whoKey, meaningKey] = REASON_KEYS[name] ?? REASON_KEYS.unknown!;
    return { name, count, who: text(whoKey, locale), meaning: text(meaningKey, locale) };
  });
}
