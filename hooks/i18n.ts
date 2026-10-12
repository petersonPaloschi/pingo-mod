import { en } from "./strings/en.ts";
import { pt } from "./strings/pt.ts";
import { reasonCode } from "./core/reasons.ts";

export type Locale = "en" | "pt";
export type LocaleOption = "auto" | Locale;
export type LocaleKey = keyof typeof en;

export const TAG: Record<Locale, string> = { en: "en-US", pt: "pt-BR" };

export function localeFor(value?: string): Locale {
  const locale = value?.trim() || Intl.DateTimeFormat().resolvedOptions().locale;
  return /^(?:pt(?:[-_]|$)|portugu)/i.test(locale) ? "pt" : "en";
}

export function localeOption(value?: string): LocaleOption {
  return value === "en" || value === "pt" ? value : "auto";
}

export function text<K extends LocaleKey>(key: K, locale: Locale = localeFor(), values: Record<string, string | number> = {}): string {
  const source = locale === "pt" ? pt : en;
  const message = (source as Partial<Record<LocaleKey, string>>)[key] ?? (en as Partial<Record<LocaleKey, string>>)[key] ?? String(key);
  return message.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export function reasonTitle(reason: string, locale: Locale = localeFor()): string {
  const key = ("reason." + reasonCode(reason) + ".title") as LocaleKey;
  return key in en ? text(key, locale) : text("reason.unknown.title", locale);
}

export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(TAG[locale], { maximumFractionDigits }).format(value);
}

export function formatPercent(part: number, whole: number, locale: Locale): string {
  return whole ? new Intl.NumberFormat(TAG[locale], { style: "percent", maximumFractionDigits: 0 }).format(part / whole) : "-";
}

export function formatCompact(value: number, locale: Locale): string {
  return new Intl.NumberFormat(TAG[locale], { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDecimal(value: number, locale: Locale, digits = 2): string {
  return new Intl.NumberFormat(TAG[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatClock(value: number, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG[locale], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

export function formatDuration(ms: number, locale: Locale): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return text("format.seconds", locale, { value: formatNumber(seconds, locale) });
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return text("format.minutesSeconds", locale, { minutes: formatNumber(minutes, locale), seconds: String(rest).padStart(2, "0") });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return text("format.hoursMinutes", locale, { hours: formatNumber(hours, locale), minutes: String(minutes % 60).padStart(2, "0") });
  return text("format.days", locale, { days: formatNumber(Math.floor(hours / 24), locale) });
}

export function formatAge(ms: number, locale: Locale): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return text("format.secondsShort", locale, { value: formatNumber(seconds, locale) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return text("format.minutesShort", locale, { value: formatNumber(minutes, locale) });
  const hours = Math.round(minutes / 60);
  return hours < 36
    ? text("format.hoursShort", locale, { value: formatNumber(hours, locale) })
    : text("format.daysShort", locale, { value: formatNumber(Math.round(hours / 24), locale) });
}
