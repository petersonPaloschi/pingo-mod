import { AGENT_MASCOTS } from "../../mascots/agents.ts";
import { DETAIL, mirror, pixelGrid, put, renderPixels, stamp, type PixelCell } from "../../mascots/pixel.ts";
import { FEATURE_MASCOT_PALETTE, HUE, PET_PALETTE, shadeOf } from "../../theme.ts";
import { MEMBER_BRAILLE, SPEAKER_IDS, isSpeaker, type CastKind, type CastMember, type CastState, type SpeakerId } from "./model.ts";

/** The desktop's box for a member: 16 units across, the middle at 8. */
export const DOTS_W = MEMBER_BRAILLE.columns * 2;
export const MID = DOTS_W / 2;
/** The pixel row the bodies' shadow lies on, under the shade of their feet. */
const FLOOR = MEMBER_BRAILLE.rows * 2 - 1;

interface Shape {
  /** Eight rows of pixels, top first: the body "#", its underside and trim "d", the floor's shadow "s". */
  rows: readonly string[];
  /** The row the tops of the eyes lie on: each eye is a box two pixels across and down. */
  eyeRow: number;
  /** The columns the eyes' boxes start at, left then right: 1 and 5 unless the body is narrower there. */
  eyeX?: readonly [number, number];
}

/** Something in each feature's own color, by feature: `make` for every one of them. */
export const perSpeaker = <T>(make: (id: SpeakerId, i: number) => T) => Object.fromEntries(SPEAKER_IDS.map((id, i) => [id, make(id, i)])) as Record<SpeakerId, T>;

/** A sphere like Pingo's, smaller: Jev's body. */
const SPHERE: Shape = { rows: ["........", "..####..", ".######.", "########", "########", ".######.", "..dddd..", "..ssss.."], eyeRow: 3 };

// Row 0 is kept free for a hop. The eyes sit where the body is wide enough to have body around each.
const SHAPES: Record<CastKind, Shape> = {
  jev: SPHERE,
  // each feature after what it does, so even without color no two look alike
  // Clareza a light bulb: the glass, its neck, the screw base
  clareza: { rows: ["........", "..####..", ".######.", ".######.", "..####..", "...dd...", "...dd...", "..ssss.."], eyeRow: 2 },
  // Semente a sprout coming out of its seed
  semente: { rows: ["........", "....d...", "...##...", "..####..", ".######.", ".######.", "..dddd..", "..ssss.."], eyeRow: 4 },
  // Farol a lighthouse: the lamp, the tower, the rocks at its foot
  farol: { rows: ["........", "..dddd..", "...##...", "..####..", "..####..", "..dddd..", ".dddddd.", "..ssss.."], eyeRow: 3, eyeX: [2, 4] },
  // Vigia an owl, its ear tufts up
  vigia: { rows: ["........", ".#....#.", ".######.", "########", "########", ".######.", "..dddd..", "..ssss.."], eyeRow: 3 },
  // Sentinela a shield, square on top and pointed below
  sentinela: { rows: ["........", "########", "########", "########", "########", ".######.", "..dddd..", "...ss..."], eyeRow: 3 },
  // Prisma a prism on its wide base
  prisma: { rows: ["........", "...##...", "..####..", "..####..", ".######.", "########", "dddddddd", "..ssss.."], eyeRow: 3, eyeX: [2, 4] },
  // Lapida a cut stone with a sparkle at its corner
  lapida: { rows: ["........", ".....d..", ".####ddd", "######d.", "########", ".######.", "..dddd..", "..ssss.."], eyeRow: 3, eyeX: [0, 3] },
  // Contexto a page with its corner folded
  contexto: { rows: ["........", ".####...", ".#####..", ".######.", ".######.", ".######.", ".dddddd.", "..ssss.."], eyeRow: 3 },
  // Code Quality a clipboard, its clip on top
  codeQuality: { rows: ["........", "..dddd..", ".#....#.", ".######.", ".######.", ".######.", ".dddddd.", "..ssss.."], eyeRow: 3 },
  // Comandante a star standing on two legs
  comandante: { rows: ["........", "...##...", "########", ".######.", ".######.", ".######.", ".##..##.", ".s....s."], eyeRow: 3 },
  // Portão a gate: its lintel, two pillars and the way through between them
  portao: { rows: ["........", "########", "########", ".##..##.", ".##..##.", ".##..##.", ".dd..dd.", ".ss..ss."], eyeRow: 2 },
  // Ensaio a clapperboard, its striped clapper on top
  ensaio: { rows: ["........", ".d#d#d#d", "########", "########", "########", "########", ".dddddd.", "..ssss.."], eyeRow: 3 },
  // Chaveiro a padlock: the shackle, the body, its keyhole
  chaveiro: { rows: ["........", "..dddd..", ".d....d.", "########", "########", "###dd###", ".######.", "..ssss.."], eyeRow: 4 },
  // Oficina a gear, its teeth all round
  oficina: { rows: ["........", ".#.##.#.", "########", ".######.", "########", ".#.##.#.", "..dddd..", "..ssss.."], eyeRow: 3 },
  // a triangle standing on its base
  tetra: { rows: ["........", "...##...", "..####..", "..####..", ".######.", ".######.", "dddddddd", "..ssss.."], eyeRow: 4 },
  // a cut gem: a flat table, the crown widening to the girdle, the pavilion narrowing to its point
  gem: { rows: ["........", ".######.", "########", ".######.", "..####..", "...##...", "...dd...", "..ssss.."], eyeRow: 2 },
  // a can: straight sides, its rims rounded off
  can: { rows: ["........", ".######.", "########", "########", "########", "########", ".dddddd.", "..ssss.."], eyeRow: 3 },
  // a spring: three coils on a thin core, the face on the top one
  coil: { rows: ["........", ".######.", "########", "...##...", ".######.", "...##...", ".dddddd.", "..ssss.."], eyeRow: 1 },
  // a spinning top: a stem, a wide shoulder, a point to spin on
  cone: { rows: ["........", "...##...", ".######.", "########", ".######.", "..####..", "...dd...", "..ssss.."], eyeRow: 3 },
};

