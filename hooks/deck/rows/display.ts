import type { FeatureId } from "../../../types";
import { text, type Locale } from "../../i18n.ts";
import { displayWidth } from "../../layout.ts";
import { fmtUsd, type DeckRow, type Spend } from "../model.ts";
import { BODY, DECK_DESIGN, MUTED, STYLE, TEXT, plain, trunc } from "../theme.ts";
import { DECK_DOTS, GLYPH } from "../../theme.ts";
import { ringSvg, rowGlyph } from "./draw.ts";

export type ChipMini = { kind: "svg"; pct: number; color: string; alt: string } | { kind: "none" };
export type Chip =
  | { kind: "route"; text: string; color: string }
  | { kind: "item"; glyph: string; glyphColor: string; text: string; textColor: string; bold: boolean; mini: ChipMini }
  | { kind: "separator" }
  | { kind: "more"; text: string };

/** Between two items of one line: " - ". */
export const SEPARATOR = ` ${GLYPH.leader} `;
// the columns between the toggle and the chips, and between the chips and the extras; what the "+N" takes
const TERMINAL_CHIP_GAP = 2;
const TERMINAL_MORE_COLUMNS = 4;

export type ChipOptions = {
  desktop: boolean;
  cols: number;
  /** The width the extras text takes (clock, weather), in the surface's units. */
  extrasLength: number;
  locale: Locale;
};

// the chips for the collapsed band: needs-you first, then limits, context, bars, the route; what
// does not fit becomes a "+N" count. In the terminal a chip is its short text (a state mark only for a row that needs
// the person or failed), the chips are joined by " - ", and the extras at the end keep their columns.
export function collapsedChips(ordered: readonly DeckRow[], o: ChipOptions): { chips: Chip[] } {
  const chips: Chip[] = [];
  // the terminal counts columns; the desktop counts pixels (about 8 per column, ~7.5 per character)
  const separator = displayWidth(SEPARATOR);
  let budget = o.desktop
    ? o.cols * DECK_DESIGN.band.pixelsPerColumn - DECK_DESIGN.band.collapsed.desktop.reservePixels - o.extrasLength * DECK_DESIGN.band.collapsed.desktop.extraPixelsPerChar
    : o.cols - DECK_DESIGN.band.collapsed.terminal.reserveColumns - TERMINAL_CHIP_GAP - (o.extrasLength ? o.extrasLength + TERMINAL_CHIP_GAP : 0) - TERMINAL_MORE_COLUMNS;
  let hidden = 0;
  for (const row of ordered) {
    const st = STYLE[row.style];
    const shown = o.desktop ? row.short : plain(row.short);
    const mark = !o.desktop && (row.state === "needs_input" || row.style === "hot") ? rowGlyph(row) + " " : "";
    const w = o.desktop
      ? row.short.length * DECK_DESIGN.band.collapsed.desktop.titlePixelsPerChar + DECK_DESIGN.band.collapsed.desktop.itemPaddingPixels
      : displayWidth(mark + shown) + (chips.length ? separator : 0);
    if (w > budget) {
      hidden++;
      continue;
    }
    budget -= w;
    if (chips.length) chips.push({ kind: "separator" });
    if (row.kind === "route") {
      chips.push({ kind: "route", text: o.desktop ? row.short + " " : shown, color: o.desktop ? STYLE.run.desk : STYLE.run.fill });
      continue;
    }
    chips.push({
      kind: "item",
      glyph: o.desktop ? rowGlyph(row) + " " : mark,
      glyphColor: o.desktop ? st.desk : st.fill,
      text: o.desktop ? row.short + " " : shown,
      textColor: o.desktop ? (row.state === "needs_input" ? st.fill : row.limit ? TEXT : BODY) : TEXT,
      bold: o.desktop ? !!row.limit : row.state === "needs_input",
      mini: o.desktop ? { kind: "svg", pct: row.pct, color: st.desk, alt: row.title + " " + Math.round(row.pct) + "%" } : { kind: "none" },
    });
  }
  if (hidden) chips.push({ kind: "more", text: (o.desktop ? "  " : " ") + text("deck.chip.more", o.locale, { count: hidden }) });
  return { chips };
}

export type TextPart = { text: string; color?: string; bold?: boolean };

// the one-line look: a glyph and a short status per row, the route as an arrow, extras at the end
export function collapsedText(ordered: readonly DeckRow[], extras: readonly string[], desktop: boolean): TextPart[] {
  const parts: TextPart[] = [];
  for (const row of ordered) {
    const st = STYLE[row.style];
    if (parts.length) parts.push({ text: desktop ? "  " : SEPARATOR, color: desktop ? undefined : MUTED });
    if (row.kind === "route") {
      parts.push({ text: desktop ? "⇄ " : "<> ", color: desktop ? STYLE.run.desk : STYLE.run.fill });
      const to = row.route ? row.route.to + (row.route.effort ? (desktop ? " · " : SEPARATOR) + row.route.effort : "") : row.short;
      parts.push({ text: desktop ? to : plain(to), color: MUTED });
      continue;
    }
    parts.push({ text: rowGlyph(row) + " ", color: desktop ? st.desk : st.fill });
    parts.push({ text: desktop ? row.short : plain(row.short), color: row.state === "needs_input" ? (desktop ? st.desk : TEXT) : MUTED, bold: !desktop && row.state === "needs_input" });
  }
  if (extras.length) parts.push({ text: (parts.length ? (desktop ? "  " : SEPARATOR) : "") + [...extras].reverse().join(desktop ? "  " : SEPARATOR), color: MUTED });
  return parts;
}

