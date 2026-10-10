// Terminal bar styles. Each returns exactly W cells for a row. Pure, no I/O.
import { DECK_DESIGN, DECK_STYLE_NAMES, DECK_STYLE_ORDER, STYLE, TRACK, TRACK_BG, TICK_ON, TICK_OFF, MUTED, TEXT, HEAD_DIM, SHINE, hash, seedOf, trunc, textCells, type DeckStyleName } from "./theme.ts";
import type { Cell, Row, Style } from "./theme.ts";
import { GLYPH } from "../theme.ts";

export const TERMINAL_STYLES = DECK_STYLE_ORDER.terminal;
export type TerminalStyle = DeckStyleName;
export const TERMINAL_STYLE_NAMES: Record<TerminalStyle, string> = DECK_STYLE_NAMES.terminal;

const DOTS = "⠁⠂⠄⠈⠃⠅⠉⠑⠆⠊⠒⠇⠋⠓⠧⠏⠗⠯⠷⠿⡿⣟⣯⣷⣽⣾⣿";

const RENDER = DECK_DESIGN.bar.terminal.render;

function labelCells(row: Row, room: number): Cell[] {
  const layout = RENDER.labels;
  const st = STYLE[row.style];
  const countGap = " ".repeat(layout.countGapColumns);
  const name = trunc(row.name, Math.max(layout.minimumCharacters, room - (row.count ? row.count.length + layout.countGapColumns : 0)));
  const cells = textCells(name, st.fill);
  if (row.count && name.length + row.count.length + layout.countGapColumns <= room) cells.push(...textCells(countGap + row.count, MUTED));
  return cells;
}

// a bar of width bw, then two spaces and the label, padded to W
function withLabel(bar: Cell[], row: Row, W: number): Cell[] {
  const gap = RENDER.labels.gapColumns;
  const room = W - bar.length - gap;
  const out = [...bar, ...textCells(" ".repeat(gap), MUTED), ...labelCells(row, room)];
  while (out.length < W) out.push({ ch: " ", color: MUTED });
  return out.slice(0, W);
}

function barWidth(W: number): number {
  const { minimumWidth, labelReserve, preferredMinimum, shareRatio } = DECK_DESIGN.bar.terminal;
  const want = Math.min(W - labelReserve, Math.max(preferredMinimum, Math.round(W * shareRatio)));
  return Math.max(minimumWidth, want);
}

type DrawCells = (row: Row, W: number, frame: number) => Cell[];

function segments(row: Row, W: number, frame: number): Cell[] {
  const animation = RENDER.animation;
  const st = STYLE[row.style];
  const bw = barWidth(W);
  const fx = (bw * row.pct) / 100;
  const gaps = new Set(row.marks.filter((m) => m.stage).map((m) => Math.round(bw * m.f)));
  const cells: Cell[] = [];
  for (let x = 0; x < bw; x++) {
    if (gaps.has(x)) {
      cells.push({ ch: " ", color: TRACK });
      continue;
    }
    const head = row.animating && x === Math.floor(fx);
    cells.push(x < Math.floor(fx) ? { ch: "▰", color: st.fill } : head ? { ch: "▰", color: frame % animation.frameCycle < animation.activeFrames ? st.fill : HEAD_DIM } : { ch: "▱", color: TRACK });
  }
  return withLabel(cells, row, W);
}

function line(row: Row, W: number, frame: number): Cell[] {
  const animation = RENDER.animation;
  const st = STYLE[row.style];
  const bw = barWidth(W);
  const full = Math.floor((bw * row.pct) / 100);
  const marks = new Set(row.marks.map((m) => Math.round(bw * m.f)));
  const cells: Cell[] = [];
  for (let x = 0; x < bw; x++) {
    if (x < full) cells.push({ ch: "━", color: st.fill });
    else if (x === full && row.pct < 100) cells.push({ ch: "╸", color: row.animating && frame % animation.frameCycle < animation.activeFrames ? TICK_ON : st.fill });
    else cells.push({ ch: marks.has(x) ? "┼" : "─", color: marks.has(x) ? TICK_OFF : TRACK });
  }
  return withLabel(cells, row, W);
}

