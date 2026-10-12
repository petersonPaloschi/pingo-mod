import { MOODS } from "../../mascots/pingo.ts";
import { textCells, type PixelCell } from "../../mascots/pixel.ts";
import { DECK_DESIGN, TERMINAL_DEFAULT } from "../../theme.ts";
import { PET_BRAILLE, PET_HOP_MS, PET_HOP_STEP_MS, petMoodFor, petX, type Pet, type PetAct } from "./model.ts";

// ---------- terminal: Pingo in ASCII, twelve columns by four rows ----------

/** The eye each of the moods' eyes draws; the open ones ("o") also blink. */
const EYE_OF = { happy: "^", x: "x", closed: "-", spinner: "o", pill: "o", line: "o" } as const;

/** The top row: the crown of the body, with a "z" or a "Z" rising from it while Pingo sleeps. */
const CROWN = "  .------.  ";
const SLEEP_CROWNS = ["  .------.z ", "  .------. Z"] as const;
/** The rows under it: the body, the mouth (a smile, or straight while asleep and failing) and its base. */
const BASE = " `--------' ";
const SMILE = "|   \\__/   |";
const STRAIGHT = "|    __    |";
const SHADES = " /[=]-[=] \\ ";
/** How long each z of the sleeper shows, and how long a look of the thinker holds, in ms. */
const SLEEP_STEP_MS = 700;
const LOOK_STEP_MS = 900;
/** Where the thinker looks, left (-1), ahead (0) or right (1), in turn. */
const LOOKS = [-1, 0, 1, 0] as const;

/** The hat on the crown, by name: each hat's top row, twelve columns, replacing the crown (and a sleeper's z). No hat moves. */
const HAT_TOPS: Readonly<Record<string, string>> = {
  tophat: "  _|####|_  ",
  party: "  .--/\\--.  ",
  crown: "  _/\\/\\/\\_  ",
  wizard: "  .-/**\\-.  ",
  cowboy: "~-.(____).-~",
  propeller: "  .-=||=-.  ",
  chef: "  .(####).  ",
  viking: " \\.------./ ",
  halo: "  .~~~~~~.  ",
  santa: "  .--==--.o ",
  nightcap: "  .-=-=-=.~ ",
};

/** Whether `hat` is one Pingo can wear. */
const wears = (hat: string) => Object.hasOwn(HAT_TOPS, hat);

/** Whether the open eyes are shut at `t` seconds: a quick blink every few seconds. */
const blinking = (t: number) => (t * 0.9) % 4.2 < 0.14;

/**
 * Whether Pingo is up, one row above its rest, at `tMs` into its scene: jumping and celebrating start with the same hop
 * as a member's goodbye, up and back every quarter second for the first second. The lane draws a body that is up over
 * its name row.
 */
export function petRaised(act: PetAct, tMs: number): boolean {
  return (act === "jump" || act === "celebrate") && tMs >= 0 && tMs < PET_HOP_MS && Math.floor(tMs / PET_HOP_STEP_MS) % 2 === 0;
}

// The scene's props (laptop, book, confetti, dust, alert badge) have no drawing in this look: the state is in the eyes
// and the z.

const PET_FRAME_CACHE_LIMIT = 24;
const petFrames = new Map<string, PixelCell[][]>();

/** Where Pingo looks in `act`: the way it walks, or around while it thinks, else ahead. */
function lookOf(act: PetAct, tMs: number, dir: 1 | -1): number {
  if (act === "walk" || act === "run") return dir;
  if (petMoodFor(act) === "thinking") return LOOKS[Math.floor(tMs / LOOK_STEP_MS) % LOOKS.length]!;
  return 0;
}

/**
 * The pet as cells for `act` at `tMs`, facing `dir` (which only decides where a walker looks: the drawing has no
 * left or right). Time is quantized to a tenth of a second, so two redraws inside the same tenth produce the same
 * cells. The eyes follow the mood (happy ^, failing x, asleep -, else open and blinking), the sunglasses cover them,
 * and a hat takes the top row. The scene has no props in the terminal: the eyes and the z tell what Pingo is doing.
 */
export function petFrame(act: PetAct, tMs: number, dir: 1 | -1, hat = "none", shades = false): PixelCell[][] {
  const tick = Math.floor(tMs / 100);
  const key = `${act}|${tick}|${dir}|${hat}|${shades ? 1 : 0}`;
  const kept = petFrames.get(key);
  if (kept !== undefined) return kept;
  const at = tick * 100;
  const mood = petMoodFor(act);
  const eye = EYE_OF[MOODS[mood].eyes] === "o" && blinking(at / 1000) ? "-" : EYE_OF[MOODS[mood].eyes];
  const look = lookOf(act, at, dir);
  const top = wears(hat) ? HAT_TOPS[hat]! : act === "sleep" ? SLEEP_CROWNS[Math.floor(at / SLEEP_STEP_MS) % 2]! : CROWN;
  const eyes = shades ? SHADES : look < 0 ? ` / ${eye}  ${eye}   \\ ` : look > 0 ? ` /   ${eye}  ${eye} \\ ` : ` /  ${eye}  ${eye}  \\ `;
  const mouth = mood === "failing" || act === "sleep" ? STRAIGHT : SMILE;
  const result = textCells([top, eyes, mouth, BASE]);
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
