import type { FeedEntry, FeedTone } from "../../../types";
import { UI_INK as INK } from "../../theme.ts";
import { type View } from "../types.ts";

/**
 * Where a scrolled-back body stays. The stored offset counts from the live edge (the newest line),
 * so whatever arrives there would push what is being read out of view: while the person is away
 * from the edge, the position grows by what arrived since. Scrolling back toward the edge closes
 * that gap in step with the scroll left, so offset 0 is the live edge again, and follows it.
 */
const anchors = new Map<string, { scroll: number; at: number; mark: number }>();
export function anchored(key: string, scroll: number, mark: number, addedSince: (mark: number) => number, limit: number): number {
  const was = anchors.get(key);
  if (scroll <= 0) {
    anchors.delete(key);
    return 0;
  }
  let at = scroll;
  if (was) {
    const kept = was.at + addedSince(was.mark);
    at = scroll >= was.scroll ? kept + scroll - was.scroll : Math.round((kept * scroll) / was.scroll);
  }
  at = Math.max(0, Math.min(limit, at));
  anchors.set(key, { scroll, at, mark });
  return at;
}

/** How far back a live log shows, anchored on its lines, and how far its stored offset may go. */
export function feedBack(key: string, view: View, lines: readonly FeedEntry[]): { back: number; max: number } {
  const limit = Math.max(0, lines.length - 1);
  const back = anchored(key, view.scroll, lines.at(-1)?.seq ?? 0, (since) => {
    const i = lines.findIndex((entry) => entry.seq === since);
    return i < 0 ? 0 : lines.length - 1 - i;
  }, limit);
  return { back, max: view.scroll + limit - back };
}

export const ENTRIES_SHOWN = 50;

export function newestFirst<T>(list: readonly T[]): T[] {
  return list.slice(-ENTRIES_SHOWN).reverse();
}

export function lastJevCall(feed: readonly FeedEntry[]): FeedEntry | undefined {
  return feed.findLast((entry) => entry.who === "jev" && entry.kind === "call");
}

export function liveLines(feed: readonly FeedEntry[]): { pinned: FeedEntry | undefined; lines: FeedEntry[] } {
  const pinned = lastJevCall(feed);
  if (!pinned) return { pinned, lines: newestFirst(feed) };
  return { pinned, lines: newestFirst(feed.filter((entry) => entry.seq !== pinned.seq)).slice(0, ENTRIES_SHOWN - 1) };
}

export const TONE_INK: Record<FeedTone, string> = {
  info: INK.ink,
  good: INK.route,
  warn: INK.pass,
  bad: INK.fail,
  muted: INK.dim,
};