// Dice, the live-log mascot: a cube of dots with a face on its front. The terminal draws braille;
// the desktop app uses SVG circles. The body is shaded by depth; only the face uses your color.
import { brailleBit, brailleChar, DEPTH, DOT, hex } from "../dots.ts";
import type { BrailleCell } from "../dots.ts";

export const DICE = { name: "Dice", face: "[•‿•]", color: DOT.you, label: "Dice, a cube of dots: you" } as const;

type Kind = "edge" | "face";
/** A projected dot: x and y in cube half-widths (y up), z from back to front. */
export interface CubeDot {
  x: number;
  y: number;
  z: number;
  kind: Kind;
}

type Vec = [number, number, number];
/** The twelve edges as dots, each with the outward normals of the two sides it joins. */
const EDGES: { p: Vec; normals: [Vec, Vec] }[] = [];
const PER_EDGE = 40;
for (const axis of [0, 1, 2] as const) {
  const a = ((axis + 1) % 3) as 0 | 1 | 2;
  const b = ((axis + 2) % 3) as 0 | 1 | 2;
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      const na: Vec = [0, 0, 0];
      const nb: Vec = [0, 0, 0];
      na[a] = sa;
      nb[b] = sb;
      for (let i = 0; i < PER_EDGE; i++) {
        const p: Vec = [0, 0, 0];
        p[axis] = -1 + (2 * i) / (PER_EDGE - 1);
        p[a] = sa;
        p[b] = sb;
        EDGES.push({ p, normals: [na, nb] });
      }
    }
  }
}

/** Whether a point of the front side (fx, fy in -1..1) is part of the face: two eyes and a smile. */
export function faceAt(fx: number, fy: number, open = 1): boolean {
  for (const side of [-1, 1]) {
    const dx = fx - side * 0.4;
    const dy = fy - 0.25;
    if ((dx / 0.16) ** 2 + (dy / (0.22 * open + 0.04)) ** 2 < 1) return true;
  }
  const r = Math.hypot(fx, fy + 0.02);
  return Math.abs(r - 0.45) < 0.09 && fy < -0.25 && Math.abs(fx) < 0.4;
}

const FACE_GRID: [number, number][] = [];
for (let fy = -0.8; fy <= 0.8; fy += 0.03) for (let fx = -0.8; fx <= 0.8; fx += 0.03) FACE_GRID.push([fx, fy]);

/**
 * Dice at time `t` (seconds): the visible dots, projected, far ones first. It turns a little to
 * show its side, looks down on its top, hops and blinks. Deterministic in `t`.
 */
export function cube(t: number): CubeDot[] {
  const yaw = -0.5 + Math.sin(t * 0.6) * 0.15;
  const tilt = 0.36 + Math.sin(t * 0.4) * 0.05;
  const hop = Math.abs(Math.sin(t * 1.6)) * 0.06;
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const cb = Math.cos(tilt);
  const sb = Math.sin(tilt);
  const camera = 5;
  // A cube's corner is √3 from its center: shrink it so the whole die fits the unit circle.
  const fit = 1 / 1.62;
  const rotate = ([x, y, z]: Vec): Vec => {
    const x1 = x * ca + z * sa;
    const z1 = -x * sa + z * ca;
    return [x1, y * cb - z1 * sb, y * sb + z1 * cb];
  };
  const out: CubeDot[] = [];
  const push = (p: Vec, kind: Kind) => {
    const [x, y, z] = rotate(p);
    const s = (camera / (camera - z)) * fit;
    out.push({ x: x * s, y: y * s + hop, z, kind });
  };
  const cycle = (t * 0.8) % 5;
  const open = cycle < 0.16 ? Math.abs(cycle - 0.08) / 0.08 : 1;
  for (const { p, normals } of EDGES) {
    // Only the edges of a side that faces the camera: a die is solid.
    if (rotate(normals[0])[2] <= 0.04 && rotate(normals[1])[2] <= 0.04) continue;
    push(p, "edge");
  }
  for (const [fx, fy] of FACE_GRID) if (faceAt(fx, fy, open)) push([fx, fy, 1.02], "face");
  return out.sort((a, b) => a.z - b.z);
}

function bodyColor(dot: CubeDot): number {
  const depth = (dot.z + 1.8) / 3.6;
  const step = Math.floor(depth * DEPTH.length) + 1;
  return DEPTH[Math.max(0, Math.min(DEPTH.length - 1, step))]!;
}

/** Dice in braille, `columns` × `rows` cells: visible edges shaded by depth, with the face in your color. */
export function diceFrame(t: number, columns: number, rows: number): BrailleCell[][] {
  const width = columns * 2;
  const height = rows * 4;
  const bits = new Uint8Array(columns * rows);
  const color = new Array<number>(columns * rows).fill(DEPTH[0]);
  const rank = new Array<number>(columns * rows).fill(-9);
  const radius = Math.min(height, width) * 0.47;
  const cx = width / 2;
  const cy = height / 2;
  cube(t).forEach((dot) => {
    const px = Math.floor(cx + dot.x * radius);
    const py = Math.floor(cy - dot.y * radius);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const cell = (py >> 2) * columns + (px >> 1);
    bits[cell]! |= brailleBit(px & 1, py & 3);
    // The face always wins its cell; otherwise the nearest dot sets the gray.
    const weight = dot.kind === "face" ? 9 : dot.z;
    if (weight > rank[cell]!) {
      rank[cell] = weight;
      color[cell] = dot.kind === "face" ? DICE.color : bodyColor(dot);
    }
  });
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c): BrailleCell => [brailleChar(bits[r * columns + c]!), color[r * columns + c]!]),
  );
}

/** Dice's size in the live tab, in cells: the render and the animation must agree. */
export function diceSize(width: number): { columns: number; rows: number } {
  return width >= 60 ? { columns: 14, rows: 6 } : { columns: 10, rows: 4 };
}

/** Dice for the desktop app: one still frame as SVG circles, on a transparent ground. */
export function diceSvg(t: number, size = 64): string {
  const dots = cube(t)
    .map((dot) => {
      const depth = (dot.z + 1.8) / 3.6;
      const r = dot.kind === "face" ? 1.6 : 1.1;
      const fill = dot.kind === "face" ? DICE.color : bodyColor(dot);
      const opacity = dot.kind === "face" ? 1 : 0.35 + depth * 0.65;
      return `<circle cx="${(50 + dot.x * 44).toFixed(1)}" cy="${(50 - dot.y * 44).toFixed(1)}" r="${r.toFixed(2)}" fill="${hex(fill)}" fill-opacity="${opacity.toFixed(2)}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${dots}</svg>`;
}
