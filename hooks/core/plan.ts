// What Jev decides beyond the next tool: whether to take part at all, which model and effort the
// turn runs on, whether to hand work to a subagent, whether to suggest consulting the advisor, and
// the model and effort of each subagent.
// Every question rides in the routing point's one Jev call; each answer counts only above the
// minimum confidence, otherwise Claude Code's own choice stands.
import { decide, SAFE_TOOL_NAME, skipReason, type AskJev, type DecideConfig, type Decision } from "./decide.ts";
import { reasonCode } from "../errors.ts";
import { buildState, truncate } from "./state.ts";
import { askTimed } from "./request.ts";
import { readChoice } from "./selection.ts";
import type { Answer, Json, ModelContext, Questions, RouterInput } from "./types.ts";
import { formatDecimal, localeFor, reasonTitle, text, type Locale, type LocaleKey } from "../i18n.ts";
import { DEFAULT_FEATURES } from "./contracts.ts";
import type {
  AdvisorChoice,
  AgentPlan,
  Chosen,
  Effort,
  Features,
  HeldChoice,
  HeldModelPick,
  ModelPick,
  ModelReason,
  Tier,
  TurnPlan,
} from "./contracts.ts";

export { DEFAULT_FEATURES, FEATURE_IDS } from "./contracts.ts";
export { readChoice } from "./selection.ts";
export type {
  AdvisorChoice,
  AdvisorWhy,
  AgentPlan,
  ChoiceRead,
  ChoiceReason,
  Chosen,
  DelegateWhy,
  Effort,
  FeatureId,
  Features,
  HeldChoice,
  HeldModelPick,
  ModelPick,
  ModelReason,
  Tier,
  TurnPlan,
} from "./contracts.ts";

export const TIERS: readonly Tier[] = ["haiku", "sonnet", "opus"];
export const KEEP_MODEL = "keep_current_model";

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
  const model = parseModelId(modelId);
  if (!model) return false;
  if (model.alias) return model.tier !== "haiku";
  const major = model.major ?? 0;
  const minor = model.minor ?? 0;
  if (model.tier === "haiku") return major > 5 || (major === 5 && minor >= 5);
  return model.tier === "opus" ? major > 4 || (major === 4 && minor >= 5) : major > 4 || (major === 4 && minor >= 6);
}
/** The ids a main-loop request is sent with; agents take the alias itself. */
export const TIER_MODEL: Record<Tier, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export const PARTICIPATE_KEY = "participate";
export const MODEL_KEY = "model";
export const EFFORT_KEY = "effort";
export const DELEGATE_KEY = "delegate";
export const NO_DELEGATION = "no_delegation";
export const ADVISOR_KEY = "advisor";
/** "consult" asks Claude to consult the advisor tool; Claude still decides whether it calls it. */
export const ADVISOR_CHOICES = ["none", "consult"] as const;

