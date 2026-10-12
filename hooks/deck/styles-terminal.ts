// Terminal bar styles. Each returns exactly W cells for a row: the meter between its brackets and nothing else (the row
// draws the name, the value and the note around it). Black and white: every cell is the plain foreground, the dimmed one
// marks a running bar's head between frames. Pure, no I/O.
import { DECK_DESIGN, DECK_STYLE_NAMES, DECK_STYLE_ORDER, MUTED, TEXT, hash, seedOf, textCells, trunc, type DeckStyleName } from "./theme.ts";
import type { Cell, Row } from "./theme.ts";
import { DECK_DOTS, bracketMeter } from "../theme.ts";

export const TERMINAL_STYLES = DECK_STYLE_ORDER.terminal;
export type TerminalStyle = DeckStyleName;
export const TERMINAL_STYLE_NAMES: Record<TerminalStyle, string> = DECK_STYLE_NAMES.terminal;

const RENDER = DECK_DESIGN.bar.terminal.render;

/**
 * The characters each style draws with, one table to change. The default style ("solid") is `bracketMeter` and has no
 * entry: it is `#` and `.` between brackets.
 * - fill/empty: a reached and a not yet reached cell; head: the cell where a running bar is now; mark: a tick on the
 *   empty part; gap: a stage's break in a "segments" bar; join/rest: the line between two steps, done and to come.
 * - ramp: the pixel bar's density, thinnest to fullest; stage/tick: its stage and regular marks; the sparkline's levels
 *   are `LEVELS`.
 */
const CHARS = {
  segments: { fill: "#", empty: ".", gap: " " },
  line: { fill: "=", head: ">", empty: "-", mark: "+" },
  dots: { join: "-", rest: ".", gap: " " },
  pixel: { ramp: ".:-=+*#@", stage: "|", tick: ":" },
  spark: { fill: "=", empty: "-", gap: " " },
} as const;

/** The sparkline's eight levels, lowest to highest. */
const LEVELS = "._-=+*#@";

const cell = (ch: string, color: string = TEXT): Cell => ({ ch, color });

/** The cells padded or cut to exactly `W` cells (only the default style has brackets). */
function framed(inner: Cell[], W: number): Cell[] {
  const body = inner.slice(0, W);
  while (body.length < W) body.push(cell(" "));
  return body;
}

/** Whether a running bar's head shows (true) or is dimmed (false) at this frame. */
const headOn = (frame: number) => frame % RENDER.animation.frameCycle < RENDER.animation.activeFrames;

function segments(row: Row, W: number, frame: number): Cell[] {
  const bw = Math.max(1, W);
  const fx = (bw * row.pct) / 100;
  const gaps = new Set(row.marks.filter((m) => m.stage).map((m) => Math.round(bw * m.f)));
  const inner: Cell[] = [];
  for (let x = 0; x < bw; x++) {
    if (gaps.has(x)) inner.push(cell(CHARS.segments.gap));
    else if (x < Math.floor(fx)) inner.push(cell(CHARS.segments.fill));
    else if (row.animating && x === Math.floor(fx)) inner.push(cell(CHARS.segments.fill, headOn(frame) ? TEXT : MUTED));
    else inner.push(cell(CHARS.segments.empty));
  }
  return framed(inner, W);
}

function line(row: Row, W: number, frame: number): Cell[] {
  const bw = Math.max(1, W);
  const full = Math.floor((bw * row.pct) / 100);
  const marks = new Set(row.marks.map((m) => Math.round(bw * m.f)));
  const inner: Cell[] = [];
  for (let x = 0; x < bw; x++) {
    if (x < full) inner.push(cell(CHARS.line.fill));
    else if (x === full && row.pct < 100) inner.push(cell(CHARS.line.head, row.animating && !headOn(frame) ? MUTED : TEXT));
    else inner.push(cell(marks.has(x) ? CHARS.line.mark : CHARS.line.empty));
  }
  return framed(inner, W);
}

// the default: `#` and `.` between brackets, as the host's own meter
function solid(row: Row, W: number): Cell[] {
  return textCells(bracketMeter(row.pct / 100, Math.max(1, W - 2)), TEXT);
}

