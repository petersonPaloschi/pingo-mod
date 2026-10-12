import { DIM_INK, type PixelCell } from "../../mascots/pixel.ts";
import { TERMINAL_DEFAULT } from "../../theme.ts";
import { petFrame, petRaised, petX, type Pet } from "../pet.ts";
import { LANE_ROWS, type CastMember } from "./model.ts";
import { BALLOON_ENDS, LABEL_PADDING, balloonWords, castLayout, clipName, growBalloons, moreWidth } from "./layout.ts";
import { hopRaised, memberFrame } from "./frame.ts";
/** A lane cell: a character, its color, and the ground behind it when it has one (none in this look). */
export type LaneCell = PixelCell;

const BLANK: LaneCell = [" ", TERMINAL_DEFAULT];

/**
 * The whole lane at `now`, `columns` cells wide and `LANE_ROWS` tall: the names on the top row (each speaker's in a
 * balloon, "(Name: what it does)", where there is room), the bodies under them, the group standing where Pingo has
 * walked to. Everything is the terminal's own color; Pingo's name and the "+N" are dim. A body that hops is drawn one
 * row up, over its name. The Raster that shows it keeps one size, so a walk, a newcomer or a leaver is only a change of
 * cells, which the host repaints in place.
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
    const raised = slot.member ? hopRaised(slot.member, now) : petRaised(pet.act, Math.max(0, now - pet.start));
    if (!raised) {
      const speaking = slot.speaking === true;
      const room = slot.width - LABEL_PADDING - (speaking ? BALLOON_ENDS : 0);
      const name = [...(speaking ? balloonWords(slot, room) : clipName(slot.label, room))];
      // Pingo between turns has no balloon and a dim name: it sleeps
      const ink = slot.member || speaking ? TERMINAL_DEFAULT : DIM_INK;
      const cells = (speaking ? ["(", ...name, ")"] : name).map((char): LaneCell => [char, ink]);
      const nameAt = x + Math.floor((slot.width - cells.length) / 2);
      cells.forEach((cell, i) => put(0, nameAt + i, cell));
    }
    const sprite = slot.member ? memberFrame(slot.member, now, slot.dir, walking) : petFrame(pet.act, Math.max(0, now - pet.start), pet.dir, pet.hat, pet.shades);
    const at = x + Math.floor((slot.width - sprite[0]!.length) / 2);
    sprite.forEach((row, r) => row.forEach((cell, c) => cell[0] !== " " && put(r + (raised ? 0 : 1), at + c, cell)));
    x += slot.width;
  }
  if (hidden) [...`+${hidden}`].forEach((char, i) => put(0, x + 1 + i, [char, DIM_INK]));
  return lane;
}
