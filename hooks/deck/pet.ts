// The Deck pet: pingo's mascot walking the Deck lane, with the Deck's scene around it (the desk, the alert
// badge, confetti, z's and dust). The scene logic is pure and the same on every surface. The desktop lane is
// SVG and moves by CSS only; the terminal gets braille frames that are a pure function of (act, time, facing),
// laid out along a lane as wide as the band, so the host can repaint them in place without drawing anything else.
import { brailleBit, brailleChar, DEPTH, hex } from "../dots.ts";
import type { BrailleCell } from "../dots.ts";
import { bayer, MOODS, pingoSvg, type Mood } from "../mascots/pingo.ts";
import { DECK_DESIGN, PET_PALETTE } from "../theme.ts";

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
  /** Pingo speaks for Claude's own turn: its name is drawn in a balloon, as a speaking member's is. */
  speaks?: boolean;
}

const SPEED = DECK_DESIGN.pet.speed; // lane fractions per second

/** The pet's box in pet units, as the lane draws it: 48 wide and 38 tall, from (-4, -6). */
const PET_W = DECK_DESIGN.pet.body.width;
const PET_H = DECK_DESIGN.pet.body.height;
const PET_VIEW = DECK_DESIGN.pet.body.viewBox;
/** The pet's cells in a terminal: 12 columns by 4 rows, so a 24 by 16 dot grid. */
export const PET_BRAILLE = DECK_DESIGN.pet.braille;
/** The terminal's dot grid, and its scale: dots per pet unit across (the 48 units span 24 dots). */
export const PET_RASTER = {
  scale: (PET_BRAILLE.columns * 2) / PET_W,
  width: PET_BRAILLE.columns * 2,
  height: PET_BRAILLE.rows * 4,
};

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

// ---------- terminal: pingo's braille sphere, with the scene painted into the same dot grid ----------

/** The dot row under the body at rest, where the shadow lies: the last row of the grid. */
const FLOOR = PET_RASTER.height - 1;

/** A braille grid: per cell, the dot bits, the color, and the rank of the dot that set that color. */
interface Grid {
  bits: number[];
  color: number[];
  rank: number[];
}

interface Dot {
  x: number;
  y: number;
  color: number;
}

function blankGrid(): Grid {
  const cells = PET_BRAILLE.columns * PET_BRAILLE.rows;
  return {
    bits: new Array<number>(cells).fill(0),
    color: new Array<number>(cells).fill(DEPTH[0]),
    rank: new Array<number>(cells).fill(-Infinity),
  };
}

const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < PET_RASTER.width && y < PET_RASTER.height;
const cellOf = (x: number, y: number) => (y >> 2) * PET_BRAILLE.columns + (x >> 1);

/** Lights a dot. Its cell takes the dot's color if the rank is at least the cell's own; later dots win ties. */
function light(grid: Grid, x: number, y: number, color: number, rank: number) {
  if (!inGrid(x, y)) return;
  const cell = cellOf(x, y);
  grid.bits[cell]! |= brailleBit(x, y);
  if (rank >= grid.rank[cell]!) {
    grid.rank[cell] = rank;
    grid.color[cell] = color;
  }
}

/** Cuts a dot out of the grid, so the badge's background shows through it. */
function unlight(grid: Grid, x: number, y: number) {
  if (inGrid(x, y)) grid.bits[cellOf(x, y)]! &= ~brailleBit(x, y);
}

/** A solid rectangle of dots, [x0, x1) by [y0, y1). Props rank above everything; the floor below the body. */
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, color: number, rank = Infinity) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) light(grid, x, y, color, rank);
}

/** A prop's dot: it takes its cell over the body and the floor. */
const paint = (grid: Grid, x: number, y: number, color: number) => light(grid, x, y, color, Infinity);

