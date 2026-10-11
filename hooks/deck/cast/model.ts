import type { AgentRun } from "../../../types";
import { AGENT_MASCOTS, isMascot, MASCOT_ORDER, type MascotId } from "../../mascots/agents.ts";
import { DECK_DESIGN, FEATURE_MASCOT_PALETTE, TERMINAL_DEFAULT } from "../../theme.ts";
import { PET_BRAILLE } from "../pet.ts";
export type SpeakerId = keyof typeof FEATURE_MASCOT_PALETTE;
export const SPEAKER_IDS = Object.keys(FEATURE_MASCOT_PALETTE) as SpeakerId[];
/** Each feature mascot's name: the feature's own, the same in every language. */
export const SPEAKER_NAMES: Record<SpeakerId, string> = {
  clareza: "Clareza",
  semente: "Semente",
  farol: "Farol",
  vigia: "Vigia",
  sentinela: "Sentinela",
  prisma: "Prisma",
  lapida: "Lapida",
  contexto: "Contexto",
  codeQuality: "Code Quality",
  comandante: "Comandante",
  portao: "Portão",
  ensaio: "Ensaio",
  chaveiro: "Chaveiro",
  oficina: "Oficina",
};
export const isSpeaker = (kind: CastKind): kind is SpeakerId => Object.hasOwn(FEATURE_MASCOT_PALETTE, kind);

export type CastKind = "jev" | MascotId | SpeakerId;
/** What a member is doing: idle (a feature waiting on the person, a subagent running), at work (it thinks), just joined, or ended (well or not) and about to leave. */
export type CastState = "idle" | "asking" | "join" | "done" | "failed";

export interface CastMember {
  /** "jev", "feature:<id>", or the subagent's run id. */
  id: string;
  kind: CastKind;
  /** The name on the row above it: the mascot's, then the subagent's type. */
  label: string;
  state: CastState;
  /** When that state began, in ms: a newcomer hops from here, a leaver from its end. */
  since: number;
  /** On the lane for a task: its name is drawn in a balloon, with `says` after it where there is room. */
  speaking?: boolean;
  /** What it is doing, in its own words: a subagent's description, Jev's call, a feature's task. */
  says?: string;
}

/**
 * A feature on the lane, as the caller found it: since when (or, once it `ended`, since its end), at work or waiting
 * on the person, and what it says. A feature with no task is not given at all.
 */
export interface CastSpeaker {
  id: SpeakerId;
  since: number;
  busy: boolean;
  says?: string;
  /** Its task ended at `since`, well or not: it hops a goodbye and leaves. */
  ended?: "done" | "failed";
}

/** Jev on the lane: whether a call of his is open and what it is about, and when the last one ended. */
export interface JevOnLane {
  open: boolean;
  says?: string;
  ended?: { at: number; failed: boolean };
}

/** A newcomer hops for this long; a member whose task ended stays this long, then leaves. */
export const CAST_JOIN_MS = DECK_DESIGN.cast.joinMs;
export const CAST_LEAVE_MS = DECK_DESIGN.cast.leaveMs;

/** Who leaves, and how: `ended` tells done from failed. */
const leaver = (base: Omit<CastMember, "state" | "since">, at: number, failed: boolean): CastMember => ({ ...base, state: failed ? "failed" : "done", since: at });

/**
 * The cast at `now`: Jev while a call is open, then the features in the order given, then each subagent at work, in
 * the order they started. Each at work speaks; each whose task ended in the last `CAST_LEAVE_MS` is there to say
 * goodbye, quiet. Nobody else is on the lane.
 */
export function castOf(runs: readonly AgentRun[], jev: JevOnLane, now: number, speakers: readonly CastSpeaker[] = []): CastMember[] {
  const cast: CastMember[] = [];
  const said = (says: string | undefined) => (says?.trim() ? { says: says.trim() } : {});
  const jevBase = { id: "jev", kind: "jev" as const, label: "Jev" };
  if (jev.open) cast.push({ ...jevBase, state: "asking", since: 0, speaking: true, ...said(jev.says) });
  else if (jev.ended && now - jev.ended.at < CAST_LEAVE_MS) cast.push(leaver(jevBase, jev.ended.at, jev.ended.failed));
  for (const one of speakers) {
    const base = { id: `feature:${one.id}`, kind: one.id, label: SPEAKER_NAMES[one.id] };
    if (one.ended) {
      if (now - one.since < CAST_LEAVE_MS) cast.push(leaver(base, one.since, one.ended === "failed"));
      continue;
    }
    const state: CastState = one.busy ? "asking" : now - one.since < CAST_JOIN_MS ? "join" : "idle";
    cast.push({ ...base, state, since: one.since, speaking: true, ...said(one.says) });
  }
  for (const run of [...runs].sort((a, b) => a.n - b.n)) {
    const kind = isMascot(run.mascot) ? run.mascot : MASCOT_ORDER[(Math.max(1, run.n) - 1) % MASCOT_ORDER.length]!;
    const base = { id: run.id, kind, label: `${AGENT_MASCOTS[kind].name}·${run.type}` };
    if (run.state === "running") {
      cast.push({ ...base, state: now - run.startedAt < CAST_JOIN_MS ? "join" : "idle", since: run.startedAt, speaking: true, ...said(run.description) });
    } else if (run.endedAt !== undefined && now - run.endedAt < CAST_LEAVE_MS) {
      cast.push(leaver(base, run.endedAt, run.state !== "done"));
    }
  }
  return cast;
}

/**
 * What the desktop's picture of a cast draws: equal keys draw the same members in the same states, the speakers in
 * their balloons. What a member says is the terminal's only (the desktop's balloon holds the name), so it is left out
 * and a changing count in Jev's words asks the desktop for no new picture.
 */
export const castKey = (cast: readonly CastMember[]): string => cast.map((m) => `${m.id}:${m.state}:${m.label}${m.speaking ? ":says" : ""}`).join("|");

// ---------- one member, in a terminal: a grid of 8 by 8 pixels, 8 cells by 4 rows ----------

/** A member's cells in a terminal: 8 columns by 4 rows of half blocks, a grid of 8 by 8 pixels. (The name is the old braille one, kept for its importers.) */
export const MEMBER_BRAILLE = DECK_DESIGN.pet.member;
/** The lane's rows in a terminal: the names, then the bodies. */
export const LANE_ROWS = PET_BRAILLE.rows + 1;

export const PINGO_INK = TERMINAL_DEFAULT;
