// What Jev decides beyond the next tool: whether to take part at all, which model and effort the
// turn runs on, whether to hand work to a subagent, and the model and effort of each subagent.
// Every question rides in the routing point's one Jev call; each answer counts only above the
// minimum confidence, otherwise Claude Code's own choice stands.
import { decide, SAFE_TOOL_NAME, skipReason, type AskJev, type DecideConfig, type Decision, type JevTrace } from "./decide.ts";
import { buildState, truncate } from "./state.ts";
import type { Answer, Questions, RouterInput } from "./types.ts";
import { formatDecimal, localeFor, reasonTitle, text, type Locale, type LocaleKey } from "../i18n.ts";

export type FeatureId = "tools" | "participation" | "model" | "effort" | "delegation" | "agents";
export type Features = Record<FeatureId, boolean>;

/** Only the tool hint is on by default: the rest change how Claude Code runs. */
export const DEFAULT_FEATURES: Features = {
  tools: true,
  participation: false,
  model: false,
  effort: false,
  delegation: false,
  agents: false,
};

export type Tier = "haiku" | "sonnet" | "opus";
export const TIERS: readonly Tier[] = ["haiku", "sonnet", "opus"];
/** The ids a main-loop request is sent with; agents take the alias itself. */
export const TIER_MODEL: Record<Tier, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export const PARTICIPATE_KEY = "participate";
export const MODEL_KEY = "model";
export const EFFORT_KEY = "effort";
export const DELEGATE_KEY = "delegate";
export const NO_DELEGATION = "no_delegation";

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

/** A subagent type Claude Code offers, as `agent.offer` reports it. */
export interface AgentType {
  name: string;
  description: string;
}

/** An agent name is written into the hint Claude reads: like a tool name, it must stay one inert token. */
export function isSafeAgentName(name: unknown): name is string {
  return typeof name === "string" && SAFE_TOOL_NAME.test(name);
}

/** The agents the delegation question offers: safe names only, never the "no delegation" label itself. */
function offeredAgents(agents: readonly AgentType[]): AgentType[] {
  return agents.filter((agent) => isSafeAgentName(agent.name) && agent.name !== NO_DELEGATION).slice(0, 40);
}

/** The extra questions a turn's routing point asks, for the features that are on. */
export function turnQuestions(features: Features, agents: readonly AgentType[], locale?: Locale): Questions {
  const questions: Questions = {};
  if (features.participation) {
    questions[PARTICIPATE_KEY] = {
      type: "noul",
      instructions: text("planning.participation.question", locale),
    };
  }
  if (features.model) {
    questions[MODEL_KEY] = {
      type: "choice",
      instructions: text("planning.model.question", locale),
      criteria: criteria(MODEL_CRITERIA, locale),
    };
  }
  if (features.effort) {
    questions[EFFORT_KEY] = {
      type: "choice",
      instructions: text("planning.effort.question", locale),
      criteria: criteria(EFFORT_CRITERIA, locale),
    };
  }
  const offered = offeredAgents(agents);
  if (features.delegation && offered.length > 0) {
    const criteria: Record<string, string | null> = {};
    for (const agent of offered) criteria[agent.name] = truncate(agent.description, 400, locale) || null;
    criteria[NO_DELEGATION] = text("planning.delegation.none", locale);
    questions[DELEGATE_KEY] = {
      type: "choice",
      instructions: text("planning.delegation.question", locale),
      criteria,
    };
  }
  return questions;
}

/** The questions for one subagent about to start: its model and its effort. */
export function agentQuestions(features: Features, locale?: Locale): Questions {
  if (!features.agents) return {};
  return {
    [MODEL_KEY]: { type: "choice", instructions: text("planning.agent.model.question", locale), criteria: criteria(MODEL_CRITERIA, locale) },
    [EFFORT_KEY]: { type: "choice", instructions: text("planning.agent.effort.question", locale), criteria: criteria(EFFORT_CRITERIA, locale) },
  };
}

