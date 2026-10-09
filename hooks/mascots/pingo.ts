// Pingo, Jev's mascot: a sphere of dots with two eyes, drawn from one small 3D scene. The terminal
// gets it as braille (each cell a 2×4 grid of dots), the desktop app as SVG circles. The body is ink;
// only the eyes, the orbit ring and a few sparks take the mood's color.
import { brailleBit, brailleChar, DEPTH, DOT, hex, noise } from "../dots.ts";
import type { BrailleCell } from "../dots.ts";

export type Mood = "routing" | "thinking" | "passthrough" | "failing" | "idle" | "baseline";
type Eyes = "happy" | "spinner" | "pill" | "x" | "line" | "closed";

export const MOODS: Record<Mood, { eyes: Eyes; color: number; face: string }> = {
  routing: { eyes: "happy", color: DOT.route, face: "(^‿^)" },
  thinking: { eyes: "spinner", color: DOT.ink, face: "(◌_◌)" },
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

/**
 * Whether a point of the face (fx, fy on the front of the sphere) is part of an eye. `scale` enlarges each eye
 * around its own center: a small sphere needs bigger eyes to be read, and a scale of 1 is the shapes as drawn.
 */
export function eyeAt(eyes: Eyes, fx: number, fy: number, t: number, lookX = 0, open = 1, scale = 1): boolean {
  for (const side of [-1, 1]) {
    const dx = (fx - (side * 0.3 + lookX)) / scale;
    const dy = (fy - 0.1) / scale;
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
/** Braille eyes are enlarged: at a few cells across, the desktop's eye shapes are a single dot. */
const BRAILLE_EYE_SCALE = 1.5;

/**
 * Pingo in braille, `columns` × `rows` cells: a halftone sphere drawn dot by dot, so its face reads at this size.
 * The eyes are the continuous shapes `eyeAt` cuts from the front of the sphere, and the body is dithered under a
 * light that turns with the sphere's slow spin. Every dot is a pure function of (mood, t, size).
 */
export function brailleFrame(mood: Mood, t: number, columns: number, rows: number): BrailleCell[][] {
  const width = columns * 2;
  const height = rows * 4;
  const bits = new Uint8Array(columns * rows);
  const color = new Array<number>(columns * rows).fill(DEPTH[0]);
  const rank = new Array<number>(columns * rows).fill(-Infinity);
  const put = (x: number, y: number, shade: number, weight: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const cell = (y >> 2) * columns + (x >> 1);
    bits[cell]! |= brailleBit(x, y);
    if (weight >= rank[cell]!) {
      rank[cell] = weight;
      color[cell] = shade;
    }
  };

  const { eyes } = MOODS[mood];
  const sleepy = mood === "idle" || mood === "baseline";
  const spin = t * 0.12 * (sleepy ? 0.35 : mood === "thinking" ? 1.6 : 1);
  const lookX = mood === "passthrough" ? 0.07 : 0;
  const blink = (t * 0.9) % 4.2;
  const open = eyes === "pill" && blink < 0.14 ? Math.abs(blink - 0.07) / 0.07 : 1;
  const dim = mood === "baseline" ? 1 : 0;
  // the whole sphere fits the grid with a dot to spare, and breathes a little
  const radius = (Math.min(width, height - 2) / 2) * (1 + Math.sin(t * (sleepy ? 1.2 : 2.2)) * 0.015);
  const shake = mood === "failing" && Math.floor(t * 10) % 2 === 1 ? 1 : 0;
  const cx = width / 2 + shake;
  const cy = height / 2;
  const accent = MOODS[mood].color;

  const eyeDots: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5 - cx) / radius;
      const v = (cy - (y + 0.5)) / radius;
      const d2 = u * u + v * v;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      if (nz > 0.2 && eyeAt(eyes, u, v, t, lookX, open, BRAILLE_EYE_SCALE)) {
        eyeDots.push([x, y]);
        continue;
      }
      // an outline of dots holds the edge; inside, a dither under the light, turned with the spin
      const edge = (1 - Math.sqrt(d2)) * radius < 0.9;
      const turned = u * Math.cos(spin) + nz * Math.sin(spin);
      const lit = Math.max(0, -0.45 * turned - 0.55 * v + 0.7 * nz);
      if (!edge && 0.3 + 0.7 * lit <= bayer(x, y)) continue;
      const depth = Math.max(0, Math.min(DEPTH.length - 1, Math.floor(nz * DEPTH.length) - dim));
      put(x, y, DEPTH[depth]!, nz);
    }
  }
  // An eye's cells lose the body dots in them, so the eye keeps its shape and color and is not a blob.
  for (const [x, y] of eyeDots) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const cell = (y >> 2) * columns + (x >> 1);
    bits[cell] = 0;
    rank[cell] = -Infinity;
  }
  for (const [x, y] of eyeDots) put(x, y, accent, 2);

  if (mood === "thinking") {
    // the ring of the spinner's orbit, drawn only where it passes in front of the sphere
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + t * 1.4;
      if (Math.sin(a) < -0.25) continue;
      put(Math.floor(cx + Math.cos(a) * 1.42 * radius), Math.floor(cy - (Math.sin(a) * 0.21 - 0.05) * radius), accent, 0.5);
    }
  }

  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c): BrailleCell => [brailleChar(bits[r * columns + c]!), color[r * columns + c]!]),
  );
}

