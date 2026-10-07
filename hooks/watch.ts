// What the Models tab shows: per prompt, what each Jev function came to and why, and a forecast of
// what it takes for the model to change next. Pure: register.tsx feeds it and keeps the state.
import type { FnResult, TurnDecision } from "../types";
import { modelThreshold, modelTier, NO_DELEGATION, participationState, TIER_MODEL, TIERS, type Features, type Tier, type TurnPlan } from "./core/plan.ts";
import type { ModelContext } from "./core/types.ts";
import { featureGate, type EffortOutcome, type FeatureContext, type ModelOutcome } from "./core/runtime.ts";
import { reasonCode } from "./errors.ts";
import { reasonKey } from "./events.ts";

/** Routing points kept for the tab: the newest, as many as fit a long session's attention. */
export const KEPT_TURNS = 40;

export interface TurnContext extends FeatureContext {
  /** The person picked the main loop's model, so Jev's model stays out. */
  userModel: boolean;
  minConfidence: number;
  session: ModelContext;
}

/** What each function did for the turn, from the plan Jev's answers made. The model is settled later. */
export function turnFunctions(plan: TurnPlan, ctx: TurnContext): FnResult[] {
  const ids = ["participation", "tools", "model", "effort", "delegation", "advisor"] as const;
  const gate = featureGate(ctx);
  if (gate) return ids.map((id) => ({ id, result: "off", why: gate }));
  const reason = plan.decision.mode === "passthrough" ? plan.decision.reason : "";
  const code = reasonCode(reason);
  if (code === "jev_error") {
    return ids.map((id): FnResult => {
      const why = featureGate(ctx, id);
      if (why) return { id, result: "off", why };
      if (id === "model" && ctx.userModel) return { id, result: "off", why: "user_model" };
      return { id, result: "failed", why: "jev_error" };
    });
  }
  const off = (id: (typeof ids)[number], why = "feature_off"): FnResult => ({ id, result: "off", why });
  const gated = (id: (typeof ids)[number]) => {
    const why = featureGate(ctx, id);
    return why ? off(id, why) : undefined;
  };
  const fns: FnResult[] = [];

  fns.push(
    gated("participation") ?? (plan.participate === undefined
        ? { id: "participation", result: "none", why: "unavailable" }
        : { id: "participation", result: "applied", value: participationState(plan.participate), confidence: plan.participate }),
  );

  fns.push(
    gated("tools") ?? (plan.decision.mode === "hint"
        ? { id: "tools", result: "applied", value: plan.decision.tool, confidence: plan.decision.confidence }
        : { id: "tools", result: "none", why: reasonKey(reason || "unknown") }),
  );

  fns.push(modelFunction(plan, ctx));

  fns.push(
    gated("effort") ?? (plan.effort
        ? { id: "effort", result: "applied", value: plan.effort.value, confidence: plan.effort.confidence }
        : plan.effortHeld
            ? { id: "effort", result: "kept", why: plan.effortWhy ?? "low_confidence", value: plan.effortHeld.value, confidence: plan.effortHeld.confidence, needed: plan.effortHeld.needed }
            : { id: "effort", result: "none", why: plan.effortWhy ?? "unavailable" }),
  );

  fns.push(
    gated("delegation") ?? (plan.delegate
        ? plan.delegate.value === NO_DELEGATION
          ? { id: "delegation", result: "none", why: "no_delegation", confidence: plan.delegate.confidence }
          : { id: "delegation", result: "applied", value: plan.delegate.value, confidence: plan.delegate.confidence }
        : plan.delegateHeld
          ? { id: "delegation", result: "kept", why: plan.delegateWhy ?? "low_confidence", value: plan.delegateHeld.value, confidence: plan.delegateHeld.confidence, needed: plan.delegateHeld.needed }
          : { id: "delegation", result: "none", why: plan.delegateWhy ?? "unavailable" }),
  );

  // "applied" means the hint was attached: whether Claude calls the advisor is Claude's decision.
  fns.push(
    gated("advisor") ?? (plan.advisor?.value === "consult"
        ? { id: "advisor", result: "applied", value: "consult", confidence: plan.advisor.confidence }
        : plan.advisor
          ? { id: "advisor", result: "none", why: "advisor_none", confidence: plan.advisor.confidence }
          : plan.advisorWhy === "low_confidence" && plan.advisorHeld
            ? { id: "advisor", result: "kept", why: "low_confidence", value: plan.advisorHeld.value, confidence: plan.advisorHeld.confidence, needed: plan.advisorHeld.needed }
            : { id: "advisor", result: "none", why: plan.advisorWhy ?? "unavailable" }),
  );
  // A malformed tool answer does not invalidate the other independently accepted questions.
  return code === "jev_unexpected_answer"
    ? fns.map((fn) => fn.result === "none" && (fn.id === "tools" || fn.why === "unavailable")
      ? { ...fn, result: "failed", why: "jev_unexpected_answer" } : fn)
    : fns;
}

function modelFunction(plan: TurnPlan, ctx: TurnContext): FnResult {
  const current = ctx.session.currentModel;
  const gate = featureGate(ctx, "model");
  if (gate) return { id: "model", result: "off", why: gate };
  if (ctx.userModel) return { id: "model", result: "off", why: "user_model" };
  const from = current ? { from: current } : {};
  if (plan.model) {
    const value = plan.model.id ?? TIER_MODEL[plan.model.value];
    return { id: "model", result: "applied", value, confidence: plan.model.confidence, needed: plan.model.needed, ...from };
  }
  const why = plan.modelReason ?? "unavailable";
  if (plan.modelHeld) {
    const value = plan.modelHeld.id ?? TIER_MODEL[plan.modelHeld.value];
    return { id: "model", result: "kept", why, value, confidence: plan.modelHeld.confidence, needed: plan.modelHeld.needed, ...from };
  }
  return { id: "model", result: "none", why, ...(current ? { value: current } : {}), ...from };
}

