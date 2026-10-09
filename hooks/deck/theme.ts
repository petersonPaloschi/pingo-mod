// Colors and small helpers shared by the Deck drawings. Pure, no I/O.
// Every color is a literal: the state and tier hues, the track and tick greys, and the text tones.
export type RGB = [number, number, number];
export type StyleName = "run" | "ask" | "hot" | "done" | "ok" | "warn";
export type TierName = "haiku" | "sonnet" | "opus";

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

export type AgentState = "running" | "waiting" | "error" | "done";

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

export const STYLE: Record<StyleName, Style> = {
  run: { fill: "#9C95EC", on: "#26215C", glyph: "●", desk: "#8B7CF6" },
  ask: { fill: "#EBA83A", on: "#412402", glyph: "?", desk: "#E09A1E" },
  hot: { fill: "#E2706F", on: "#501313", glyph: "!", desk: "#E5484D" },
  done: { fill: "#5DCAA5", on: "#04342C", glyph: "✓", desk: "#30A46C" },
  ok: { fill: "#5DCAA5", on: "#04342C", glyph: "◔", desk: "#30A46C" },
  warn: { fill: "#EBA83A", on: "#412402", glyph: "◑", desk: "#E09A1E" },
};

export const TIER: Record<TierName, { term: string; desk: string }> = {
  haiku: { term: "#5DCAA5", desk: "#30A46C" },
  sonnet: { term: "#9C95EC", desk: "#8B7CF6" },
  opus: { term: "#EBA83A", desk: "#E09A1E" },
};

export const TRACK = "#3a3936";
export const TRACK_BG = "#2b2a28";
export const TICK_ON = "#f2f0ea";
export const TICK_OFF = "#55534e";
export const DIM = "#77756f";
export const MUTED = "#9a9893";
export const TEXT = "#e8e6e1";
/** Body text: the chip names, the effort values, and the agent titles. */
export const BODY = "#c9c7c1";
/** Text on a terminal pill (a route tier, an agent's model); the desktop pills use white. */
export const PILL_INK = "#1e1e1e";

export function hash(a: number, b: number, k: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

export function seedOf(id: string | number): number {
  let h = 0;
  for (const ch of String(id)) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) | 0;
  return h;
}

export function trunc(s: string | null | undefined, n: number): string {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, Math.max(1, n - 1)) + "…" : text;
}

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function textWidth(s: string, px = 6.7): number {
  let w = 0;
  for (const ch of String(s)) w += /[ilI.,:;'|!]/.test(ch) ? 3.4 : /[mwMW]/.test(ch) ? 9.5 : /[　-鿿]/.test(ch) ? 12 : px;
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
