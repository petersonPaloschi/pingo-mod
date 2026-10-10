// Pingo, Jev's mascot: a sphere of dots with two eyes, drawn from one small 3D scene. The Deck's pet
// (deck/pet.ts) draws it in braille on the terminal and takes its SVG circles on the desktop. The body is
// ink; only the eyes, the orbit ring and a few sparks take the mood's color.
import { DEPTH, DOT, hex, noise } from "../dots.ts";

export type Mood = "routing" | "thinking" | "passthrough" | "failing" | "idle" | "baseline";
type Eyes = "happy" | "spinner" | "pill" | "x" | "line" | "closed";

export const MOODS: Record<Mood, { eyes: Eyes; color: number; face: string }> = {
  routing: { eyes: "happy", color: DOT.route, face: "(^‿^)" },
  thinking: { eyes: "spinner", color: DOT.brand, face: "(◌_◌)" },
  passthrough: { eyes: "pill", color: DOT.pass, face: "( •_•)" },
  failing: { eyes: "x", color: DOT.fail, face: "(×_×)" },
  idle: { eyes: "line", color: DOT.idle, face: "(–_–)" },
  baseline: { eyes: "closed", color: DOT.base, face: "(-_-)ᶻ" },
};

type Kind = "body" | "eye" | "ring";
/** A projected dot: x and y in sphere radii (y up), z from -1 (back) to 1 (front). */
export interface Dot {
  x: number;
  y: number;
  z: number;
  kind: Kind;
  phase: number;
}

const bodies = new Map<number, { x: number; y: number; z: number; phase: number }[]>();
/** Evenly spread points on a unit sphere (a Fibonacci lattice), kept per count. */
function sphere(count: number) {
  let points = bodies.get(count);
  if (points) return points;
  const golden = Math.PI * (3 - Math.sqrt(5));
  points = Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    return { x: Math.cos(golden * i) * r, y, z: Math.sin(golden * i) * r, phase: (i * 0.618) % 1 };
  });
  bodies.set(count, points);
  return points;
}

const EYE_GRID: [number, number][] = [];
for (let fy = -0.3; fy <= 0.42; fy += 0.02) for (let fx = -0.52; fx <= 0.52; fx += 0.02) EYE_GRID.push([fx, fy]);

const coarseGrids = new Map<number, [number, number][]>();
/** The points of the face an eye can cover, `step` apart; the default step is the fine grid the large Pingo uses. */
function eyeGrid(step: number): [number, number][] {
  if (step === 0.02) return EYE_GRID;
  let grid = coarseGrids.get(step);
  if (!grid) {
    grid = [];
    for (let j = 0; -0.3 + j * step <= 0.42; j++) for (let i = 0; -0.52 + i * step <= 0.52; i++) grid.push([-0.52 + i * step, -0.3 + j * step]);
    coarseGrids.set(step, grid);
  }
  return grid;
}

/** Whether a point of the face (fx, fy on the front of the sphere) is part of an eye. */
export function eyeAt(eyes: Eyes, fx: number, fy: number, t: number, lookX = 0, open = 1): boolean {
  for (const side of [-1, 1]) {
    const dx = fx - (side * 0.3 + lookX);
    const dy = fy - 0.1;
    if (Math.abs(dx) > 0.18 || Math.abs(dy) > 0.25) continue;
    switch (eyes) {
      case "pill": {
        const h = 0.17 * open + 0.03;
        if ((dx / 0.095) ** 2 + (dy / h) ** 2 < 1) return true;
        break;
      }
      case "happy": {
        const r = Math.hypot(dx, dy + 0.06);
        if (Math.abs(r - 0.12) < 0.04 && dy + 0.06 > 0.02) return true;
        break;
      }
      case "x":
        if (Math.abs(dx) < 0.11 && Math.abs(dy) < 0.11 && (Math.abs(dx - dy) < 0.04 || Math.abs(dx + dy) < 0.04)) return true;
        break;
      case "line":
        if (Math.abs(dy + 0.02) < 0.03 && Math.abs(dx) < 0.11) return true;
        break;
      case "closed": {
        const r = Math.hypot(dx, dy - 0.05);
        if (Math.abs(r - 0.11) < 0.032 && dy - 0.05 < -0.03) return true;
        break;
      }
      case "spinner": {
        const r = Math.hypot(dx, dy);
        if (Math.abs(r - 0.09) < 0.035) {
          const turn = Math.PI * 2;
          const a = (((Math.atan2(dy, dx) - t * 5 * side) % turn) + turn) % turn;
          if (a > 1.3) return true;
        }
        break;
      }
    }
  }
  return false;
}

/**
 * Pingo at time `t` (seconds), facing `yaw` radians to the side: every dot projected, far ones first.
 * Deterministic in its inputs, so a still frame (a test, the desktop SVG) always looks the same.
 * `eyeStep` is how far apart the dots of an eye are, in sphere radii: a small Pingo wants fewer, bolder ones.
 */
