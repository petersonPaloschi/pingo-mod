// The Deck pet: pingo's mascot walking the Deck lane, with the Deck's scene around it (the desk, the alert
// badge, confetti, z's and dust). The scene logic is pure and the same on every surface. The desktop lane is
// SVG and moves by CSS only; the terminal gets pixel-art frames (half blocks, two pixels to a cell) that are a pure
// function of (act, time, facing), laid out along a lane as wide as the band, so the host can repaint them in place
// without drawing anything else.
import { hex } from "../dots.ts";
import { MOODS, pingoSvg, type Mood } from "../mascots/pingo.ts";
import { DETAIL, mirror, pixelGrid, put, renderPixels, stamp, type PixelCell, type PixelGrid } from "../mascots/pixel.ts";
import { DECK_DESIGN, HUE, PET_PALETTE, TERMINAL_DEFAULT } from "../theme.ts";

export const PET_ACTS = ["idle", "walk", "run", "jump", "console", "read", "sleep", "celebrate", "alert"] as const;
export type PetAct = (typeof PET_ACTS)[number];

/** The Deck's moods: what the rest of the Deck knows about the session. */
export type DeckMood = "alert" | "celebrate" | "working" | "sleepy" | "calm";

export interface Pet {
  act: PetAct;
  dir: 1 | -1;
  x0: number;
  x1: number;
  start: number;
  dur: number;
  mood: DeckMood;
  id: number;
  hat?: string;
  shades?: boolean;
  /** Pingo speaks for the session (Claude's turn runs, or its goal is known): its name is drawn in a balloon, as a speaking member's is. */
  speaks?: boolean;
  /** The session's goal, summed up from the person's requests, after Pingo's name in the balloon where the lane has room. */
  says?: string;
}

const SPEED = DECK_DESIGN.pet.speed; // lane fractions per second

/** The pet's box in pet units, as the lane draws it: 48 wide and 38 tall, from (-4, -6). */
const PET_W = DECK_DESIGN.pet.body.width;
const PET_H = DECK_DESIGN.pet.body.height;
const PET_VIEW = DECK_DESIGN.pet.body.viewBox;
/** The pet's cells in a terminal: 12 columns by 4 rows of half blocks, a grid of 12 by 8 pixels. (The name is the old braille one, kept for its importers.) */
export const PET_BRAILLE = DECK_DESIGN.pet.sprite;

// ---------- mood mapping: Deck moods and pet acts onto pingo's moods ----------

/**
 * The pingo mood a Deck mood or a pet act is drawn with. Pingo's Mood sets the eyes and the color:
 * alert uses failing (x eyes, red, a jittering sphere) for attention; celebrate uses routing (happy eyes,
 * green sparks); working and the desk acts (console, read) use thinking (spinner eyes); sleepy and sleep use
 * baseline (closed eyes); calm and idle use idle (line eyes); walk, run and jump use passthrough, whose blinking
 * eyes read as motion.
 */
export function petMoodFor(mood: DeckMood | PetAct): Mood {
  switch (mood) {
    case "alert":
      return "failing";
    case "celebrate":
      return "routing";
    case "working":
    case "console":
    case "read":
      return "thinking";
    case "sleepy":
    case "sleep":
      return "baseline";
    case "calm":
    case "idle":
      return "idle";
    case "walk":
    case "run":
    case "jump":
      return "passthrough";
  }
}

// ---------- behaviour: one scene at a time, the same on every surface ----------

export function createPet(now: number): Pet {
  return { act: "idle", dir: 1, x0: 0.3, x1: 0.3, start: now, dur: 3000, mood: "calm", id: 1 };
}

export function petX(pet: Pet, now: number): number {
  const p = pet.dur > 0 ? Math.min(1, Math.max(0, (now - pet.start) / pet.dur)) : 1;
  return pet.x0 + (pet.x1 - pet.x0) * p;
}

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.floor(r * list.length) % list.length]!;
}

