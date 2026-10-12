// Colors and small helpers shared by the Deck drawings. Pure, no I/O.
// Every color comes from hooks/theme.ts: the state and tier hues, the track and tick tones, and the text tones.
import type { AgentState as ModelAgentState } from "./model/types.ts";
import { CLAUDE_MODEL, type Tier } from "../core/contracts.ts";
import { css, DECK_DESIGN, DECK_GLYPH, GLYPH, HUE, PAINT, SVG_PAINT, type DeckGlyphName } from "../theme.ts";
export { DECK_DESIGN, DECK_STYLE_NAMES, DECK_STYLE_ORDER, type DeckStyleName } from "../theme.ts";
export type RGB = [number, number, number];
export type StyleName = DeckGlyphName;
export type TierName = Tier;
const TYPE_MEASURE = DECK_DESIGN.type.measure;

/** fill and pill-text colors for the terminal, glyph, and the desktop color (text on it is `on`) */
export interface Style {
  fill: string;
  on: string;
  glyph: string;
  desk: string;
}

/** A tick on a bar at fraction `f`; a stage mark is a taller, bolder tick. */
export interface Mark {
  f: number;
  stage?: boolean;
}

/** One bar: progress as `pct` (0 to 100), optional stage marks, steps, and recent history. */
export interface Row {
  id: string;
  name: string;
  count?: string;
  rate?: string;
  style: StyleName;
  pct: number;
  marks: Mark[];
  animating?: boolean;
  steps?: number;
  finished?: number;
  hist?: number[];
}

export type AgentState = ModelAgentState;

export interface AgentRow {
  id: string;
  title: string;
  state: AgentState;
  depth: number;
  model?: string;
  startedAt: number;
  endedAt?: number;
}

/** The agents under a bar: the ones shown as strips and the ones folded into a "+N more" line. */
export interface AgentView {
  shown: AgentRow[];
  hidden: AgentRow[];
}

export interface Cell {
  ch: string;
  color: string;
  bg?: string;
  bold?: boolean;
}

export interface TextProps {
  color: string;
  children: string[];
  backgroundColor?: string;
  bold?: boolean;
}

// The terminal Deck is black and white: a state is told by its glyph and its word, so every terminal color is the
// theme's text key. The desktop keeps its hues (`desk`, `TIER.desk`): an SVG cannot name a theme key.
const fill = (color: number) => css(color);
const ink = PAINT.text;

export const STYLE: Record<StyleName, Style> = {
  run: { fill: ink, on: ink, glyph: DECK_GLYPH.run, desk: fill(HUE.brand) },
  ask: { fill: ink, on: ink, glyph: DECK_GLYPH.ask, desk: fill(HUE.warn) },
  hot: { fill: ink, on: ink, glyph: DECK_GLYPH.hot, desk: fill(HUE.fail) },
  done: { fill: ink, on: ink, glyph: DECK_GLYPH.done, desk: fill(HUE.ok) },
  ok: { fill: ink, on: ink, glyph: DECK_GLYPH.ok, desk: fill(HUE.ok) },
  warn: { fill: ink, on: ink, glyph: DECK_GLYPH.warn, desk: fill(HUE.warn) },
};

export const AGENT_STYLE: Record<AgentState, StyleName> = { running: "run", waiting: "ask", error: "hot", done: "done" };

export const TIER: Record<TierName, { term: string; desk: string }> = {
  [CLAUDE_MODEL.HAIKU.name]: { term: ink, desk: fill(HUE.info) },
  [CLAUDE_MODEL.SONNET.name]: { term: ink, desk: fill(HUE.brand) },
  [CLAUDE_MODEL.OPUS.name]: { term: ink, desk: fill(HUE.plum) },
};

