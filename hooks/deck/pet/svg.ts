import { hex } from "../../dots.ts";
import { pingoSvg } from "../../mascots/pingo.ts";
import { DECK_DESIGN, PET_PALETTE } from "../../theme.ts";
import { CONFETTI, PET_MOTION, PROP, petMoodFor, type Pet, type PetAct } from "./model.ts";

/** The pet's box in pet units, as the lane draws it: 48 wide and 38 tall, from (-4, -6). */
const PET_W = DECK_DESIGN.pet.body.width;
const PET_H = DECK_DESIGN.pet.body.height;
const PET_VIEW = DECK_DESIGN.pet.body.viewBox;
// ---------- desktop: SVG, moved by CSS and by the lane's own translate ----------

export const PET_CSS =
  ".fb{transform-box:fill-box;transform-origin:center}.fbot{transform-box:fill-box;transform-origin:bottom center}" +
  `@keyframes breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(${PET_MOTION.breatheScale})}}` +
  `@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-${PET_MOTION.bobPixels}px)}}` +
  `@keyframes jump{0%,100%{transform:translateY(0) scaleY(.92)}12%{transform:translateY(0) scaleY(1.04)}45%{transform:translateY(-${PET_MOTION.jumpPixels}px)}80%{transform:translateY(0)}}` +
  `@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-${PET_MOTION.shakePixels}px)}75%{transform:translateX(${PET_MOTION.shakePixels}px)}}` +
  `@keyframes conf{0%{transform:translateY(0);opacity:1}100%{transform:translateY(${PET_MOTION.confettiPixels}px);opacity:0}}` +
  `@keyframes zz{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(${PET_MOTION.sleepZX}px,-${PET_MOTION.sleepZY}px);opacity:0}}` +
  `@keyframes glow{0%,100%{opacity:1}50%{opacity:${PET_MOTION.glowLowOpacity}}}` +
  `@keyframes puff{0%{transform:translateX(0) scale(${PET_MOTION.puffScale[0]});opacity:${PET_MOTION.puffOpacity}}100%{transform:translateX(-${PET_MOTION.puffPixels}px) scale(${PET_MOTION.puffScale[1]});opacity:0}}` +
  "@media (prefers-reduced-motion:reduce){*{animation:none!important}}";

/** The floor line, and the sphere: a square of `size` units centred on x, its outer edge (0.355 of the square) on the floor. */
const FLOOR_Y = DECK_DESIGN.pet.body.floorY;
const BODY = { size: DECK_DESIGN.pet.body.size, x: DECK_DESIGN.pet.body.x };
const BODY_Y = FLOOR_Y - 0.355 * BODY.size;

const bodies = new Map<string, string>();

// The pet in its 48x38 box (viewBox -4 -6 48 38), facing right, in the lane's own coordinates. The body is
// pingo's still sphere from pingoSvg, in its small form; its motion is CSS on that sphere, and walking is the
// lane's translate. It is the same picture every time for an act, so each act is built once.
export function petSvgBody(state: PetAct, hat = "none", shades = false): string {
  const key = `${state}|${hat}|${shades}`;
  const kept = bodies.get(key);
  if (kept !== undefined) return kept;
  const body = buildSvgBody(state, hat, shades);
  bodies.set(key, body);
  return body;
}

function buildSvgBody(state: PetAct, hat: string, shades: boolean): string {
  const run = state === "run";
  const walk = state === "walk" || run;
  const sleep = state === "sleep";
  const motion =
    state === "jump" || state === "celebrate"
      ? `jump ${PET_MOTION.jumpSeconds}s cubic-bezier(.3,.6,.4,1) infinite`
      : walk
        ? `bob ${run ? PET_MOTION.runSeconds : PET_MOTION.walkSeconds}s ease-in-out infinite`
        : `breathe ${sleep ? PET_MOTION.sleepSeconds : PET_MOTION.breatheSeconds}s ease-in-out infinite`;
  const mood = petMoodFor(state);
  // passthrough eyes look aside, so the walking sphere is turned round to look ahead
  const ahead = mood === "passthrough" ? ` transform="translate(${BODY.size} 0) scale(-1 1)"` : "";
  const sphere = `<g transform="translate(${BODY.x - BODY.size / 2} ${BODY_Y - BODY.size / 2})"><g${ahead}>${pingoSvg(mood, 0, BODY.size, true)}</g></g>`;
  const body = `<g${run ? ' transform="rotate(-7 20 28)"' : ""}><g class="fbot" style="animation:${motion}">${sphere}</g></g>`;
  const shadowDesign = DECK_DESIGN.pet.body.shadow;
  const shadow = `<ellipse cx="${BODY.x}" cy="${FLOOR_Y}" rx="${state === "jump" ? shadowDesign.jumpRadiusPixels : shadowDesign.restRadiusPixels}" ry="${shadowDesign.radiusYPixels}" fill="${PET_PALETTE.shadow}" opacity="${shadowDesign.opacity}"/>`;
  return shadow + body + propsSvg(state) + accessoriesSvg(hat, shades);
}

