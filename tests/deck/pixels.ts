// The Deck's mascots are half-block pixel art. These helpers read a frame's cells back as the pixels they stand for,
// so a test can pin a picture exactly: a pixel is its color, or undefined where nothing is drawn.
import { TERMINAL_DEFAULT } from "../../hooks/theme.ts";

type Cell = readonly [char: string, color: number, background?: number];

/** The two pixels of a cell, top and bottom: "▀" is its color over its ground, "▄" the ground over its color. */
function cellPixels([char, color, background]: Cell): [number | undefined, number | undefined] {
  const ground = background === undefined || background === TERMINAL_DEFAULT ? undefined : background;
  if (char === " ") return [ground, ground];
  if (char === "█") return [color, color];
  if (char === "▀") return [color, ground];
  if (char === "▄") return [ground, color];
  throw new Error(`not a half block: ${JSON.stringify(char)}`);
}

/** A frame as rows of pixels, two to a cell row. */
export function pixelsOf(frame: readonly (readonly Cell[])[]): (number | undefined)[][] {
  return frame.flatMap((row) => {
    const pairs = row.map(cellPixels);
    return [pairs.map(([top]) => top), pairs.map(([, bottom]) => bottom)];
  });
}

/** A frame as text, a character a pixel: `legend` maps colors to characters, a color it lacks is "?", nothing is ".". */
export function pictureOf(frame: readonly (readonly Cell[])[], legend: ReadonlyMap<number, string>): string[] {
  return pixelsOf(frame).map((row) => row.map((pixel) => (pixel === undefined ? "." : (legend.get(pixel) ?? "?"))).join(""));
}

/** Where a color lies in a frame, as "x,y" in reading order, limited to rows `from` up to `to`. */
export function whereIs(frame: readonly (readonly Cell[])[], color: number, from = 0, to = Infinity): string[] {
  const out: string[] = [];
  pixelsOf(frame).forEach((row, y) => {
    if (y >= from && y <= to) row.forEach((pixel, x) => pixel === color && out.push(`${x},${y}`));
  });
  return out;
}