export function participationState(score: number): "in" | "out" {
  return score < 0.5 ? "out" : "in";
}

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
  if (features.model && Object.keys(models).length > 0) {
    questions[MODEL_KEY] = {
      type: "choice",
      instructions: text("planning.model.question", locale),
      criteria: models,
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
  if (features.advisor && session.advisorAvailable !== false) {
    questions[ADVISOR_KEY] = {
      type: "choice",
      instructions: text("planning.advisor.question", locale),
      criteria: { none: text("planning.advisor.none", locale), consult: text("planning.advisor.consult", locale) },
    };
  }
  return questions;
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
export function selectModel(answer: Answer | undefined, minConfidence: number, session: ModelContext = {}): {
  model?: ModelPick; modelHeld?: HeldModelPick; retainedModel?: string; modelReason?: ModelReason;
} {
  const keep = (modelReason: ModelReason) => ({ modelReason, ...(session.currentModel ? { retainedModel: session.currentModel } : {}) });
  if (answer?.type === "choice" && answer.choice === KEEP_MODEL && session.currentModel) return keep("keep_current");
  const offered = (session.availableModels ?? TIERS).filter((id) => modelTier(id) && SAFE_TOOL_NAME.test(id));
  const read = readChoice(answer, offered, minConfidence);
  const candidate = read.chosen ?? read.held;
  if (!candidate) return keep("unavailable");
  const id = candidate.value;
  const tier = modelTier(id);
  if (!tier) return keep("unavailable");
  const { needed, reason } = modelThreshold(tier, minConfidence, session);
  const pick: HeldModelPick = { value: tier, confidence: candidate.confidence, needed, ...(id !== tier ? { id } : {}) };
  if (candidate.confidence < needed) return { ...keep(reason), modelHeld: pick };
  return { model: pick };
}

/** The advisor answer on its own: a malformed answer to another question does not void it. */
function readAdvisor(answer: Answer | undefined, min: number): Pick<TurnPlan, "advisor" | "advisorHeld" | "advisorWhy"> {
  const read = readChoice(answer, ADVISOR_CHOICES, min);
  return read.chosen
    ? { advisor: read.chosen }
    : read.held
      ? { advisorHeld: read.held, advisorWhy: "low_confidence" }
      : { advisorWhy: "unavailable" };
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
  try {
    const asked = await askTimed({ state: buildState(input, config), questions, model: config.jevModel }, askJev, now);
    if ("failure" in asked) return { mode: "passthrough", reason: asked.failure };
    return {
      mode: "passthrough",
      reason,
      answers: asked.result.answers,
      jev: { inputTokens: asked.result.usage.input_tokens, latencyMs: asked.latencyMs },
    };
  } catch (error) {
    return { mode: "passthrough", reason: `jev_error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function readTurnPlan(decision: Decision, features: Features, agents: readonly AgentType[], minConfidence: number, session: ModelContext = {}): TurnPlan {
  const answers = decision.answers;
  const participateAnswer = answers?.[PARTICIPATE_KEY];
  const participate = features.participation && participateAnswer?.type === "noul"
    && Number.isFinite(participateAnswer.noul) && participateAnswer.noul >= 0 && participateAnswer.noul <= 1
    ? participateAnswer.noul
    : undefined;
  const jevFailed = decision.mode === "passthrough" && reasonCode(decision.reason) === "jev_error";
  const selection = features.model && !jevFailed ? selectModel(answers?.[MODEL_KEY], minConfidence, session) : {};
  const effortRead = features.effort && !jevFailed ? readChoice(answers?.[EFFORT_KEY], EFFORTS, minConfidence) : undefined;
  const sizing = {
    ...selection,
    ...(effortRead?.chosen ? { effort: effortRead.chosen } : {}),
    ...(effortRead?.held ? { effortHeld: effortRead.held } : {}),
    ...(effortRead?.reason ? { effortWhy: effortRead.reason } : {}),
    ...(decision.jev ? { jev: decision.jev } : {}),
  };
  if (jevFailed) {
    return {
      decision,
      ...(participate !== undefined ? { participate } : {}),
      ...sizing,
      ...(features.delegation ? { delegateWhy: "unavailable" as const } : {}),
      ...(features.advisor ? { advisorWhy: session.advisorAvailable === false ? "advisor_unavailable" as const : "unavailable" as const } : {}),
    };
  }
  const passthrough = (reason: string): Decision => ({
    mode: "passthrough",
    reason,
    ...(answers ? { answers } : {}),
    ...(decision.jev ? { jev: decision.jev } : {}),
  });
  // Jev chose to stay out: no hint and no delegation. The model and effort still apply, since a
  // trivial request is exactly the one a smaller model and less effort fit.
  if (participate !== undefined && participationState(participate) === "out") {
    return {
      decision: passthrough("jev_declined"),
      participate,
      ...sizing,
      ...(features.delegation ? { delegateWhy: "jev_declined" as const } : {}),
      ...(features.advisor ? { advisorWhy: "jev_declined" as const } : {}),
    };
  }
  const participationUnavailable = features.participation && participate === undefined;
  if (participationUnavailable) {
    return {
      decision: decision.mode === "passthrough" ? decision : passthrough("participation_unavailable"),
      ...sizing,
      ...(features.delegation ? { delegateWhy: "participation_unavailable" as const } : {}),
      ...(features.advisor ? { advisorWhy: "participation_unavailable" as const } : {}),
    };
  }
  // Availability and participation gate the advisor before its answer is considered.
  const advisor = !features.advisor
    ? {}
    : session.advisorAvailable === false
      ? { advisorWhy: "advisor_unavailable" as const }
      : readAdvisor(answers?.[ADVISOR_KEY], minConfidence);
  const offeredAgentsForTurn = offeredAgents(agents);
  const delegateRead = features.delegation && offeredAgentsForTurn.length > 0
    ? readChoice(answers?.[DELEGATE_KEY], [...offeredAgentsForTurn.map((agent) => agent.name), NO_DELEGATION], minConfidence)
    : undefined;
  return {
    decision,
    ...(participate !== undefined ? { participate } : {}),
    ...sizing,
    ...(delegateRead?.chosen ? { delegate: delegateRead.chosen } : {}),
    ...(delegateRead?.held ? { delegateHeld: delegateRead.held } : {}),
    ...(features.delegation && offeredAgentsForTurn.length === 0 ? { delegateWhy: "no_agents" as const }
      : delegateRead?.reason ? { delegateWhy: delegateRead.reason } : {}),
    ...advisor,
  };
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
    const selection = selectModel(asked.result.answers[MODEL_KEY], config.minConfidence, agentSession);
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

/** The context Claude reads for a turn: the tool hint, the delegation hint and the advisor hint, in one note. */
export function planHint(plan: TurnPlan, toolHint: (tool: string, locale?: Locale) => string, locale?: Locale): string | undefined {
  const parts: string[] = [];
  if (plan.decision.mode === "hint") parts.push(toolHint(plan.decision.tool, locale));
  if (plan.delegate && plan.delegate.value !== NO_DELEGATION) {
    parts.push(text("planning.hint.delegate", locale, { agent: plan.delegate.value }));
  }
  if (plan.advisor?.value === "consult") parts.push(text("planning.hint.advisor", locale));
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
    plan.modelReason ? text("planning.summary.modelKept", locale, { reason: text(`planning.modelReason.${plan.modelReason}` as LocaleKey, locale) }) : undefined,
    plan.effort ? text("planning.summary.effort", locale, { effort: plan.effort.value }) : undefined,
    plan.delegate && plan.delegate.value !== NO_DELEGATION ? text("planning.summary.delegate", locale, { agent: plan.delegate.value }) : undefined,
    plan.advisor?.value === "consult" ? text("planning.summary.advisor", locale) : undefined,
  ].filter(Boolean);
  return parts.join(text("planning.summary.separator", locale));
}
