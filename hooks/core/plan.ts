// What Jev decides beyond the next tool: whether to take part at all, which model and effort the
// turn runs on, whether to hand work to a subagent, and the model and effort of each subagent.
// Every question rides in the routing point's one Jev call; each answer counts only above the
// minimum confidence, otherwise Claude Code's own choice stands.
import { decide, type AskJev, type DecideConfig, type Decision, type JevTrace } from "./decide.ts";
import { buildState, truncate } from "./state.ts";
import type { Answer, Questions, RouterInput } from "./types.ts";

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

const MODEL_CRITERIA: Record<Tier, string> = {
  haiku: "A quick, simple step: a lookup, a small mechanical edit, a short factual answer.",
  sonnet: "Ordinary coding work: implement or fix something well-scoped, explain code, run and read tests.",
  opus: "Hard work: design or architecture, a subtle bug, a large multi-file change, or an ambiguous request.",
};
const EFFORT_CRITERIA: Record<Effort, string> = {
  low: "Trivial: the answer or the edit is obvious.",
  medium: "Routine: some reading and a few straightforward steps.",
  high: "Demanding: several steps that depend on each other, or care needed to get it right.",
  xhigh: "Very demanding: long, intricate reasoning or a change with many interacting parts.",
  max: "Maximum effort: the hardest tasks, when the deepest reasoning is worth the extra time and token use.",
};

/** A subagent type Claude Code offers, as `agent.offer` reports it. */
export interface AgentType {
  name: string;
  description: string;
}

/** The extra questions a turn's routing point asks, for the features that are on. */
export function turnQuestions(features: Features, agents: readonly AgentType[]): Questions {
  const questions: Questions = {};
  if (features.participation) {
    questions[PARTICIPATE_KEY] = {
      type: "noul",
      instructions:
        "Is the user's latest request substantial enough that choosing tools, model, effort or delegation " +
        "for it matters, rather than a trivial exchange best left to the assistant as it is?",
    };
  }
  if (features.model) {
    questions[MODEL_KEY] = {
      type: "choice",
      instructions: "Which model size fits the user's latest request best?",
      criteria: { ...MODEL_CRITERIA },
    };
  }
  if (features.effort) {
    questions[EFFORT_KEY] = {
      type: "choice",
      instructions: "How much thinking effort does the user's latest request need?",
      criteria: { ...EFFORT_CRITERIA },
    };
  }
  if (features.delegation && agents.length > 0) {
    const criteria: Record<string, string | null> = {};
    for (const agent of agents.slice(0, 40)) criteria[agent.name] = truncate(agent.description, 400) || null;
    criteria[NO_DELEGATION] = "The assistant should do the work itself; no part of it is worth handing to a subagent.";
    questions[DELEGATE_KEY] = {
      type: "choice",
      instructions:
        "Should the assistant hand part of the user's latest request to one of these subagents, " +
        "which run separately and report back?",
      criteria,
    };
  }
  return questions;
}

/** The questions for one subagent about to start: its model and its effort. */
export function agentQuestions(features: Features): Questions {
  if (!features.agents) return {};
  return {
    [MODEL_KEY]: { type: "choice", instructions: "Which model size fits this subagent's task best?", criteria: { ...MODEL_CRITERIA } },
    [EFFORT_KEY]: { type: "choice", instructions: "How much thinking effort does this subagent's task need?", criteria: { ...EFFORT_CRITERIA } },
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
  const extra = turnQuestions(features, agents);
  let decision: Decision;
  if (features.tools) {
    decision = await decide(input, config, askJev, now, extra);
  } else if (Object.keys(extra).length === 0) {
    return { decision: { mode: "passthrough", reason: "features_off" } };
  } else {
    decision = await askOnly(input, config, askJev, extra, now);
  }
  return readTurnPlan(decision, features, agents, config.minConfidence);
}

/** The extra questions alone, when the tool hint is off. */
async function askOnly(input: RouterInput, config: DecideConfig, askJev: AskJev, questions: Questions, now: () => number): Promise<Decision> {
  if (input.turns.length === 0) return { mode: "passthrough", reason: "no_messages" };
  const startedAt = now();
  try {
    const result = await askJev({ state: buildState(input, config), questions, model: config.jevModel });
    const latencyMs = Math.round(now() - startedAt);
    return {
      mode: "passthrough",
      reason: "tools_feature_off",
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
  const delegated = features.delegation ? choice(answers, DELEGATE_KEY, agents.map((agent) => agent.name), minConfidence) : undefined;
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
  const questions = agentQuestions(features);
  if (Object.keys(questions).length === 0) return {};
  const startedAt = now();
  try {
    const result = await askJev({
      state: {
        agent_type: task.subagentType,
        task_description: truncate(task.description, 400),
        task_prompt: truncate(task.prompt, config.maxMessageChars),
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
export function planHint(plan: TurnPlan, toolHint: (tool: string) => string): string | undefined {
  const parts: string[] = [];
  if (plan.decision.mode === "hint") parts.push(toolHint(plan.decision.tool));
  if (plan.delegate && plan.delegate.value !== NO_DELEGATION) {
    parts.push(
      `It also suggests handing part of this request to the "${plan.delegate.value}" subagent (the Agent tool, ` +
        `subagent_type "${plan.delegate.value}"). Ignore this if doing the work directly is simpler.`,
    );
  }
  return parts.length ? parts.join(" ") : undefined;
}

/** One short line saying what Jev decided: the summary the live log and the band show. */
export function planSummary(plan: TurnPlan): string {
  const d = plan.decision;
  if (d.mode === "passthrough" && d.reason.startsWith("jev_error")) return `failed: ${d.reason.slice(11, 70)}`;
  const parts = [
    d.mode === "hint"
      ? `tool ${d.tool} (${d.confidence.toFixed(2)})`
      : d.reason === "jev_declined"
        ? `stayed out (participate ${plan.participate?.toFixed(2)})`
        : `no tool hint (${d.reason})`,
    plan.model ? `model ${plan.model.value}` : undefined,
    plan.effort ? `effort ${plan.effort.value}` : undefined,
    plan.effortIgnored ? `effort ${plan.effortIgnored.value} ignored (Haiku 4.5 does not support effort)` : undefined,
    plan.delegate && plan.delegate.value !== NO_DELEGATION ? `delegate → ${plan.delegate.value}` : undefined,
  ].filter(Boolean);
  return parts.join(" · ");
}
