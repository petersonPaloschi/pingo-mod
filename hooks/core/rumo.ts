// Rumo: when the person's request says when the work is done ("até os testes passarem", "until the build is green"),
// Jev proposes a goal; once the person sends it, Claude keeps working turn after turn until Jev judges the condition
// met, impossible, or out of turns. It belongs to the orchestrator's objective and has no mascot of its own: Jev
// speaks for it. This module holds the pure parts: the cue that finds a condition, the two questions Jev answers and
// how their answers are read. register.tsx holds every `$` call.
import type { RumoGoal } from "../../types";
import { readChoice } from "./selection.ts";
import type { Answer, Json, Questions } from "./types.ts";
import { vigiaFlat } from "./vigia.ts";

/** What starts every prompt Rumo sends Claude: its own sends are told from the person's by it. */
export const RUMO_MARK = "[Rumo]";
/** The turns a goal may add, as Jev picks them; the middle one when Jev picks none confidently. */
export const RUMO_TURNS = [3, 8, 15] as const;
export const RUMO_DEFAULT_TURNS = 8;
/** How many goals the Rumo card keeps, newest first. */
export const RUMO_HISTORY = 12;

/**
 * The words that say when the work is done, in Portuguese and English: "até (que)", "until", "enquanto não", "so that",
 * "make sure", "garanta que". The clause after the cue, up to the end of its sentence or a comma, is the condition.
 */
const CUE = /(?:^|[\s,;:(])(?:até que|até|until|till|enquanto não|so that|make sure|garanta que|certifique-se de que)\s+([^.!?\n,;]{6,200})/i;

/** The condition a request states, or undefined: then no goal is proposed and Jev is not asked. */
export function goalCondition(request: string): string | undefined {
  const found = CUE.exec(request);
  const condition = found?.[1]?.trim().replace(/[,;:]+$/, "");
  return condition && condition.split(/\s+/).length >= 2 ? condition : undefined;
}

/** The question names in Jev's requests and answers. */
export const RUMO_GOAL = "goal";
export const RUMO_TURNS_KEY = "turns";
export const RUMO_STATUS = "status";
const GOAL_OPTIONS = ["checkable", "vague", "none"] as const;
const TURN_OPTIONS = RUMO_TURNS.map(String);
const STATUS_OPTIONS = ["met", "not_met", "impossible"] as const;
export type RumoStatus = (typeof STATUS_OPTIONS)[number];

/** Jev's request on a new request: whether its condition can be checked, and how many turns the goal may add. */
export function rumoProposeRequest(request: string, condition: string, objective?: string): { state: { [key: string]: Json }; questions: Questions } {
  return {
    state: { request: vigiaFlat(request, 800), condition: vigiaFlat(condition, 300), ...(objective ? { objective } : {}) },
    questions: {
      [RUMO_GOAL]: {
        type: "choice",
        instructions: "The user's request (`request`) ends with a completion condition (`condition`). Decide whether it can serve as a goal the coding agent keeps working toward, turn after turn, until it holds.",
        criteria: {
          checkable: "The condition can be checked from the agent's own work: tests or a build passing, an error gone, a file or behavior in place.",
          vague: "It is a wish, not a check: no one could tell from the work whether it holds.",
          none: "It is not a completion condition at all (a time, a place, a quantity, part of another sentence).",
        },
      },
      [RUMO_TURNS_KEY]: {
        type: "choice",
        instructions: "Decide how many extra turns the goal may take before it stops, from how much work the request implies.",
        criteria: {
          "3": "A small fix: a few more tries at most.",
          "8": "A usual task: some iterations of fixing and checking.",
          "15": "A large change: many files or many failing checks.",
        },
      },
    },
  };
}

/** The proposal Jev's answer allows: the turns, when the condition is checkable with enough confidence. */
export function rumoProposal(answers: Readonly<Record<string, Answer>>, min: number): { turns: number } | undefined {
  const goal = readChoice(answers[RUMO_GOAL], GOAL_OPTIONS, min).chosen;
  if (goal?.value !== "checkable") return undefined;
  const turns = readChoice(answers[RUMO_TURNS_KEY], TURN_OPTIONS, min).chosen;
  return { turns: turns ? Number(turns.value) : RUMO_DEFAULT_TURNS };
}

/** Jev's request at the end of each of Claude's turns: whether the goal holds now, from Claude's last answer. */
export function rumoJudgeRequest(goal: Pick<RumoGoal, "condition" | "request" | "turnsUsed" | "turnsMax">, answer: string): { state: { [key: string]: Json }; questions: Questions } {
  return {
    state: {
      condition: vigiaFlat(goal.condition, 300),
      request: vigiaFlat(goal.request, 600),
      last_answer: vigiaFlat(answer, 1500),
      turns_used: goal.turnsUsed,
      turns_max: goal.turnsMax,
    },
    questions: {
      [RUMO_STATUS]: {
        type: "choice",
        instructions: "The coding agent just ended a turn (`last_answer`). Decide whether the goal's `condition` holds now.",
        criteria: {
          met: "The answer shows the condition holds: the check it names passed, or the result it names is in place.",
          not_met: "Not yet: work remains, or nothing shows the condition holds.",
          impossible: "It cannot hold: the agent is blocked, needs something only the user can give, or the condition contradicts the code.",
        },
      },
    },
  };
}

/** Jev's reading of the goal, or undefined below the least confidence (Rumo then waits for the next turn). */
export function rumoStatus(answers: Readonly<Record<string, Answer>>, min: number): RumoStatus | undefined {
  return readChoice(answers[RUMO_STATUS], STATUS_OPTIONS, min).chosen?.value;
}

/** Whether a goal still waits on the person (proposed) or keeps Claude going (active). */
export const rumoOpen = (goal: RumoGoal | undefined) => goal?.state === "proposed" || goal?.state === "active";
