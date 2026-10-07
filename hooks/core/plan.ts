// What Jev decides beyond the next tool: whether to take part at all, which model and effort the
// turn runs on, whether to hand work to a subagent, whether to suggest consulting the advisor, and
// the model and effort of each subagent.
// Every question rides in the routing point's one Jev call; each answer counts only above the
// minimum confidence, otherwise Claude Code's own choice stands.
import { decide, failedDecision, SAFE_TOOL_NAME, skipReason, timed, type AskJev, type DecideConfig, type Decision, type JevTrace } from "./decide.ts";
import { errorMessage, isJevError, reasonCause } from "./reasons.ts";
import { buildState, truncate } from "./state.ts";
import type { Answer, ChoiceQuestion, Json, ModelContext, Questions, RouterInput } from "./types.ts";
import { formatDecimal, localeFor, reasonTitle, text, type Locale, type LocaleKey } from "../i18n.ts";

export type FeatureId = "tools" | "participation" | "model" | "effort" | "delegation" | "agents" | "advisor";
export type Features = Record<FeatureId, boolean>;

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

export type Tier = "haiku" | "sonnet" | "opus";
export const TIERS: readonly Tier[] = ["haiku", "sonnet", "opus"];
export const KEEP_MODEL = "keep_current_model";

export function modelTier(id: string | undefined): Tier | undefined {
  return id?.toLowerCase().match(/^(?:claude-)?(haiku|sonnet|opus)(?:-|$)/)?.[1] as Tier | undefined;
}
/** The ids a main-loop request is sent with; agents take the alias itself. */
export const TIER_MODEL: Record<Tier, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Whether a model accepts an effort level: the one rule the plan, the subagent start and every
 * request apply. Haiku does not, whatever form its id takes (an alias, a dated id, a provider's).
 */
export const supportsEffort = (model: string | undefined): boolean => !/haiku/i.test(model ?? "");

export const PARTICIPATE_KEY = "participate";
export const MODEL_KEY = "model";
export const EFFORT_KEY = "effort";
export const DELEGATE_KEY = "delegate";
export const NO_DELEGATION = "no_delegation";
export const ADVISOR_KEY = "advisor";
/** "consult" asks Claude to consult the advisor tool; Claude still decides whether it calls it. */
export const ADVISOR_CHOICES = ["none", "consult"] as const;
export type AdvisorChoice = (typeof ADVISOR_CHOICES)[number];

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
const ADVISOR_CRITERIA: Record<AdvisorChoice, LocaleKey> = {
  none: "planning.advisor.none",
  consult: "planning.advisor.consult",
};

const criteria = (keys: Record<string, LocaleKey>, locale?: Locale) =>
  Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, text(value, locale)]));

/** Every choice question has this one shape: the instructions in the prompt's language and its options. */
const choiceQuestion = (instructions: LocaleKey, options: Record<string, Json>, locale?: Locale): ChoiceQuestion => ({
  type: "choice",
  instructions: text(instructions, locale),
  criteria: options,
});

function modelCriteria(session: ModelContext, locale?: Locale): Record<string, Json> {
  const options: Record<string, Json> = {};
  for (const id of session.availableModels ?? TIERS) {
    const tier = modelTier(id);
    if (!tier || !SAFE_TOOL_NAME.test(id)) continue;
    options[id] = {
      model: id,
      what: text(MODEL_CRITERIA[tier], locale),
      not_for: text(`planning.model.${tier}.notFor` as LocaleKey, locale),
    };
  }
  if (session.currentModel) options[KEEP_MODEL] = text("planning.model.keep", locale);
  return options;
}

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
export function turnQuestions(features: Features, agents: readonly AgentType[], locale?: Locale, session: ModelContext = {}): Questions {
  const questions: Questions = {};
  if (features.participation) {
    questions[PARTICIPATE_KEY] = {
      type: "noul",
      instructions: text("planning.participation.question", locale),
    };
  }
  const models = features.model ? modelCriteria(session, locale) : {};
  if (Object.keys(models).length > 0) questions[MODEL_KEY] = choiceQuestion("planning.model.question", models, locale);
  if (features.effort) questions[EFFORT_KEY] = choiceQuestion("planning.effort.question", criteria(EFFORT_CRITERIA, locale), locale);
  const offered = offeredAgents(agents);
  if (features.delegation && offered.length > 0) {
    const options: Record<string, string | null> = {};
    for (const agent of offered) options[agent.name] = truncate(agent.description, 400, locale) || null;
    options[NO_DELEGATION] = text("planning.delegation.none", locale);
    questions[DELEGATE_KEY] = choiceQuestion("planning.delegation.question", options, locale);
  }
  if (features.advisor) {
    questions[ADVISOR_KEY] = choiceQuestion("planning.advisor.question", criteria(ADVISOR_CRITERIA, locale), locale);
  }
  return questions;
}

