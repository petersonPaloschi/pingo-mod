// The dotted visual system: one palette, braille cells, and shared dot meters.
// Everything is a dot: the mascot, the meters, the timeline. The body is ink; color only says state.

/** Draws in the terminal's own default color (a Raster cell's "no color"). */
export const DEFAULT_COLOR = 0x01000000;

/** The palette, tuned for a dark terminal. */
export const DOT = {
  ink: 0xe9ebef,
  dim: 0x8d93a0,
  faint: 0x4a4f5a,
  route: 0x5ef0a8,
  pass: 0xf2c14e,
  fail: 0xff6b5e,
  idle: 0x8d93a0,
  base: 0x8fa2ff,
  /** Who speaks in the live log, the one place color names a speaker and not a state. */
  you: 0xc9a7ff,
  claude: 0xd97757,
} as const;

/** Body dots from the far side of a sphere to the near side: dimmer far away. */
export const DEPTH = [0x2c2f36, 0x434750, 0x676c78, 0x9a9fab, 0xc9ccd4, 0xe9ebef] as const;

/** A palette color as the string a Text or Box paints with. */
export const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/** Same input, same value in [0, 1): flicker-free "randomness" between redraws. */
export function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

// --- Braille: a terminal cell as a 2×4 grid of dots (U+2800 to U+28FF) ---

export type BrailleCell = [char: string, color: number];

const BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

/** The bit a dot at (x, y) of its cell (x in 0..1, y in 0..3) sets. */
export const brailleBit = (x: number, y: number) => BITS[y & 3]![x & 1]!;
export const brailleChar = (bits: number) => (bits ? String.fromCharCode(0x2800 + bits) : " ");

/** A run of text in one color: a row is a list of runs. */
export type Run = [text: string, color: number];

/**
 * The constellation: one dot per point on a braille grid, x for time, y for size. A cell takes the
 * color of its highest-priority dot. Rows come back as color runs, so any surface can draw them.
 */
export function constellation(
  points: readonly { x: number; y: number; color: number; priority: number }[],
  columns: number,
  rows: number,
  floor: number = DOT.faint,
): Run[][] {
  const width = columns * 2;
  const height = rows * 4;
  const bits = new Uint8Array(columns * rows);
  const color = new Array<number>(columns * rows).fill(floor);
  const rank = new Array<number>(columns * rows).fill(-1);
  for (const point of points) {
    const px = Math.max(0, Math.min(width - 1, Math.floor(point.x * width)));
    const py = Math.max(0, Math.min(height - 1, height - 1 - Math.round(point.y * (height - 1))));
    const cell = (py >> 2) * columns + (px >> 1);
    bits[cell]! |= brailleBit(px & 1, py & 3);
    if (point.priority > rank[cell]!) {
      rank[cell] = point.priority;
      color[cell] = point.color;
    }
  }
  const out: Run[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Run[] = [];
    for (let c = 0; c < columns; c++) {
      const cell = r * columns + c;
      // An empty bottom row reads as the ground line.
      const char = bits[cell] ? brailleChar(bits[cell]!) : r === rows - 1 ? "⠤" : " ";
      const ink = bits[cell] ? color[cell]! : floor;
      const last = row.at(-1);
      if (last && last[1] === ink) last[0] += char;
      else row.push([char, ink]);
    }
    out.push(row);
  }
  return out;
}

// --- Raster encoding ---

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += b === undefined ? "=" : B64[(n >> 6) & 63]!;
    out += c === undefined ? "=" : B64[n & 63]!;
  }
  return out;
}

/** A Raster's packed cells: [code point, color, background] per cell, as little-endian u32. */
export function cellsOf(rows: readonly (readonly [string, number, number?])[][]): string {
  const numbers = rows.flat().flatMap(([char, color, background]) => [char.codePointAt(0) ?? 32, color, background ?? DEFAULT_COLOR]);
  return base64(new Uint8Array(Uint32Array.from(numbers).buffer));
}