function solid(row: Row, W: number, frame: number): Cell[] {
  const animation = RENDER.animation;
  const padding = RENDER.labels.contentPaddingColumns;
  const st = STYLE[row.style];
  const bw = W;
  const f = Math.round((bw * row.pct) / 100);
  const text = (" ".repeat(padding) + row.name + (row.count ? " · " + row.count : "") + " ".repeat(padding)).slice(0, bw);
  const sweep = row.animating ? ((frame * animation.solidSweepStep) % (bw + animation.solidSweepExtraColumns)) - animation.solidSweepStartColumns : -animation.inactiveSweepOffset;
  const cells: Cell[] = [];
  for (let x = 0; x < bw; x++) {
    const ch = text[x] ?? " ";
    const inFill = x < f;
    const shine = inFill && Math.abs(x - sweep) < animation.shineRadiusColumns;
    cells.push(inFill ? { ch, color: st.on, bg: shine ? SHINE : st.fill, bold: true } : { ch, color: TEXT, bg: TRACK_BG });
  }
  return cells;
}

function dots(row: Row, W: number, frame: number): Cell[] {
  const animation = RENDER.animation;
  const design = RENDER.dots;
  const st = STYLE[row.style];
  const cells: Cell[] = [];
  if (row.steps && row.steps <= DECK_DESIGN.bar.terminal.stepLimit) {
    for (let i = 0; i < row.steps; i++) {
      const done = i < (row.finished ?? 0);
      const cur = i === row.finished && row.animating;
      cells.push(done ? { ch: GLYPH.on, color: st.fill } : cur ? { ch: frame % animation.frameCycle < animation.activeFrames ? "◉" : GLYPH.off, color: st.fill } : { ch: GLYPH.off, color: TICK_OFF });
      if (i < row.steps - 1) cells.push({ ch: done ? "─" : "┄", color: done ? st.fill : TRACK });
    }
  } else {
    const n = DECK_DESIGN.bar.terminal.dotCount;
    for (let i = 0; i < n; i++) {
      const v = row.pct / DECK_DESIGN.bar.terminal.dotCount - i;
      cells.push({ ch: v >= 1 ? GLYPH.on : v > design.partialThreshold ? "◐" : GLYPH.off, color: v > design.partialThreshold ? st.fill : TICK_OFF });
      if (i < n - 1) cells.push({ ch: " ", color: TRACK });
    }
  }
  return withLabel(cells.slice(0, Math.max(design.minimumBarColumns, W - design.labelReserveColumns)), row, W);
}

function pixel(row: Row, W: number, frame: number): Cell[] {
  const design = RENDER.pixel;
  const padding = RENDER.labels.contentPaddingColumns;
  const st = STYLE[row.style];
  const fx = Math.round((W * row.pct) / 100);
  const pill = " ".repeat(padding) + trunc(row.name + (row.count ? " ".repeat(RENDER.labels.countGapColumns) + row.count : ""), Math.max(design.minimumPillCharacters, W - design.labelReserveColumns)) + " ".repeat(padding);
  const L = pill.length;
  const ps = Math.max(0, Math.min(W - L, fx >= L ? fx - L : fx));
  const marks = new Map<number, boolean | undefined>(row.marks.map((m): [number, boolean | undefined] => [Math.round(W * m.f), m.stage]));
  const seed = seedOf(row.id);
  const cells: Cell[] = [];
  for (let x = 0; x < W; x++) {
    if (x >= ps && x < ps + L) cells.push({ ch: pill[x - ps] ?? " ", color: st.on, bg: st.fill, bold: true });
    else if (marks.has(x)) cells.push({ ch: marks.get(x) ? (x < fx ? "┃" : "│") : "╎", color: x < fx ? TICK_ON : TICK_OFF, bg: TRACK_BG });
    else if (x < fx) {
      const t = (x + design.sampleOffset) / Math.max(fx, 1);
      const d = (design.densityStart + design.densityRange * t * t) * (design.noiseBase + design.noiseRange * hash(seed, x, frame >> design.animationFrameShift));
      cells.push({ ch: DOTS[Math.min(DOTS.length - 1, Math.floor(d * DOTS.length))] ?? " ", color: st.fill, bg: TRACK_BG });
    } else cells.push({ ch: " ", color: TRACK, bg: TRACK_BG });
  }
  return cells;
}

