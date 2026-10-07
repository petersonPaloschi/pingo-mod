// The request log and the dashboard's arithmetic: one RouteEvent per model request, metadata
// only (no prompts, arguments or keys).
import type { RouteEvent } from "../types";

export type { RouteEvent };

export const KEPT_EVENTS = 500;
export const IDLE_MS = 5 * 60 * 1000;
export const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042;

export const RANGES: readonly (readonly [string, number])[] = [
  ["15 min", 15 * 60e3],
  ["1 h", 60 * 60e3],
  ["24 h", 24 * 60 * 60e3],
  ["All", 0],
];

export const CATEGORIES = [
  ["hint", "hint — Jev's pick suggested to Claude"],
  ["passthrough", "passthrough — Claude decided"],
  ["failed", "passthrough — Jev failed"],
] as const;
export type Category = (typeof CATEGORIES)[number][0];

/** [who made the call, what it means], for each reason a request was not routed. */
export const REASONS: Record<string, readonly [string, string]> = {
  no_tools: ["Jev not asked", "The request carried no tools, so there was nothing to select."],
  no_messages: ["Jev not asked", "The request had no conversation to decide on."],
  unsafe_tool_name: ["Jev not asked", "A tool's name has spaces, quotes or brackets in it; the router won't repeat it to a model."],
  too_many_tools: ["Jev not asked", "The tool roster is larger than the router can shortlist."],
  duplicate_tool_names: ["Jev not asked", "Two tools share a name."],
  reserved_tool_name: ["Jev not asked", "A tool is named no_tool_needed, which the router reserves."],
  routing_disabled: ["Jev not asked", "Routing is switched off (baseline mode): tokens are metered, Jev is never asked."],
  no_api_key: ["Jev not asked", "No Jev key is configured. Run /jev setup."],
  subagent: ["Jev not asked", "A subagent's request: the mod routes the main conversation only."],
  not_asked: ["Jev not asked", "No routing point came before this request (a parallel tool still running, or a refused call)."],
  features_off: ["Jev not asked", "Every routing feature is switched off (/jev features)."],
  jev_declined: ["Jev asked", "Jev judged the request simple enough to give no hints; its model and effort still apply (Participation feature)."],
  tools_feature_off: ["Jev asked", "The tool hint is off; Jev decided only model, effort or delegation."],
  low_confidence: ["Jev asked", "Jev's confidence was below the minimum confidence setting."],
  jev_answers_disagree: ["Jev asked", "The tool pick and the needs-a-tool check contradicted each other."],
  no_tool_needed: ["Jev asked", "Jev said no tool is needed; left to Claude (a hint never suggests silence)."],
  hosted_tool_selected: ["Jev asked", "Jev picked a provider-run tool."],
  jev_unknown_tool: ["Jev asked", "Jev named a tool that isn't in the roster."],
  jev_error: ["Jev failed", "The Jev call errored or timed out. Check the key (/jev setup) and the network."],
  jev_unexpected_answer: ["Jev failed", "Jev's reply didn't contain the expected answers."],
  router_error: ["Router failed", "The mod hit a bug of its own and left the request alone."],
};

export const reasonKey = (reason: string) =>
  ["jev_error", "router_error"].find((prefix) => reason.startsWith(prefix)) ?? reason;
export const failed = (event: RouteEvent) =>
  event.mode === "passthrough" && REASONS[reasonKey(event.reason ?? "")]?.[0] === "Jev failed";
export const category = (event: RouteEvent): Category => (failed(event) ? "failed" : event.mode);
export const routed = (event: RouteEvent) => event.mode !== "passthrough";
export const baseline = (event: RouteEvent) => event.reason === "routing_disabled";
export const at = (event: RouteEvent) => Date.parse(event.time);

export const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) + "%" : "–");
export const sum = (events: readonly RouteEvent[], pick: (event: RouteEvent) => number | undefined) =>
  events.reduce((total, event) => total + (pick(event) ?? 0), 0);