/** A disc of dots around (cx, cy), taking in each dot whose center lies within r. */
function disc(grid: Grid, cx: number, cy: number, r: number, color: number) {
  for (let y = Math.floor(cy - r); y <= Math.floor(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++)
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) paint(grid, x, y, color);
}

function toCells(grid: Grid): BrailleCell[][] {
  return Array.from({ length: PET_BRAILLE.rows }, (_, r) =>
    Array.from({ length: PET_BRAILLE.columns }, (_, c): BrailleCell => {
      const cell = r * PET_BRAILLE.columns + c;
      return [brailleChar(grid.bits[cell]!), grid.color[cell]!];
    }),
  );
}

/** Where a repeating motion stands, from 0 up to 1, `offset` seconds into its period. */
const cycle = (t: number, period: number, offset = 0) => ((t + offset) % period) / period;

/**
 * How far the body sits from its rest, in dots (negative is up). The sphere fills the four-row box, so the
 * room above it is one dot: walking and running bob it, jumping hops it, and console and read sink it onto the desk.
 */
function liftOf(act: PetAct, t: number): number {
  const wave = (period: number) => Math.abs(Math.sin((t / period) * Math.PI * 2));
  if (act === "walk") return -Math.round(wave(0.6));
  if (act === "run") return -Math.round(wave(0.28));
  if (act === "jump" || act === "celebrate") {
    const p = cycle(t, 1);
    return p < 0.12 || p >= 0.8 ? 0 : -Math.round(Math.sin(((p - 0.12) / 0.68) * Math.PI));
  }
  return act === "console" || act === "read" ? 1 : 0;
}

/** The desk: a dark laptop whose screen lights on a 0.4 s glow. */
function laptop(grid: Grid, t: number) {
  fill(grid, 4, 10, 20, 16, PROP.dark);
  fill(grid, 6, 11, 14, 14, cycle(t, 0.4) < 0.5 ? PROP.screen : PROP.dark);
  paint(grid, 16, 12, PROP.red);
  paint(grid, 17, 14, PROP.blue);
}

/** The desk: an open book, a blue cover with two pages. */
function book(grid: Grid) {
  fill(grid, 3, 10, 21, 16, PROP.blue);
  fill(grid, 4, 11, 11, 15, PROP.paper);
  fill(grid, 12, 11, 20, 15, PROP.page);
}

/** A "z" n dots square: a bar along the top, a diagonal, a bar along the foot. */
function zGlyph(grid: Grid, x: number, y: number, n: number, color: number) {
  for (let k = 0; k < n; k++) {
    paint(grid, x + k, y, color);
    paint(grid, x + k, y + n - 1, color);
    paint(grid, x + n - 1 - k, y + k, color);
  }
}

/** Two z's drifting up from the sleeper and fading, each on its own 2 s cycle; shown while half opaque. */
function zs(grid: Grid, t: number) {
  for (const [offset, n, x0, y0] of [
    [0, 4, 17, 5],
    [0.9, 3, 19, 7],
  ] as const) {
    const q = cycle(t, 2, offset);
    const alpha = q < 0.2 ? q * 5 : 1 - q;
    if (alpha >= 0.5) zGlyph(grid, x0 + Math.round(2 * q), Math.round(y0 - 8 * q), n, PROP.gray);
  }
}

/** The alert badge: an amber disc with a "!" cut out of it, jittering as the desktop badge shakes. */
function badge(grid: Grid, t: number) {
  const shake = Math.sin(t * 40) > 0 ? 1 : 0;
  disc(grid, 20 + shake, 2.5, 2.1, PROP.amber);
  for (const y of [0, 1, 2, 4]) for (const x of [19, 20]) unlight(grid, x + shake, y);
}

/** Confetti: four 2x2 bits falling past the sphere, each on its own 1 s cycle, gone by the end. */
function confetti(grid: Grid, t: number) {
  CONFETTI.forEach((color, i) => {
    const q = cycle(t, 1, i * 0.22);
    const x = 2 + i * 5;
    const y = Math.floor(-1 + q * 9);
    if (q < 0.85) fill(grid, x, y, x + 2, y + 2, color);
  });
}

