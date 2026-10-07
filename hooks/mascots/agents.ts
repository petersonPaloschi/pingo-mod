// Five dotted mascots for Claude's subagents, so concurrent agents are easy to tell apart. Each is
// a tetrahedron, octahedron, cylinder, torus, or cone, drawn as terminal braille or desktop SVG.
import { brailleBit, brailleChar, DEPTH, hex } from "../dots.ts";
import { faceAt } from "./dice.ts";
import type { BrailleCell } from "../dots.ts";

export type MascotId = "tetra" | "gem" | "can" | "coil" | "cone";

type Vec = [number, number, number];
/** A dot of the model, drawn when any of its sides faces the camera (always when it lists none). */
interface ModelDot {
  p: Vec;
  normals: Vec[];
}
/** How a mascot moves at time `t`: turn about its vertical axis, tilt toward the camera, hop. */
interface Motion {
  yaw: number;
  tilt: number;
  roll: number;
  hop: number;
}

export interface AgentMascot {
  id: MascotId;
  name: string;
  /** Five characters, the width of a face in the live log's gutter. */
  face: string;
  color: number;
  /** Where its face sits, in model radii, and how big it is. */
  faceY: number;
  faceScale: number;
  motion: (t: number) => Motion;
  model: ModelDot[];
}

const norm = ([x, y, z]: Vec): Vec => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const lerp = (a: Vec, b: Vec, f: number): Vec => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** A convex solid's edges as dots, each with the normals of the two sides it joins. */
function polyhedron(vertices: Vec[], faces: number[][], perEdge = 30): ModelDot[] {
  const center = vertices.reduce<Vec>((s, v) => [s[0] + v[0] / vertices.length, s[1] + v[1] / vertices.length, s[2] + v[2] / vertices.length], [0, 0, 0]);
  const edges = new Map<string, { a: number; b: number; normals: Vec[] }>();
  for (const face of faces) {
    const mid = face.reduce<Vec>((s, i) => [s[0] + vertices[i]![0] / face.length, s[1] + vertices[i]![1] / face.length, s[2] + vertices[i]![2] / face.length], [0, 0, 0]);
    const normal = norm([mid[0] - center[0], mid[1] - center[1], mid[2] - center[2]]);
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const edge = edges.get(key) ?? { a, b, normals: [] };
      edge.normals.push(normal);
      edges.set(key, edge);
    });
  }
  const out: ModelDot[] = [];
  for (const { a, b, normals } of edges.values()) {
    for (let i = 0; i < perEdge; i++) out.push({ p: lerp(vertices[a]!, vertices[b]!, i / (perEdge - 1)), normals });
  }
  return out;
}

const TAU = Math.PI * 2;

function tetrahedron(): ModelDot[] {
  const base = [0, 1, 2].map((k): Vec => {
    const a = -Math.PI / 2 + (k * TAU) / 3;
    return [Math.cos(a) * 1.05, -0.55, Math.sin(a) * 1.05];
  });
  return polyhedron([[0, 1.1, 0], ...base], [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]], 34);
}

function octahedron(): ModelDot[] {
  const v: Vec[] = [[1, 0, 0], [-1, 0, 0], [0, 1.15, 0], [0, -1.15, 0], [0, 0, 1], [0, 0, -1]];
  const faces = [[2, 0, 4], [2, 4, 1], [2, 1, 5], [2, 5, 0], [3, 4, 0], [3, 1, 4], [3, 5, 1], [3, 0, 5]];
  return polyhedron(v, faces, 26);
}

function cylinder(): ModelDot[] {
  const out: ModelDot[] = [];
  const r = 0.78;
  const h = 0.9;
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * TAU;
    const radial: Vec = [Math.cos(a), 0, Math.sin(a)];
    out.push({ p: [Math.cos(a) * r, h, Math.sin(a) * r], normals: [[0, 1, 0], radial] });
    out.push({ p: [Math.cos(a) * r, -h, Math.sin(a) * r], normals: [[0, -1, 0], radial] });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    for (let i = 1; i < 18; i++) out.push({ p: [Math.cos(a) * r, -h + (2 * h * i) / 18, Math.sin(a) * r], normals: [[Math.cos(a), 0, Math.sin(a)]] });
  }
  return out;
}