// the hats keep their own colors (a chef's hat is white, a cowboy's brown), and never a mood's: the eyes alone
// wear the mood's color. The party and wizard hats take the identity's plum and sky.
const HAT_COLORS: Readonly<Record<string, string | undefined>> = PET_PALETTE.hats;

function accessoriesSvg(hat: string, shades: boolean): string {
  let headwear = "";
  const color = HAT_COLORS[hat];
  if (color) {
    const brim = `<rect x="12" y="7" width="16" height="2.5" rx="1" fill="${color}"/>`;
    const body = hat === "tophat" ? `<rect x="16" y="0" width="8" height="8" rx="1" fill="${color}"/>`
    : hat === "party" ? `<path d="M14 8 20 -3 26 8Z" fill="${color}"/><circle cx="20" cy="-3" r="1.3" fill="${PET_PALETTE.accents.gold}"/>`
      : hat === "crown" ? `<path d="M14 8 15 1 18 4 20 -1 22 4 25 1 26 8Z" fill="${color}" stroke="${PET_PALETTE.accents.red}" stroke-width=".7"/>`
        : hat === "wizard" ? `<path d="M14 8 20 -4 26 8Z" fill="${color}"/><path d="M18 5 20 3 22 5" stroke="${PET_PALETTE.accents.gold}" stroke-width="1"/>`
          : hat === "cowboy" ? `<path d="M14 5 Q20 -1 26 5 L28 7 Q20 9 12 7Z" fill="${color}"/><rect x="17" y="2" width="6" height="5" rx="1" fill="${color}"/>`
            : hat === "propeller" ? `<rect x="16" y="4" width="8" height="4" rx="2" fill="${color}"/><path d="M20 4V1 M13 1H27" stroke="${HAT_COLORS.santa}" stroke-width="1.5" stroke-linecap="round"/>`
              : hat === "chef" ? `<path d="M15 8 Q12 2 16 2 Q17 -2 20 2 Q24 -2 25 3 Q29 4 25 8Z" fill="${color}" stroke="${PET_PALETTE.accents.trim}" stroke-width=".7"/>`
                : hat === "viking" ? `<rect x="15" y="4" width="10" height="4" rx="2" fill="${color}"/><path d="M16 5 Q12 0 12 2 L15 7 M24 5 Q28 0 28 2 L25 7" fill="${HAT_COLORS.chef}" stroke="${color}" stroke-width="1"/>`
                    : hat === "halo" ? `<ellipse cx="20" cy="1" rx="7" ry="2" fill="none" stroke="${color}" stroke-width="1.5"/>`
                  : hat === "santa" ? `<path d="M14 8 Q16 2 21 0 L25 7Z" fill="${color}"/><circle cx="21" cy="0" r="1.8" fill="${HAT_COLORS.chef}"/>`
                    : `<path d="M15 7 Q16 0 24 1 L27 7Z" fill="${color}"/><circle cx="25" cy="1" r="1.5" fill="${HAT_COLORS.chef}"/>`;
    headwear = brim + body;
  }
  const glasses = shades ? `<g fill="${PET_PALETTE.accents.glasses}" stroke="${PET_PALETTE.accents.glassesEdge}" stroke-width=".6"><rect x="12.5" y="13" width="6.5" height="4.2" rx="1.4"/><rect x="21" y="13" width="6.5" height="4.2" rx="1.4"/><path d="M19 14.5h2M12.5 14 10.5 13M27.5 14l2-1"/></g>` : "";
  return headwear + glasses;
}

