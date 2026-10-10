// Jev may size a native subagent request; Claude Code remains in charge of starting and running it.
import type { AskJev } from "./request.ts";
import { truncate } from "./state.ts";
import { askTimed } from "./request.ts";
import { readChoice } from "./selection.ts";
import { catalogueModel } from "./orchestration.ts";
import type { Answer, Json, ModelContext, Questions } from "./types.ts";
import { text, type Locale, type LocaleKey } from "../i18n.ts";
import {
  CLAUDE_MODEL,
  EFFORT,
  EFFORTS,
  EFFORT_TEXT_VALUES,
  MODEL_ID_BY_TIER,
  TIERS,
  type AgentPlan,
  type Effort,
  type Features,
  type HeldModelPick,
  type ModelPick,
  type ModelReason,
  type Tier,
} from "./contracts.ts";

export { DEFAULT_FEATURES } from "./contracts.ts";
export { EFFORTS, TIERS };
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
  if (TIERS.includes(fullId as Tier)) return { tier: fullId as Tier, alias: true };
  const model = modelIdTail(fullId).replace(/^(?:[a-z0-9-]+\.)?anthropic\./, "");
  const tiers = TIERS.join("|");
  const match = model.match(new RegExp(`^claude-(?:(\\d+)(?:-(\\d+))?-(${tiers})|(${tiers})-(\\d+)(?:-(\\d+))?)(.*)$`));
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
  if (model.alias) return model.tier !== CLAUDE_MODEL.HAIKU.name;
  const major = model.major ?? 0;
  const minor = model.minor ?? 0;
  if (model.tier === CLAUDE_MODEL.HAIKU.name) return major > 5 || (major === 5 && minor >= 5);
  return model.tier === CLAUDE_MODEL.OPUS.name ? major > 4 || (major === 4 && minor >= 5) : major > 4 || (major === 4 && minor >= 6);
}
/** Defaults use the first three catalogue entries (Haiku, Sonnet, Opus); native agents accept tier aliases. */
export const TIER_MODEL = MODEL_ID_BY_TIER;

export const MODEL_KEY = "model";
export const EFFORT_KEY = "effort";
const SAFE_MODEL_ID = /^[\p{L}\p{N}_.:/-]{1,128}$/u;
const NATIVE_AGENT_TYPES = new Set(["Explore", "Plan"]);

const MODEL_CRITERIA = Object.fromEntries(TIERS.map((tier) => [tier, `planning.model.${tier}`])) as Record<Tier, LocaleKey>;
const EFFORT_CRITERIA = Object.fromEntries(EFFORTS.map((effort) => [effort, `planning.effort.${effort}`])) as Record<Effort, LocaleKey>;

const criteria = (keys: Record<string, LocaleKey>, locale?: Locale) =>
  Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, text(value, locale, EFFORT_TEXT_VALUES)]));

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
    [EFFORT_KEY]: { type: "choice", instructions: text("planning.agent.effort.question", locale, EFFORT_TEXT_VALUES), criteria: criteria(EFFORT_CRITERIA, locale) },
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
