import { text, type Locale } from "../i18n.ts";

/** Keep the head and tail of long text; the middle is what matters least for agent planning. */
export function truncate(value: string, max: number, locale?: Locale): string {
  if (value.length <= max) return value;
  const marker = text("routing.truncated", locale);
  // No room for the marker: a hard cut still keeps the result within max.
  if (max < marker.length) return value.slice(0, Math.max(0, max));
  const keep = Math.max(0, max - marker.length);
  const head = Math.ceil(keep * 0.6);
  return value.slice(0, head) + marker + value.slice(value.length - (keep - head));
}