function torus(): ModelDot[] {
  const out: ModelDot[] = [];
  const R = 0.7;
  const r = 0.3;
  for (let i = 0; i < 36; i++) {
    for (let j = 0; j < 8; j++) {
      const u = (i / 36) * TAU;
      const v = (j / 8) * TAU;
      const p: Vec = [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
      out.push({ p, normals: [[Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)]] });
    }
  }
  return out;
}

function cone(): ModelDot[] {
  const out: ModelDot[] = [];
  const r = 0.9;
  const top = 1.1;
  const bottom = -0.7;
  const slope = r / (top - bottom);
  const side = (a: number): Vec => norm([Math.cos(a), slope, Math.sin(a)]);
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * TAU;
    out.push({ p: [Math.cos(a) * r, bottom, Math.sin(a) * r], normals: [[0, -1, 0], side(a)] });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    for (let i = 0; i < 22; i++) out.push({ p: lerp([0, top, 0], [Math.cos(a) * r, bottom, Math.sin(a) * r], i / 21), normals: [side(a)] });
  }
  return out;
}

export const AGENT_MASCOTS: Record<MascotId, AgentMascot> = {
  tetra: {
    id: "tetra",
    name: "Tetra",
    face: "/•ᴗ•\\",
    color: 0x67d4e6,
    faceY: -0.12,
    faceScale: 0.5,
    motion: (t) => ({ yaw: t * 0.6, tilt: 0.28, roll: 0, hop: Math.abs(Math.sin(t * 1.4)) * 0.05 }),
    model: tetrahedron(),
  },
  gem: {
    id: "gem",
    name: "Gem",
    face: "<•ᴗ•>",
    color: 0xf78fc6,
    faceY: 0.02,
    faceScale: 0.55,
    motion: (t) => ({ yaw: t * 0.9, tilt: 0.22 + Math.sin(t * 0.8) * 0.06, roll: 0, hop: Math.sin(t * 2) * 0.05 }),
    model: octahedron(),
  },
  can: {
    id: "can",
    name: "Can",
    face: "|•ᴗ•|",
    color: 0xc3e88d,
    faceY: 0,
    faceScale: 0.6,
    motion: (t) => ({ yaw: Math.sin(t * 0.7) * 0.45, tilt: 0.42, roll: Math.sin(t * 1.1) * 0.08, hop: Math.abs(Math.sin(t * 1.8)) * 0.07 }),
    model: cylinder(),
  },
  coil: {
    id: "coil",
    name: "Coil",
    face: "(◦ᴗ◦)",
    color: 0xffb38a,
    faceY: 0,
    faceScale: 0.42,
    motion: (t) => ({ yaw: Math.sin(t * 0.6) * 0.5, tilt: 0.3, roll: t * 0.5, hop: 0 }),
    model: torus(),
  },
  cone: {
    id: "cone",
    name: "Top",
    face: "^•ᴗ•^",
    color: 0xe9e09a,
    faceY: -0.22,
    faceScale: 0.5,
    motion: (t) => ({ yaw: t * 1.4, tilt: 0.3 + Math.sin(t * 1.3) * 0.12, roll: Math.sin(t * 1.3 + 1) * 0.1, hop: 0 }),
    model: cone(),
  },
};

/** The order mascots are handed out in. */
export const MASCOT_ORDER: readonly MascotId[] = ["tetra", "gem", "can", "coil", "cone"];

export const isMascot = (id: unknown): id is MascotId => typeof id === "string" && id in AGENT_MASCOTS;

/** The mascot for a new subagent: the first one no running subagent wears, else the next in turn. */
export function pickMascot(running: readonly (string | undefined)[], n: number): MascotId {
  return MASCOT_ORDER.find((id) => !running.includes(id)) ?? MASCOT_ORDER[(n - 1) % MASCOT_ORDER.length]!;
}

type Kind = "body" | "face";
export interface MascotDot {
  x: number;
  y: number;
  z: number;
  kind: Kind;
}

const FACE_GRID: [number, number][] = [];
for (let fy = -0.8; fy <= 0.8; fy += 0.03) for (let fx = -0.8; fx <= 0.8; fx += 0.03) FACE_GRID.push([fx, fy]);
const extent = new Map<MascotId, number>();