/** The questions for one subagent about to start: its model and its effort. */
export function agentQuestions(features: Features, locale?: Locale, session: ModelContext = {}): Questions {
  if (!features.agents) return {};
  const models = modelCriteria(session, locale);
  return {
    ...(Object.keys(models).length ? { [MODEL_KEY]: choiceQuestion("planning.agent.model.question", models, locale) } : {}),
    [EFFORT_KEY]: choiceQuestion("planning.agent.effort.question", criteria(EFFORT_CRITERIA, locale), locale),
  };
}

export interface Chosen<T> {
  value: T;
  confidence: number;
}

export type ModelReason = "keep_current" | "low_confidence" | "downgrade_confidence" | "cache_confidence" | "unavailable";
export type ModelPick = Chosen<Tier> & { id?: string };

/**
 * The confidence Jev needs to move the model to `tier`: the minimum, raised for a downgrade, and
 * again when it would disturb a warm cache. `reason` is what holds the switch back below it.
 */
export function modelThreshold(tier: Tier, minConfidence: number, session: ModelContext = {}): { needed: number; reason: ModelReason } {
  let needed = minConfidence;
  let reason: ModelReason = "low_confidence";
  const currentTier = modelTier(session.currentModel);
  if (currentTier && TIERS.indexOf(tier) < TIERS.indexOf(currentTier)) {
    // Halve the tolerated uncertainty for a downgrade, then again when it would disturb warm cache.
    needed += (1 - needed) / 2;
    reason = "downgrade_confidence";
    if ((session.cacheReadTokens ?? 0) > 0) {
      needed += (1 - needed) / 2;
      reason = "cache_confidence";
    }
  }
  return { needed, reason };
}

/** Keep Jev's answer intact; policy decides whether its model change is worth accepting. */
export interface ModelSelection {
  model?: ModelPick;
  retainedModel?: string;
  modelReason?: ModelReason;
  /** What Jev answered, accepted or not: the Models tab shows a held-back pick with its confidence. */
  modelAsked?: Chosen<string>;
}

export function selectModel(answer: Answer | undefined, minConfidence: number, session: ModelContext = {}): ModelSelection {
  const asked = answer?.type === "choice" ? { modelAsked: { value: answer.choice, confidence: answer.confidence } } : {};
  const keep = (modelReason: ModelReason) => ({ modelReason, ...(session.currentModel ? { retainedModel: session.currentModel } : {}), ...asked });
  if (answer?.type !== "choice") return keep("unavailable");
  if (answer.choice === KEEP_MODEL && session.currentModel) return keep("keep_current");
  const tier = modelTier(answer.choice);
  if (!tier || !(session.availableModels ?? TIERS).includes(answer.choice)) return keep("unavailable");
  const { needed, reason } = modelThreshold(tier, minConfidence, session);
  if (answer.confidence < needed) return keep(reason);
  return { model: { value: tier, confidence: answer.confidence, ...(answer.choice !== tier ? { id: answer.choice } : {}) }, ...asked };
}

/** One choice answer, read against the options it offered and the minimum confidence. */
export interface ChoiceRead<T> {
  /** Usable: one of the options, confident enough. */
  chosen?: Chosen<T>;
  /** One of the options, below the minimum: no effect, but shown with what it lacked. */
  held?: Chosen<T>;
}

/**
 * The one way an answer to a choice question is read. `binding` says which options must clear
 * the minimum; the others count at any confidence, since acting on them changes nothing.
 */
export function readChoice<T extends string>(
  answer: Answer | undefined,
  allowed: readonly T[],
  min: number,
  binding: (value: T) => boolean = () => true,
): ChoiceRead<T> {
  if (answer?.type !== "choice" || !allowed.includes(answer.choice as T)) return {};
  const read = { value: answer.choice as T, confidence: answer.confidence };
  return read.confidence < min && binding(read.value) ? { held: read } : { chosen: read };
}

/** Everything one routing point decided. */
export interface TurnPlan extends ModelSelection {
  decision: Decision;
  /** Jev's yes/no on taking part; absent when that feature is off. */
  participate?: number;
  /** The effort Jev chose for the turn; turn.step applies it to every request whose model accepts it. */
  effort?: Chosen<Effort>;
  /** Jev answered, but the model the turn is planned on does not accept effort: shown, not applied. */
  effortIgnored?: Chosen<Effort>;
  effortHeld?: Chosen<Effort>;
  delegate?: Chosen<string>;
  delegateHeld?: Chosen<string>;
  /** Jev's usable answer on the advisor: "consult" attaches the hint, "none" does not. */
  advisor?: Chosen<AdvisorChoice>;
  /** A "consult" below the minimum confidence: no hint. */
  advisorHeld?: Chosen<AdvisorChoice>;
  /** Why the advisor answer was not used, when it was not. */
  advisorWhy?: AdvisorWhy;
  jev?: JevTrace;
}