export function tally(keys: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const name of keys) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h` : `${Math.round(h / 24)} d`;
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
export function status(events: readonly RouteEvent[], routing: boolean, now: number): Status {
  const recent = events.filter((event) => now - at(event) < IDLE_MS);
  if (!routing) {
    const n = recent.length;
    return {
      kind: "baseline",
      icon: "◌",
      title: "Baseline — routing off",
      text: `Jev is switched off: ${n} request${n === 1 ? "" : "s"} in the last 5 minutes went straight to Claude, metered for comparison.`,
    };
  }
  if (recent.length === 0) {
    const last = events.at(-1);
    return {
      kind: "idle",
      icon: "–",
      title: "Idle",
      text: "No requests in the last 5 minutes" + (last ? `; the last one was ${ago(now - at(last))} ago (${last.mode}).` : "."),
    };
  }
  const asked = recent.filter((event) => event.jev || failed(event));
  const latest = asked.at(-1);
  if (latest && failed(latest)) {
    return {
      kind: "failing",
      icon: "!",
      title: "Jev is failing",
      text: `The latest Jev call failed (${latest.reason}). Requests fall back to Claude alone.`,
    };
  }
  const decided = recent.filter(routed).length;
  if (decided) {
    return { kind: "routing", icon: "✓", title: "Routing", text: `Jev decided ${decided} of the last ${recent.length} requests (5 min).` };
  }
  const reasons = tally(recent.map((event) => reasonKey(event.reason ?? "unknown")));
  return {
    kind: "passthrough",
    icon: "→",
    title: "Passthrough only",
    text: `None of the last ${recent.length} requests were routed — mostly ${reasons[0]?.[0] ?? "unknown"}.`,
  };
}

export interface Tile {
  label: string;
  value: string;
  sub: string;
}

export function tiles(events: readonly RouteEvent[]): Tile[] {
  const asked = events.filter((event) => event.jev);
  const failures = events.filter(failed).length;
  const latencies = asked.map((event) => event.jev!.latencyMs).sort((a, b) => a - b);
  const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined);
  const tokens = sum(asked, (event) => event.jev?.inputTokens);
  const decided = events.filter(routed).length;
  const avgLatency = mean(latencies);
  const avgConfidence = mean(asked.map((event) => event.jev!.confidence));
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  return [
    { label: "Requests", value: int(events.length), sub: "model requests" },
    { label: "Routed by Jev", value: pct(decided, events.length), sub: `${int(decided)} requests` },
    { label: "Passed through", value: pct(events.length - decided, events.length), sub: `${int(events.length - decided)} requests` },
    { label: "Jev calls", value: int(asked.length + failures), sub: failures ? `${int(failures)} failed` : "none failed" },
    {
      label: "Jev latency",
      value: avgLatency === undefined ? "–" : int(avgLatency) + " ms",
      sub: p95 === undefined ? "no calls yet" : `p95 ${int(p95)} ms`,
    },
    { label: "Jev confidence", value: avgConfidence === undefined ? "–" : avgConfidence.toFixed(2), sub: "average of its picks" },
    {
      label: "LLM input tokens",
      value: int(sum(events, (event) => event.usage?.input)),
      sub: `${pct(sum(events, (event) => event.usage?.cached), sum(events, (event) => event.usage?.input))} from cache`,
    },
    { label: "LLM output tokens", value: int(sum(events, (event) => event.usage?.output)), sub: "across requests" },
    {
      label: "Jev input tokens",
      value: int(tokens),
      sub: `≈ $${((tokens / 1e6) * JEV_USD_PER_MILLION_INPUT_TOKENS).toFixed(4)}`,
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
export function compare(events: readonly RouteEvent[]): { rows: CompareRow[]; hasBaseline: boolean } {
  const metered = events.filter((event) => event.usage);
  const groups = [metered.filter((event) => !baseline(event)), metered.filter(baseline)] as const;
  const per = (group: RouteEvent[], pick: (event: RouteEvent) => number | undefined) =>
    group.length ? sum(group, pick) / group.length : undefined;
  const cachedShare = (group: RouteEvent[]) => {
    const input = sum(group, (event) => event.usage?.input);
    return input ? (100 * sum(group, (event) => event.usage?.cached)) / input : undefined;
  };
  const measures: [string, (group: RouteEvent[]) => number | undefined, (value: number) => string][] = [
    ["Requests metered", (group) => group.length, int],
    ["Input / request", (group) => per(group, (event) => event.usage?.input), int],
    ["…of which cached", cachedShare, (value) => Math.round(value) + "%"],
    ["Output / request", (group) => per(group, (event) => event.usage?.output), int],
    ["Seconds / request", (group) => per(group, (event) => event.durationMs / 1000), (value) => value.toFixed(1)],
    ["Total input", (group) => sum(group, (event) => event.usage?.input), int],
    ["Total output", (group) => sum(group, (event) => event.usage?.output), int],
  ];
  const cell = (value: number | undefined, format: (value: number) => string) =>
    value === undefined || Number.isNaN(value) ? "–" : format(value);
  const rows = measures.map(([label, measure, format], index) => {
    const withJev = measure(groups[0]);
    const without = measure(groups[1]);
    const comparable = index > 0 && index < 5 && withJev !== undefined && without;
    const delta = comparable ? (100 * (withJev - without)) / without : undefined;
    return {
      label,
      withJev: cell(withJev, format),
      without: cell(without, format),
      delta: delta === undefined || !Number.isFinite(delta) ? "" : (delta > 0 ? "+" : "") + Math.round(delta) + "%",
    };
  });
  return { rows, hasBaseline: groups[1].length > 0 };
}

/** Why requests were not routed, most common first. */
export function reasons(events: readonly RouteEvent[]): { name: string; count: number; who: string; meaning: string }[] {
  const passed = events.filter((event) => !routed(event));
  return tally(passed.map((event) => reasonKey(event.reason ?? "unknown"))).map(([name, count]) => {
    const [who, meaning] = REASONS[name] ?? ["", ""];
    return { name, count, who, meaning };
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
