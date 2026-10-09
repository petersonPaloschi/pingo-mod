// One objective's effective plan: at new human input Jev is asked, in one SystemOne request, whether
// the input continues the active objective, which work mode it needs and the executor's profile.
// The snapshot holds until a new or revised objective; dashboard edits wait for it (or for an
// explicit apply-to-current, taken at the next input).
import type { AskJev } from "./request.ts";
import { askTimed } from "./request.ts";
import { readChoice } from "./selection.ts";
import { truncate } from "./state.ts";
import type { Json, Questions } from "./types.ts";
import type { Locale } from "../i18n.ts";
import { ORCHESTRATION_PROMPT_VERSION } from "./prompts.ts";
import {
  CONTINUITY,
  continuityQuestion,
  GUIDANCE,
  guidanceQuestion,
  offeredProfiles,
  readProfile,
  roleQuestion,
  stillOffered,
  WORK_MODES,
  workModeQuestion,
  type Capabilities,
  type Continuity,
  type Guidance,
  type OrchestrationPolicy,
  type Profile,
  type WorkMode,
} from "./orchestration.ts";

export interface Objective {
  id: string;
  startedAt: number;
  /** The policy it runs under, frozen at its start (or at an applied edit). */
  policy: OrchestrationPolicy;
  workMode: WorkMode;
  /** False when the mode is the conservative default rather than Jev's confident choice. */
  workModeConfident: boolean;
  /** The executor profile applied to main-loop requests; absent leaves them native. */
  executor?: Profile;
  /** Why no executor profile applies (`low_confidence`, `jev_error`, a hold reason). */
  executorWhy?: string;
  /** What the last main-loop request was sent with, after the runtime's own checks. */
  applied?: { model?: string; effort?: string };
  /** What the runtime last reported running the main loop with; unknown until a reply says. */
  observed?: { model?: string; effort?: string };
  adviceUsed: number;
  /** Set by the dashboard's apply-to-current; honoured at the next input. */
  applyPending?: boolean;
}

export interface ObjectiveConfig {
  jevModel: string;
  minConfidence: number;
  maxMessageChars: number;
  locale?: Locale;
  promptLocale?: Locale;
}

export interface ObjectiveInput {
  text: string;
  /** Items the Jev classifier cannot inspect (images, documents). */
  attachments: number;
  active?: Objective;
  policy: OrchestrationPolicy;
  caps?: Capabilities;
  now: number;
  newId: () => string;
}

export interface ObjectiveDecision {
  objective?: Objective;
  continuity: Continuity;
  /** Jev's typed guidance answer, already filtered by role settings and the advice allowance. */
  guidance: Guidance;
  latencyMs?: number;
  /** The Jev call failed: the native request stays as it was. */
  failure?: string;
  /** Answers that could not be used and were replaced by a retained or conservative value. */
  held: string[];
}

const EXECUTOR_KEY = "objective_executor";