/** Dust kicked up behind a runner: two gray discs that swell and fade on a 0.5 s cycle. */
function dust(grid: Grid, t: number) {
  for (const [offset, x, y] of [
    [0, 3, 11],
    [0.25, 1.5, 9],
  ] as const) {
    const q = cycle(t, 0.5, offset);
    if (q < 0.8) disc(grid, x - 2 * q, y, 0.8 + q, PROP.dark);
  }
}

/** The scene's props for an act, painted over the body in the order the desktop layers them. */
function props(grid: Grid, act: PetAct, t: number) {
  if (act === "console") laptop(grid, t);
  if (act === "read") book(grid);
  if (act === "sleep") zs(grid, t);
  if (act === "alert") badge(grid, t);
  if (act === "celebrate") confetti(grid, t);
  if (act === "run") dust(grid, t);
}

// ---------- the sphere itself, drawn for this grid ----------
// Pingo's own scene (hundreds of projected points) turns to static at 24x16 dots: the pattern changes with every
// frame and the eyes, a fraction of a dot across, are lost. The pet's sphere is drawn for the grid instead, the same
// sphere of dots: halftone shading under a fixed light, an edge of dots to hold the outline, and eyes a few dots
// wide. It does not turn, so a still pet is a still picture; only breath, blink and bob move it.

/** The sphere on the grid: its centre across, the row its foot rests on, and its radius, in dots. One dot is left above it for the bob. */
const SPHERE = { cx: PET_RASTER.width / 2, foot: 14.7, r: 6.7 };

type Pixels = readonly (readonly [number, number])[];
/** The eight dots around a three by three eye, in order; a spinner lights four in a row. */
const RING: Pixels = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];

/** An eye's dots, from its top left corner. Three dots across and down; the pill is two across. */
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
      return [0, 1, 2, 3].map((i) => RING[(start + i) % 8]!);
    }
  }
}

/** The body and the eyes of the pet for `act` at `t`, lifted by the act's bob. */
function sphere(grid: Grid, act: PetAct, t: number) {
  const mood = petMoodFor(act);
  const lift = liftOf(act, t);
  // sleepers are a shade dimmer; an alert pet shakes a dot to the side
  const dim = mood === "baseline" ? 1 : 0;
  const shake = mood === "failing" && Math.floor(t * 10) % 2 === 1 ? 1 : 0;
  // a breath: the top of the sphere sinks by up to half a dot and rises again, the foot staying on the floor
  const squash = 0.5 * (0.5 - 0.5 * Math.cos((t / (act === "sleep" ? 3 : 2.4)) * Math.PI * 2));
  const ry = SPHERE.r - squash;
  const cy = SPHERE.foot - ry;
  for (let y = 0; y < PET_RASTER.height; y++) {
    for (let x = 0; x < PET_RASTER.width; x++) {
      const u = (x + 0.5 - SPHERE.cx) / SPHERE.r;
      const v = (y + 0.5 - cy) / ry;
      const d2 = u * u + v * v;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const edge = (1 - Math.sqrt(d2)) * SPHERE.r < 0.95;
      // lit from above and to the left: dense where it faces the light, sparse on the far side
      const lit = Math.max(0, -0.45 * u - 0.55 * v + 0.7 * nz);
      if (!edge && 0.3 + 0.7 * lit <= bayer(x, y)) continue;
      const depth = Math.min(DEPTH.length - 1, Math.max(0, Math.floor(((nz + 1) / 2) * DEPTH.length) - dim));
      light(grid, x + shake, y + lift, DEPTH[depth]!, depth);
    }
  }
  const eyes = MOODS[mood].eyes;
  const look = mood === "passthrough" ? 1 : 0;
  const dots: Dot[] = [];
  for (const side of [-1, 1] as const) {
    const x0 = (eyes === "pill" ? 9 : 8) + (side === 1 ? (eyes === "pill" ? 4 : 5) : 0) + look + shake;
    for (const [dx, dy] of eyePixels(eyes, t, side)) dots.push({ x: x0 + dx, y: 5 + dy + lift, color: MOODS[mood].color });
  }
  // a cell holds one color: the body dots in the cells an eye lands in go, so the eye keeps its shape and its own color
  for (const dot of dots) {
    if (!inGrid(dot.x, dot.y)) continue;
    const cell = cellOf(dot.x, dot.y);
    grid.bits[cell] = 0;
    grid.rank[cell] = -Infinity;
  }
  for (const dot of dots) paint(grid, dot.x, dot.y, dot.color);
}