/** Settles the effort row from the request that was actually sent. */
export function settleEffort(turn: TurnDecision, outcome?: EffortOutcome, ctx?: FeatureContext): TurnDecision {
  const gate = ctx ? featureGate(ctx, "effort") : undefined;
  const fns = turn.fns.map((fn): FnResult => {
    if (fn.id !== "effort") return fn;
    if (gate) return { id: "effort", result: "off", why: gate };
    if (!outcome) return fn;
    const value = outcome.value ?? fn.value;
    if (outcome.kind === "applied") return { ...fn, result: "applied", value, ...(outcome.from ? { from: outcome.from } : {}) };
    if (outcome.kind === "ignored") return { ...fn, result: "kept", why: outcome.why ?? "haiku_no_effort", value, ...(outcome.from ? { from: outcome.from } : {}) };
    if (outcome.why === "routing_disabled" || outcome.why === "no_api_key" || outcome.why === "feature_off") {
      return { id: "effort", result: "off", why: outcome.why };
    }
    return { ...fn, result: "kept", why: outcome.why ?? "default", value, ...(outcome.from ? { from: outcome.from } : {}) };
  });
  return { ...turn, fns };
}

/** Fills in the model function once the first request is sent: it was switched, held back or already running. */
export function settleModel(turn: TurnDecision, outcome: ModelOutcome | undefined, ctx?: FeatureContext): TurnDecision {
  const gate = ctx ? featureGate(ctx, "model") : undefined;
  const fns = turn.fns.map((fn): FnResult => {
    if (fn.id !== "model") return fn;
    if (gate) return { id: "model", result: "off", why: gate };
    if (!outcome) return fn;
    if (fn.result !== "applied") {
      if (outcome.kind === "same" && (fn.result === "none" || fn.result === "kept")) {
        return { ...fn, from: outcome.model, ...(fn.result === "none" ? { value: outcome.model } : {}) };
      }
      return fn;
    }
    if (outcome.kind === "switched") return { ...fn, value: outcome.to, from: outcome.from };
    if (outcome.kind === "held") return { ...fn, result: "kept", why: outcome.why, value: outcome.to, from: outcome.from };
    return { ...fn, result: "none", why: "same_model", value: outcome.model, from: outcome.model };
  });
  return { ...turn, fns, settled: true };
}

export const modelOf = (turn: TurnDecision) => turn.fns.find((fn) => fn.id === "model");

/** Newest last, the oldest dropped. */
export const keepTurns = (turns: readonly TurnDecision[], turn: TurnDecision): TurnDecision[] => [...turns, turn].slice(-KEPT_TURNS);

export type Blocker = "routing_disabled" | "no_api_key" | "feature_off" | "user_model" | "model_id";

export interface Target {
  id: string;
  tier: Tier;
  direction: "up" | "same" | "down";
  /** The confidence Jev needs to move the model here. */
  needed: number;
  /** Why a pick below `needed` would be held back. */
  why: string;
  /** Excluded for the session after failing twice. */
  blocked: boolean;
}

export interface Forecast {
  /** Why Jev's model pick cannot change anything now; empty when it can. */
  blockers: Blocker[];
  current?: string;
  /** Every other model Jev may pick, with what it takes. */
  targets: Target[];
  /** The cache is warm, which raises the bar for a downgrade. */
  cacheWarm: boolean;
}

export interface ForecastInput {
  routing: boolean;
  hasKey: boolean;
  features: Features;
  userModel: boolean;
  current?: string;
  /** The running model is a plain first-party id that Jev may replace. */
  switchable: boolean;
  cacheReadTokens: number;
  minConfidence: number;
  available: readonly string[];
  blocked: readonly string[];
}

/** What it takes for the model to change at the next prompt. Jev decides once per prompt, never mid-turn. */
export function forecast(input: ForecastInput): Forecast {
  const blockers: Blocker[] = [];
  if (!input.routing) blockers.push("routing_disabled");
  else if (!input.hasKey) blockers.push("no_api_key");
  if (!input.features.model) blockers.push("feature_off");
  if (input.userModel) blockers.push("user_model");
  if (input.current && !input.switchable) blockers.push("model_id");
  const session: ModelContext = { ...(input.current ? { currentModel: input.current } : {}), cacheReadTokens: input.cacheReadTokens };
  const currentTier = modelTier(input.current);
  const targets: Target[] = [];
  for (const id of input.available.length ? input.available : TIERS.map((tier) => TIER_MODEL[tier])) {
    const tier = modelTier(id);
    if (!tier || id === input.current) continue;
    const { needed, reason } = modelThreshold(tier, input.minConfidence, session);
    const delta = currentTier ? TIERS.indexOf(tier) - TIERS.indexOf(currentTier) : 0;
    targets.push({ id, tier, direction: delta > 0 ? "up" : delta < 0 ? "down" : "same", needed, why: reason, blocked: input.blocked.includes(id) });
  }
  targets.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  return { blockers, ...(input.current ? { current: input.current } : {}), targets, cacheWarm: input.cacheReadTokens > 0 };
}
