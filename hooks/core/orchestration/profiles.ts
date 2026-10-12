import { EFFORT, MODEL_HANDLE, type ClaudeModelId, type Effort, type Role } from "../contracts.ts";
import { readChoice } from "../selection.ts";
import type { Answer } from "../types.ts";
import type { EffortSetting, ModelSetting, OrchestrationPolicy, Profile, TaskOverride } from "./policy.ts";
export interface Capabilities {
  /** Catalogue models the runtime offers; undefined = not known, so all four stay possible. */
  available?: readonly ClaudeModelId[];
}

export type HoldReason = "fixed_model_unavailable" | "no_allowed_model" | "no_allowed_effort";

export interface Offer {
  /** Profile keys (`sonnet_high`) to the exact profile each stands for. */
  profiles: Record<string, Profile>;
  /** Why nothing could be offered. */
  held?: HoldReason;
  /** Where the offer came from, most binding first. */
  source: "override" | "fixed" | "auto";
}

export const profileKey = (profile: Profile) => `${MODEL_HANDLE[profile.model]}_${profile.effort}`;

function pickModels(setting: ModelSetting, available: (id: ClaudeModelId) => boolean, forced?: ClaudeModelId): { models: ClaudeModelId[]; held?: HoldReason } {
  if (forced) return available(forced) ? { models: [forced] } : { models: [], held: "fixed_model_unavailable" };
  if (setting.mode === "fixed") {
    if (available(setting.fixed)) return { models: [setting.fixed] };
    const fallback = setting.fallback.find(available);
    return fallback ? { models: [fallback] } : { models: [], held: "fixed_model_unavailable" };
  }
  const models = setting.allowed.filter(available);
  return models.length ? { models } : { models: [], held: "no_allowed_model" };
}

function pickEfforts(setting: EffortSetting, forced?: Effort): Effort[] {
  // All four catalogue models document the five levels; a runtime refusal is handled where it is sent.
  if (forced) return [forced];
  if (setting.mode === "fixed") return [setting.fixed];
  return setting.allowed;
}

/**
 * The complete model/effort profiles one role may use: a trusted override first, then fixed
 * dashboard values, then the AUTO allowlists, filtered by what the runtime offers. At most 20.
 */
export function offeredProfiles(policy: OrchestrationPolicy, role: Role, caps: Capabilities = {}, agentType?: string): Offer {
  const setting = policy.roles[role];
  const override: TaskOverride = { ...(role === "subagent" && agentType ? policy.agentTypes[agentType] : {}), ...policy.override[role] };
  const available = (id: ClaudeModelId) => !caps.available || caps.available.includes(id);
  const source: Offer["source"] = override.model || override.effort ? "override" : setting.model.mode === "fixed" || setting.effort.mode === "fixed" ? "fixed" : "auto";
  const { models, held } = pickModels(setting.model, available, override.model);
  if (held) return { profiles: {}, held, source };
  const efforts = pickEfforts(setting.effort, override.effort);
  if (!efforts.length) return { profiles: {}, held: "no_allowed_effort", source };
  const profiles: Record<string, Profile> = {};
  for (const model of models) for (const effort of efforts) profiles[profileKey({ model, effort })] = Object.freeze({ model, effort });
  return { profiles, source };
}

export type ProfileRead =
  | { profile: Profile; key: string; confidence?: number; local?: true }
  | { held: Profile; key: string; confidence: number; needed: number }
  | { none: "unavailable" | HoldReason };

/**
 * A role's profile: the only offered one applied locally, else Jev's typed choice when it names an
 * offered key with enough confidence. Anything else (an invented key, a bad confidence) is refused.
 */
export function readProfile(offer: Offer, answer: Answer | undefined, minConfidence: number): ProfileRead {
  const keys = Object.keys(offer.profiles);
  if (offer.held || !keys.length) return { none: offer.held ?? "no_allowed_model" };
  if (keys.length === 1) return { profile: offer.profiles[keys[0]!]!, key: keys[0]!, local: true };
  const read = readChoice(answer, keys, minConfidence);
  if (read.chosen) return { profile: offer.profiles[read.chosen.value]!, key: read.chosen.value, confidence: read.chosen.confidence };
  if (read.held) return { held: offer.profiles[read.held.value]!, key: read.held.value, confidence: read.held.confidence, needed: read.held.needed };
  return { none: "unavailable" };
}

/** Whether a profile (an active one being retained, say) is still within the role's current offer. */
export const stillOffered = (offer: Offer, profile: Profile | undefined) =>
  Boolean(profile && Object.values(offer.profiles).some((p) => p.model === profile.model && p.effort === profile.effort));

/** Concurrency: Jev's offered integer, a single option locally, one when unsure. */
export function readConcurrency(answer: Answer | undefined, ceiling: number, minConfidence: number): { workers: number; confident: boolean } {
  if (ceiling <= 1) return { workers: 1, confident: true };
  const options = Array.from({ length: ceiling }, (_, i) => String(i + 1));
  const read = readChoice(answer, options, minConfidence);
  return read.chosen ? { workers: Number(read.chosen.value), confident: true } : { workers: 1, confident: false };
}

/** Output cap for a controlled review by effort, held to what one completion can return. */
export function reviewCap(effort: Effort): number {
  return effort === EFFORT.MAX ? 64_000 : effort === EFFORT.XHIGH ? 32_768 : effort === EFFORT.HIGH ? 16_384 : 8_192;
}