/** Where the eyes sit on the desktop's 16-unit box: the row of their top, and the units between each and the middle. */
export const SVG_EYES: Record<CastKind, { y: number; apart: number }> = {
  jev: { y: 5, apart: 2 },
  ...perSpeaker(() => ({ y: 5, apart: 2 })),
  tetra: { y: 9, apart: 1 },
  gem: { y: 5, apart: 2 },
  can: { y: 5, apart: 2 },
  coil: { y: 4, apart: 2 },
  cone: { y: 8, apart: 2 },
};

/** Each kind blinks at its own moment, so the group never blinks as one. */
const BLINK_PHASE: Record<CastKind, number> = { jev: 0, tetra: 0.7, gem: 1.5, can: 2.3, coil: 3.1, cone: 3.8, ...perSpeaker((_, i) => 0.4 + i * 0.55) };

/** The color of each member's body and name. */
export function castColor(kind: CastKind): number {
  if (kind === "jev") return HUE.brand;
  return isSpeaker(kind) ? FEATURE_MASCOT_PALETTE[kind] : AGENT_MASCOTS[kind].color;
}

/** The four pixels of an eye's box, clockwise: a spinner lights one. */
const EYE_RING: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * An eye's pixels in its two by two box, for a member facing right (facing left is the grid turned round): a pill
 * that blinks and looks ahead when idle, a lit pixel walking round the box while asked, a slash that leans in to
 * join and to leave ("/ \", happy), and the same leaning out ("\ /") for a member whose task failed.
 */
function eyeDots(state: CastState, t: number, side: 1 | -1): readonly (readonly [number, number])[] {
  if (state === "asking") return [EYE_RING[(((Math.floor(t * 6) * side) % 4) + 4) % 4]!];
  if (state === "failed") return side === -1 ? [[0, 0], [1, 1]] : [[1, 0], [0, 1]];
  if (state === "join" || state === "done") return side === -1 ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]];
  return (t * 0.9) % 4.2 < 0.14 ? [[1, 1]] : [[1, 0], [1, 1]];
}

/** How far the body sits above its rest, in pixels (negative is up): hops to join and to leave, a bob to walk or to think. */
function liftOf(state: CastState, t: number, age: number, walking: boolean): number {
  if (state === "join" || state === "done") return -Math.round(Math.sin(Math.PI * ((age % 0.6) / 0.6)));
  if (state === "asking") return -Math.round(Math.abs(Math.sin((t / 0.5) * Math.PI)));
  return walking ? -Math.round(Math.abs(Math.sin((t / 0.6) * Math.PI * 2))) : 0;
}

const memberFrames = new Map<string, PixelCell[][]>();
const MEMBER_FRAMES_KEPT = 64;

/**
 * A member as pixel cells at `now`, facing `dir` (toward Pingo). Its look follows its state: eyes that blink when
 * idle, a spinner while Jev or a feature is at work, happy eyes to join and to leave, crosses for a task that failed.
 * Time is quantized to a tenth of a second, so two redraws inside the same tenth give the same cells.
 */
export function memberFrame(member: Pick<CastMember, "kind" | "state" | "since">, now: number, dir: 1 | -1, walking: boolean): PixelCell[][] {
  const tick = Math.floor(now / 100);
  const hops = member.state === "join" || member.state === "done";
  const ageTick = hops ? Math.floor(Math.max(0, now - member.since) / 100) : 0;
  const key = `${member.kind}|${member.state}|${tick}|${ageTick}|${dir}|${walking ? 1 : 0}`;
  const kept = memberFrames.get(key);
  if (kept !== undefined) return kept;
  const t = tick / 10;
  const shape = SHAPES[member.kind];
  const color = castColor(member.kind);
  const grid = pixelGrid(DOTS_W / 2, MEMBER_BRAILLE.rows * 2);
  // a member whose task failed shakes: it jumps a pixel every other tenth
  const lift = member.state === "failed" ? (tick % 2 === 1 ? -1 : 0) : liftOf(member.state, t, ageTick / 10, walking);
  stamp(grid, 0, FLOOR, [shape.rows[FLOOR]!], { s: PET_PALETTE.floor });
  stamp(grid, 0, lift, shape.rows.slice(0, FLOOR), { "#": color, d: shadeOf(color) });
  const [left, right] = shape.eyeX ?? [1, 5];
  for (const side of [-1, 1] as const) {
    const x0 = side === -1 ? left : right;
    for (const [dx, dy] of eyeDots(member.state, t + BLINK_PHASE[member.kind], side)) put(grid, x0 + dx, shape.eyeRow + dy + lift, PET_PALETTE.eyeInk | DETAIL);
  }
  const frame = renderPixels(dir > 0 ? grid : mirror(grid));
  if (memberFrames.size >= MEMBER_FRAMES_KEPT) memberFrames.delete(memberFrames.keys().next().value!);
  memberFrames.set(key, frame);
  return frame;
}
