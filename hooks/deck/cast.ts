// The Deck's cast: whoever is at work stands with Pingo on the pet's lane, and nobody else. Jev joins while a call of
// his is open; a feature joins while it is at work or has something waiting on the person; a subagent joins when it
// starts. Each says what it is doing in a balloon over its body, and when its task ends, well or not, it hops a
// goodbye and leaves. Each member is a small body in its own color and shape: the subagents after their names (Tetra
// a triangle, Gem a cut gem, Can a can, Coil a spring, Top a spinning top), Jev a sphere like Pingo's, each feature
// after what it does (Farol a lighthouse, Semente a sprout, Vigia an owl...), drawn as pixel art like him, in half
// blocks, with its name on a row above it. The group stands in a fixed order, the features then Jev at Pingo's left
// and the subagents at his right, everyone facing Pingo, and it walks wherever Pingo walks. Unlike Pingo's scenes
// nothing here is random: a frame is a pure function of its inputs, so the host can repaint it in place and a test
// can check it exactly.
import type { AgentRun } from "../../types";
import { hex } from "../dots.ts";
import { displayWidth } from "../layout.ts";
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
  portao: "Portão",
  ensaio: "Ensaio",
  chaveiro: "Chaveiro",
  oficina: "Oficina",
};
export const isSpeaker = (kind: CastKind): kind is SpeakerId => Object.hasOwn(FEATURE_MASCOT_PALETTE, kind);

export type CastKind = "jev" | MascotId | SpeakerId;
/** What a member is doing: idle (a feature waiting on the person, a subagent running), at work (it thinks), just joined, or ended (well or not) and about to leave. */
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
  /** On the lane for a task: its name is drawn in a balloon, with `says` after it where there is room. */
  speaking?: boolean;
  /** What it is doing, in its own words: a subagent's description, Jev's call, a feature's task. */
  says?: string;
}

/**
 * A feature on the lane, as the caller found it: since when (or, once it `ended`, since its end), at work or waiting
 * on the person, and what it says. A feature with no task is not given at all.
 */
export interface CastSpeaker {
  id: SpeakerId;
  since: number;
  busy: boolean;
  says?: string;
  /** Its task ended at `since`, well or not: it hops a goodbye and leaves. */
  ended?: "done" | "failed";
}

/** Jev on the lane: whether a call of his is open and what it is about, and when the last one ended. */
export interface JevOnLane {
  open: boolean;
  says?: string;
  ended?: { at: number; failed: boolean };
}

/** A newcomer hops for this long; a member whose task ended stays this long, then leaves. */
export const CAST_JOIN_MS = DECK_DESIGN.cast.joinMs;
export const CAST_LEAVE_MS = DECK_DESIGN.cast.leaveMs;

/** Who leaves, and how: `ended` tells done from failed. */
const leaver = (base: Omit<CastMember, "state" | "since">, at: number, failed: boolean): CastMember => ({ ...base, state: failed ? "failed" : "done", since: at });

/**
 * The cast at `now`: Jev while a call is open, then the features in the order given, then each subagent at work, in
 * the order they started. Each at work speaks; each whose task ended in the last `CAST_LEAVE_MS` is there to say
 * goodbye, quiet. Nobody else is on the lane.
 */
export function castOf(runs: readonly AgentRun[], jev: JevOnLane, now: number, speakers: readonly CastSpeaker[] = []): CastMember[] {
  const cast: CastMember[] = [];
  const said = (says: string | undefined) => (says?.trim() ? { says: says.trim() } : {});
  const jevBase = { id: "jev", kind: "jev" as const, label: "Jev" };
  if (jev.open) cast.push({ ...jevBase, state: "asking", since: 0, speaking: true, ...said(jev.says) });
  else if (jev.ended && now - jev.ended.at < CAST_LEAVE_MS) cast.push(leaver(jevBase, jev.ended.at, jev.ended.failed));
  for (const one of speakers) {
    const base = { id: `feature:${one.id}`, kind: one.id, label: SPEAKER_NAMES[one.id] };
    if (one.ended) {
      if (now - one.since < CAST_LEAVE_MS) cast.push(leaver(base, one.since, one.ended === "failed"));
      continue;
    }
    const state: CastState = one.busy ? "asking" : now - one.since < CAST_JOIN_MS ? "join" : "idle";
    cast.push({ ...base, state, since: one.since, speaking: true, ...said(one.says) });
  }
  for (const run of [...runs].sort((a, b) => a.n - b.n)) {
    const kind = isMascot(run.mascot) ? run.mascot : MASCOT_ORDER[(Math.max(1, run.n) - 1) % MASCOT_ORDER.length]!;
    const base = { id: run.id, kind, label: `${AGENT_MASCOTS[kind].name}·${run.type}` };
    if (run.state === "running") {
      cast.push({ ...base, state: now - run.startedAt < CAST_JOIN_MS ? "join" : "idle", since: run.startedAt, speaking: true, ...said(run.description) });
    } else if (run.endedAt !== undefined && now - run.endedAt < CAST_LEAVE_MS) {
      cast.push(leaver(base, run.endedAt, run.state !== "done"));
    }
  }
  return cast;
}

