import { EFFORT_TEXT_VALUES, MODEL_HANDLE, MODEL_TEXT_VALUES, type ClaudeModelId, type Role } from "../contracts.ts";
import { text, type Locale, type LocaleKey } from "../../i18n.ts";
import type { ChoiceQuestion, Json } from "../types.ts";
import { NATIVE_ADVISORS, type OrchestrationPolicy, type Profile } from "./policy.ts";
import type { Capabilities } from "./profiles.ts";
export const CONTINUITY = ["continue", "revise", "new"] as const;
export const WORK_MODES = ["direct", "managed", "batch_candidate"] as const;
export const GUIDANCE = ["none", "plan", "recover"] as const;
export type Continuity = (typeof CONTINUITY)[number];
export type WorkMode = (typeof WORK_MODES)[number];
export type Guidance = (typeof GUIDANCE)[number];

const prompt = (key: LocaleKey, locale?: Locale) => text("orchestration.prompt.common", locale) + "\n\n" + text(key, locale, { ...MODEL_TEXT_VALUES, ...EFFORT_TEXT_VALUES });

const labelled = <T extends string>(keys: readonly T[]): Record<string, Json> => Object.fromEntries(keys.map((key) => [key, key]));

export const continuityQuestion = (locale?: Locale): ChoiceQuestion => ({
  type: "choice", instructions: prompt("orchestration.prompt.continuity", locale), criteria: labelled(CONTINUITY),
});

export const workModeQuestion = (locale?: Locale): ChoiceQuestion => ({
  type: "choice", instructions: prompt("orchestration.prompt.workMode", locale), criteria: labelled(WORK_MODES),
});

export const guidanceQuestion = (offered: readonly Guidance[], locale?: Locale): ChoiceQuestion => ({
  type: "choice", instructions: prompt("orchestration.prompt.guidance", locale), criteria: labelled(offered),
});

/** One role's profile question; `state.decisions[key]` must carry this decision's input. */
export function roleQuestion(key: string, unit: string, role: Role, profiles: Record<string, Profile>, locale?: Locale): ChoiceQuestion {
  return {
    type: "choice",
    instructions: prompt("orchestration.prompt.roleProfile", locale) + "\n\n" + text("orchestration.prompt.roleSuffix", locale, { key, unit, role }),
    criteria: Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, { model: profile.model, effort: profile.effort }])),
  };
}

/** Worker concurrency: decimal strings from 1 to the safe ceiling. */
export function concurrencyQuestion(ceiling: number, locale?: Locale): ChoiceQuestion {
  const options = Array.from({ length: Math.max(1, ceiling) }, (_, i) => String(i + 1));
  return { type: "choice", instructions: prompt("orchestration.prompt.concurrency", locale), criteria: labelled(options) };
}

/** Native advisor models for a resolved executor: the user's setting filtered by compatibility. */
export function nativeAdvisorOptions(policy: OrchestrationPolicy, executor: ClaudeModelId, caps: Capabilities = {}): ClaudeModelId[] {
  const compatible = NATIVE_ADVISORS[executor].filter((id) => !caps.available || caps.available.includes(id));
  if (policy.nativeAdvisor.mode === "off") return [];
  if (policy.nativeAdvisor.mode === "fixed") return compatible.includes(policy.nativeAdvisor.model) ? [policy.nativeAdvisor.model] : [];
  return compatible;
}

export function nativeAdvisorQuestion(options: readonly ClaudeModelId[], locale?: Locale): ChoiceQuestion {
  return {
    type: "choice",
    instructions: prompt("orchestration.prompt.nativeAdvisor", locale),
    criteria: Object.fromEntries(options.map((id) => [MODEL_HANDLE[id], { model: id }])),
  };
}