// Braille dots pair up across a cell's two columns; mirroring a cell swaps each pair.
const DOT_PAIRS = [0, 1, 2, 3].map((y): [number, number] => [brailleBit(0, y), brailleBit(1, y)]);

function mirrorChar(char: string): string {
  const bits = char === " " ? 0 : char.codePointAt(0)! - 0x2800;
  let out = 0;
  for (const [left, right] of DOT_PAIRS) {
    if (bits & left) out |= right;
    if (bits & right) out |= left;
  }
  return brailleChar(out);
}

/**
 * The pet as a braille grid for `act` at `tMs`, facing `dir`. Time is quantized to a tenth of a second,
 * so two redraws inside the same tenth produce the same cells.
 */
function terminalAccessories(grid: Grid, hat: string, shades: boolean) {
  const color = hat === "tophat" ? 0x858c99 : HAT_COLORS[hat] ? Number.parseInt(HAT_COLORS[hat]!.slice(1), 16) : 0;
  if (color) {
    if (hat === "tophat") {
      fill(grid, 9, 0, 15, 3, color); fill(grid, 6, 3, 18, 4, color);
    } else if (hat === "party" || hat === "wizard") {
      fill(grid, 7, 3, 18, 4, color); fill(grid, 9, 2, 16, 3, color);
      fill(grid, 10, 1, 15, 2, color); fill(grid, 11, 0, 14, 1, color); paint(grid, 12, 0, hat === "party" ? 0xffd23f : color);
      if (hat === "wizard") paint(grid, 13, 1, 0xffd23f);
    } else if (hat === "crown") {
      fill(grid, 7, 3, 18, 4, color); fill(grid, 8, 1, 17, 3, color);
      paint(grid, 8, 0, color); paint(grid, 12, 0, color); paint(grid, 16, 0, color);
      paint(grid, 9, 2, 0xe03c3c); paint(grid, 12, 1, 0xe03c3c); paint(grid, 15, 2, 0xe03c3c);
    } else if (hat === "cowboy") {
      fill(grid, 5, 3, 19, 4, color); fill(grid, 8, 2, 16, 3, color); fill(grid, 9, 1, 15, 2, color); fill(grid, 10, 0, 14, 1, color);
      fill(grid, 9, 2, 15, 3, 0xc48743);
    } else if (hat === "propeller") {
      fill(grid, 8, 3, 16, 4, color); fill(grid, 9, 1, 15, 3, color); fill(grid, 10, 0, 14, 1, color);
      fill(grid, 6, 0, 19, 1, 0xe03c3c); paint(grid, 12, 0, 0xffd23f);
    } else if (hat === "chef") {
      fill(grid, 8, 3, 16, 4, 0xcfcfcf); fill(grid, 9, 2, 15, 3, color);
      fill(grid, 10, 1, 12, 2, color); fill(grid, 13, 0, 15, 2, color);
    } else if (hat === "viking") {
      fill(grid, 8, 3, 16, 4, color); fill(grid, 9, 1, 15, 3, color);
      paint(grid, 7, 0, 0xf4f4f4); fill(grid, 6, 1, 8, 3, 0xf4f4f4);
      paint(grid, 16, 0, 0xf4f4f4); fill(grid, 16, 1, 18, 3, 0xf4f4f4);
    } else if (hat === "halo") {
      fill(grid, 10, 0, 14, 1, color); fill(grid, 8, 1, 10, 2, color); fill(grid, 14, 1, 16, 2, color);
      paint(grid, 7, 2, color); paint(grid, 16, 2, color); fill(grid, 8, 3, 16, 4, color);
    } else if (hat === "santa") {
      fill(grid, 8, 3, 18, 4, 0xf4f4f4); fill(grid, 10, 2, 16, 3, color); fill(grid, 11, 1, 17, 2, color);
      fill(grid, 14, 0, 19, 1, color); paint(grid, 19, 0, 0xf4f4f4);
    } else {
      fill(grid, 8, 3, 17, 4, color); fill(grid, 10, 2, 16, 3, color); fill(grid, 13, 1, 18, 2, color);
      fill(grid, 16, 0, 20, 1, color); paint(grid, 20, 0, 0xf4f4f4);
    }
  }
  if (shades) {
    fill(grid, 6, 5, 11, 7, 0x17171d);
    fill(grid, 13, 5, 18, 7, 0x17171d);
    fill(grid, 10, 5, 14, 6, 0xffe66d);
    paint(grid, 8, 5, 0xffffff);
    paint(grid, 15, 5, 0xffffff);
  }
}