/**
 * What the desktop's picture of a cast draws: equal keys draw the same members in the same states, the speakers in
 * their balloons. What a member says is the terminal's only (the desktop's balloon holds the name), so it is left out
 * and a changing count in Jev's words asks the desktop for no new picture.
 */
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
  /** Eight rows of pixels, top first: the body "#", its underside and trim "d", the floor's shadow "s". */
  rows: readonly string[];
  /** The row the tops of the eyes lie on: each eye is a box two pixels across and down. */
  eyeRow: number;
  /** The columns the eyes' boxes start at, left then right: 1 and 5 unless the body is narrower there. */
  eyeX?: readonly [number, number];
}

/** Something in each feature's own color, by feature: `make` for every one of them. */
const perSpeaker = <T>(make: (id: SpeakerId, i: number) => T) => Object.fromEntries(SPEAKER_IDS.map((id, i) => [id, make(id, i)])) as Record<SpeakerId, T>;

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

// ---------- the group on the lane ----------

/** One place in the group: who stands there (none for Pingo), its name, its color, its width, and which way it faces. */
export interface CastSlot {
  member?: CastMember;
  label: string;
  color: number;
  width: number;
  dir: 1 | -1;
  /** A member or Pingo on the lane for a task: its name is drawn in a balloon. */
  speaking?: boolean;
  /** What it says, after its name in the balloon where the lane has room. */
  says?: string;
}

/** A member's slot is as wide as its name and a space, within these bounds; Pingo's is his sprite's width. */
const LABEL_PADDING = DECK_DESIGN.cast.lane.labelPaddingColumns;
const SLOT_MIN = MEMBER_BRAILLE.columns + DECK_DESIGN.cast.lane.memberWidthPaddingColumns;
const SLOT_MAX = DECK_DESIGN.cast.lane.maximumLabelColumns;
/** The widest a speaker's slot grows to show what it says after its name. */
const BALLOON_MAX = DECK_DESIGN.cast.lane.maximumBalloonColumns;
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

/** A text's characters that take one column each: accented letters kept, wide, zero-width and control ones dropped. */
const oneColumn = (text: string): string[] => [...text.normalize("NFC").replace(/\s+/g, " ")].filter((char) => displayWidth(char) === 1);

/**
 * What a speaker's balloon reads in `room` columns: its name (cut to a slot's widest, as the desktop shows it), then
 * what it says, cut with an ellipsis. Words only come when at least one of them shows a letter; until then, or when
 * nothing it says takes one column, the name stands alone.
 */
export function balloonWords(slot: Pick<CastSlot, "label" | "says">, room: number): string {
  const name = clipName(slot.label, Math.min(room, SLOT_MAX));
  const words = slot.says ? oneColumn(slot.says).join("").trim() : "";
  if (!words || room < [...name].length + 4) return name;
  const chars = [...`${name}: ${words}`];
  return chars.length <= room ? chars.join("") : `${chars.slice(0, Math.max(0, room - 1)).join("")}…`;
}

/** The columns a speaker's slot would take to show all it says, up to the cap: its balloon's words at their widest. */
const balloonNeed = (slot: CastSlot) =>
  slot.speaking && slot.says ? Math.max(slot.width, [...balloonWords(slot, BALLOON_MAX - LABEL_PADDING - BALLOON_ENDS)].length + LABEL_PADDING + BALLOON_ENDS) : slot.width;

/**
 * Widens the speakers' slots into `spare` columns, so each balloon shows what its member says after its name: an
 * equal share each, none past what its words need. Returns the columns taken.
 */