export interface Chosen<T> {
  value: T;
  confidence: number;
}

function choice<T extends string>(answers: Record<string, Answer> | undefined, key: string, allowed: readonly T[], min: number): Chosen<T> | undefined {
  const answer = answers?.[key];
  if (answer?.type !== "choice" || !allowed.includes(answer.choice as T) || answer.confidence < min) return undefined;
  return { value: answer.choice as T, confidence: answer.confidence };
}

/** Everything one routing point decided. */
export interface TurnPlan {
  decision: Decision;
  /** Jev's yes/no on taking part; absent when that feature is off. */
  participate?: number;
  model?: Chosen<Tier>;
  effort?: Chosen<Effort>;
  /** Jev answered, but the selected tier does not accept effort. */
  effortIgnored?: Chosen<Effort>;
  delegate?: Chosen<string>;
  jev?: JevTrace;
}

/** One routing point: the tool decision plus the extra questions, in one Jev call. */
export async function planTurn(
  input: RouterInput,
  config: DecideConfig,
  askJev: AskJev,
  features: Features,
  agents: readonly AgentType[],
  now: () => number = () => Date.now(),
): Promise<TurnPlan> {
  const extra = turnQuestions(features, agents, config.locale);
  let decision: Decision;
  const skip = features.tools ? skipReason(input) : undefined;
  if (skip && Object.keys(extra).length > 0) {
    // Jev is not asked about the tool, but the other questions still are.
    decision = await askOnly(input, config, askJev, extra, now, skip);
  } else if (features.tools) {
    decision = await decide(input, config, askJev, now, extra);
  } else if (Object.keys(extra).length === 0) {
    return { decision: { mode: "passthrough", reason: "features_off" } };
  } else {
    decision = await askOnly(input, config, askJev, extra, now);
  }
  return readTurnPlan(decision, features, agents, config.minConfidence);
}

