import { text, type Locale } from "../../i18n.ts";
import { type RateLimit, type UsageReading, type HistPoint, type Spend, type DeckState, type SavedSpend } from "./types.ts";
import { HIST_KEEP_MS, HIST_MAX_POINTS, COST_SESSIONS } from "./constants.ts";
import { isRecord, today } from "./state.ts";

// the counts saved per session, sanitized
function costSeenMap(saved: unknown): Record<string, number> {
  const map: Record<string, number> = {};
  const raw = isRecord(saved) && isRecord(saved.costSeen) ? saved.costSeen : {};
  for (const [id, usd] of Object.entries(raw)) if (typeof usd === "number" && Number.isFinite(usd)) map[id] = usd;
  return map;
}

// what this session has counted so far, from the saved record; null when it has counted nothing yet
export function costSeenFrom(saved: unknown, sessionId: string): number | null {
  return costSeenMap(saved)[sessionId] ?? null;
}

// the spend record to save: the day and month totals, and what each of the last sessions has counted
export function spendRecord(s: DeckState, saved: unknown, sessionId: string): SavedSpend {
  const seen = costSeenMap(saved);
  if (s.costSeen != null) seen[sessionId] = s.costSeen;
  const ids = Object.keys(seen);
  for (const id of ids.slice(0, Math.max(0, ids.length - COST_SESSIONS))) delete seen[id];
  return { spend: s.spend, costSeen: seen };
}

// the usage history as saved: each window's points within the retention, the newest of them kept
export function histFrom(saved: unknown, now: number): Record<string, HistPoint[]> {
  const out: Record<string, HistPoint[]> = {};
  if (!isRecord(saved)) return out;
  for (const [key, list] of Object.entries(saved)) {
    if (!Array.isArray(list)) continue;
    const points = list.filter((x): x is HistPoint => isRecord(x) && typeof x.t === "number" && typeof x.p === "number" && now - x.t <= HIST_KEEP_MS);
    if (points.length) out[key] = points.slice(-HIST_MAX_POINTS);
  }
  return out;
}

// usage history, for sparklines and burn rates
function addPoint(s: DeckState, key: string, p: number | null | undefined, now: number): boolean {
  if (p == null) return false;
  const list = (s.hist[key] = s.hist[key] ?? []);
  const last = list[list.length - 1];
  if (last && last.p === p && now - last.t < 300_000) return false;
  if (last && now - last.t < 20_000) last.p = p;
  else list.push({ t: now, p });
  while (list.length && now - list[0]!.t > HIST_KEEP_MS) list.shift();
  if (list.length > HIST_MAX_POINTS) list.splice(0, list.length - HIST_MAX_POINTS);
  return true;
}

// records the context and limit percentages; true when the history changed and should be saved
export function sampleUsage(s: DeckState, now: number): boolean {
  let changed = addPoint(s, "context", s.usage.context?.percent, now);
  for (const rl of s.usage.rateLimits) changed = addPoint(s, rl.kind, rl.percentUsed, now) || changed;
  return changed;
}

// the values over a window, for a sparkline; the newest point is now
export function series(s: DeckState, key: string, windowMs: number, now: number): number[] {
  return (s.hist[key] ?? []).filter((x) => now - x.t <= windowMs).map((x) => x.p);
}

// how fast a window moves: percent per hour (or per day for the weekly window)
export function burnRate(s: DeckState, key: string, now: number, locale: Locale): string {
  const daily = key.startsWith("seven_day");
  const list = (s.hist[key] ?? []).filter((x) => now - x.t <= (daily ? 24 : 1) * 3600_000);
  if (list.length < 2) return "";
  const a = list[0]!;
  const b = list[list.length - 1]!;
  const span = b.t - a.t;
  if (span < 5 * 60_000 || b.p < a.p) return "";
  const per = ((b.p - a.p) / span) * (daily ? 86_400_000 : 3_600_000);
  if (per < 0.05) return "";
  const unit = text(daily ? "deck.rate.day" : "deck.rate.hour", locale);
  return "+" + (per < 10 ? per.toFixed(1) : String(Math.round(per))) + unit;
}

// a response may report only some windows; keep the others, drop ones already reset
export function mergeLimits(old: readonly RateLimit[], fresh: readonly RateLimit[] | undefined, now: number): RateLimit[] {
  const byKind = new Map(old.map((r) => [r.kind, r]));
  for (const r of fresh ?? []) byKind.set(r.kind, r);
  return [...byKind.values()].filter((r) => !r.resetsAt || Date.parse(r.resetsAt) > now).sort((a, b) => (a.kind < b.kind ? -1 : 1));
}

// a reading replaces the demo's sample numbers, then is merged in; returns the spend it added. The session's own
// measure drops the sample at once; a poll drops it only once the poll has real numbers.
export function takeUsage(s: DeckState, reading: UsageReading, now: number, costOn: boolean, measured = false): number {
  if (s.demoUsage && (measured || (reading.rateLimits ?? []).length || reading.context?.percent != null)) dropDemoUsage(s);
  // a reading that carries no context figures (null) clears the row; an absent one keeps it
  s.usage = { context: reading.context === undefined ? s.usage.context : reading.context, rateLimits: mergeLimits(s.usage.rateLimits, reading.rateLimits, now) };
  return reading.cost ? addSpend(s, reading.cost.usd, new Date(now), costOn) : 0;
}

export function dropDemoUsage(s: DeckState): void {
  if (!s.demoUsage) return;
  s.demoUsage = false;
  s.usage = { context: null, rateLimits: [] };
}

// the saved spend, for today and this month; a stale day or month starts at zero
export function spendFrom(saved: unknown, date: Date): Spend {
  const day = today(date);
  const month = day.slice(0, 7);
  const o = isRecord(saved) ? saved : {};
  return {
    day,
    dayUsd: o.day === day && typeof o.dayUsd === "number" ? o.dayUsd : 0,
    month,
    monthUsd: o.month === month && typeof o.monthUsd === "number" ? o.monthUsd : 0,
  };
}

// adds what this session spent since its last reading; the cost reported is a running total per session
export function addSpend(s: DeckState, usd: number, date: Date, costOn: boolean): number {
  if (!costOn || typeof usd !== "number") return 0;
  const seen = s.costSeen ?? 0;
  const delta = usd >= seen ? usd - seen : usd;
  s.costSeen = usd;
  const day = today(date);
  const month = day.slice(0, 7);
  s.spend = {
    day,
    dayUsd: (s.spend.day === day ? s.spend.dayUsd : 0) + delta,
    month,
    monthUsd: (s.spend.month === month ? s.spend.monthUsd : 0) + delta,
  };
  return delta;
}