/** Why no advisor answer counts: Jev stayed out, the participation answer is missing, no usable answer, or too unsure. */
export type AdvisorWhy = "jev_declined" | "participation_unavailable" | "unavailable" | "low_confidence";

/** The advisor answer on its own: a malformed answer to another question does not void it. */
function readAdvisor(answer: Answer | undefined, min: number): Pick<TurnPlan, "advisor" | "advisorHeld" | "advisorWhy"> {
  const { chosen, held } = readChoice(answer, ADVISOR_CHOICES, min, (value) => value === "consult");
  if (chosen) return { advisor: chosen };
  return held ? { advisorHeld: held, advisorWhy: "low_confidence" } : { advisorWhy: "unavailable" };
}

/** An effort answer split by whether the model it would run on accepts it. */
function splitEffort(read: ChoiceRead<Effort>, model: string | undefined): { effort?: Chosen<Effort>; effortIgnored?: Chosen<Effort>; effortHeld?: Chosen<Effort> } {
  return {
    ...(read.chosen ? (supportsEffort(model) ? { effort: read.chosen } : { effortIgnored: read.chosen }) : {}),
    ...(read.held ? { effortHeld: read.held } : {}),
  };
}

/** The model id a pick is sent with: the exact version Jev chose, or the tier's id. */
export const pickedModelId = (pick: ModelPick): string => pick.id ?? TIER_MODEL[pick.value];

/** The model the plan runs the turn on: Jev's pick, else the one it kept. */
export const plannedModel = (plan: ModelSelection, session: ModelContext = {}): string | undefined =>
  plan.model ? pickedModelId(plan.model) : plan.retainedModel ?? session.currentModel;

/** The subagent the plan hands work to, if any: "no_delegation" is a confident no. */
export const delegatedAgent = (plan: TurnPlan): string | undefined =>
  plan.delegate && plan.delegate.value !== NO_DELEGATION ? plan.delegate.value : undefined;

/** The plan asks Claude to consult the advisor. */
export const consultsAdvisor = (plan: TurnPlan): boolean => plan.advisor?.value === "consult";

/** One routing point: the tool decision plus the extra questions, in one Jev call. */
export async function planTurn(
  input: RouterInput,
  config: DecideConfig,
  askJev: AskJev,
  features: Features,
  agents: readonly AgentType[],
  now: () => number = () => Date.now(),
): Promise<TurnPlan> {
  const extra = turnQuestions(features, agents, config.promptLocale ?? config.locale, input.session);
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
  return readTurnPlan(decision, features, agents, config.minConfidence, input.session);
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
  const call = await timed(() => askJev({ state: buildState(input, config), questions, model: config.jevModel }), now);
  if ("error" in call) return failedDecision(call.error);
  return {
    mode: "passthrough",
    reason,
    answers: call.value.answers,
    jev: { choice: "–", confidence: 0, needsTool: 0, topProbabilities: {}, inputTokens: call.value.usage.input_tokens, latencyMs: call.latencyMs },
  };
}

export function readTurnPlan(decision: Decision, features: Features, agents: readonly AgentType[], minConfidence: number, session: ModelContext = {}): TurnPlan {
  const answers = decision.answers;
  const participateAnswer = answers?.[PARTICIPATE_KEY];
  const participate = features.participation && participateAnswer?.type === "noul" ? participateAnswer.noul : undefined;
  const selection = features.model ? selectModel(answers?.[MODEL_KEY], minConfidence, session) : {};
  const effort = features.effort ? splitEffort(readChoice(answers?.[EFFORT_KEY], EFFORTS, minConfidence), plannedModel(selection, session)) : {};
  const sizing = { ...selection, ...effort, ...(decision.jev ? { jev: decision.jev } : {}) };
  // Jev chose to stay out: no hint and no delegation. The model and effort still apply, since a
  // trivial request is exactly the one a smaller model and less effort fit.
  if (participate !== undefined && participate < 0.5) {
    return {
      decision: { mode: "passthrough", reason: "jev_declined", ...(decision.jev ? { jev: decision.jev } : {}) },
      participate,
      ...sizing,
      ...(features.advisor ? { advisorWhy: "jev_declined" as const } : {}),
    };
  }
  // With participation on, its answer gates the advisor hint: no answer, no hint.
  const advisor = !features.advisor
    ? {}
    : features.participation && participate === undefined
      ? { advisorWhy: "participation_unavailable" as const }
      : readAdvisor(answers?.[ADVISOR_KEY], minConfidence);
  // Only a name the question offered is taken; "no_delegation" is a confident no.
  const offered = [...offeredAgents(agents).map((agent) => agent.name), NO_DELEGATION];
  const delegated = features.delegation ? readChoice(answers?.[DELEGATE_KEY], offered, minConfidence) : {};
  return {
    decision,
    ...(participate !== undefined ? { participate } : {}),
    ...sizing,
    ...(delegated.chosen ? { delegate: delegated.chosen } : {}),
    ...(delegated.held ? { delegateHeld: delegated.held } : {}),
    ...advisor,
  };
}

