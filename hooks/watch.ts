// What the Models tab shows: per prompt, what each Jev function came to and why, and a forecast of
// what it takes for the model to change next. Pure: register.tsx feeds it and keeps the state.
import type { FnResult, TurnDecision } from "../types";
import { consultsAdvisor, modelThreshold, modelTier, NO_DELEGATION, pickedModelId, TIER_MODEL, TIERS, type Features, type Tier, type TurnPlan } from "./core/plan.ts";
import { gateReason, isJevError, reasonCode } from "./core/reasons.ts";
import { passReason } from "./core/decide.ts";
import type { ModelContext } from "./core/types.ts";

/** Routing points kept for the tab: the newest, as many as fit a long session's attention. */
export const KEPT_TURNS = 40;

export interface TurnContext {
  features: Features;
  routing: boolean;
  hasKey: boolean;
  /** The person picked the main loop's model, so Jev's model stays out. */
  userModel: boolean;
  minConfidence: number;
  session: ModelContext;
}

/**
 * What each function did for the turn, read off the plan alone: every confidence check was made
 * once, when the plan was read. The model is settled later, by the first request.
 */
export function turnFunctions(plan: TurnPlan, ctx: TurnContext): FnResult[] {
  const ids = ["participation", "tools", "model", "effort", "delegation", "advisor"] as const;
  const gate = gateReason(ctx.routing, ctx.hasKey);
  if (gate) return ids.map((id) => ({ id, result: "off", why: gate }));
  const reason = passReason(plan.decision);
  if (isJevError(reason)) {
    return ids.map((id) => id === "model" && ctx.userModel
      ? { id, result: "off", why: "user_model" }
      : ctx.features[id] ? { id, result: "failed", why: "jev_error" } : { id, result: "off", why: "feature_off" });
  }
  const declined = reason === "jev_declined";
  const min = ctx.minConfidence;
  const off = (id: (typeof ids)[number], why = "feature_off"): FnResult => ({ id, result: "off", why });
  const fns: FnResult[] = [];

  fns.push(
    !ctx.features.participation
      ? off("participation")
      : plan.participate === undefined
        ? { id: "participation", result: "none", why: "unavailable" }
        : { id: "participation", result: "applied", value: plan.participate < 0.5 ? "out" : "in", confidence: plan.participate },
  );

  fns.push(
    !ctx.features.tools
      ? off("tools")
      : plan.decision.mode === "hint"
        ? { id: "tools", result: "applied", value: plan.decision.tool, confidence: plan.decision.confidence }
        : { id: "tools", result: "none", why: reasonCode(reason || "unknown") },
  );

  fns.push(modelFunction(plan, ctx));

  fns.push(
    !ctx.features.effort
      ? off("effort")
      : plan.effort
        ? { id: "effort", result: "applied", value: plan.effort.value, confidence: plan.effort.confidence }
        : plan.effortIgnored
          ? { id: "effort", result: "kept", why: "haiku_no_effort", value: plan.effortIgnored.value, confidence: plan.effortIgnored.confidence }
          : plan.effortHeld
            ? { id: "effort", result: "kept", why: "low_confidence", value: plan.effortHeld.value, confidence: plan.effortHeld.confidence, needed: min }
            : { id: "effort", result: "none", why: "unavailable" },
  );

  fns.push(
    !ctx.features.delegation
      ? off("delegation")
      : declined
        ? { id: "delegation", result: "none", why: "jev_declined" }
        : plan.delegate
          ? plan.delegate.value === NO_DELEGATION
            ? { id: "delegation", result: "none", why: "no_delegation", confidence: plan.delegate.confidence }
            : { id: "delegation", result: "applied", value: plan.delegate.value, confidence: plan.delegate.confidence }
          : plan.delegateHeld
            ? { id: "delegation", result: "kept", why: "low_confidence", value: plan.delegateHeld.value, confidence: plan.delegateHeld.confidence, needed: min }
            : { id: "delegation", result: "none", why: "unavailable" },
  );

  // "applied" means the hint was attached: whether Claude calls the advisor is Claude's decision.
  fns.push(
    !ctx.features.advisor
      ? off("advisor")
      : consultsAdvisor(plan) && plan.advisor
        ? { id: "advisor", result: "applied", value: "consult", confidence: plan.advisor.confidence }
        : plan.advisor
          ? { id: "advisor", result: "none", why: "advisor_none", confidence: plan.advisor.confidence }
          : plan.advisorWhy === "low_confidence" && plan.advisorHeld
            ? { id: "advisor", result: "kept", why: "low_confidence", value: "consult", confidence: plan.advisorHeld.confidence, needed: min }
            : { id: "advisor", result: "none", why: plan.advisorWhy ?? "unavailable" },
  );
  // A malformed tool answer does not invalidate the other independently accepted questions.
  return reason === "jev_unexpected_answer"
    ? fns.map((fn) => fn.result === "none" && (fn.id === "tools" || fn.why === "unavailable")
      ? { ...fn, result: "failed", why: "jev_unexpected_answer" } : fn)
    : fns;
}

function modelFunction(plan: TurnPlan, ctx: TurnContext): FnResult {
  const current = ctx.session.currentModel;
  if (ctx.features.model && ctx.userModel) return { id: "model", result: "off", why: "user_model" };
  if (!ctx.features.model) return { id: "model", result: "off", why: "feature_off" };
  const wanted = plan.modelAsked;
  const from = current ? { from: current } : {};
  if (plan.model) {
    const needed = modelThreshold(plan.model.value, ctx.minConfidence, ctx.session).needed;
    return { id: "model", result: "applied", value: pickedModelId(plan.model), confidence: plan.model.confidence, needed, ...from };
  }
  const why = plan.modelReason ?? "unavailable";
  if (why === "keep_current" || why === "unavailable") {
    return { id: "model", result: "none", why, ...(current ? { value: current } : {}), ...(wanted ? { confidence: wanted.confidence } : {}), ...from };
  }
  const tier = modelTier(wanted?.value);
  return {
    id: "model",
    result: "kept",
    why,
    ...(wanted ? { value: wanted.value, confidence: wanted.confidence } : {}),
    ...(tier ? { needed: modelThreshold(tier, ctx.minConfidence, ctx.session).needed } : {}),
    ...from,
  };
}

/** How the turn's first request treated the model Jev picked. */
export type ModelOutcome =
  | { kind: "switched"; from: string; to: string }
  | { kind: "held"; why: "user_model" | "model_id" | "blocked"; from: string; to: string }
  | { kind: "same"; model: string };

/** Fills in the model function once the first request is sent: it was switched, held back or already running. */
export function settleModel(turn: TurnDecision, outcome: ModelOutcome | undefined): TurnDecision {
  const fns = turn.fns.map((fn): FnResult => {
    if (fn.id !== "model" || fn.result !== "applied" || !outcome) return fn;
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
  const gate = gateReason(input.routing, input.hasKey);
  const blockers: Blocker[] = gate ? [gate] : [];
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