/** The extra questions alone, when the tool hint is off or the tool decision was skipped. */
async function askOnly(
  input: RouterInput,
  config: DecideConfig,
  askJev: AskJev,
  questions: Questions,
  now: () => number,
  reason = "tools_feature_off",
): Promise<Decision> {
  if (input.turns.length === 0) return { mode: "passthrough", reason: "no_messages" };
  const startedAt = now();
  try {
    const result = await askJev({ state: buildState(input, config), questions, model: config.jevModel });
    const latencyMs = Math.round(now() - startedAt);
    return {
      mode: "passthrough",
      reason,
      answers: result.answers,
      jev: { choice: "–", confidence: 0, needsTool: 0, topProbabilities: {}, inputTokens: result.usage.input_tokens, latencyMs },
    };
  } catch (error) {
    return { mode: "passthrough", reason: `jev_error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function readTurnPlan(decision: Decision, features: Features, agents: readonly AgentType[], minConfidence: number): TurnPlan {
  const answers = decision.answers;
  const participateAnswer = answers?.[PARTICIPATE_KEY];
  const participate = features.participation && participateAnswer?.type === "noul" ? participateAnswer.noul : undefined;
  const model = features.model ? choice(answers, MODEL_KEY, TIERS, minConfidence) : undefined;
  const requestedEffort = features.effort ? choice(answers, EFFORT_KEY, EFFORTS, minConfidence) : undefined;
  const effortIgnored = model?.value === "haiku" ? requestedEffort : undefined;
  const effort = effortIgnored ? undefined : requestedEffort;
  const sizing = {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(effortIgnored ? { effortIgnored } : {}),
    ...(decision.jev ? { jev: decision.jev } : {}),
  };
  // Jev chose to stay out: no hint and no delegation. The model and effort still apply, since a
  // trivial request is exactly the one a smaller model and less effort fit.
  if (participate !== undefined && participate < 0.5) {
    return { decision: { mode: "passthrough", reason: "jev_declined", ...(decision.jev ? { jev: decision.jev } : {}) }, participate, ...sizing };
  }
  // Only a name the question offered is taken; "no_delegation" is a confident no.
  const offered = [...offeredAgents(agents).map((agent) => agent.name), NO_DELEGATION];
  const delegated = features.delegation ? choice(answers, DELEGATE_KEY, offered, minConfidence) : undefined;
  return {
    decision,
    ...(participate !== undefined ? { participate } : {}),
    ...sizing,
    ...(delegated ? { delegate: delegated } : {}),
  };
}

/** What one subagent runs with. */
export interface AgentPlan {
  model?: Chosen<Tier>;
  effort?: Chosen<Effort>;
  effortIgnored?: Chosen<Effort>;
  latencyMs?: number;
  error?: string;
}

export async function planAgent(
  task: { description: string; prompt: string; subagentType: string },
  config: DecideConfig,
  askJev: AskJev,
  features: Features,
  now: () => number = () => Date.now(),
): Promise<AgentPlan> {
  const questions = agentQuestions(features, config.locale);
  if (Object.keys(questions).length === 0) return {};
  const startedAt = now();
  try {
    const result = await askJev({
      state: {
        agent_type: task.subagentType,
      task_description: truncate(task.description, 400, config.locale),
      task_prompt: truncate(task.prompt, config.maxMessageChars, config.locale),
      },
      questions,
      model: config.jevModel,
    });
    const model = choice(result.answers, MODEL_KEY, TIERS, config.minConfidence);
    const requestedEffort = choice(result.answers, EFFORT_KEY, EFFORTS, config.minConfidence);
    const effortIgnored = model?.value === "haiku" ? requestedEffort : undefined;
    const effort = effortIgnored ? undefined : requestedEffort;
    return {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(effortIgnored ? { effortIgnored } : {}),
      latencyMs: Math.round(now() - startedAt),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The context Claude reads for a turn: the tool hint and the delegation hint, in one note. */
export function planHint(plan: TurnPlan, toolHint: (tool: string, locale?: Locale) => string, locale?: Locale): string | undefined {
  const parts: string[] = [];
  if (plan.decision.mode === "hint") parts.push(toolHint(plan.decision.tool, locale));
  if (plan.delegate && plan.delegate.value !== NO_DELEGATION) {
    parts.push(text("planning.hint.delegate", locale, { agent: plan.delegate.value }));
  }
  return parts.length ? parts.join(text("planning.hint.separator", locale)) : undefined;
}

/** One short line saying what Jev decided: the summary the live log and the band show. */
export function planSummary(plan: TurnPlan, locale?: Locale): string {
  const d = plan.decision;
  if (d.mode === "passthrough" && d.reason.startsWith("jev_error")) {
    return text("planning.summary.failed", locale, { message: d.reason.slice("jev_error: ".length, 70) });
  }
  const parts = [
    d.mode === "hint"
      ? text("planning.summary.tool", locale, { tool: d.tool, confidence: formatDecimal(d.confidence, localeFor(locale), 2) })
      : d.reason === "jev_declined"
        ? text("planning.summary.declined", locale, { confidence: formatDecimal(plan.participate ?? 0, localeFor(locale), 2) })
        : text("planning.summary.noTool", locale, { reason: reasonTitle(d.reason, locale) }),
    plan.model ? text("planning.summary.model", locale, { model: plan.model.value }) : undefined,
    plan.effort ? text("planning.summary.effort", locale, { effort: plan.effort.value }) : undefined,
    plan.effortIgnored ? text("planning.summary.effortIgnored", locale, { effort: plan.effortIgnored.value }) : undefined,
    plan.delegate && plan.delegate.value !== NO_DELEGATION ? text("planning.summary.delegate", locale, { agent: plan.delegate.value }) : undefined,
  ].filter(Boolean);
  return parts.join(text("planning.summary.separator", locale));
}