export function stepPet(pet: Pet, mood: DeckMood, now: number, rand: () => number = Math.random): boolean {
  const moodChanged = mood !== pet.mood && (mood === "alert" || mood === "celebrate" || pet.mood === "alert");
  if (!moodChanged && now < pet.start + pet.dur) return false;
  const x = petX(pet, now);
  pet.mood = mood;
  pet.start = now;
  pet.x0 = x;
  pet.x1 = x;
  pet.id++;
  let act: PetAct;
  if (mood === "alert") act = "alert";
  else if (mood === "celebrate") act = "celebrate";
  else if (mood === "working") act = pick(["console", "console", "read", "walk", "idle"] as const, rand());
  // Claude idle a while: Pingo sleeps, always, so the lane reads as idle at a glance
  else if (mood === "sleepy") act = "sleep";
  else act = pick(["idle", "walk", "walk", "run", "jump", "read"] as const, rand());
  pet.act = act;
  if (act === "walk" || act === "run") {
    let target = rand();
    if (Math.abs(target - x) < 0.15) target = x < 0.5 ? Math.min(1, x + 0.4) : Math.max(0, x - 0.4);
    pet.x1 = target;
    pet.dir = target >= x ? 1 : -1;
    pet.dur = (Math.abs(target - x) / SPEED[act]) * 1000;
  } else {
    if (rand() < 0.3) pet.dir = pet.dir === 1 ? -1 : 1;
    pet.dur = act === "sleep" ? 14000 : act === "alert" ? 2500 : act === "celebrate" ? 3200 : act === "jump" ? 2000 : 3000 + rand() * 4000;
  }
  return true;
}

// The props keep their own colors, apart from every mood's, so the eyes alone wear the mood's color.
const PROP = PET_PALETTE.props;
const CONFETTI = PET_PALETTE.confetti;
const PET_MOTION = DECK_DESIGN.pet.motion;

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

// ---------- terminal: Pingo in pixel art, with the scene drawn into the same grid ----------

/** The sprite in pixels: two to a cell across and two rows to a cell down, 12 by 8. */
const PIXELS_W = PET_BRAILLE.columns;
const PIXELS_H = PET_BRAILLE.rows * 2;
/** The row the body's top rests on: the two above it are the room for a hat and for a hop. */
const TOP = 2;
/** The row under the body at rest, where the floor's shadow lies. */
const FLOOR = PIXELS_H - 1;
/** The row the eyes start on: one under the body's top, so a hat's brim never touches them. */
const EYE_ROW = TOP + 1;

/** Pingo's body: the terminal's own color on top ("#"), a shade for the underside ("d"). */
const TERMINAL_BODY = ["...######...", ".##########.", ".##########.", ".##########.", "..dddddddd.."];
const BODY_INK = { "#": PET_PALETTE.body, d: HUE.neutral };

/** A css "#rrggbb" of the palette as the number a pixel takes. */
const rgb = (color: string) => Number.parseInt(color.slice(1), 16);

/** Where a repeating motion stands, from 0 up to 1, `offset` seconds into its period. */
const cycle = (t: number, period: number, offset = 0) => ((t + offset) % period) / period;

/**
 * How far the body sits from its rest, in pixels (negative is up). Resting bobs a pixel now and then, walking and
 * running bob it faster, jumping and celebrating hop it up to the two rows of headroom; the desk acts keep it down.
 */
function liftOf(act: PetAct, t: number): number {
  const wave = (period: number) => Math.abs(Math.sin((t / period) * Math.PI * 2));
  if (act === "idle") return cycle(t, 3.2) < 0.3 ? -1 : 0;
  if (act === "sleep") return cycle(t, 4) < 0.4 ? -1 : 0;
  if (act === "walk") return -Math.round(wave(0.6));
  if (act === "run") return -Math.round(wave(0.28));
  if (act === "jump" || act === "celebrate") {
    const p = cycle(t, 1);
    return p < 0.12 || p >= 0.8 ? 0 : -Math.round(2 * Math.sin(((p - 0.12) / 0.68) * Math.PI));
  }
  return 0;
}

type Pixels = readonly (readonly [number, number])[];
/** The eight pixels around a three by three eye, in order; a spinner lights three in a row. */
const RING: Pixels = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];

/** An eye's pixels, from its top left corner. Three across and down; the pill is two across. */
export function eyePixels(eyes: (typeof MOODS)[Mood]["eyes"], t: number, side: 1 | -1): Pixels {
  switch (eyes) {
    case "line":
      return [[0, 1], [1, 1], [2, 1]];
    case "closed":
      return [[0, 1], [1, 2], [2, 1]];
    case "happy":
      return [[0, 2], [1, 1], [2, 2]];
    case "x":
      return [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]];
    case "pill":
      // the eyes that read as motion blink, now and then, for a moment
      return (t * 0.9) % 4.2 < 0.14 ? [[0, 1], [1, 1]] : [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]];
    case "spinner": {
      const start = (((Math.floor(t * 6) * side) % 8) + 8) % 8;
      return [0, 1, 2].map((i) => RING[(start + i) % 8]!);
    }
  }
}