/** What one subagent runs with. */
export interface AgentPlan {
  model?: Chosen<Tier>;
  /** The effort Jev chose; applied to each of the subagent's requests whose model accepts it. */
  effort?: Chosen<Effort>;
  /** Jev answered, but the planned model does not accept effort. */
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
  session: ModelContext = {},
): Promise<AgentPlan> {
  // The native Agent hook accepts tier aliases; keep its inherited model when no choice is accepted.
  const agentSession: ModelContext = session.availableModels ? {
    availableModels: [...new Set(session.availableModels.map(modelTier).filter((tier): tier is Tier => tier !== undefined))],
  } : {};
  const questions = agentQuestions(features, config.promptLocale ?? config.locale, agentSession);
  if (Object.keys(questions).length === 0) return {};
  const call = await timed(() => askJev({
    state: {
      agent_type: task.subagentType,
      task_description: truncate(task.description, 400, config.locale),
      task_prompt: truncate(task.prompt, config.maxMessageChars, config.locale),
      ...(session.availableModels ? { available_models: [...session.availableModels] } : {}),
    },
    questions,
    model: config.jevModel,
  }), now);
  if ("error" in call) return { error: errorMessage(call.error) };
  const { model } = selectModel(call.value.answers[MODEL_KEY], config.minConfidence, agentSession);
  const { effort, effortIgnored } = splitEffort(readChoice(call.value.answers[EFFORT_KEY], EFFORTS, config.minConfidence), model?.value);
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(effortIgnored ? { effortIgnored } : {}),
    latencyMs: call.latencyMs,
  };
}

/** The effort Jev asked for, whether or not the planned model accepts it: the request decides. */
export const requestedEffort = (plan: { effort?: Chosen<Effort>; effortIgnored?: Chosen<Effort> }): Effort | undefined =>
  (plan.effort ?? plan.effortIgnored)?.value;

/** The context Claude reads for a turn: the tool hint, the delegation hint and the advisor hint, in one note. */
export function planHint(plan: TurnPlan, toolHint: (tool: string, locale?: Locale) => string, locale?: Locale): string | undefined {
  const parts: string[] = [];
  if (plan.decision.mode === "hint") parts.push(toolHint(plan.decision.tool, locale));
  const agent = delegatedAgent(plan);
  if (agent) parts.push(text("planning.hint.delegate", locale, { agent }));
  if (consultsAdvisor(plan)) parts.push(text("planning.hint.advisor", locale));
  return parts.length ? parts.join(text("planning.hint.separator", locale)) : undefined;
}

/** One short line saying what Jev decided: the summary the live log and the band show. */
export function planSummary(plan: TurnPlan, locale?: Locale): string {
  const d = plan.decision;
  if (d.mode === "passthrough" && isJevError(d.reason)) {
    return text("planning.summary.failed", locale, { message: (reasonCause(d.reason) ?? "").slice(0, 59) });
  }
  const parts = [
    d.mode === "hint"
      ? text("planning.summary.tool", locale, { tool: d.tool, confidence: formatDecimal(d.confidence, localeFor(locale), 2) })
      : d.reason === "jev_declined"
        ? text("planning.summary.declined", locale, { confidence: formatDecimal(plan.participate ?? 0, localeFor(locale), 2) })
        : text("planning.summary.noTool", locale, { reason: reasonTitle(d.reason, locale) }),
    plan.model ? text("planning.summary.model", locale, { model: plan.model.value }) : undefined,
    plan.modelReason ? text("planning.summary.modelKept", locale, { reason: text(`planning.modelReason.${plan.modelReason}` as LocaleKey, locale) }) : undefined,
    plan.effort ? text("planning.summary.effort", locale, { effort: plan.effort.value }) : undefined,
    plan.effortIgnored ? text("planning.summary.effortIgnored", locale, { effort: plan.effortIgnored.value }) : undefined,
    delegatedAgent(plan) ? text("planning.summary.delegate", locale, { agent: delegatedAgent(plan)! }) : undefined,
    consultsAdvisor(plan) ? text("planning.summary.advisor", locale) : undefined,
  ].filter(Boolean);
  return parts.join(text("planning.summary.separator", locale));
}
