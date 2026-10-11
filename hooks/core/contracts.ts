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
  contexto: true,
  codeQuality: true,
  comandante: false,
};

export const EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
} as const;
export type Effort = (typeof EFFORT)[keyof typeof EFFORT];
export const EFFORTS = Object.freeze(Object.values(EFFORT));
export const EFFORT_TEXT_VALUES: Record<string, string> = Object.fromEntries(Object.entries(EFFORT).map(([key, value]) => [key.toLowerCase(), value]));

/** One entry per model; aliases, native tiers, IDs and display labels stay distinct values. */
export const CLAUDE_MODEL = {
  HAIKU: { name: "haiku", id: "claude-haiku-5-5", label: "Haiku 5.5", tier: true },
  SONNET: { name: "sonnet", id: "claude-sonnet-5-5", label: "Sonnet 5.5", tier: true },
  OPUS: { name: "opus", id: "claude-opus-5-5", label: "Opus 5.5", tier: true },
  FABLE: { name: "fable", id: "claude-fable-5-1", label: "Fable 5.1" },
} as const;
type ClaudeModel = (typeof CLAUDE_MODEL)[keyof typeof CLAUDE_MODEL];
export type ModelName = ClaudeModel["name"];
export type ClaudeModelId = ClaudeModel["id"];
export type Tier = {
  [K in keyof typeof CLAUDE_MODEL]: (typeof CLAUDE_MODEL)[K] extends { tier: true }
    ? (typeof CLAUDE_MODEL)[K]["name"]
    : never;
}[keyof typeof CLAUDE_MODEL];

const CLAUDE_MODELS_BY_NAME = Object.values(CLAUDE_MODEL);
export const MODEL_NAMES = Object.freeze(CLAUDE_MODELS_BY_NAME.map(({ name }) => name));
export const TIERS = Object.freeze(CLAUDE_MODELS_BY_NAME.filter((model) => "tier" in model).map(({ name }) => name)) as readonly Tier[];
/** The only Claude models the orchestration policy offers. */
export const CLAUDE_MODELS = Object.freeze(CLAUDE_MODELS_BY_NAME.map(({ id }) => id));
export const MODEL_HANDLE: Readonly<Record<ClaudeModelId, ModelName>> = Object.freeze(Object.fromEntries(CLAUDE_MODELS_BY_NAME.map(({ id, name }) => [id, name])) as Record<ClaudeModelId, ModelName>);
export const MODEL_LABEL: Readonly<Record<ClaudeModelId, string>> = Object.freeze(Object.fromEntries(CLAUDE_MODELS_BY_NAME.map(({ id, label }) => [id, label])) as Record<ClaudeModelId, string>);
export const MODEL_ID_BY_TIER: Readonly<Record<Tier, ClaudeModelId>> = Object.freeze(Object.fromEntries(CLAUDE_MODELS_BY_NAME.filter((model) => "tier" in model).map(({ name, id }) => [name, id])) as Record<Tier, ClaudeModelId>);
export const MODEL_TEXT_VALUES: Record<string, string> = Object.fromEntries(Object.entries(CLAUDE_MODEL).flatMap(([key, { name, label }]) => {
  const placeholder = key.toLowerCase();
  return [[placeholder, name], [`${placeholder}Label`, label]];
}));
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
