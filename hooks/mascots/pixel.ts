// The mascots' one stroke: pixel art on a grid of two pixels to a terminal cell. Every mascot (Pingo, Jev, the
// features, the subagents) is a small map of pixels drawn on this grid and turned into half blocks, so they share
// one scale, one look and one palette. A cell shows its top pixel and its bottom pixel: "▀" paints the top in the
// foreground and the bottom in the background, "▄" the other way round, "█" both in one color.
//
// A colorless terminal keeps the glyphs and drops the colors, so the body is always what the glyph draws: a pixel
// marked as a detail (an eye, a glint) goes in the background, and without color it reads as a hole in the body.
import { PET_PALETTE, TERMINAL_DEFAULT } from "../theme.ts";

/** A detail pixel: drawn behind the body in its cell, so without color it is a hole. Bit 25, above every color. */
export const DETAIL = 0x02000000;
/** One pixel: a color (0x00RRGGBB, or TERMINAL_DEFAULT), maybe marked DETAIL; undefined is empty. */
export type Pixel = number | undefined;
/** Rows of pixels, top first. */
export type PixelGrid = Pixel[][];
/** A terminal cell as a Raster takes it: its glyph, its foreground and its background. */
export type PixelCell = [char: string, color: number, background?: number];

const colorOf = (p: number) => p & ~DETAIL;
const isDetail = (p: number) => (p & DETAIL) !== 0;

/** An empty grid `width` pixels across and `height` down. */
export function pixelGrid(width: number, height: number): PixelGrid {
  return Array.from({ length: height }, () => new Array<Pixel>(width).fill(undefined));
}

/** Sets one pixel, if it is inside the grid. */
export function put(grid: PixelGrid, x: number, y: number, pixel: Pixel): void {
  const row = grid[Math.round(y)];
  const col = Math.round(x);
  if (row && col >= 0 && col < row.length) row[col] = pixel;
}

/**
 * Stamps a pixel map onto the grid with its top left at (x, y). Each character of `map` is one pixel: "." is left
 * as it was, and every other character is looked up in `colors` (a character it lacks is left as it was too).
 */
export function stamp(grid: PixelGrid, x: number, y: number, map: readonly string[], colors: Readonly<Record<string, Pixel>>): void {
  map.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch === "." || !(ch in colors)) return;
      put(grid, x + c, y + r, colors[ch]);
    });
  });
}

/** The grid seen from the other side: each row reversed. Half blocks have no left or right, so cells need no mirroring. */
export function mirror(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row].reverse());
}

/**
 * The grid as terminal cells, two pixel rows to a cell row (an odd last row gets an empty one under it). The solid
 * pixel of a cell is its foreground and a detail pixel goes behind it; empty is the terminal's own background. The
 * terminal's own color is only ever a foreground (as a background it would paint the terminal's ground, not the body),
 * and a cell whose two pixels are both details is cut clean through (a space on the detail's ground), so without color
 * it is a hole in the body and not a solid block.
 */
export function renderPixels(grid: PixelGrid): PixelCell[][] {
  const out: PixelCell[][] = [];
  for (let r = 0; r < grid.length; r += 2) {
    const top = grid[r]!;
    const bottom = grid[r + 1] ?? [];
    out.push(
      top.map((t, c): PixelCell => {
        const b = bottom[c];
        if (t === undefined && b === undefined) return [" ", TERMINAL_DEFAULT];
        if (t === undefined) return ["▄", colorOf(b!)];
        if (b === undefined) return ["▀", colorOf(t)];
        if (colorOf(t) === colorOf(b)) return isDetail(t) && isDetail(b) ? [" ", TERMINAL_DEFAULT, colorOf(t)] : ["█", colorOf(t)];
        // the body in front: a detail on top, or the terminal's own color below, is drawn as a lower half block
        if ((isDetail(t) && !isDetail(b)) || (colorOf(b) === TERMINAL_DEFAULT && !isDetail(b))) return ["▄", colorOf(b), colorOf(t)];
        return ["▀", colorOf(t), colorOf(b)];
      }),
    );
  }
  return out;
}

/**
 * Pingo at its smallest, for the dashboard's header: six pixels by four, two cells tall, still. Its body is the
 * terminal's own color and its eyes, one pixel each, take the mood's color, so the face reads on any terminal.
 */
export function miniPingo(eyeColor: number, closed = false): PixelCell[][] {
  const grid = pixelGrid(6, 4);
  const B = PET_PALETTE.body;
  stamp(grid, 0, 0, [".####.", "######", "######", ".####."], { "#": B });
  const eye = eyeColor | DETAIL;
  put(grid, 1, closed ? 2 : 1, eye);
  put(grid, 4, closed ? 2 : 1, eye);
  return renderPixels(grid);
}
