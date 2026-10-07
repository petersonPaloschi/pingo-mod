import type { Decision, JevTrace } from "./decide.ts";
import type { FeatureFlags, FeatureId } from "../../types";

export type { FeatureId } from "../../types";
export type Features = FeatureFlags;

/** Only the tool hint is on by default: the rest change how Claude Code runs. */
export const DEFAULT_FEATURES: Features = {
  tools: true,
  participation: false,
  model: false,
  effort: false,
  delegation: false,
  agents: false,
  advisor: false,
};
export const FEATURE_IDS = Object.keys(DEFAULT_FEATURES) as FeatureId[];

export type Tier = "haiku" | "sonnet" | "opus";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type AdvisorChoice = "none" | "consult";
export type ChoiceReason = "unavailable" | "low_confidence";
export type ModelReason = "keep_current" | "low_confidence" | "downgrade_confidence" | "cache_confidence" | "unavailable";
export type AdvisorWhy = "jev_declined" | "participation_unavailable" | "advisor_unavailable" | "unavailable" | "low_confidence";
export type DelegateWhy = ChoiceReason | "jev_declined" | "participation_unavailable" | "no_agents";

export interface Chosen<T> {
  value: T;
  confidence: number;
}

export interface HeldChoice<T> extends Chosen<T> {
  needed: number;
}

export type ModelPick = Chosen<Tier> & { id?: string; needed: number };
export type HeldModelPick = HeldChoice<Tier> & { id?: string };

export interface TurnPlan {
  decision: Decision;
  /** Jev's yes/no on taking part; absent when that feature is off or unanswered. */
  participate?: number;
  model?: ModelPick;
  modelHeld?: HeldModelPick;
  retainedModel?: string;
  modelReason?: ModelReason;
  effort?: Chosen<Effort>;
  effortHeld?: HeldChoice<Effort>;
  effortWhy?: ChoiceReason;
  delegate?: Chosen<string>;
  delegateHeld?: HeldChoice<string>;
  delegateWhy?: DelegateWhy;
  /** Jev's usable answer on the advisor: "consult" attaches the hint, "none" does not. */
  advisor?: Chosen<AdvisorChoice>;
  advisorHeld?: HeldChoice<AdvisorChoice>;
  advisorWhy?: AdvisorWhy;
  jev?: JevTrace;
}

/** What one subagent runs with. */
export interface AgentPlan {
  model?: ModelPick;
  modelHeld?: HeldModelPick;
  modelReason?: ModelReason;
  retainedModel?: string;
  effort?: Chosen<Effort>;
  effortHeld?: HeldChoice<Effort>;
  effortWhy?: ChoiceReason;
  latencyMs?: number;
  error?: string;
}

export interface ChoiceRead<T> {
  chosen?: Chosen<T>;
  held?: HeldChoice<T>;
  reason?: ChoiceReason;
}
