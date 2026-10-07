// The request log and the dashboard's arithmetic: one RouteEvent per model request, metadata
// only (no prompts, arguments or keys).
import type { RouteEvent } from "../types";
import { formatAge, formatDecimal, formatNumber, formatPercent, localeFor, reasonTitle, text, type Locale, type LocaleKey } from "./i18n.ts";

export type { RouteEvent };

export const KEPT_EVENTS = 500;
export const IDLE_MS = 5 * 60 * 1000;
export const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042;

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

export const reasonKey = (reason: string) =>
  ["jev_error", "router_error"].find((prefix) => reason.startsWith(prefix)) ?? reason;
export const failed = (event: RouteEvent) =>
  event.mode === "passthrough" && ["jev_error", "jev_unexpected_answer"].includes(reasonKey(event.reason ?? ""));
export const category = (event: RouteEvent): Category => (failed(event) ? "failed" : event.mode);
export const routed = (event: RouteEvent) => event.mode !== "passthrough";
export const baseline = (event: RouteEvent) => event.reason === "routing_disabled";
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

export function inRange(events: readonly RouteEvent[], range: number, now: number): RouteEvent[] {
  return range > 0 ? events.filter((event) => now - at(event) < range) : [...events];
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
      icon: "◌",
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
      icon: "–",
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
      icon: "!",
      title: text("status.failing.title", locale),
      text: text("status.failing.text", locale, { reason: reasonTitle(latest.reason ?? "unknown", locale) }),
    };
  }
  const decided = recent.filter(routed).length;
  if (decided) {
    return {
      kind: "routing",
      icon: "✓",
      title: text("status.routing.title", locale),
      text: text("status.routing.text", locale, {
        decided: formatNumber(decided, locale ?? "en"),
        count: formatNumber(recent.length, locale ?? "en"),
        requests: text(recent.length === 1 ? "unit.request" : "unit.requests", locale),
      }),
    };
  }
  const reasons = tally(recent.map((event) => reasonKey(event.reason ?? "unknown")));
  return {
    kind: "passthrough",
    icon: "→",
    title: text("status.passthrough.title", locale),
    text: text("status.passthrough.text", locale, {
      count: formatNumber(recent.length, locale ?? "en"),
      requests: text(recent.length === 1 ? "unit.request" : "unit.requests", locale),
      reason: reasonTitle(reasons[0]?.[0] ?? "unknown", locale),
    }),
  };
}

export interface Tile {
  label: string;
  value: string;
  sub: string;
}

export function tiles(events: readonly RouteEvent[], locale: Locale = localeFor()): Tile[] {
  const asked = events.filter((event) => event.jev);
  const failures = events.filter(failed).length;
  const latencies = asked.map((event) => event.jev!.latencyMs).sort((a, b) => a - b);
  const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined);
  const tokens = sum(asked, (event) => event.jev?.inputTokens);
  const decided = events.filter(routed).length;
  const avgLatency = mean(latencies);
  const confidences = asked.flatMap(({ jev }) => jev?.confidence === undefined ? [] : [jev.confidence]);
  const avgConfidence = mean(confidences);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  return [
    { label: text("tile.requests.label", locale), value: int(events.length, locale), sub: text("tile.requests.sub", locale) },
    { label: text("tile.routed.label", locale), value: pct(decided, events.length, locale), sub: text("tile.routed.sub", locale, { count: int(decided, locale), requests: text(decided === 1 ? "unit.request" : "unit.requests", locale) }) },
    { label: text("tile.passed.label", locale), value: pct(events.length - decided, events.length, locale), sub: text("tile.passed.sub", locale, { count: int(events.length - decided, locale), requests: text(events.length - decided === 1 ? "unit.request" : "unit.requests", locale) }) },
    { label: text("tile.calls.label", locale), value: int(asked.length + failures, locale), sub: failures ? text("tile.calls.failed", locale, { count: int(failures, locale) }) : text("tile.calls.noneFailed", locale) },
    {
      label: text("tile.latency.label", locale),
      value: avgLatency === undefined ? "–" : int(avgLatency, locale) + " ms",
      sub: p95 === undefined ? text("tile.latency.none", locale) : text("tile.latency.p95", locale, { value: int(p95, locale) }),
    },
    { label: text("tile.confidence.label", locale), value: avgConfidence === undefined ? "–" : formatDecimal(avgConfidence, locale), sub: text("tile.confidence.sub", locale) },
    {
      label: text("tile.input.label", locale),
      value: int(sum(events, (event) => event.usage?.input), locale),
      sub: text("tile.input.sub", locale, { percent: pct(sum(events, (event) => event.usage?.cached), sum(events, (event) => event.usage?.input), locale) }),
    },
    { label: text("tile.output.label", locale), value: int(sum(events, (event) => event.usage?.output), locale), sub: text("tile.output.sub", locale) },
    {
      label: text("tile.jevInput.label", locale),
      value: int(tokens, locale),
      sub: text("tile.jevInput.sub", locale, { value: formatDecimal((tokens / 1e6) * JEV_USD_PER_MILLION_INPUT_TOKENS, locale, 4) }),
    },
  ];
}