/** A mascot at time `t`: its visible dots, projected, far ones first, and its face in front. */
export function mascotScene(id: MascotId, t: number): MascotDot[] {
  const mascot = AGENT_MASCOTS[id];
  const { yaw, tilt, roll, hop } = mascot.motion(t);
  let fit = extent.get(id);
  if (fit === undefined) {
    fit = 0.95 / Math.max(...mascot.model.map(({ p }) => Math.hypot(...p)));
    extent.set(id, fit);
  }
  const [ca, sa, cb, sb, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(tilt), Math.sin(tilt), Math.cos(roll), Math.sin(roll)];
  // Roll about the camera axis, turn about the vertical one, then tilt toward the camera.
  const rotate = ([x0, y0, z0]: Vec): Vec => {
    const x = x0 * cr - y0 * sr;
    const y = x0 * sr + y0 * cr;
    const x1 = x * ca + z0 * sa;
    const z1 = -x * sa + z0 * ca;
    return [x1, y * cb - z1 * sb, y * sb + z1 * cb];
  };
  const camera = 5;
  const out: MascotDot[] = [];
  for (const { p, normals } of mascot.model) {
    if (normals.length && !normals.some((n) => rotate(n)[2] > 0.04)) continue;
    const [x, y, z] = rotate([p[0] * fit, p[1] * fit, p[2] * fit]);
    const s = camera / (camera - z);
    out.push({ x: x * s, y: y * s + hop, z, kind: "body" });
  }
  // The face stays fixed in front while the body turns and blinks from time to time.
  const cycle = (t * 0.8 + mascot.faceY * 7) % 5;
  const open = cycle < 0.16 ? Math.abs(cycle - 0.08) / 0.08 : 1;
  for (const [fx, fy] of FACE_GRID) {
    if (faceAt(fx, fy, open)) out.push({ x: fx * mascot.faceScale, y: mascot.faceY + fy * mascot.faceScale + hop, z: 2, kind: "face" });
  }
  return out.sort((a, b) => a.z - b.z);
}

/** Gray by depth, with the nearest dots in the mascot's color: that is how one tells them apart. */
function bodyColor(id: MascotId, dot: MascotDot): number {
  const depth = (dot.z + 1) / 2;
  if (depth > 0.86) return AGENT_MASCOTS[id].color;
  return DEPTH[Math.max(0, Math.min(DEPTH.length - 1, Math.floor(depth * DEPTH.length) + 1))]!;
}

/** A mascot in braille, `columns` × `rows` cells. */
export function mascotFrame(id: MascotId, t: number, columns: number, rows: number): BrailleCell[][] {
  const width = columns * 2;
  const height = rows * 4;
  const bits = new Uint8Array(columns * rows);
  const color = new Array<number>(columns * rows).fill(DEPTH[0]);
  const rank = new Array<number>(columns * rows).fill(-9);
  const radius = Math.min(height, width) * 0.47;
  const cx = width / 2;
  const cy = height / 2;
  for (const dot of mascotScene(id, t)) {
    const px = Math.floor(cx + dot.x * radius);
    const py = Math.floor(cy - dot.y * radius);
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const cell = (py >> 2) * columns + (px >> 1);
    bits[cell]! |= brailleBit(px & 1, py & 3);
    const weight = dot.kind === "face" ? 9 : dot.z;
    if (weight > rank[cell]!) {
      rank[cell] = weight;
      color[cell] = dot.kind === "face" ? AGENT_MASCOTS[id].color : bodyColor(id, dot);
    }
  }
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c): BrailleCell => [brailleChar(bits[r * columns + c]!), color[r * columns + c]!]),
  );
}

/** A mascot for the desktop app: one still frame as SVG circles, on a transparent ground. */
export function mascotSvg(id: MascotId, t: number, size = 64): string {
  const dots = mascotScene(id, t)
    .map((dot) => {
      const depth = (dot.z + 1) / 2;
      const r = dot.kind === "face" ? 1.6 : 1.1;
      const fill = dot.kind === "face" ? AGENT_MASCOTS[id].color : bodyColor(id, dot);
      const opacity = dot.kind === "face" ? 1 : 0.35 + Math.min(1, depth) * 0.65;
      return `<circle cx="${(50 + dot.x * 44).toFixed(1)}" cy="${(50 - dot.y * 44).toFixed(1)}" r="${r.toFixed(2)}" fill="${hex(fill)}" fill-opacity="${opacity.toFixed(2)}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${dots}</svg>`;
}
