// The mascots' one stroke: a few lines of 7-bit text. Every mascot (Pingo, Jev, the features, the subagents) is a
// small picture drawn in plain ASCII, one character to a terminal cell, in the terminal's own color, so they share one
// scale and one look and read the same on any terminal, with or without color.
import { TERMINAL_DEFAULT } from "../theme.ts";

/** A terminal cell as a Raster takes it: its character, its foreground and, when it has one, its background. */
export type PixelCell = [char: string, color: number, background?: number];

/** The dim ink inside a Raster, which has no "dim" attribute: a fixed gray that reads on a light and a dark ground. */
export const DIM_INK = 0x808080;

/** Rows of text as terminal cells, every character in the terminal's own color. */
export function textCells(rows: readonly string[]): PixelCell[][] {
  return rows.map((row) => [...row].map((char): PixelCell => [char, TERMINAL_DEFAULT]));
}
