// The Deck's cast: Jev, the features with something to say, and every subagent at work, standing with Pingo on the
// pet's lane. Jev is always there and changes its look while it is being asked; a feature joins while it has
// something for the person or is at work, and is gone as soon as it has not; a subagent joins when it starts and
// leaves shortly after it ends. Each member is a small body in its own color, the subagents shaped after their names
// (Tetra a triangle, Gem a cut gem, Can a can, Coil a spring, Top a spinning top), Jev and the features spheres like
// Pingo's, drawn as pixel art like him, in half blocks, with its name on a row above it; the one speaking has its name
// in a balloon. The group stands in a fixed order, the features then Jev at Pingo's left and the subagents at his
// right, everyone facing Pingo, and it walks wherever Pingo walks. Unlike Pingo's scenes nothing here is random: a
// frame is a pure function of its inputs, so the host can repaint it in place and a test can check it exactly.
import type { AgentRun } from "../../types";
import { hex } from "../dots.ts";
import { AGENT_MASCOTS, isMascot, MASCOT_ORDER, type MascotId } from "../mascots/agents.ts";
import { DETAIL, mirror, pixelGrid, put, renderPixels, stamp, type PixelCell } from "../mascots/pixel.ts";
import { DECK_DESIGN, DOT_DEPTH, FEATURE_MASCOT_PALETTE, HUE, inkOn, PET_PALETTE, shadeOf, TERMINAL_DEFAULT } from "../theme.ts";
import { PET_BRAILLE, PET_CSS, petFrame, petSvgBody, petX, type Pet } from "./pet.ts";
import { esc } from "./theme.ts";

/** The features that join the lane as mascots of their own. */
export type SpeakerId = keyof typeof FEATURE_MASCOT_PALETTE;
export const SPEAKER_IDS = Object.keys(FEATURE_MASCOT_PALETTE) as SpeakerId[];
/** Each feature mascot's name: the feature's own, the same in every language. */
export const SPEAKER_NAMES: Record<SpeakerId, string> = {
  clareza: "Clareza",
  semente: "Semente",
  farol: "Farol",
  vigia: "Vigia",
  sentinela: "Sentinela",
  prisma: "Prisma",
  lapida: "Lapida",
  contexto: "Contexto",
  codeQuality: "Code Quality",
  comandante: "Comandante",
};
export const isSpeaker = (kind: CastKind): kind is SpeakerId => Object.hasOwn(FEATURE_MASCOT_PALETTE, kind);

export type CastKind = "jev" | MascotId | SpeakerId;
/** What a member is doing: standing by, being asked (Jev) or at work (a feature), just joined, or ended (well or not) and about to leave. */
export type CastState = "idle" | "asking" | "join" | "done" | "failed";

export interface CastMember {
  /** "jev", "feature:<id>", or the subagent's run id. */
  id: string;
  kind: CastKind;
  /** The name on the row above it: the mascot's, then the subagent's type. */
  label: string;
  state: CastState;
  /** When that state began, in ms: a newcomer hops from here, a leaver from its end. */
  since: number;
  /** The one speaking: its name is drawn in a balloon. */
  speaking?: boolean;
}

/** A feature on the lane, as the caller found it: since when, at work or not, and whether it is the one speaking. */
export interface CastSpeaker {
  id: SpeakerId;
  since: number;
  busy: boolean;
  speaking: boolean;
}

/** A newcomer hops for this long; a subagent that ended stays this long, then leaves. */
export const CAST_JOIN_MS = DECK_DESIGN.cast.joinMs;
export const CAST_LEAVE_MS = DECK_DESIGN.cast.leaveMs;

/**
 * The cast at `now`: Jev first, then the features in the order given (the one speaking first), then each subagent at
 * work or just ended, in the order they started. `lead` names the member speaking when it is Jev or a subagent at work
 * (a feature's own `speaking` says it for the features).
 */