const BLOCKS = "▁▂▃▄▅▆▇█";

// a thin bar, then the recent history as a sparkline, then the label and how fast it moves
function spark(row: Row, W: number, frame: number): Cell[] {
  const design = RENDER.spark;
  const labels = RENDER.labels;
  const animation = RENDER.animation;
  const st = STYLE[row.style];
  // the label and rate always fit; the bar and sparkline get whatever room is left
  const name = trunc(row.name, design.maximumNameCharacters);
  const tail = name.length + (row.rate ? row.rate.length + labels.rateGapColumns : row.count ? row.count.length + labels.countGapColumns : 0) + design.tailReserveColumns;
  const { sparkMinWidth, sparkMaxWidth, sparkRatio, historyLimit } = DECK_DESIGN.bar.terminal;
  const bw = Math.max(sparkMinWidth, Math.min(sparkMaxWidth, Math.round(W * sparkRatio), W - tail - design.historyGapColumns));
  const room = Math.max(0, Math.min(historyLimit, W - bw - design.historyGapColumns - tail));
  const hist = room >= design.minimumHistoryRoomColumns ? (row.hist ?? []).slice(-Math.min(room, historyLimit)) : [];
  const f = Math.round((bw * row.pct) / 100);
  const cells: Cell[] = [];
  for (let x = 0; x < bw; x++) cells.push({ ch: x < f ? "━" : "─", color: x < f ? st.fill : TRACK });
  cells.push(...textCells(" ".repeat(design.historyGapColumns), TRACK));
  if (hist.length > 1) {
    const lo = Math.min(...hist);
    const hi = Math.max(...hist);
    for (const v of hist) cells.push({ ch: BLOCKS[Math.round(((v - lo) / Math.max(1e-9, hi - lo)) * (BLOCKS.length - 1))] ?? "█", color: st.fill });
  } else if (row.animating && room >= design.animationRoomColumns) {
    for (let i = 0; i < design.animationCells; i++) cells.push({ ch: BLOCKS[(i + frame) % BLOCKS.length] ?? "█", color: st.fill });
  }
  const out = [...cells, ...textCells(" ".repeat(labels.gapColumns), MUTED), ...textCells(name, st.fill)];
  if (row.rate) out.push(...textCells(" ".repeat(labels.rateGapColumns) + row.rate, MUTED));
  else if (row.count) out.push(...textCells(" ".repeat(labels.countGapColumns) + row.count, MUTED));
  while (out.length < W) out.push({ ch: " ", color: MUTED });
  return out.slice(0, W);
}

const FN: Record<TerminalStyle, DrawCells> = { segments, line, solid, dots, pixel, spark };

export function terminalBar(style: string, row: Row, W: number, frame: number): Cell[] {
  const draw: DrawCells = FN[style as TerminalStyle] ?? solid;
  return draw(row, W, frame);
}

// a short bar for the collapsed line
export function terminalMini(style: string, row: Row, W: number): Cell[] {
  const st: Style = STYLE[row.style];
  const f = Math.round((W * row.pct) / 100);
  const cells: Cell[] = [];
  for (let x = 0; x < W; x++) {
    if (style === "solid" || style === "pixel") cells.push({ ch: " ", color: st.fill, bg: x < f ? st.fill : TRACK_BG });
    else if (style === "line") cells.push({ ch: x < f ? "━" : "─", color: x < f ? st.fill : TRACK });
    else if (style === "dots") cells.push({ ch: x < f ? GLYPH.on : GLYPH.off, color: x < f ? st.fill : TICK_OFF });
    else if (style === "spark") cells.push({ ch: x < f ? "━" : "─", color: x < f ? st.fill : TRACK });
    else cells.push({ ch: x < f ? "▰" : "▱", color: x < f ? st.fill : TRACK });
  }
  return cells;
}
