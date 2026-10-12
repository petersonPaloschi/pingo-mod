import { AGENT_MASCOTS } from "../../mascots/agents.ts";
import { textCells, type PixelCell } from "../../mascots/pixel.ts";
import { FEATURE_MASCOT_PALETTE, HUE } from "../../theme.ts";
import { CAST_HOP_MS, CAST_HOP_STEP_MS, MEMBER_BRAILLE, SPEAKER_IDS, isSpeaker, type CastKind, type CastMember, type CastState, type SpeakerId } from "./model.ts";

/** The desktop's box for a member: 16 units across, the middle at 8. */
export const DOTS_W = MEMBER_BRAILLE.columns * 2;
export const MID = DOTS_W / 2;
/** Something in each feature's own color, by feature: `make` for every one of them. */
export const perSpeaker = <T>(make: (id: SpeakerId, i: number) => T) => Object.fromEntries(SPEAKER_IDS.map((id, i) => [id, make(id, i)])) as Record<SpeakerId, T>;

/** Where the eyes sit on the desktop's 16-unit box: the row of their top, and the units between each and the middle. */
export const SVG_EYES: Record<CastKind, { y: number; apart: number }> = {
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

// ---------- one member, in a terminal: eight columns by four rows of text ----------

// Each member after what it does: the features by their trade, Jev a sphere, the subagents after their names (Tetra a
// triangle, Gem a cut gem, Can a can, Coil a spring, Top a spinning top). An "o" marks an eye; the state picks its look.
const DRAWINGS: Record<CastKind, readonly string[]> = {
  jev: ["  .--.  ", " /o  o\\ ", " \\ -- / ", "  `--'  "],
  farol: [" - /\\ - ", "  |o o| ", "  |===| ", " /_____\\"],
  semente: ["   \\|/  ", "  .-'-. ", " ( o o )", "  `---' "],
  clareza: ["  .--.  ", " (o  o) ", "  \\  /  ", "  [__]  "],
  vigia: [" /\\  /\\ ", " (o)(o) ", " ( \\/ ) ", "  `--'  "],
  sentinela: [" |====| ", " |o  o| ", "  \\  /  ", "   \\/   "],
  prisma: ["   /\\  =", "  /  \\= ", " /o  o\\ ", "/______\\"],
  lapida: ["  ____ *", " /o  o\\ ", "<______>", " \\/\\/\\/ "],
  contexto: [" ____   ", "|o  o\\_ ", "| ---- |", "|______|"],
  codeQuality: ["  [==]  ", " |o  o| ", " | == | ", " |____| "],
  comandante: ["   /\\   ", "__/  \\__", "\\ o  o /", "/_/  \\_\\"],
  portao: ["========", " |o  o| ", " ||  || ", " ||  || "],
  ensaio: [".-/-/-/.", "|o    o|", "|  --  |", "`------'"],
  chaveiro: ["  .--.  ", "  |  |  ", " |o  o| ", " |_()_| "],
  oficina: [" ._||_. ", "-|o  o|-", "-|____|-", "  '||'  "],
  tetra: ["   /\\   ", "  /  \\  ", " /o  o\\ ", "/______\\"],
  gem: [" .----. ", "/_o__o_\\", "  \\  /  ", "   \\/   "],
  can: [" .----. ", " |o  o| ", " |    | ", " `----' "],
  coil: [" (o  o) ", "  \\/\\/  ", "  /\\/\\  ", "  \\/\\/  "],
  cone: ["   ||   ", "(o    o)", " `.  .' ", "   \\/   "],
};

/** Whether the eyes are shut at `t` seconds: a quick blink every few seconds. */
const blinking = (t: number) => (t * 0.9) % 4.2 < 0.14;

/** The eye a state draws: happy (^) to join the lane's goodbye and cross (x) for a task that failed, else open or blinking. */
function eyeOf(state: CastState, t: number): string {
  if (state === "done") return "^";
  if (state === "failed") return "x";
  return blinking(t) ? "-" : "o";
}

/**
 * Whether a member that is saying goodbye is up, one row above its rest, at `now`: for the first `CAST_HOP_MS` of its
 * leave it alternates every `CAST_HOP_STEP_MS` between up (where its name is hidden) and its place. Nobody else hops.
 */
export function hopRaised(member: Pick<CastMember, "state" | "since">, now: number): boolean {
  if (member.state !== "done" && member.state !== "failed") return false;
  const age = Math.max(0, now - member.since);
  return age < CAST_HOP_MS && Math.floor(age / CAST_HOP_STEP_MS) % 2 === 0;
}

const memberFrames = new Map<string, PixelCell[][]>();
const MEMBER_FRAMES_KEPT = 64;

/**
 * A member as cells at `now`: its drawing with the eye its state asks for, open and blinking at its own moment, "^" to
 * leave well, "x" to leave having failed. The drawing does not turn to face anyone, so `dir` and `walking` are only kept
 * for the callers. Time is quantized to a tenth of a second, so two redraws inside the same tenth give the same cells.
 */
export function memberFrame(member: Pick<CastMember, "kind" | "state" | "since">, now: number, _dir: 1 | -1, _walking: boolean): PixelCell[][] {
  const tick = Math.floor(now / 100);
  const eye = eyeOf(member.state, tick / 10 + BLINK_PHASE[member.kind]);
  const key = `${member.kind}|${eye}`;
  const kept = memberFrames.get(key);
  if (kept !== undefined) return kept;
  const frame = textCells(DRAWINGS[member.kind].map((row) => row.replace(/o/g, eye)));
  if (memberFrames.size >= MEMBER_FRAMES_KEPT) memberFrames.delete(memberFrames.keys().next().value!);
  memberFrames.set(key, frame);
  return frame;
}
