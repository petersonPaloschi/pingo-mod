// Jev may size a native subagent request; Claude Code remains in charge of starting and running it.
import type { AskJev } from "./request.ts";
import { truncate } from "./state.ts";
import { askTimed } from "./request.ts";
import { readChoice } from "./selection.ts";
import { catalogueModel, CLAUDE_MODELS } from "./orchestration.ts";
import type { Answer, Json, ModelContext, Questions } from "./types.ts";
import { text, type Locale, type LocaleKey } from "../i18n.ts";
import {
  EFFORTS,
  type AgentPlan,
  type Effort,
  type Features,
  type HeldModelPick,
  type ModelPick,
  type ModelReason,
  type Tier,
} from "./contracts.ts";

export { DEFAULT_FEATURES } from "./contracts.ts";
export { EFFORTS };
export { readChoice } from "./selection.ts";
export type {
  AgentPlan,
  ChoiceRead,
  ChoiceReason,
  Chosen,
  Effort,
  FeatureId,
  Features,
  HeldChoice,
  HeldModelPick,
  ModelPick,
  ModelReason,
  Tier,
} from "./contracts.ts";

export interface AgentPlanConfig {
  jevModel: string;
  minConfidence: number;
  maxMessageChars: number;
  locale?: Locale;
  promptLocale?: Locale;
}

export const TIERS: readonly Tier[] = ["haiku", "sonnet", "opus"];

function modelIdTail(id: string): string {
  return id.toLowerCase().slice(id.lastIndexOf("/") + 1);
}

interface ParsedModelId {
  tier: Tier;
  major?: number;
  minor?: number;
  alias?: boolean;
}

function parseModelId(id: string | undefined): ParsedModelId | undefined {
  if (!id) return undefined;
  const fullId = id.toLowerCase();
  if (fullId === "haiku" || fullId === "sonnet" || fullId === "opus") return { tier: fullId as Tier, alias: true };
  const model = modelIdTail(fullId).replace(/^(?:[a-z0-9-]+\.)?anthropic\./, "");
  const match = model.match(/^claude-(?:(\d+)(?:-(\d+))?-(haiku|sonnet|opus)|(haiku|sonnet|opus)-(\d+)(?:-(\d+))?)(.*)$/);
  if (!match || !/^(?:-\d{8})?(?:-v\d+(?::\d+|@\d{8}))?(?:@\d{8})?(?:\[1m\])?$/.test(match[7] ?? "")) return undefined;
  return {
    tier: (match[3] ?? match[4]) as Tier,
    major: Number(match[1] ?? match[5]),
    minor: Number(match[2] ?? match[6] ?? 0),
  };
}

export function modelTier(id: string | undefined): Tier | undefined {
  return parseModelId(id)?.tier;
}

/** Whether this model generation accepts an effort setting. Unknown models fail closed. */
export function supportsEffort(modelId: string | undefined): boolean {
  // The orchestration catalogue (Fable included) documents all five levels.
  if (catalogueModel(modelId)) return true;
  const model = parseModelId(modelId);
  if (!model) return false;
  if (model.alias) return model.tier !== "haiku";
  const major = model.major ?? 0;
  const minor = model.minor ?? 0;
  if (model.tier === "haiku") return major > 5 || (major === 5 && minor >= 5);
  return model.tier === "opus" ? major > 4 || (major === 4 && minor >= 5) : major > 4 || (major === 4 && minor >= 6);
}
/** Defaults use the first three catalogue entries (Haiku, Sonnet, Opus); native agents accept tier aliases. */
export const TIER_MODEL: Record<Tier, string> = {
  haiku: CLAUDE_MODELS[0],
  sonnet: CLAUDE_MODELS[1],
  opus: CLAUDE_MODELS[2],
};

export const MODEL_KEY = "model";
export const EFFORT_KEY = "effort";
const SAFE_MODEL_ID = /^[\p{L}\p{N}_.:/-]{1,128}$/u;
const NATIVE_AGENT_TYPES = new Set(["Explore", "Plan"]);

