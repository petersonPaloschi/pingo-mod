import { modelTier, supportsEffort, type Effort, type FeatureId, type Features } from "./plan.ts";
import { gateReason } from "./reasons.ts";

/** The same live gate is used when planning, sending requests and showing results. */
export interface FeatureContext {
  routing: boolean;
  hasKey: boolean;
  features: Features;
}

export function featureGate(ctx: FeatureContext, feature?: FeatureId): "routing_disabled" | "no_api_key" | "feature_off" | undefined {
  return gateReason(ctx.routing, ctx.hasKey) ?? (feature && !ctx.features[feature] ? "feature_off" : undefined);
}

export interface RequestPlan {
  effort?: Effort;
}

export type EffortOutcome = { kind: "applied" | "ignored" | "held"; value?: string; from?: string; why?: string };

export interface RequestPolicy {
  effort: boolean;
}

/** Size effort against the native agent's actual model, including fallbacks. */
export function sizeRequest<T extends { model: string; effort?: Effort | number }>(original: T, plan: RequestPlan, policy: RequestPolicy): {
  request: T;
  effortOutcome?: EffortOutcome;
  ignoredEffort?: Effort | number;
} {
  const model = original.model;
  let effort = original.effort;
  let effortOutcome: EffortOutcome | undefined;
  let ignoredEffort: Effort | number | undefined;
  const wanted = policy.effort ? plan.effort : undefined;
  if (wanted !== undefined) {
    if (supportsEffort(model)) {
      effort = wanted;
      effortOutcome = { kind: "applied", value: wanted, ...(original.effort === undefined ? {} : { from: String(original.effort) }) };
    } else {
      ignoredEffort = wanted;
      effortOutcome = { kind: "ignored", value: wanted, why: modelTier(model) === "haiku" ? "haiku_no_effort" : "unsupported_effort" };
    }
  }
  // Leave native/manual requests alone; only strip an incompatible planned effort.
  if (wanted !== undefined && !supportsEffort(model)) {
    ignoredEffort ??= effort;
    effort = undefined;
  }
  if (effort === original.effort) return { request: original, effortOutcome, ignoredEffort };
  const { effort: _effort, ...rest } = original;
  return { request: { ...rest, ...(effort === undefined ? {} : { effort }) } as T, effortOutcome, ignoredEffort };
}

export function totalInput(usage: { input_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): number {
  return usage ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0;
}