/** The eyes of the pet for `act` at `t`, in the mood's color and shape, `lift` up and `shake` aside. */
function drawEyes(grid: PixelGrid, act: PetAct, t: number, lift: number, shake: number) {
  const mood = petMoodFor(act);
  const { eyes, color } = MOODS[mood];
  const look = mood === "passthrough" ? 1 : 0;
  for (const side of [-1, 1] as const) {
    const x0 = (side === -1 ? (eyes === "pill" ? 3 : 2) : 7) + look + shake;
    for (const [dx, dy] of eyePixels(eyes, t, side)) put(grid, x0 + dx, EYE_ROW + dy + lift, color | DETAIL);
  }
}

/** Sunglasses over the face, under the eyes, which still show through them in the mood's color. */
function drawShades(grid: PixelGrid, lift: number, shake: number) {
  const lens = rgb(PET_PALETTE.accents.glasses);
  const edge = rgb(PET_PALETTE.accents.glassesEdge);
  stamp(grid, shake, EYE_ROW + lift, [".eLLLLLLLLe.", "..LLL..LLL..", "...L....L..."], { L: lens, e: edge });
}

// the hats keep to the top three rows: the brim is on the body's top row, so a hat never reaches the eyes. "h" is the
// hat's own color and "t" its second tone. The propeller turns between its two rows of blades.
const HAT_MAPS: Readonly<Record<string, readonly string[]>> = {
  tophat: ["....hhhh....", "....tttt....", ".hhhhhhhhhh."],
  party: [".....tt.....", "....hhhh....", "..hhthhthh.."],
  crown: ["..h..hh..h..", "..hhhhhhhh..", "..hthhhhth.."],
  wizard: [".....hh.....", "....htth....", ".hhhhhhhhhh."],
  cowboy: ["....hhhh....", "h..tttttt..h", ".hhhhhhhhhh."],
  propeller: ["..tttttttt..", "....hhhh....", "..hhhhhhhh.."],
  chef: ["...hh..hh...", "..hhhhhhhh..", "..tttttttt.."],
  viking: ["t..........t", ".t.hhhhhh.t.", "..hhhhhhhh.."],
  halo: ["...hhhhhh...", "..t......t..", "............"],
  santa: ["......hhhtt.", "....hhhhh...", "..tttttttt.."],
  nightcap: ["....hhh.....", "...hhhhhhtt.", "..tttttttt.t"],
};
const PROPELLER_SPIN = "...tt..tt...";

/** Whether `hat` is one Pingo can wear. */
const wears = (hat: string) => Object.hasOwn(HAT_MAPS, hat);

function drawHat(grid: PixelGrid, hat: string, t: number, lift: number, shake: number) {
  const rows = [...HAT_MAPS[hat]!];
  if (hat === "propeller" && Math.floor(t * 5) % 2 === 1) rows[0] = PROPELLER_SPIN;
  const hats: Readonly<Record<string, string>> = PET_PALETTE.hats;
  const trims: Readonly<Record<string, string>> = PET_PALETTE.hatTrim;
  stamp(grid, shake, lift, rows, { h: rgb(hats[hat]!), t: rgb(trims[hat]!) });
}

// ---------- the props of the scene ----------

/** The desk: a dark laptop in front of the body, its screen flickering between two glows (a detail: a hole without color). */
function laptop(grid: PixelGrid, t: number) {
  const dark = PROP.dark;
  stamp(grid, 1, 7, ["##########"], { "#": dark });
  put(grid, 2, 6, dark);
  put(grid, 9, 6, dark);
  const tick = Math.floor(t * 5);
  for (let x = 3; x <= 8; x++) put(grid, x, 6, ((x + tick) % 3 === 0 ? PROP.glow : PROP.screen) | DETAIL);
}

/** The desk: an open book, a blue cover under two pages. */
function book(grid: PixelGrid) {
  stamp(grid, 1, 7, ["BBBBBBBBBB"], { B: PROP.blue });
  stamp(grid, 2, 6, ["ppppPPPP"], { p: PROP.paper, P: PROP.page });
}

/** Two z's rising from the sleeper, one after the other, each on its own 2.4 s cycle. */
function zs(grid: PixelGrid, t: number) {
  for (const offset of [0, 1.2]) {
    const q = cycle(t, 2.4, offset);
    if (q < 0.9) put(grid, 10 + Math.round(q), TOP - Math.round(q * 2), HUE.info);
  }
}

/** The alert badge: a small amber diamond with a "!" cut in it, shaking. */
function badge(grid: PixelGrid, t: number) {
  const shake = Math.floor(t * 10) % 2;
  stamp(grid, 8 + shake, 0, [".A.", "AmA", ".A."], { A: PROP.amber, m: PROP.mark | DETAIL });
}