export interface CompareRow {
  label: string;
  withJev: string;
  without: string;
  delta: string;
}

/** The "Token use: with Jev routing vs. baseline" table. */
export function compare(events: readonly RouteEvent[], locale: Locale = localeFor()): { rows: CompareRow[]; hasBaseline: boolean } {
  const metered = events.filter((event) => event.usage);
  const groups = [metered.filter((event) => !baseline(event)), metered.filter(baseline)] as const;
  const per = (group: RouteEvent[], pick: (event: RouteEvent) => number | undefined) =>
    group.length ? sum(group, pick) / group.length : undefined;
  const cachedShare = (group: RouteEvent[]) => {
    const input = sum(group, (event) => event.usage?.input);
    return input ? (100 * sum(group, (event) => event.usage?.cached)) / input : undefined;
  };
  const number = (value: number) => int(value, locale);
  const measures: [LocaleKey, (group: RouteEvent[]) => number | undefined, (value: number) => string][] = [
    ["compare.metered", (group) => group.length, number],
    ["compare.input", (group) => per(group, (event) => event.usage?.input), number],
    ["compare.cached", cachedShare, (value) => formatPercent(value, 100, locale)],
    ["compare.output", (group) => per(group, (event) => event.usage?.output), number],
    ["compare.seconds", (group) => per(group, (event) => event.durationMs / 1000), (value) => formatDecimal(value, locale, 1)],
    ["compare.totalInput", (group) => sum(group, (event) => event.usage?.input), number],
    ["compare.totalOutput", (group) => sum(group, (event) => event.usage?.output), number],
  ];
  const cell = (value: number | undefined, format: (value: number) => string) =>
    value === undefined || Number.isNaN(value) ? "–" : format(value);
  const rows = measures.map(([label, measure, format], index) => {
    const withJev = measure(groups[0]);
    const without = measure(groups[1]);
    const comparable = index > 0 && index < 5 && withJev !== undefined && without;
    const delta = comparable ? (100 * (withJev - without)) / without : undefined;
    return {
      label: text(label, locale),
      withJev: cell(withJev, format),
      without: cell(without, format),
      delta: delta === undefined || !Number.isFinite(delta) ? "" : (delta > 0 ? "+" : "") + formatPercent(delta, 100, locale),
    };
  });
  return { rows, hasBaseline: groups[1].length > 0 };
}

/** Why requests were not routed, most common first. */
export function reasons(events: readonly RouteEvent[], locale: Locale = localeFor()): { name: string; count: number; who: string; meaning: string }[] {
  const passed = events.filter((event) => !routed(event));
  return tally(passed.map((event) => reasonKey(event.reason ?? "unknown"))).map(([name, count]) => {
    const [whoKey, meaningKey] = REASON_KEYS[name] ?? REASON_KEYS.unknown!;
    return { name, count, who: text(whoKey, locale), meaning: text(meaningKey, locale) };
  });
}

/** 36 buckets of request counts per category, oldest first. */
export function timeline(events: readonly RouteEvent[], range: number, now: number, buckets = 36): Map<Category, number>[] {
  const from = range > 0 ? now - range : Math.min(now - (RANGES[0]?.[1] ?? 0), ...events.map(at));
  const width = Math.max(1, (now - from) / buckets);
  const out = Array.from({ length: buckets }, () => new Map<Category, number>());
  for (const event of events) {
    const index = Math.floor((at(event) - from) / width);
    const bucket = out[Math.min(buckets - 1, index)];
    if (!bucket || index < 0) continue;
    bucket.set(category(event), (bucket.get(category(event)) ?? 0) + 1);
  }
  return out;
}