export function scene(mood: Mood, t: number, count = 700, yaw?: number, eyeStep = 0.02): Dot[] {
  const { eyes } = MOODS[mood];
  const sleepy = mood === "idle" || mood === "baseline";
  const speed = sleepy ? 0.35 : mood === "thinking" ? 1.6 : 1;
  const turn = (yaw ?? Math.sin(t * 0.5) * 0.35) + (mood === "passthrough" ? -0.35 : 0);
  const tilt = Math.sin(t * 0.37) * 0.12 - (mood === "baseline" ? 0.2 : 0);
  const frame = Math.floor(t * 20);
  const shakeX = mood === "failing" ? (noise(frame, 1) - 0.5) * 0.05 : 0;
  const shakeY = mood === "failing" ? (noise(frame, 2) - 0.5) * 0.04 : 0;
  const breathe = 1 + Math.sin(t * (sleepy ? 1.2 : 2.2)) * 0.015;
  const ca = Math.cos(turn);
  const sa = Math.sin(turn);
  const cb = Math.cos(tilt);
  const sb = Math.sin(tilt);
  const camera = 3.4;
  const out: Dot[] = [];
  const push = (x: number, y: number, z: number, kind: Kind, phase: number) => {
    const x1 = x * ca + z * sa;
    const z1 = -x * sa + z * ca;
    const y2 = y * cb - z1 * sb;
    const z2 = y * sb + z1 * cb;
    const s = (camera / (camera - z2)) * breathe;
    out.push({ x: x1 * s + shakeX, y: y2 * s + shakeY, z: z2, kind, phase });
  };
  const lookX = mood === "passthrough" ? 0.07 : 0;
  const cycle = (t * 0.9) % 4.2;
  const open = eyes === "pill" && cycle < 0.14 ? Math.abs(cycle - 0.07) / 0.07 : 1;

  // The body drifts around its vertical axis; the face stays put.
  const spin = t * 0.12 * speed;
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  for (const p of sphere(count)) {
    const x = p.x * cs + p.z * ss;
    const z = -p.x * ss + p.z * cs;
    if (z > 0.5 && eyeAt(eyes, x, p.y, t, lookX, open)) continue;
    push(x, p.y, z, "body", p.phase);
  }
  for (const [fx, fy] of eyeGrid(eyeStep)) {
    if (!eyeAt(eyes, fx, fy, t, lookX, open)) continue;
    push(fx, fy, Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy)) * 1.035, "eye", 0);
  }
  if (mood === "thinking") {
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 1.4;
      const x = Math.cos(a) * 1.42;
      const depth = Math.sin(a) * 1.42;
      push(x, depth * 0.15 - 0.05, depth * 0.9, "ring", i / n);
    }
  }
  return out.sort((a, b) => a.z - b.z);
}

/** The color a body dot takes: a gray by depth, now and then a spark of the mood's color. */
function bodyColor(mood: Mood, dot: Dot, t: number): number {
  const depth = (dot.z + 1) / 2;
  const wave = 0.5 + 0.5 * Math.sin(dot.y * 7 - t * 2.2 + dot.phase * 2);
  if (mood === "routing" && wave > 0.95 && depth > 0.45) return MOODS.routing.color;
  if (mood === "failing" && dot.phase > 0.9) return MOODS.failing.color;
  const sleepy = mood === "baseline" ? 1 : 0;
  return DEPTH[Math.max(0, Math.min(DEPTH.length - 1, Math.floor(depth * DEPTH.length) - sleepy))]!;
}

/** A 4x4 ordered-dither matrix: a dot is lit where the shading beats its entry, so the same shade is always the same pattern. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
/** A still frame is a pure function of its inputs, so the last few are kept: a redraw inside the same frame costs nothing. */
const svgFrames = new Map<string, string>();
const SVG_FRAMES = 48;

/**
 * Pingo for the desktop app: one still frame as SVG circles, on a transparent ground.
 * `small` is for a sphere a few dozen pixels wide, where hundreds of sub-pixel dots blur into a smudge: it
 * draws a few score of larger dots, none from the far side, and bolder eyes.
 */
export function pingoSvg(mood: Mood, t: number, size = 96, small = false): string {
  const key = `${mood}|${t}|${size}|${small ? 1 : 0}`;
  const kept = svgFrames.get(key);
  if (kept !== undefined) return kept;
  const dots = (small ? scene(mood, t, SMALL.dots, undefined, SMALL.eyeStep).filter((dot) => dot.kind !== "body" || dot.z > -0.05) : scene(mood, t, 900))
    .map((dot) => circleOf(mood, dot, t, small))
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${dots}</svg>`;
  if (svgFrames.size >= SVG_FRAMES) svgFrames.delete(svgFrames.keys().next().value!);
  svgFrames.set(key, svg);
  return svg;
}

/** One dot of the sphere as an SVG circle: its size and shade follow its depth, and its eyes and orbit take the mood's color. */
function circleOf(mood: Mood, dot: Dot, t: number, small: boolean): string {
  const depth = (dot.z + 1) / 2;
  const r = small
    ? dot.kind === "eye" ? SMALL.eye : dot.kind === "ring" ? 1.9 : SMALL.body + depth * 0.9
    : dot.kind === "eye" ? 1.9 : dot.kind === "ring" ? 1.3 : 0.5 + depth * 1.0;
  const fill = dot.kind === "body" ? bodyColor(mood, dot, t) : MOODS[mood].color;
  const opacity = dot.kind === "body" ? (small ? 0.3 + depth * depth * 0.7 : 0.15 + depth * depth * 0.85) : 1;
  return `<circle cx="${(50 + dot.x * 34).toFixed(1)}" cy="${(50 - dot.y * 34).toFixed(1)}" r="${r.toFixed(2)}" fill="${hex(fill)}" fill-opacity="${opacity.toFixed(2)}"/>`;
}

/** The small sphere's dots: how many on the whole sphere, how far apart an eye's dots are, and the radii (viewBox units). */
const SMALL = { dots: 330, eyeStep: 0.065, body: 1.9, eye: 3.3 } as const;
