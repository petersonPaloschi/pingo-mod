import { displayWidth } from "../../layout.ts";
import { DECK_DESIGN, DOT_DEPTH, HUE } from "../../theme.ts";
import { PET_BRAILLE } from "../pet.ts";
import { castColor } from "./frame.ts";
import { isSpeaker, MEMBER_BRAILLE, type CastMember } from "./model.ts";

/** Pingo's name on the desktop, which has no terminal default to take. */
const PINGO_NAME_INK = DOT_DEPTH[4];
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
export const LABEL_PADDING = DECK_DESIGN.cast.lane.labelPaddingColumns;
const SLOT_MIN = MEMBER_BRAILLE.columns + DECK_DESIGN.cast.lane.memberWidthPaddingColumns;
export const SLOT_MAX = DECK_DESIGN.cast.lane.maximumLabelColumns;
/** The widest a speaker's slot grows to show what it says after its name. */
const BALLOON_MAX = DECK_DESIGN.cast.lane.maximumBalloonColumns;
const slotWidth = (label: string) => Math.max(SLOT_MIN, Math.min(SLOT_MAX, [...label].length + LABEL_PADDING));
/** The balloon's two ends around a speaker's name. */
export const BALLOON_ENDS = 2;
const memberWidth = (member: CastMember) => slotWidth(member.label) + (member.speaking ? BALLOON_ENDS : 0);
export const moreWidth = (hidden: number) => `+${hidden}`.length + 1;

/** A text cut to `room` columns, with "..." (three columns) in place of what is left out. */
const cut = (chars: readonly string[], room: number): string =>
  chars.length <= room ? chars.join("") : room <= 3 ? chars.slice(0, Math.max(0, room)).join("") : `${chars.slice(0, room - 3).join("").trimEnd()}...`;

/** A name as one-column characters (printable ASCII and accented letters), cut to `room` with "...". */
export function clipName(label: string, room: number): string {
  return cut([...label.normalize("NFC").replace(/[^\x20-\x7e\p{L}]/gu, "")].filter((char) => displayWidth(char) === 1), room);
}

/** A name as the desktop lane writes it (its own drawing, unchanged): printable ASCII and "·", cut with "…". */
export function clipNameDesktop(label: string, room: number): string {
  const chars = [...label.replace(/[^\x20-\x7e·]/g, "")];
  return chars.length <= room ? chars.join("") : `${chars.slice(0, Math.max(0, room - 1)).join("")}…`;
}

/** A text's characters that take one column each: printable ASCII and accented letters kept, wide, zero-width and control ones dropped. */
const oneColumn = (text: string): string[] => [...text.normalize("NFC").replace(/\s+/g, " ").replace(/[^\x20-\x7e\p{L}]/gu, "")].filter((char) => displayWidth(char) === 1);

/** The fewest columns of its words a balloon shows after the name and ": ", the "..." included (the design drops them below 7). */
const WORDS_MIN = 7;

/**
 * What a speaker's balloon reads in `room` columns: its name (cut to a slot's widest, as the desktop shows it), then
 * what it says, cut with "...". Words only come when at least one of them shows a letter; until then, or when nothing
 * it says takes one column, the name stands alone.
 */
export function balloonWords(slot: Pick<CastSlot, "label" | "says">, room: number): string {
  const name = clipName(slot.label, Math.min(room, SLOT_MAX));
  const words = slot.says ? oneColumn(slot.says).join("").trim() : "";
  // a short saying needs only its own columns; a long one at least WORDS_MIN of them, the "..." included
  if (!words || room < [...name].length + 2 + Math.min(WORDS_MIN, [...words].length)) return name;
  return cut([...`${name}: ${words}`], room);
}

/** The columns a speaker's slot would take to show all it says, up to the cap: its balloon's words at their widest. */
const balloonNeed = (slot: CastSlot) =>
  slot.speaking && slot.says ? Math.max(slot.width, [...balloonWords(slot, BALLOON_MAX - LABEL_PADDING - BALLOON_ENDS)].length + LABEL_PADDING + BALLOON_ENDS) : slot.width;

/**
 * Widens the speakers' slots into `spare` columns, so each balloon shows what its member says after its name: an
 * equal share each, none past what its words need. Returns the columns taken.
 */
export function growBalloons(slots: readonly CastSlot[], spare: number): number {
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