/** Confetti: five pixels falling past the body, each on its own 1.2 s cycle, gone by the end. */
function confetti(grid: PixelGrid, t: number) {
  CONFETTI.forEach((color, i) => {
    const q = cycle(t, 1.2, i * 0.23);
    if (q < 0.85) put(grid, 1 + i * 2.5, Math.floor(q * 9) - 1, color);
  });
}

/** Dust kicked up behind a runner (the left, for a pet facing right): puffs that rise and fade on a 0.4 s cycle. */
function dust(grid: PixelGrid, t: number) {
  const q = cycle(t, 0.4);
  if (q < 0.66) put(grid, 0, FLOOR - 1, PROP.gray);
  if (q >= 0.33) put(grid, 0, FLOOR - 2, PROP.gray);
}

/** The scene's props for an act, drawn over the body. */
function props(grid: PixelGrid, act: PetAct, t: number) {
  if (act === "console") laptop(grid, t);
  if (act === "read") book(grid);
  if (act === "sleep") zs(grid, t);
  if (act === "alert") badge(grid, t);
  if (act === "celebrate") confetti(grid, t);
  if (act === "run") dust(grid, t);
}

const PET_FRAME_CACHE_LIMIT = 24;
const petFrames = new Map<string, PixelCell[][]>();

/**
 * The pet as pixel cells for `act` at `tMs`, facing `dir`. Time is quantized to a tenth of a second, so two redraws
 * inside the same tenth produce the same cells. The floor's shadow, the body, the sunglasses, the eyes, the hat
 * and then the props are drawn in that order; facing left is the whole grid turned round.
 */
export function petFrame(act: PetAct, tMs: number, dir: 1 | -1, hat = "none", shades = false): PixelCell[][] {
  const tick = Math.floor(tMs / 100);
  const key = `${act}|${tick}|${dir}|${hat}|${shades ? 1 : 0}`;
  const kept = petFrames.get(key);
  if (kept !== undefined) return kept;
  const t = tick / 10;
  const grid = pixelGrid(PIXELS_W, PIXELS_H);
  const worn = wears(hat);
  // a hat takes the room above the body, so a hatted pet bobs down instead of up (a crouch, the shade over the
  // floor's shadow), and only a hop may rise: one row, the hat's top row going off the grid
  const rise = liftOf(act, t);
  const lift = !worn ? rise : act === "jump" || act === "celebrate" ? Math.max(-1, rise) : -rise;
  const shake = petMoodFor(act) === "failing" && tick % 2 === 1 ? 1 : 0;
  const half = act === "jump" ? 2 : 3;
  stamp(grid, PIXELS_W / 2 - half, FLOOR, ["#".repeat(half * 2)], { "#": PET_PALETTE.floor });
  stamp(grid, shake, TOP + lift, TERMINAL_BODY, BODY_INK);
  if (shades) drawShades(grid, lift, shake);
  drawEyes(grid, act, t, lift, shake);
  if (worn) drawHat(grid, hat, t, lift, shake);
  props(grid, act, t);
  const result = renderPixels(dir > 0 ? grid : mirror(grid));
  if (petFrames.size >= PET_FRAME_CACHE_LIMIT) petFrames.delete(petFrames.keys().next().value!);
  petFrames.set(key, result);
  return result;
}

// ---------- the terminal lane: the sprite laid along a row as wide as the band ----------

/** How many cells wide the lane is for a band `cols` wide: the body less a margin, and never narrower than the sprite. */
export const petLaneColumns = (cols: number): number => Math.max(PET_BRAILLE.columns, Math.min(DECK_DESIGN.pet.lane.maximumColumns, cols - DECK_DESIGN.pet.lane.sidePadding));

const BLANK: PixelCell = [" ", TERMINAL_DEFAULT];

/**
 * The whole lane at `now`, `columns` cells wide: the sprite for the pet's scene, where the pet has walked to.
 * The Raster that shows it keeps one size, so the walk is a change of cells, which the host repaints in place.
 */
export function petLaneCells(pet: Pet, now: number, columns: number): PixelCell[][] {
  const sprite = petFrame(pet.act, Math.max(0, now - pet.start), pet.dir, pet.hat, pet.shades);
  const room = Math.max(0, columns - PET_BRAILLE.columns);
  const left = Math.round(petX(pet, now) * room);
  const blank = (n: number) => Array.from({ length: n }, () => BLANK);
  return sprite.map((row) => [...blank(left), ...row, ...blank(room - left)]);
}
