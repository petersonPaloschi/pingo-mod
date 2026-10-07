import type { Answer } from "./types.ts";
import type { ChoiceRead, Chosen } from "./contracts.ts";

/** Read a choice once, retaining a valid low-confidence answer and why it was held. */
export function readChoice<T extends string>(answer: Answer | undefined, allowed: readonly T[], min: number): ChoiceRead<T> {
  if (answer?.type !== "choice" || !allowed.includes(answer.choice as T)
    || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
    return { reason: "unavailable" };
  }
  const choice: Chosen<T> = { value: answer.choice as T, confidence: answer.confidence };
  return answer.confidence < min
    ? { held: { ...choice, needed: min }, reason: "low_confidence" }
    : { chosen: choice };
}