export function castOf(runs: readonly AgentRun[], asking: boolean, now: number, speakers: readonly CastSpeaker[] = [], lead?: string): CastMember[] {
  const cast: CastMember[] = [{ id: "jev", kind: "jev", label: asking ? "Jev ?" : "Jev", state: asking ? "asking" : "idle", since: 0, ...(lead === "jev" ? { speaking: true } : {}) }];
  for (const one of speakers) {
    const state: CastState = one.busy ? "asking" : now - one.since < CAST_JOIN_MS ? "join" : "idle";
    cast.push({ id: `feature:${one.id}`, kind: one.id, label: SPEAKER_NAMES[one.id], state, since: one.since, ...(one.speaking ? { speaking: true } : {}) });
  }
  for (const run of [...runs].sort((a, b) => a.n - b.n)) {
    const kind = isMascot(run.mascot) ? run.mascot : MASCOT_ORDER[(Math.max(1, run.n) - 1) % MASCOT_ORDER.length]!;
    const label = `${AGENT_MASCOTS[kind].name}·${run.type}`;
    if (run.state === "running") {
      cast.push({ id: run.id, kind, label, state: now - run.startedAt < CAST_JOIN_MS ? "join" : "idle", since: run.startedAt, ...(lead === run.id ? { speaking: true } : {}) });
    } else if (run.endedAt !== undefined && now - run.endedAt < CAST_LEAVE_MS) {
      cast.push({ id: run.id, kind, label, state: run.state === "done" ? "done" : "failed", since: run.endedAt });
    }
  }
  return cast;
}

/** What a cast draws: equal keys draw the same members in the same states. */
export const castKey = (cast: readonly CastMember[]): string => cast.map((m) => `${m.id}:${m.state}:${m.label}${m.speaking ? ":says" : ""}`).join("|");

// ---------- one member, in a terminal: a grid of 8 by 8 pixels, 8 cells by 4 rows ----------

/** A member's cells in a terminal: 8 columns by 4 rows of half blocks, a grid of 8 by 8 pixels. (The name is the old braille one, kept for its importers.) */
export const MEMBER_BRAILLE = DECK_DESIGN.pet.member;
/** The lane's rows in a terminal: the names, then the bodies. */
export const LANE_ROWS = PET_BRAILLE.rows + 1;

/** The desktop's box for a member: 16 units across, the middle at 8. */
const DOTS_W = MEMBER_BRAILLE.columns * 2;
const MID = DOTS_W / 2;
/** The pixel row the bodies' shadow lies on, under the shade of their feet. */
const FLOOR = MEMBER_BRAILLE.rows * 2 - 1;
export const PINGO_INK = TERMINAL_DEFAULT;
/** Pingo's name on the desktop, which has no terminal default to take. */
const PINGO_NAME_INK = DOT_DEPTH[4];

interface Shape {
  /** Eight rows of pixels, top first: the body "#", its underside "d", the floor's shadow "s". */
  rows: readonly string[];
  /** The row the tops of the eyes lie on: each eye is a box two pixels across and down, the left at column 1, the right at 5. */
  eyeRow: number;
}

/** Something in each feature's own color, by feature: `make` for every one of them. */
const perSpeaker = <T>(make: (id: SpeakerId, i: number) => T) => Object.fromEntries(SPEAKER_IDS.map((id, i) => [id, make(id, i)])) as Record<SpeakerId, T>;

/** A sphere like Pingo's, smaller: Jev's body, and every feature's. */
const SPHERE: Shape = { rows: ["........", "..####..", ".######.", "########", "########", ".######.", "..dddd..", "..ssss.."], eyeRow: 3 };

