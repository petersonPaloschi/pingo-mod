import type { Mood } from "../../mascots/pingo.ts";
import { DECK_DESIGN, PET_PALETTE } from "../../theme.ts";

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

/** The pet's terminal cells: the old braille name stays for its importers. */
export const PET_BRAILLE = DECK_DESIGN.pet.sprite;

const SPEED = DECK_DESIGN.pet.speed; // lane fractions per second

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
export const PROP = PET_PALETTE.props;
export const CONFETTI = PET_PALETTE.confetti;
export const PET_MOTION = DECK_DESIGN.pet.motion;
