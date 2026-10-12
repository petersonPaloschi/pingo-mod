// The Deck's mascots are ASCII drawings, a character to a cell. These helpers read a frame's cells back as text, so a
// test can pin a picture exactly: it is the drawing itself, and every cell is the terminal's own color.
import { TERMINAL_DEFAULT } from "../../hooks/theme.ts";

type Cell = readonly [char: string, color: number, background?: number];

/** A frame as rows of text. */
export function textOf(frame: readonly (readonly Cell[])[]): string[] {
  return frame.map((row) => row.map(([char]) => char).join(""));
}

/** Whether every cell of a frame is the terminal's own color with no ground, as the mascots are drawn. */
export function isPlainInk(frame: readonly (readonly Cell[])[]): boolean {
  return frame.every((row) => row.every(([, color, background]) => color === TERMINAL_DEFAULT && background === undefined));
}

/** Where a character lies in a frame, as "x,y" in reading order. */
export function whereIs(frame: readonly (readonly Cell[])[], char: string): string[] {
  const out: string[] = [];
  frame.forEach((row, y) => row.forEach(([c], x) => c === char && out.push(`${x},${y}`)));
  return out;
}