const PET_FRAME_CACHE_LIMIT = 24;
const petFrames = new Map<string, BrailleCell[][]>();

export function petFrame(act: PetAct, tMs: number, dir: 1 | -1, hat = "none", shades = false): BrailleCell[][] {
  const tick = Math.floor(tMs / 100);
  const key = `${act}|${tick}|${dir}|${hat}|${shades ? 1 : 0}`;
  const kept = petFrames.get(key);
  if (kept !== undefined) return kept;
  const t = tick / 10;
  const grid = blankGrid();
  const half = act === "jump" ? 5 : 7;
  fill(grid, 12 - half, FLOOR, 12 + half, FLOOR + 1, PROP.dark, -1);
  sphere(grid, act, t);
  props(grid, act, t);
  terminalAccessories(grid, hat, shades);
  const frame = toCells(grid);
  const result = dir > 0 ? frame : frame.map((row) => row.map(([char, color]): BrailleCell => [mirrorChar(char), color]).reverse());
  if (petFrames.size >= PET_FRAME_CACHE_LIMIT) petFrames.delete(petFrames.keys().next().value!);
  petFrames.set(key, result);
  return result;
}

// ---------- the terminal lane: the sprite laid along a row as wide as the band ----------

/** How many cells wide the lane is for a band `cols` wide: the body less a margin, and never narrower than the sprite. */
export const petLaneColumns = (cols: number): number => Math.max(PET_BRAILLE.columns, Math.min(DECK_DESIGN.pet.lane.maximumColumns, cols - DECK_DESIGN.pet.lane.sidePadding));

const BLANK: BrailleCell = [" ", DEPTH[0]];

/**
 * The whole lane at `now`, `columns` cells wide: the sprite for the pet's scene, where the pet has walked to.
 * The Raster that shows it keeps one size, so the walk is a change of cells, which the host repaints in place.
 */
export function petLaneCells(pet: Pet, now: number, columns: number): BrailleCell[][] {
  const sprite = petFrame(pet.act, Math.max(0, now - pet.start), pet.dir, pet.hat, pet.shades);
  const room = Math.max(0, columns - PET_BRAILLE.columns);
  const left = Math.round(petX(pet, now) * room);
  const blank = (n: number) => Array.from({ length: n }, () => BLANK);
  return sprite.map((row) => [...blank(left), ...row, ...blank(room - left)]);
}