function growBalloons(slots: readonly CastSlot[], spare: number): number {
  let taken = 0;
  let growing = slots.filter((slot) => balloonNeed(slot) > slot.width);
  while (spare - taken > 0 && growing.length) {
    const share = Math.max(1, Math.floor((spare - taken) / growing.length));
    for (const slot of growing) {
      const add = Math.max(0, Math.min(share, balloonNeed(slot) - slot.width, spare - taken));
      slot.width += add;
      taken += add;
    }
    growing = growing.filter((slot) => balloonNeed(slot) > slot.width);
  }
  return taken;
}

/**
 * The group laid out for a lane `columns` wide: the features, Jev, Pingo, then the subagents in the order they
 * started. Pingo is always there; Jev comes next if he fits; then, while they fit, the features, the subagents, and
 * the members saying goodbye, leaving room for "+N" when some do not. The features face right and the subagents
 * left, so everyone faces Pingo. `pingoSpeaks`: Pingo speaks for the session, saying `pingoSays`, its goal.
 */
export function castLayout(cast: readonly CastMember[], columns: number, pingoSpeaks = false, pingoSays?: string): { slots: CastSlot[]; hidden: number; width: number } {
  const pingo: CastSlot = {
    label: "Pingo",
    color: PINGO_NAME_INK,
    width: Math.max(PET_BRAILLE.columns, slotWidth("Pingo") + (pingoSpeaks ? BALLOON_ENDS : 0)),
    dir: 1,
    ...(pingoSpeaks ? { speaking: true, ...(pingoSays ? { says: pingoSays } : {}) } : {}),
  };
  let width = pingo.width;
  const slotOf = (member: CastMember): CastSlot => ({
    member,
    label: member.label,
    color: member.state === "failed" ? HUE.fail : castColor(member.kind),
    width: memberWidth(member),
    dir: isSpeaker(member.kind) || member.kind === "jev" ? 1 : -1,
    ...(member.speaking ? { speaking: true, ...(member.says ? { says: member.says } : {}) } : {}),
  });
  const jev = cast.find((m) => m.kind === "jev");
  const jevSlot = jev && width + memberWidth(jev) <= columns ? slotOf(jev) : undefined;
  if (jevSlot) width += jevSlot.width;
  // who gets the room first: the features, then the subagents, then whoever is only there to say goodbye
  const queue = cast.filter((m) => m.kind !== "jev");
  const rank = (m: CastMember) => (m.state === "done" || m.state === "failed" ? 2 : isSpeaker(m.kind) ? 0 : 1);
  const fitted = new Set<CastMember>();
  for (const member of [...queue].sort((a, b) => rank(a) - rank(b))) {
    const left = queue.length - fitted.size - 1;
    const need = memberWidth(member) + (left ? moreWidth(left) : 0);
    if (width + need > columns) break;
    fitted.add(member);
    width += memberWidth(member);
  }
  // and they stand in the cast's own order: the features at Jev's left, the subagents at Pingo's right
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
 * The whole lane at `now`, `columns` cells wide and `LANE_ROWS` tall: the names on the top row (each speaker's in a
 * balloon of its color, with what it is doing after it where there is room), the bodies under them, the group
 * standing where Pingo has walked to. The Raster that shows it keeps one size, so a walk, a newcomer or a leaver is
 * only a change of cells, which the host repaints in place.
 */
export function castLaneCells(pet: Pet, cast: readonly CastMember[], now: number, columns: number): LaneCell[][] {
  const { slots, hidden, width } = castLayout(cast, columns, pet.speaks === true, pet.says);
  const more = hidden ? moreWidth(hidden) : 0;
  // the balloons take what the group leaves, so what each says shows; whatever they leave is Pingo's to walk
  const total = width + more + growBalloons(slots, columns - width - more);
  const lane = Array.from({ length: LANE_ROWS }, () => Array.from({ length: columns }, () => BLANK));
  const put = (row: number, col: number, cell: LaneCell) => {
    if (col >= 0 && col < columns) lane[row]![col] = cell;
  };
  const walking = pet.act === "walk" || pet.act === "run";
  let x = Math.round(petX(pet, now) * Math.max(0, columns - total));
  for (const slot of slots) {
    const speaking = slot.speaking === true;
    const room = slot.width - LABEL_PADDING - (speaking ? BALLOON_ENDS : 0);
    const name = [...(speaking ? balloonWords(slot, room) : clipName(slot.label, room))];
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