/** The terminal ring: how full a limit is, empty to full (the desktop draws a ring). */
const RING_LEVELS = [DECK_DOTS.empty, ":", DECK_DOTS.half, DECK_DOTS.now, DECK_DOTS.full] as const;

export type RingItem =
  | { kind: "ask"; text: string; color: string }
  | { kind: "limit"; percent: string; label: string; color: string; svg: string | null; glyph: string; alt: string }
  | { kind: "spend"; amount: string; note: string; color: string; svg: string | null; glyph: string; alt: string }
  | { kind: "busy"; glyph: string; color: string; text: string };

// the limits as rings with their reset, then spend, then the busy row: the rings look
export function collapsedRings(rows: readonly DeckRow[], spend: Spend, costOn: boolean, desktop: boolean, locale: Locale): RingItem[] {
  const items: RingItem[] = [];
  const ask = rows.find((r) => r.state === "needs_input");
  if (ask) items.push({ kind: "ask", text: STYLE.ask.glyph + " " + text("deck.ask", locale, { title: trunc(ask.title, 24) }), color: desktop ? STYLE.ask.desk : STYLE.ask.fill });
  for (const row of rows.filter((r) => r.limit)) {
    const st = STYLE[row.style];
    const tag = row.kindKey === "five_hour" ? text("deck.limit.sessionTag", locale) : row.kindKey === "seven_day" ? text("deck.limit.weeklyTag", locale) : row.title;
    const icon = row.kindKey === "seven_day" ? "week" : "clock";
    items.push({
      kind: "limit",
      percent: Math.round(row.pct) + "%",
      label: tag + (row.resets ? (desktop ? " · " : SEPARATOR) + text("deck.limit.resets", locale, { time: row.resets }) : ""),
      color: desktop ? st.desk : st.fill,
      svg: desktop ? ringSvg(row.pct, st.desk, icon) : null,
      glyph: RING_LEVELS[Math.min(4, Math.round(row.pct / 25))] ?? RING_LEVELS[0]!,
      alt: text("deck.limit.alt", locale, { title: tag, percent: Math.round(row.pct) }),
    });
  }
  if (costOn) {
    items.push({
      kind: "spend",
      amount: fmtUsd(spend.dayUsd),
      note: text("deck.spend.today", locale, { today: fmtUsd(spend.monthUsd) }),
      color: desktop ? STYLE.done.desk : STYLE.done.fill,
      svg: desktop ? ringSvg(100, STYLE.done.desk, "usd") : null,
      glyph: "$",
      alt: text("deck.spend.alt", locale),
    });
  }
  const busy = rows.find((r) => (r.kind === "bar" || r.kind === "activity") && r.animating && r.state !== "needs_input");
  if (busy) items.push({ kind: "busy", glyph: rowGlyph(busy), color: MUTED, text: desktop ? trunc(busy.short, 22) : plain(trunc(busy.short, 22)) });
  return items;
}

/** One feature's switch as the expanded band draws it: its id, the name it shows, and whether it is on. */
export type FeatureSwitch = { id: FeatureId; name: string; on: boolean };

/** A switch's label: its state glyph, then its name. */
export const switchLabel = (sw: FeatureSwitch) => `${sw.on ? GLYPH.check : GLYPH.unchecked} ${sw.name}`;

/**
 * The switches packed into terminal lines of `cols` columns, indented under their title. A switch that does not fit
 * moves whole to the next line; only a name wider than a whole line is shortened. The gap between two switches is the
 * design's, or one column when that saves a line (a `[x]` is wider than the glyph it replaced, and the Deck pane keeps
 * its row budget). The band draws these lines and counts them against its row budget, so the two never disagree.
 */
export function featureLines(switches: readonly FeatureSwitch[], cols: number): { lines: { sw: FeatureSwitch; label: string }[][]; gap: number } {
  const { indent, columnGap } = DECK_DESIGN.band.features;
  const room = Math.max(4, cols - indent);
  const pack = (gap: number) => {
    const lines: { sw: FeatureSwitch; label: string }[][] = [];
    let line: { sw: FeatureSwitch; label: string }[] = [];
    let used = 0;
    for (const sw of switches) {
      const label = trunc(switchLabel(sw), room);
      const width = displayWidth(label);
      if (line.length && used + gap + width > room) {
        lines.push(line);
        line = [];
        used = 0;
      }
      used += (line.length ? gap : 0) + width;
      line.push({ sw, label });
    }
    if (line.length) lines.push(line);
    return lines;
  };
  const wide = pack(columnGap);
  const tight = pack(1);
  return tight.length < wide.length ? { lines: tight, gap: 1 } : { lines: wide, gap: columnGap };
}