/** The braille frame as plain lines, for logs and tests. */
export const brailleText = (frame: BrailleCell[][]) => frame.map((row) => row.map(([char]) => char).join("")).join("\n");

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
function circleOf(mood: Mood, dot: Dot, t: number, small: boolean, style = ""): string {
  const depth = (dot.z + 1) / 2;
  const r = small
    ? dot.kind === "eye" ? SMALL.eye : dot.kind === "ring" ? 1.9 : SMALL.body + depth * 0.9
    : dot.kind === "eye" ? 1.9 : dot.kind === "ring" ? 1.3 : 0.5 + depth * 1.0;
  const fill = dot.kind === "body" ? bodyColor(mood, dot, t) : MOODS[mood].color;
  const opacity = dot.kind === "body" ? (small ? 0.3 + depth * depth * 0.7 : 0.15 + depth * depth * 0.85) : 1;
  return `<circle cx="${(50 + dot.x * 34).toFixed(1)}" cy="${(50 - dot.y * 34).toFixed(1)}" r="${r.toFixed(2)}" fill="${hex(fill)}" fill-opacity="${opacity.toFixed(2)}"${style ? ` style="${style}"` : ""}/>`;
}

/** One lap of a thinking Pingo's orbit, in seconds: a highlight runs once around the ring per lap. */
const ORBIT_S = 2.8;

const LIVE_CSS =
  "@keyframes pl-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}" +
  "@keyframes pl-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}" +
  "@keyframes pl-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}" +
  `@keyframes pl-chase{0%,100%{opacity:1}30%{opacity:.25}}` +
  "@keyframes pl-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-.6px)}75%{transform:translateX(.6px)}}" +
  "@media (prefers-reduced-motion:reduce){.pl-live *{animation:none!important}}";
const liveSvgs = new Map<string, string>();

/**
 * Pingo for the desktop dashboard: one still sphere per mood and size, the same bytes on every redraw, so the app
 * keeps the animation it started. The sphere breathes and bobs, a pill-eyed mood blinks and a failing one shakes;
 * a thinking one's orbit is a fixed ellipse with a highlight running around it. All of it is CSS, and nothing here
 * is timed by the plugin.
 */
export function pingoLiveSvg(mood: Mood, size = 96): string {
  const key = `${mood}|${size}`;
  const kept = liveSvgs.get(key);
  if (kept !== undefined) return kept;
  const dots = scene(mood, 0, 900);
  const of = (kind: Kind) => dots.filter((dot) => dot.kind === kind).map((dot) => circleOf(mood, dot, 0, false)).join("");
  const eyes = of("eye");
  const blink = MOODS[mood].eyes === "pill";
  const face = `${of("body")}${blink ? `<g style="transform-box:fill-box;transform-origin:center;animation:pl-blink 4.7s ease-in-out infinite">${eyes}</g>` : eyes}`;
  const bob = `<g style="animation:pl-bob 2.4s ease-in-out infinite">${face}</g>`;
  const breathe = `<g style="transform-box:view-box;transform-origin:50px 50px;animation:pl-breathe 2.4s ease-in-out infinite">${bob}</g>`;
  const shaking = mood === "failing" ? `<g style="animation:pl-shake .3s ease-in-out infinite">${breathe}</g>` : breathe;
  // The orbit stays where it is: its back half is drawn behind the sphere, its front half over it, and each dot
  // fades on a delay set by its place on the ring, so the highlight travels round the ellipse.
  const ring = dots.filter((dot) => dot.kind === "ring");
  const orbit = (part: Dot[]) =>
    part.map((dot) => circleOf(mood, dot, 0, false, `animation:pl-chase ${ORBIT_S}s linear infinite;animation-delay:${((dot.phase - 1) * ORBIT_S).toFixed(3)}s`)).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" class="pl-live" width="${size}" height="${size}" viewBox="0 0 100 100">` +
    `<style>${LIVE_CSS}</style>${orbit(ring.filter((dot) => dot.z < 0))}${shaking}${orbit(ring.filter((dot) => dot.z >= 0))}</svg>`;
  if (liveSvgs.size >= SVG_FRAMES) liveSvgs.delete(liveSvgs.keys().next().value!);
  liveSvgs.set(key, svg);
  return svg;
}

/** The small sphere's dots: how many on the whole sphere, how far apart an eye's dots are, and the radii (viewBox units). */
const SMALL = { dots: 330, eyeStep: 0.065, body: 1.9, eye: 3.3 } as const;
