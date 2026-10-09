import type { FeatureFlags, FeatureId } from "../../types";

export type { FeatureId } from "../../types";
export type Features = FeatureFlags;

export const DEFAULT_FEATURES: Features = {
  agents: false,
};
export const FEATURE_IDS = Object.keys(DEFAULT_FEATURES) as FeatureId[];

export type Tier = "haiku" | "sonnet" | "opus";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ChoiceReason = "unavailable" | "low_confidence";
export type ModelReason = "low_confidence" | "unavailable";

export interface Chosen<T> {
  value: T;
  confidence: number;
}

export interface HeldChoice<T> extends Chosen<T> {
  needed: number;
}

export type ModelPick = Chosen<Tier> & { id?: string; needed: number };
export type HeldModelPick = HeldChoice<Tier> & { id?: string };

/** What one subagent runs with. */
export interface AgentPlan {
  model?: ModelPick;
  modelHeld?: HeldModelPick;
  modelReason?: ModelReason;
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