const MODEL_CRITERIA: Record<Tier, LocaleKey> = {
  haiku: "planning.model.haiku",
  sonnet: "planning.model.sonnet",
  opus: "planning.model.opus",
};
const EFFORT_CRITERIA: Record<Effort, LocaleKey> = {
  low: "planning.effort.low",
  medium: "planning.effort.medium",
  high: "planning.effort.high",
  xhigh: "planning.effort.xhigh",
  max: "planning.effort.max",
};

const criteria = (keys: Record<string, LocaleKey>, locale?: Locale) =>
  Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, text(value, locale)]));

function modelCriteria(session: ModelContext, locale?: Locale): Record<string, Json> {
  const options: Record<string, Json> = {};
  for (const id of session.availableModels ?? TIERS) {
    const tier = modelTier(id);
    if (!tier || !SAFE_MODEL_ID.test(id)) continue;
    options[id] = {
      model: id,
      what: text(MODEL_CRITERIA[tier], locale),
      not_for: text(`planning.model.${tier}.notFor` as LocaleKey, locale),
    };
  }
  return options;
}

/** The questions for one subagent about to start: its model and its effort. */
export function agentQuestions(features: Features, locale?: Locale, session: ModelContext = {}): Questions {
  if (!features.agents) return {};
  const models = modelCriteria(session, locale);
  return {
    ...(Object.keys(models).length ? {
      [MODEL_KEY]: { type: "choice" as const, instructions: text("planning.agent.model.question", locale), criteria: models },
    } : {}),
    [EFFORT_KEY]: { type: "choice", instructions: text("planning.agent.effort.question", locale), criteria: criteria(EFFORT_CRITERIA, locale) },
  };
}

function selectAgentModel(answer: Answer | undefined, minConfidence: number, session: ModelContext): {
  model?: ModelPick; modelHeld?: HeldModelPick; modelReason?: ModelReason;
} {
  const offered = (session.availableModels ?? TIERS).filter((id) => modelTier(id) && SAFE_MODEL_ID.test(id));
  const read = readChoice(answer, offered, minConfidence);
  const candidate = read.chosen ?? read.held;
  if (!candidate) return { modelReason: "unavailable" };
  const id = candidate.value;
  const tier = modelTier(id);
  if (!tier) return { modelReason: "unavailable" };
  const pick: HeldModelPick = { value: tier, confidence: candidate.confidence, needed: minConfidence, ...(id !== tier ? { id } : {}) };
  if (read.held) return { modelHeld: pick, modelReason: "low_confidence" };
  return { model: pick };
}

export async function planAgent(
  task: { description: string; prompt: string; subagentType: string },
  config: AgentPlanConfig,
  askJev: AskJev,
  features: Features,
  now: () => number = () => Date.now(),
  session: ModelContext = {},
): Promise<AgentPlan> {
  // Keep built-in exploration and planning on Claude's native model/effort choices without paired evidence.
  if (NATIVE_AGENT_TYPES.has(task.subagentType)) return {};
  // The native Agent hook accepts tier aliases; keep its inherited model when no choice is accepted.
  const agentSession: ModelContext = session.availableModels ? {
    availableModels: [...new Set(session.availableModels.map(modelTier).filter((tier): tier is Tier => tier !== undefined))],
  } : {};
  const questions = agentQuestions(features, config.promptLocale ?? config.locale, agentSession);
  if (Object.keys(questions).length === 0) return {};
  try {
    const asked = await askTimed({
      state: {
        agent_type: task.subagentType,
        task_description: truncate(task.description, 400, config.locale),
        task_prompt: truncate(task.prompt, config.maxMessageChars, config.locale),
        ...(session.availableModels ? { available_models: [...session.availableModels] } : {}),
      },
      questions,
      model: config.jevModel,
    }, askJev, now);
    if ("failure" in asked) return { error: asked.failure.replace(/^jev_error:\s*/, "") };
    const selection = selectAgentModel(asked.result.answers[MODEL_KEY], config.minConfidence, agentSession);
    const effortRead = readChoice(asked.result.answers[EFFORT_KEY], EFFORTS, config.minConfidence);
    return {
      ...selection,
      ...(effortRead.chosen ? { effort: effortRead.chosen } : {}),
      ...(effortRead.held ? { effortHeld: effortRead.held } : {}),
      ...(effortRead.reason ? { effortWhy: effortRead.reason } : {}),
      latencyMs: asked.latencyMs,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