function dots(row: Row, W: number, frame: number): Cell[] {
  const design = RENDER.dots;
  const inner: Cell[] = [];
  if (row.steps && row.steps <= DECK_DESIGN.bar.terminal.stepLimit) {
    for (let i = 0; i < row.steps; i++) {
      const done = i < (row.finished ?? 0);
      const cur = i === row.finished && row.animating;
      inner.push(cell(done ? DECK_DOTS.full : cur ? (headOn(frame) ? DECK_DOTS.now : DECK_DOTS.half) : DECK_DOTS.half, done || cur ? TEXT : MUTED));
      if (i < row.steps - 1) inner.push(cell(done ? CHARS.dots.join : CHARS.dots.rest, done ? TEXT : MUTED));
    }
  } else {
    const n = DECK_DESIGN.bar.terminal.dotCount;
    for (let i = 0; i < n; i++) {
      const v = row.pct / n - i;
      inner.push(cell(v >= 1 ? DECK_DOTS.full : v > design.partialThreshold ? DECK_DOTS.half : DECK_DOTS.empty, v > design.partialThreshold ? TEXT : MUTED));
      if (i < n - 1) inner.push(cell(CHARS.dots.gap));
    }
  }
  return framed(inner, W);
}

function pixel(row: Row, W: number, frame: number): Cell[] {
  const design = RENDER.pixel;
  const bw = Math.max(1, W);
  const ramp = CHARS.pixel.ramp;
  const fx = Math.round((bw * row.pct) / 100);
  const marks = new Map<number, boolean | undefined>(row.marks.map((m): [number, boolean | undefined] => [Math.round(bw * m.f), m.stage]));
  const seed = seedOf(row.id);
  // the label rides the bar's edge in bold, with no ground
  const label = trunc(row.name + (row.count ? " " + row.count : ""), Math.max(design.minimumPillCharacters, bw - design.labelReserveColumns));
  const ps = Math.max(0, Math.min(bw - label.length, fx >= label.length ? fx - label.length : fx));
  const inner: Cell[] = [];
  for (let x = 0; x < bw; x++) {
    if (x >= ps && x < ps + label.length) inner.push({ ch: label[x - ps] ?? " ", color: TEXT, bold: true });
    else if (marks.has(x)) inner.push(cell(marks.get(x) ? CHARS.pixel.stage : CHARS.pixel.tick, x < fx ? TEXT : MUTED));
    else if (x < fx) {
      const t = (x + design.sampleOffset) / Math.max(fx, 1);
      const d = (design.densityStart + design.densityRange * t * t) * (design.noiseBase + design.noiseRange * hash(seed, x, frame >> design.animationFrameShift));
      inner.push(cell(ramp[Math.min(ramp.length - 1, Math.floor(d * ramp.length))] ?? " "));
    } else inner.push(cell(" "));
  }
  return framed(inner, W);
}

// a thin bar, then the recent history as a sparkline
function spark(row: Row, W: number, frame: number): Cell[] {
  const design = RENDER.spark;
  const { historyLimit } = DECK_DESIGN.bar.terminal;
  const inside = Math.max(1, W);
  // the bar takes half of the meter, the sparkline the other half
  const bw = Math.max(1, Math.ceil(inside / 2));
  const room = Math.max(0, Math.min(historyLimit, inside - bw - design.historyGapColumns));
  const hist = room >= design.minimumHistoryRoomColumns ? (row.hist ?? []).slice(-Math.min(room, historyLimit)) : [];
  const f = Math.round((bw * row.pct) / 100);
  const inner: Cell[] = [];
  for (let x = 0; x < bw; x++) inner.push(cell(x < f ? CHARS.spark.fill : CHARS.spark.empty));
  if (hist.length > 1 || (row.animating && room >= design.animationRoomColumns)) {
    inner.push(...textCells(CHARS.spark.gap.repeat(design.historyGapColumns), TEXT));
    if (hist.length > 1) {
      const lo = Math.min(...hist);
      const hi = Math.max(...hist);
      for (const v of hist) inner.push(cell(LEVELS[Math.round(((v - lo) / Math.max(1e-9, hi - lo)) * (LEVELS.length - 1))] ?? "@"));
    } else {
      for (let i = 0; i < design.animationCells; i++) inner.push(cell(LEVELS[(i + frame) % LEVELS.length] ?? "@"));
    }
  }
  return framed(inner, W);
}

type DrawCells = (row: Row, W: number, frame: number) => Cell[];

const FN: Record<TerminalStyle, DrawCells> = { segments, line, solid, dots, pixel, spark };

export function terminalBar(style: string, row: Row, W: number, frame: number): Cell[] {
  const draw: DrawCells = FN[style as TerminalStyle] ?? solid;
  return draw(row, W, frame);
}
