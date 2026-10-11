import { hex } from "../../dots.ts";
import { DECK_DESIGN, HUE, inkOn, PET_PALETTE } from "../../theme.ts";
import { PET_CSS, petSvgBody, type Pet } from "../pet.ts";
import { esc } from "../theme.ts";
import { castColor, DOTS_W, MID, perSpeaker, SVG_EYES } from "./frame.ts";
import { castKey, type CastKind, type CastMember, type CastState } from "./model.ts";
import { SLOT_MAX, castLayout, clipName, moreWidth, type CastSlot } from "./layout.ts";

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
