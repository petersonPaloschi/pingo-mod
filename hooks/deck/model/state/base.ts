import { MODEL_NAMES } from "../../../core/contracts.ts";
import { text, type Locale, type LocaleKey } from "../../../i18n.ts";
import { trunc } from "../../theme.ts";
import type { Weather, DeckState } from "../types.ts";

export function createDeckState(now: number, sessionId = "", date: Date = new Date(now)): DeckState {
  return {
    bars: new Map(),
    agents: new Map(),
    tasks: new Map(),
    inFlight: new Map(),
    waiting: new Set(),
    askedUser: false,
    lastSeen: new Map(),
    lastPrompt: "",
    route: null,
    routeHist: [],
    routeFail: null,
    routeFails: 0,
    sessionModel: "",
    seen: { model: "", effort: "" },
    activity: null,
    hist: {},
    usage: { context: null, rateLimits: [] },
    weather: null,
    demoRoute: false,
    demoUsage: false,
    turnActive: false,
    lastActivity: now,
    celebrateUntil: 0,
    spend: { day: today(date), dayUsd: 0, month: today(date).slice(0, 7), monthUsd: 0 },
    costSeen: null,
    sessionId,
  };
}

// ---------- small helpers ----------


export function slug(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "plan";
}

// the words the person typed: tagged blocks (system reminders, pasted content, attachments) removed
export function cleanPrompt(text: string): string {
  return String(text)
    .replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fmtK(n: number | null | undefined): string {
  if (n == null) return "?";
  if (n >= 1_000_000) return +(n / 1_000_000).toFixed(1) + "M";
  return n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
}

export const fmtUsd = (v: number): string => "$" + (v < 100 ? v.toFixed(2) : String(Math.round(v)));

export function today(date: Date): string {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

// "0:04:09", or "3d 5h 07m" once a day or more is left
export function countdown(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  let s = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  s = s % 60;
  if (d > 0) return d + "d " + h + "h " + String(m).padStart(2, "0") + "m";
  return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// "1h7m", "3d 5h", "42m": for the rings, where seconds would only flicker
export function humanReset(iso: string | null | undefined, now: number): string {
  const s = Math.max(0, Math.floor((Date.parse(String(iso)) - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h" + m + "m" : m + "m";
}

// how long a row has run, as the activity line shows it: "42s", then "1m 5s" (unpadded, unlike the i18n duration)
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

export function clockText(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

// WMO weather codes: the highest code of each band, its icon, and its word
const WMO: readonly (readonly [number, string, LocaleKey])[] = [
  [0, "☀", "deck.weather.clear"],
  [3, "⛅", "deck.weather.cloudy"],
  [48, "🌫", "deck.weather.fog"],
  [57, "☂", "deck.weather.drizzle"],
  [67, "☂", "deck.weather.rain"],
  [77, "❄", "deck.weather.snow"],
  [82, "☂", "deck.weather.showers"],
  [86, "❄", "deck.weather.snow"],
  [99, "⛈", "deck.weather.storm"],
];

export function weatherText(weather: Weather | null, city: { name: string } | null, desktop: boolean, locale: Locale): string {
  if (!weather) return city ? text("deck.weather.loading", locale, { city: city.name }) : "";
  const [, icon, key] = WMO.find(([max]) => weather.code <= max) ?? WMO[WMO.length - 1]!;
  const t = Math.round(weather.temp) + "°";
  return desktop ? icon + " " + t + " " + weather.name : t + " " + text(key, locale) + " · " + weather.name;
}

export function limitName(kind: string, locale: Locale): [string, string] {
  if (kind === "five_hour") return [text("deck.limit.session", locale), text("deck.limit.sessionTag", locale)];
  if (kind === "seven_day") return [text("deck.limit.weekly", locale), text("deck.limit.weeklyTag", locale)];
  if (kind === "seven_day_opus") return [text("deck.limit.opus", locale), text("deck.limit.opusTag", locale)];
  if (kind === "spend_limit") return [text("deck.limit.spend", locale), text("deck.limit.spendTag", locale)];
  return [kind, kind];
}

export function shortModel(id: string | null | undefined): string {
  const s = String(id ?? "").toLowerCase();
  for (const name of MODEL_NAMES) if (s.includes(name)) return name;
  return trunc(id ?? "", 14);
}

// ---------- agents ----------


// an agent ends: its state, its label, and its bar's done time once every agent there has ended