// Row 0 is kept free for a hop. The eyes sit where the body is eight pixels or six wide, so each has body around it.
const SHAPES: Record<CastKind, Shape> = {
  jev: SPHERE,
  ...perSpeaker(() => SPHERE),
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
const SVG_EYES: Record<CastKind, { y: number; apart: number }> = {
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
 * join and to leave ("/ \", happy), and the same leaning out ("\ /") for a subagent that failed.
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
 * idle, a spinner while Jev is asked, happy eyes to join and to leave, crosses for a subagent that failed.
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
  // a subagent that failed shakes: it jumps a pixel every other tenth
  const lift = member.state === "failed" ? (tick % 2 === 1 ? -1 : 0) : liftOf(member.state, t, ageTick / 10, walking);
  stamp(grid, 0, FLOOR, [shape.rows[FLOOR]!], { s: PET_PALETTE.floor });
  stamp(grid, 0, lift, shape.rows.slice(0, FLOOR), { "#": color, d: shadeOf(color) });
  for (const side of [-1, 1] as const) {
    const x0 = side === -1 ? 1 : 5;
    for (const [dx, dy] of eyeDots(member.state, t + BLINK_PHASE[member.kind], side)) put(grid, x0 + dx, shape.eyeRow + dy + lift, PET_PALETTE.eyeInk | DETAIL);
  }
  const frame = renderPixels(dir > 0 ? grid : mirror(grid));
  if (memberFrames.size >= MEMBER_FRAMES_KEPT) memberFrames.delete(memberFrames.keys().next().value!);
  memberFrames.set(key, frame);
  return frame;
}

// ---------- the group on the lane ----------

/** One place in the group: who stands there (none for Pingo), its name, its color, its width, and which way it faces. */
export interface CastSlot {
  member?: CastMember;
  label: string;
  color: number;
  width: number;
  dir: 1 | -1;
  /** The one speaking, a member or Pingo: its name is drawn in a balloon. */
  speaking?: boolean;
}

/** A member's slot is as wide as its name and a space, within these bounds; Pingo's is his sprite's width. */
const LABEL_PADDING = DECK_DESIGN.cast.lane.labelPaddingColumns;
const SLOT_MIN = MEMBER_BRAILLE.columns + DECK_DESIGN.cast.lane.memberWidthPaddingColumns;
const SLOT_MAX = DECK_DESIGN.cast.lane.maximumLabelColumns;
const slotWidth = (label: string) => Math.max(SLOT_MIN, Math.min(SLOT_MAX, [...label].length + LABEL_PADDING));
/** The balloon's two ends around a speaker's name. */
const BALLOON_ENDS = 2;
const memberWidth = (member: CastMember) => slotWidth(member.label) + (member.speaking ? BALLOON_ENDS : 0);
const moreWidth = (hidden: number) => `+${hidden}`.length + 1;

/** A name as one-column characters, cut to `room` with an ellipsis. */
export function clipName(label: string, room: number): string {
  const chars = [...label.replace(/[^\x20-\x7e·]/g, "")];
  return chars.length <= room ? chars.join("") : `${chars.slice(0, Math.max(0, room - 1)).join("")}…`;
}

/**
 * The group laid out for a lane `columns` wide: the features, Jev, Pingo, then the subagents in the order they
 * started. Pingo is always there; Jev comes next if he fits; then, while they fit, the features speaking or at work,
 * the subagents, and the features standing by, leaving room for "+N" when some do not. The features face right and the subagents left,
 * so everyone faces Pingo. `pingoSpeaks`: Pingo is the one speaking, for Claude's own turn.
 */
export function castLayout(cast: readonly CastMember[], columns: number, pingoSpeaks = false): { slots: CastSlot[]; hidden: number; width: number } {
  const pingo: CastSlot = { label: "Pingo", color: PINGO_NAME_INK, width: Math.max(PET_BRAILLE.columns, slotWidth("Pingo") + (pingoSpeaks ? BALLOON_ENDS : 0)), dir: 1, ...(pingoSpeaks ? { speaking: true } : {}) };
  let width = pingo.width;
  const jev = cast.find((m) => m.kind === "jev");
  const jevSlot: CastSlot | undefined = jev && width + memberWidth(jev) <= columns
    ? { member: jev, label: jev.label, color: castColor("jev"), width: memberWidth(jev), dir: 1, ...(jev.speaking ? { speaking: true } : {}) }
    : undefined;
  if (jevSlot) width += jevSlot.width;
  // who gets the room first: a feature speaking or at work, then the subagents, then the features standing by (every
  // feature switched on is on the lane, so on a narrow one the quiet ones give way before any subagent does)
  const queue = cast.filter((m) => m.kind !== "jev");
  // (a feature hopping in has nothing to say yet: it waits with the ones standing by)
  const rank = (m: CastMember) => (!isSpeaker(m.kind) ? 1 : m.speaking || m.state === "asking" ? 0 : 2);
  const fitted = new Set<CastMember>();
  for (const member of [...queue].sort((a, b) => rank(a) - rank(b))) {
    const left = queue.length - fitted.size - 1;
    const need = memberWidth(member) + (left ? moreWidth(left) : 0);
    if (width + need > columns) break;
    fitted.add(member);
    width += memberWidth(member);
  }
  // and they stand in the cast's own order: the features at Jev's left, the subagents at Pingo's right
  const slotOf = (member: CastMember): CastSlot => ({ member, label: member.label, color: member.state === "failed" ? HUE.fail : castColor(member.kind), width: memberWidth(member), dir: isSpeaker(member.kind) ? 1 : -1, ...(member.speaking ? { speaking: true } : {}) });
  const features = queue.filter((m) => fitted.has(m) && isSpeaker(m.kind)).map(slotOf);
  const agents = queue.filter((m) => fitted.has(m) && !isSpeaker(m.kind)).map(slotOf);
  return { slots: [...features, ...(jevSlot ? [jevSlot] : []), pingo, ...agents], hidden: queue.length - fitted.size, width };
}

/** A lane cell: a character, its color, and the ground behind it when it has one (a speaker's balloon, a pixel's detail). */
export type LaneCell = PixelCell;

const BLANK: LaneCell = [" ", TERMINAL_DEFAULT];
/** Pingo's own balloon is stone: its body is the terminal's color, so it has no color of its own to fill one with. */
const PINGO_BALLOON = HUE.neutral;

/**
 * The whole lane at `now`, `columns` cells wide and `LANE_ROWS` tall: the names on the top row (the speaker's in a
 * balloon of its color), the bodies under them, the group standing where Pingo has walked to. The Raster that shows
 * it keeps one size, so a walk, a newcomer or a leaver is only a change of cells, which the host repaints in place.
 */
export function castLaneCells(pet: Pet, cast: readonly CastMember[], now: number, columns: number): LaneCell[][] {
  const { slots, hidden, width } = castLayout(cast, columns, pet.speaks === true);
  const total = width + (hidden ? moreWidth(hidden) : 0);
  const lane = Array.from({ length: LANE_ROWS }, () => Array.from({ length: columns }, () => BLANK));
  const put = (row: number, col: number, cell: LaneCell) => {
    if (col >= 0 && col < columns) lane[row]![col] = cell;
  };
  const walking = pet.act === "walk" || pet.act === "run";
  let x = Math.round(petX(pet, now) * Math.max(0, columns - total));
  for (const slot of slots) {
    const speaking = slot.speaking === true;
    const name = [...clipName(slot.label, slot.width - LABEL_PADDING - (speaking ? BALLOON_ENDS : 0))];
    const ink = slot.member ? slot.color : TERMINAL_DEFAULT;
    const ground = slot.member ? slot.color : PINGO_BALLOON;
    const cells: LaneCell[] = speaking
      ? [["▐", ground], ...name.map((char): LaneCell => [char, inkOn(ground), ground]), ["▌", ground]]
      : name.map((char): LaneCell => [char, ink]);
    const nameAt = x + Math.floor((slot.width - cells.length) / 2);
    cells.forEach((cell, i) => put(0, nameAt + i, cell));
    const sprite = slot.member ? memberFrame(slot.member, now, slot.dir, walking) : petFrame(pet.act, Math.max(0, now - pet.start), pet.dir, pet.hat, pet.shades);
    const at = x + Math.floor((slot.width - sprite[0]!.length) / 2);
    sprite.forEach((row, r) => row.forEach((cell, c) => put(r + 1, at + c, cell)));
    x += slot.width;
  }
  if (hidden) [...`+${hidden}`].forEach((char, i) => put(0, x + 1 + i, [char, HUE.neutral]));
  return lane;
}

// ---------- the group on the desktop: SVG, moved by CSS like Pingo ----------

/** The desktop lane's band for the names above the bodies, in pixels. */
export const CAST_LABEL_PX = DECK_DESIGN.cast.lane.labelHeight;
/** A member's body on the desktop, in pixels per pet scale: 16 units drawn this many pixels wide. */
const MEMBER_PX = DECK_DESIGN.cast.lane.memberPixels;
const NAME_PX = DECK_DESIGN.cast.lane.namePixels;

const sphereSvg = (f: string) => `<circle cx="8" cy="8.6" r="6.2" fill="${f}"/><ellipse cx="5.8" cy="5.8" rx="2.4" ry="1.6" fill="${PET_PALETTE.laneLight}" fill-opacity=".22"/>`;

const SHAPE_SVG: Record<CastKind, (fill: string) => string> = {
  jev: sphereSvg,
  ...perSpeaker(() => sphereSvg),
  tetra: (f) => `<path d="M8 2.8 14.4 14.4H1.6Z" fill="${f}" stroke="${f}" stroke-width="1.2" stroke-linejoin="round"/>`,
  gem: (f) => `<path d="M5 2.6H11L14.8 6.2 8 14.6 1.2 6.2Z" fill="${f}"/><path d="M1.2 6.2H14.8M5 2.6 6.4 6.2 8 14.6 9.6 6.2 11 2.6" stroke="${PET_PALETTE.laneLight}" stroke-opacity=".3" stroke-width=".5" fill="none"/>`,
  can: (f) => `<rect x="2" y="2.6" width="12" height="11.8" rx="2.4" fill="${f}"/><ellipse cx="8" cy="3.6" rx="5.4" ry="1.1" fill="${PET_PALETTE.laneLight}" fill-opacity=".25"/>`,
  coil: (f) => `<rect x="7" y="3.2" width="2" height="11.2" fill="${f}"/>` + [5, 9.2, 13.1].map((cy) => `<ellipse cx="8" cy="${cy}" rx="6.5" ry="1.9" fill="${f}"/>`).join(""),
  cone: (f) => `<path d="M7 2.6H9V4.8L15 8.2 8 14.6 1 8.2 7 4.8Z" fill="${f}" stroke="${f}" stroke-width=".8" stroke-linejoin="round"/>`,
};

/** A member's eyes in its 16-unit box, looking toward `dir`. */
function eyesSvg(kind: CastKind, state: CastState, dir: 1 | -1): string {
  const { y, apart } = SVG_EYES[kind];
  const look = dir * 0.8;
  return ([-1, 1] as const).map((side) => {
    const cx = MID + side * (apart + 1.2) + look;
    if (state === "asking") return `<circle cx="${cx}" cy="${y + 1.5}" r="1.3" fill="none" stroke="${PET_PALETTE.laneLight}" stroke-width=".9" stroke-dasharray="3 5.2" class="fb" style="animation:spin ${DECK_DESIGN.cast.motion.eyeSpinSeconds}s linear infinite"/>`;
    if (state === "failed") return `<path d="M${cx - 1.1} ${y + 0.4}l2.2 2.2m0-2.2-2.2 2.2" stroke="${PET_PALETTE.laneLight}" stroke-width=".9"/>`;
    if (state === "join" || state === "done") return `<path d="M${cx - 1.3} ${y + 2.2}Q${cx} ${y + 0.4} ${cx + 1.3} ${y + 2.2}" fill="none" stroke="${PET_PALETTE.laneLight}" stroke-width=".9"/>`;
    return `<rect x="${cx - 0.8}" y="${y}" width="1.6" height="2.8" rx=".8" fill="${PET_PALETTE.laneLight}"/>`;
  }).join("");
}

/** A member's motion on the desktop: a hop to join and to leave, a quick bob while asked, a shake if it failed. */
function motionOf(state: CastState, walking: boolean): string {
  const m = DECK_DESIGN.pet.motion;
  if (state === "join" || state === "done") return `jump ${DECK_DESIGN.cast.motion.hopSeconds}s ${DECK_DESIGN.cast.motion.hopEasing} infinite`;
  if (state === "asking") return `bob ${DECK_DESIGN.cast.motion.askingSeconds}s ease-in-out infinite`;
  if (state === "failed") return `shake ${m.shakeSeconds}s infinite`;
  return walking ? `bob ${m.walkSeconds}s ease-in-out infinite` : `breathe ${m.breatheSeconds}s ease-in-out infinite`;
}

const lanes = new Map<string, string>();
const LANES_KEPT = 8;

/**
 * The desktop lane, `W` by `H` pixels with the names' band at its top: the same group as the terminal's, walked from
 * x0 to x1 by CSS like Pingo alone. A scene is one picture for as long as it runs, so its text is made once, at its
 * first draw, and handed back as it was: the app keeps the animation going and nothing is built again.
 */
export function castLaneSvg(pet: Pet, cast: readonly CastMember[], now: number, W: number, H: number, scale: number = DECK_DESIGN.pet.lane.desktopScale): string {
  const key = [pet.id, pet.act, pet.dir, pet.hat, pet.shades, pet.speaks, pet.x0, pet.x1, pet.dur, pet.start, castKey(cast), W, H, scale].join("|");
  const kept = lanes.get(key);
  if (kept !== undefined) return kept;
  const lane = buildCastSvg(pet, cast, now, W, H, scale);
  if (lanes.size >= LANES_KEPT) lanes.delete(lanes.keys().next().value!);
  lanes.set(key, lane);
  return lane;
}

function buildCastSvg(pet: Pet, cast: readonly CastMember[], now: number, W: number, H: number, scale: number): string {
  const body = DECK_DESIGN.pet.body;
  const PW = body.width * scale;
  const PH = body.height * scale;
  const MW = MEMBER_PX * scale;
  const gap = DECK_DESIGN.pet.lane.bodyGap;
  const { memberPaddingPixels, labelPaddingPixels, memberShadow, balloon } = DECK_DESIGN.cast.desktop;
  // the same group as the terminal's, a column being NAME_PX pixels: who fits, and how many are left out
  const { slots, hidden } = castLayout(cast, Math.floor(W / NAME_PX), pet.speaks === true);
  const widthOf = (slot: CastSlot) => Math.max(slot.member ? MW + memberPaddingPixels : PW, [...clipName(slot.label, SLOT_MAX)].length * NAME_PX + labelPaddingPixels + (slot.speaking ? 2 * balloon.paddingPixels : 0));
  const total = slots.reduce((sum, slot) => sum + widthOf(slot), 0) + (hidden ? moreWidth(hidden) * NAME_PX : 0);
  const room = Math.max(0, W - total);
  const age = Math.max(0, now - pet.start) / 1000;
  const dur = Math.max(0.001, pet.dur / 1000);
  const move = `@keyframes mv${pet.id}{from{transform:translateX(${(pet.x0 * room).toFixed(1)}px)}to{transform:translateX(${(pet.x1 * room).toFixed(1)}px)}}`;
  const walking = pet.act === "walk" || pet.act === "run";
  let x = 0;
  let group = "";
  for (const slot of slots) {
    const w = widthOf(slot);
    const clipped = clipName(slot.label, SLOT_MAX);
    const name = esc(clipped);
    const speaking = slot.speaking === true;
    if (speaking) {
      // the speaker's name in a balloon of its color, its tail pointing down at the body
      const bw = [...clipped].length * NAME_PX + 2 * balloon.paddingPixels;
      const bx = x + (w - bw) / 2;
      const cx = x + w / 2;
      group +=
        `<rect x="${bx.toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${CAST_LABEL_PX}" rx="${balloon.radiusPixels}" fill="${hex(slot.color)}"/>` +
        `<path d="M${(cx - balloon.tailPixels).toFixed(1)} ${CAST_LABEL_PX}h${2 * balloon.tailPixels}l-${balloon.tailPixels} ${balloon.tailPixels}Z" fill="${hex(slot.color)}"/>`;
    }
    group += `<text x="${(x + w / 2).toFixed(1)}" y="${CAST_LABEL_PX - DECK_DESIGN.cast.lane.labelBaselineInsetPixels}" text-anchor="middle" style="font:${DECK_DESIGN.type.svgWeights.semibold} ${DECK_DESIGN.type.svgTinyPixels}px ${DECK_DESIGN.type.svg};fill:${hex(speaking ? inkOn(slot.color) : slot.color)}">${name}</text>`;
    if (slot.member) {
      const left = x + (w - MW) / 2;
      const top = H - MW - gap;
      const fill = hex(castColor(slot.member.kind));
      group +=
        `<ellipse cx="${(x + w / 2).toFixed(1)}" cy="${H - gap}" rx="${(MW * memberShadow.radiusRatio).toFixed(1)}" ry="${memberShadow.radiusYPixels}" fill="${PET_PALETTE.shadow}" opacity="${memberShadow.opacity}"/>` +
        `<g transform="translate(${left.toFixed(1)} ${top.toFixed(1)}) scale(${(MW / DOTS_W).toFixed(3)})"><g class="fbot" style="animation:${motionOf(slot.member.state, walking)}">` +
        SHAPE_SVG[slot.member.kind](fill) + eyesSvg(slot.member.kind, slot.member.state, slot.dir) +
        "</g></g>";
    } else {
      const left = x + (w - PW) / 2;
      const flip = pet.dir < 0 ? `translate(${PW} 0) scale(-1 1)` : "";
      group += `<g transform="translate(${left.toFixed(1)} ${(H - PH - gap).toFixed(1)})"><g transform="${flip}"><svg width="${PW}" height="${PH}" viewBox="${body.viewBox}" overflow="visible">${petSvgBody(pet.act, pet.hat, pet.shades)}</svg></g></g>`;
    }
    x += w;
  }
  if (hidden) group += `<text x="${x + NAME_PX}" y="${CAST_LABEL_PX - DECK_DESIGN.cast.lane.labelBaselineInsetPixels}" style="font:${DECK_DESIGN.type.svgWeights.semibold} ${DECK_DESIGN.type.svgTinyPixels}px ${DECK_DESIGN.type.svg};fill:${hex(HUE.neutral)}">+${hidden}</text>`;
  let dots = "";
  const backgroundDots = DECK_DESIGN.pet.lane.backgroundDots;
  if (scale >= backgroundDots.minimumScale) for (let d = backgroundDots.startX; d < W; d += DECK_DESIGN.pet.lane.backgroundSpacing) dots += `<rect x="${d}" y="${H - backgroundDots.yInsetPixels}" width="${backgroundDots.widthPixels}" height="${backgroundDots.heightPixels}" fill="${PET_PALETTE.laneLight}" opacity="${backgroundDots.opacity}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<style>${PET_CSS}@keyframes spin{to{transform:rotate(360deg)}}${move}.mv{animation:mv${pet.id} ${dur.toFixed(2)}s linear both;animation-delay:-${Math.min(age, dur).toFixed(2)}s}</style>` +
    dots +
    `<g class="mv">${group}</g>` +
    "</svg>"
  );
}
