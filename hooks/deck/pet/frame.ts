import { MOODS, type Mood } from "../../mascots/pingo.ts";
import { DETAIL, mirror, pixelGrid, put, renderPixels, stamp, type PixelCell, type PixelGrid } from "../../mascots/pixel.ts";
import { DECK_DESIGN, HUE, PET_PALETTE, TERMINAL_DEFAULT } from "../../theme.ts";
import { CONFETTI, PET_BRAILLE, PROP, petMoodFor, petX, type Pet, type PetAct } from "./model.ts";

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