/** The props around the body: the desk for console and read, the alert badge, confetti, z's and dust. */
function propsSvg(state: PetAct): string {
  if (state === "console")
    return (
      `<rect x="11" y="19" width="18" height="9" rx="2" fill="${hex(PROP.dark)}"/>` +
      `<rect x="13" y="20.5" width="9" height="6" rx="1" fill="${hex(PROP.screen)}" style="animation:glow ${PET_MOTION.glowSeconds}s infinite"/>` +
      `<circle cx="25" cy="22" r="1" fill="${hex(PROP.red)}"/><circle cx="26.5" cy="25" r="1" fill="${hex(PROP.blue)}"/>`
    );
  if (state === "read")
    return (
      `<rect x="10" y="18" width="20" height="10" rx="1.5" fill="${hex(PROP.blue)}"/>` +
      `<rect x="11.5" y="19" width="8" height="8" rx=".8" fill="${hex(PROP.paper)}"/>` +
      `<rect x="20.5" y="19" width="8" height="8" rx=".8" fill="${hex(PROP.page)}"/>` +
      `<path d="M13 21.5h5M13 23.5h5M13 25.5h4M22 21.5h5M22 23.5h5" stroke="${hex(PROP.gray)}" stroke-width=".6"/>`
    );
  if (state === "sleep")
    return (
      `<text x="31" y="6" font-size="${DECK_DESIGN.pet.props.sleepZFontPixels}" fill="${hex(PROP.gray)}" font-family="${DECK_DESIGN.type.svg}" style="animation:zz ${PET_MOTION.sleepZSeconds}s infinite">z</text>` +
      `<text x="34" y="3" font-size="${DECK_DESIGN.pet.props.sleepZSmallFontPixels}" fill="${hex(PROP.gray)}" font-family="${DECK_DESIGN.type.svg}" style="animation:zz ${PET_MOTION.sleepZSeconds}s infinite ${PET_MOTION.sleepZDelaySeconds}s">z</text>`
    );
  if (state === "alert")
    return (
      `<g style="animation:shake ${PET_MOTION.shakeSeconds}s infinite"><circle cx="33.5" cy="1.5" r="4.5" fill="${hex(PROP.amber)}"/>` +
      `<text x="33.5" y="4.3" font-size="${DECK_DESIGN.pet.props.alertMarkFontPixels}" font-weight="${DECK_DESIGN.type.svgWeights.semibold}" text-anchor="middle" fill="${hex(PROP.mark)}" font-family="${DECK_DESIGN.type.svg}">!</text></g>`
    );
  if (state === "celebrate")
    return CONFETTI.map(
      (color, i) =>
        `<rect x="${6 + i * 9}" y="-2" width="2" height="2" rx=".5" fill="${hex(color)}" style="animation:conf ${PET_MOTION.confettiSeconds}s infinite ${i * PET_MOTION.confettiDelaySeconds}s"/>`,
    ).join("");
  if (state === "run")
    return (
      `<circle cx="6" cy="27" r="2" fill="${hex(PROP.dark)}" class="fb" style="animation:puff ${PET_MOTION.puffSeconds}s infinite"/>` +
      `<circle cx="4" cy="25" r="1.5" fill="${hex(PROP.dark)}" class="fb" style="animation:puff ${PET_MOTION.puffSeconds}s infinite ${PET_MOTION.puffDelaySeconds}s"/>`
    );
  return "";
}

const lanes = new Map<string, string>();
const LANES_KEPT = 8;

// the lane: the pet walks from x0 to x1 by CSS, phased by the scene's age so a redraw does not restart it. A scene
// is one picture for as long as it runs, so the lane's text is made once, at the scene's first draw, and handed back
// as it was: the app sees the same source and keeps the animation going, and nothing is built again.
export function petLaneSvg(pet: Pet, now: number, W: number, H: number = DECK_DESIGN.pet.lane.desktopHeight, scale: number = DECK_DESIGN.pet.lane.desktopScale): string {
  const key = [pet.id, pet.act, pet.dir, pet.hat, pet.shades, pet.x0, pet.x1, pet.dur, pet.start, W, H, scale].join("|");
  const kept = lanes.get(key);
  if (kept !== undefined) return kept;
  const lane = buildLaneSvg(pet, now, W, H, scale);
  if (lanes.size >= LANES_KEPT) lanes.delete(lanes.keys().next().value!);
  lanes.set(key, lane);
  return lane;
}

function buildLaneSvg(pet: Pet, now: number, W: number, H: number, scale: number): string {
  const PW = PET_W * scale;
  const PH = PET_H * scale;
  const room = Math.max(0, W - PW);
  const a = pet.x0 * room;
  const b = pet.x1 * room;
  const age = Math.max(0, now - pet.start) / 1000;
  const dur = Math.max(0.001, pet.dur / 1000);
  const move = `@keyframes mv${pet.id}{from{transform:translateX(${a.toFixed(1)}px)}to{transform:translateX(${b.toFixed(1)}px)}}`;
  const flip = pet.dir < 0 ? `translate(${PW} 0) scale(-1 1)` : "";
  let dots = "";
  const backgroundDots = DECK_DESIGN.pet.lane.backgroundDots;
  if (scale >= backgroundDots.minimumScale) for (let x = backgroundDots.startX; x < W; x += DECK_DESIGN.pet.lane.backgroundSpacing) dots += `<rect x="${x}" y="${H - backgroundDots.yInsetPixels}" width="${backgroundDots.widthPixels}" height="${backgroundDots.heightPixels}" fill="${PET_PALETTE.laneLight}" opacity="${backgroundDots.opacity}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<style>${PET_CSS}${move}.mv{animation:mv${pet.id} ${dur.toFixed(2)}s linear both;animation-delay:-${Math.min(age, dur).toFixed(2)}s}</style>` +
    dots +
    `<g class="mv"><g transform="translate(0 ${H - PH - DECK_DESIGN.pet.lane.bodyGap})"><g transform="${flip}"><svg width="${PW}" height="${PH}" viewBox="${PET_VIEW}" overflow="visible">${petSvgBody(pet.act, pet.hat, pet.shades)}</svg></g></g></g>` +
    "</svg>"
  );
}
