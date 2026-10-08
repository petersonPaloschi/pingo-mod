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
  model?: string;
  effort?: Effort;
}

export type ModelOutcome =
  | { kind: "switched"; from: string; to: string }
  | { kind: "same"; model: string }
  | { kind: "held"; why: "user_model" | "model_id" | "blocked"; from: string; to: string };

export type EffortOutcome = { kind: "applied" | "ignored" | "held"; value?: string; from?: string; why?: string };

export interface RequestPolicy {
  model: boolean;
  effort: boolean;
  userModel?: boolean;
  blockedModels?: ReadonlySet<string>;
}

export const switchableModel = (id: string): boolean => /^claude-[a-z0-9.-]+$/i.test(id);

/** Resolve model first; effort must follow the actual request, including fallbacks. */
export function sizeRequest<T extends { model: string; effort?: Effort | number }>(original: T, plan: RequestPlan, policy: RequestPolicy): {
  request: T;
  modelOutcome?: ModelOutcome;
  effortOutcome?: EffortOutcome;
  ignoredEffort?: Effort | number;
} {
  let model = original.model;
  let effort = original.effort;
  let modelOutcome: ModelOutcome = { kind: "same", model: original.model };
  let effortOutcome: EffortOutcome | undefined;
  let ignoredEffort: Effort | number | undefined;
  if (policy.model && plan.model) {
    const why = policy.userModel ? "user_model" : policy.blockedModels?.has(plan.model) ? "blocked" : !switchableModel(model) ? "model_id" : undefined;
    if (plan.model === model) modelOutcome = { kind: "same", model };
    else if (why) modelOutcome = { kind: "held", why, from: model, to: plan.model };
    else {
      model = plan.model;
      modelOutcome = { kind: "switched", from: original.model, to: model };
    }
  }
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
  // Strip inherited effort only for a request Jev is actually sizing for Haiku.
  if (modelTier(model) === "haiku" && !supportsEffort(model) && (wanted !== undefined || modelOutcome?.kind === "switched")) {
    ignoredEffort ??= effort;
    effort = undefined;
  }
  if (model === original.model && effort === original.effort) return { request: original, modelOutcome, effortOutcome, ignoredEffort };
  const { effort: _effort, ...rest } = original;
  return { request: { ...rest, model, ...(effort === undefined ? {} : { effort }) } as T, modelOutcome, effortOutcome, ignoredEffort };
}

export function withHint(context: readonly string[] | undefined, hint: string): string[] {
  return [...(context ?? []), `<system-reminder>${hint}</system-reminder>`];
}

export function totalInput(usage: { input_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): number {
  return usage ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0;
}