/** The empty part of a terminal bar: the dimmed foreground. */
export const TRACK = PAINT.rule;
/** A tick or step that is reached, and one that is not yet. */
export const TICK_ON = PAINT.text;
export const TICK_OFF = PAINT.muted;
export const DIM = PAINT.muted;
export const MUTED = PAINT.muted;
export const TEXT = PAINT.text;
/** Body text: the chip names, the effort values, and the agent titles. */
export const BODY = PAINT.text;
/** The text tones inside the desktop SVG rows. */
export const SVG_TEXT = { body: SVG_PAINT.muted, muted: SVG_PAINT.muted, dim: SVG_PAINT.muted } as const;
export const SVG_ON_FILL = SVG_PAINT.onFill;
export const SVG_TRACK = SVG_PAINT.muted;

export function hash(a: number, b: number, k: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

export function seedOf(id: string | number): number {
  let h = 0;
  for (const ch of String(id)) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) | 0;
  return h;
}

/** A text cut to `n` columns; the cut is marked by "..." (three columns, counted in `n`). */
export function trunc(s: string | null | undefined, n: number): string {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  const dots = GLYPH.ellipsis;
  if (text.length <= n) return text;
  return n > dots.length ? text.slice(0, n - dots.length).trimEnd() + dots : text.slice(0, Math.max(1, n));
}

const ASCII_MARKS: Record<string, string> = { "↻": "~", "·": "-", "—": "-", "→": "->", "↓": "v", "↑": "^", "⇄": "<>", "…": "...", "✕": "x", "⚠": "!" };

/** A text the model made (a short, a reset, a weather line) as the terminal draws it: its few non-ASCII marks in ASCII. */
export const plain = (s: string): string => s.replace(/[↻·—→↓↑⇄…✕⚠]/g, (c) => ASCII_MARKS[c] ?? c);

/** The terminal band's measures that `DECK_DESIGN.band.terminal` does not hold: the row's name column and its meter. */
export const TERMINAL_ROW = {
  /** The name column is this share of the band, never narrower than the minimum, wider than the maximum. */
  labelRatio: 0.2,
  labelMinimumColumns: 9,
  labelMaximumColumns: 22,
  /** The meter's cells (its brackets come on top): this share of the band, between the two limits. */
  meterRatio: 0.15,
  meterMinimumCells: 4,
  meterMaximumCells: 10,
  /** The value after the meter ("3/5", "41%") and the gap on each side of it. */
  valueColumns: 4,
  gapColumns: 2,
} as const;

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function textWidth(s: string, px: number = TYPE_MEASURE.defaultPixelsPerChar): number {
  let w = 0;
  for (const ch of String(s)) w += /[ilI.,:;'|!]/.test(ch) ? TYPE_MEASURE.narrowPixelsPerChar : /[mwMW]/.test(ch) ? TYPE_MEASURE.widePixelsPerChar : /[　-鿿]/.test(ch) ? TYPE_MEASURE.fullWidthPixelsPerChar : px;
  return w;
}

/** "#RRGGBB" to its channels. */
export const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const mix = (a: RGB, b: RGB, m: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * m),
  Math.round(a[1] + (b[1] - a[1]) * m),
  Math.round(a[2] + (b[2] - a[2]) * m),
];

export const rgb = (c: RGB): string => "rgb(" + c.join(",") + ")";

/** One Text per run of same-styled cells. `Text` builds a text node from its props. */
export function runs<T>(Text: (props: TextProps) => T, cells: readonly Cell[]): T[] {
  const out: { text: string; color: string; bg?: string; bold?: boolean }[] = [];
  let cur: { text: string; color: string; bg?: string; bold?: boolean } | null = null;
  for (const c of cells) {
    if (cur && cur.color === c.color && cur.bg === c.bg && cur.bold === c.bold) cur.text += c.ch;
    else {
      if (cur) out.push(cur);
      cur = { text: c.ch, color: c.color, bg: c.bg, bold: c.bold };
    }
  }
  if (cur) out.push(cur);
  return out.map((r) => {
    const props: TextProps = { color: r.color, children: [r.text] };
    if (r.bg) props.backgroundColor = r.bg;
    if (r.bold) props.bold = true;
    return Text(props);
  });
}

export function textCells(s: string, color: string, bg?: string, bold?: boolean): Cell[] {
  return [...String(s)].map((ch) => ({ ch, color, bg, bold }));
}
