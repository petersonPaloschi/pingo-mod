import type { FeatureFlags } from "../../types";

export type { FeatureId } from "../../types";
export type Features = FeatureFlags;

export const DEFAULT_FEATURES: Features = {
  agents: false,
  farol: true,
  clareza: true,
  pingoVivo: true,
  prisma: true,
  semente: true,
  lapida: true,
  sentinela: true,
  vigia: true,
};

export type Tier = "haiku" | "sonnet" | "opus";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** The only Claude models the orchestration policy offers; native tier aliases stay separate. */
export const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"] as const;
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number];
/** The three configurable orchestration roles. */
export const ROLES = ["executor", "subagent", "advisor"] as const;
export type Role = (typeof ROLES)[number];
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