/** Ask and resolve one human input. Never throws: a failed Jev call fails open. */
export async function decideObjective(input: ObjectiveInput, config: ObjectiveConfig, askJev: AskJev, clock: () => number = () => Date.now()): Promise<ObjectiveDecision> {
  const { active, policy } = input;
  const locale = config.promptLocale ?? config.locale;
  const offer = offeredProfiles(policy, "executor", input.caps);
  const advisorOffer = offeredProfiles(policy, "advisor", input.caps);
  const adviceLeft = policy.advice === "auto" && Object.keys(advisorOffer.profiles).length > 0
    && (active?.adviceUsed ?? 0) < policy.limits.adviceCalls;
  const guidanceOptions = GUIDANCE.filter((option) => option !== "recover" || active);
  const questions: Questions = {
    ...(active ? { continuity: continuityQuestion(locale) } : {}),
    work_mode: workModeQuestion(locale),
    ...(Object.keys(offer.profiles).length > 1 ? { [EXECUTOR_KEY]: roleQuestion(EXECUTOR_KEY, "objective", "executor", offer.profiles, locale) } : {}),
    ...(adviceLeft ? { guidance: guidanceQuestion(guidanceOptions, locale) } : {}),
  };
  const state: { [key: string]: Json } = {
    prompt_version: ORCHESTRATION_PROMPT_VERSION,
    request: truncate(input.text, config.maxMessageChars, config.locale),
    uninspected_attachments: input.attachments,
    active_objective: active ? { work_mode: active.workMode, executor: active.executor ? { ...active.executor } : null } : null,
    decisions: {
      [EXECUTOR_KEY]: { role: "executor", unit: "objective", offered: Object.keys(offer.profiles), source: offer.source },
    },
    limits: { ...policy.limits },
    advice_left: adviceLeft ? policy.limits.adviceCalls - (active?.adviceUsed ?? 0) : 0,
  };
  const asked = await askTimed({ state, questions, model: config.jevModel }, askJev, clock);
  if ("failure" in asked) {
    // Fail open: an active objective keeps going as it was; with none, nothing is applied.
    return { ...(active ? { objective: active } : {}), continuity: active ? "continue" : "new", guidance: "none", failure: asked.failure, held: [] };
  }
  const answers = asked.result.answers;
  const held: string[] = [];
  const latencyMs = asked.latencyMs;
  const guidanceRead = adviceLeft ? readChoice(answers.guidance, guidanceOptions, config.minConfidence) : {};
  const guidance: Guidance = guidanceRead.chosen?.value ?? "none";
  if (adviceLeft && !guidanceRead.chosen) held.push("guidance");

  let continuity: Continuity = "new";
  if (active) {
    const read = readChoice(answers.continuity, CONTINUITY, config.minConfidence);
    // Unsure whether scope changed: keep the active, valid plan.
    continuity = read.chosen?.value ?? "continue";
    if (!read.chosen) held.push("continuity");
  }

  const profile = readProfile(offer, answers[EXECUTOR_KEY], config.minConfidence);
  if (active && continuity === "continue") {
    if (!active.applyPending) return { objective: active, continuity, guidance, latencyMs, held };
    // Apply-to-current: the new policy from this safe boundary on; a still-offered profile stays.
    const executor = stillOffered(offer, active.executor) ? active.executor : "profile" in profile ? profile.profile : undefined;
    const { applyPending: _pending, executorWhy: _why, ...rest } = active;
    return {
      objective: { ...rest, policy, ...(executor ? { executor } : { executor: undefined, executorWhy: whyNone(profile) }) },
      continuity, guidance, latencyMs, held,
    };
  }

  const modeRead = readChoice(answers.work_mode, WORK_MODES, config.minConfidence);
  if (!modeRead.chosen) held.push("work_mode");
  let executor: Profile | undefined = "profile" in profile ? profile.profile : undefined;
  if (!executor) {
    held.push("executor");
    // A revision keeps its valid profile; a new objective without a confident one stays native.
    if (continuity === "revise" && stillOffered(offer, active?.executor)) executor = active!.executor;
  }
  const objective: Objective = {
    id: continuity === "revise" && active ? active.id : input.newId(),
    startedAt: continuity === "revise" && active ? active.startedAt : input.now,
    policy,
    // Unsure: managed, so a change still meets review.
    workMode: modeRead.chosen?.value ?? "managed",
    workModeConfident: Boolean(modeRead.chosen),
    ...(executor ? { executor } : { executorWhy: whyNone(profile) }),
    adviceUsed: continuity === "revise" && active ? active.adviceUsed : 0,
  };
  return { objective, continuity, guidance, latencyMs, held };
}

function whyNone(read: ReturnType<typeof readProfile>): string {
  if ("held" in read) return "low_confidence";
  if ("none" in read) return read.none;
  return "unavailable";
}

/** Keep only a well-formed stored objective. */
export function restoreObjective(value: unknown, normalize: (policy: unknown) => OrchestrationPolicy): Objective | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.startedAt !== "number" || !WORK_MODES.includes(raw.workMode as WorkMode)) return undefined;
  const executor = raw.executor as Profile | undefined;
  const policy = normalize(raw.policy);
  const valid = executor && Object.values(offeredProfiles(policy, "executor").profiles).some((p) => p.model === executor.model && p.effort === executor.effort);
  return {
    id: raw.id,
    startedAt: raw.startedAt,
    policy,
    workMode: raw.workMode as WorkMode,
    workModeConfident: raw.workModeConfident === true,
    ...(valid ? { executor: { model: executor.model, effort: executor.effort } } : typeof raw.executorWhy === "string" ? { executorWhy: raw.executorWhy } : {}),
    ...(raw.applied && typeof raw.applied === "object" ? { applied: raw.applied as Objective["applied"] } : {}),
    ...(raw.observed && typeof raw.observed === "object" ? { observed: raw.observed as Objective["observed"] } : {}),
    adviceUsed: typeof raw.adviceUsed === "number" ? raw.adviceUsed : 0,
    ...(raw.applyPending === true ? { applyPending: true } : {}),
  };
}
