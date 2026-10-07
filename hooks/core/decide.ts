// Turns Jev's answers into a decision. Claude Code always runs with thinking and the prompt
// cache, so a request cannot be forced to a tool: the one way to steer it is a hint.
import {
  buildQuestions,
  buildShortlistQuestions,
  MAX_TOOLS,
  NEEDS_TOOL_KEY,
  NO_TOOL,
  NONE_OF_THESE,
  shardKey,
  SHORTLIST_PER_SHARD,
  TOOL_KEY,
} from "./questions.ts";
import { buildState, type Limits } from "./state.ts";
import { unusableAnswer } from "../errors.ts";
import type { Answer, Questions, RouterInput, RouterTool, SystemOneRequest, SystemOneResult } from "./types.ts";
import { text, type Locale } from "../i18n.ts";

/** The one Jev call the router makes; injectable so tests need no network. */
export type AskJev = (request: SystemOneRequest) => Promise<SystemOneResult>;

export interface DecideConfig extends Limits {
  jevModel: string;
  minConfidence: number;
  locale?: Locale;
  promptLocale?: Locale;
}

export interface JevTrace {
  choice: string;
  confidence: number;
  needsTool: number;
  topProbabilities: Record<string, number>;
  inputTokens: number;
  latencyMs: number;
  shortlist?: string[];
}

/** `answers`: every answer of the Jev call, for the questions other features added to it. */
export type Decision = { jev?: JevTrace; answers?: Record<string, Answer> } & (
  | { mode: "passthrough"; reason: string; /** What was observed behind a failure: shown in the log. */ detail?: string }
  /** Jev picked the tool; the LLM is told, not forced. */
  | { mode: "hint"; tool: string; confidence: number }
);

/** A tool name must stay one inert token: it is written into text the model reads as the host's. */
export const SAFE_TOOL_NAME = /^[\p{L}\p{N}_.:/-]{1,128}$/u;

/** A provider string stored in the event log and drawn in the terminal: no control sequences, capped. */
function inert(value: string): string {
  return String(value).replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 128);
}

/** Why a request is not Jev's to decide, or undefined when it is. */
export function skipReason(input: RouterInput): string | undefined {
  if (input.turns.length === 0) return "no_messages";
  if (input.tools.length === 0) return "no_tools";
  if (input.tools.length > MAX_TOOLS * 255) return "too_many_tools";
  if (input.tools.some((tool) => typeof tool.name !== "string" || !SAFE_TOOL_NAME.test(tool.name))) return "unsafe_tool_name";
  if (new Set(input.tools.map((tool) => tool.name)).size !== input.tools.length) return "duplicate_tool_names";
  if (input.tools.some((tool) => tool.name === NO_TOOL || tool.name === NONE_OF_THESE)) return "reserved_tool_name";
  return undefined;
}

async function shortlist(
  tools: RouterTool[],
  state: SystemOneRequest["state"],
  config: DecideConfig,
  askJev: AskJev,
): Promise<{ tools: RouterTool[]; inputTokens: number }> {
  const { questions, shards } = buildShortlistQuestions(tools, config.promptLocale ?? config.locale);
  const result = await askJev({ state, questions, model: config.jevModel });
  const ranked = shards.map((shard, index) => {
    const answer = result.answers[shardKey(index)];
    if (answer?.type !== "choice") return [];
    const names = new Set(shard.map((tool) => tool.name));
    const scores = new Map(Object.entries(answer.probabilities ?? {}).filter(([name]) => names.has(name)));
    // A typed caller may supply only a confident choice; never turn confidence into probability.
    if (!scores.size && names.has(answer.choice) && answer.confidence >= config.minConfidence) return [answer.choice];
    return [...scores]
      .sort(([, a], [, b]) => b - a)
      .slice(0, SHORTLIST_PER_SHARD)
      .map(([name]) => name);
  });
  // Probabilities are conditional on a shard, so compare ranks within it, never scores across shards.
  // ponytail: beyond MAX_TOOLS shards, roster order breaks ties; group routing if such rosters become common.
  const best = new Set<string>();
  for (let rank = 0; rank < SHORTLIST_PER_SHARD && best.size < MAX_TOOLS; rank++) {
    for (const names of ranked) {
      if (names[rank]) best.add(names[rank]!);
      if (best.size === MAX_TOOLS) break;
    }
  }
  return { tools: tools.filter((tool) => best.has(tool.name)), inputTokens: result.usage.input_tokens };
}

export async function decide(
  input: RouterInput,
  config: DecideConfig,
  askJev: AskJev,
  now: () => number = () => Date.now(),
  extra: Questions = {},
): Promise<Decision> {
  const skip = skipReason(input);
  if (skip) return { mode: "passthrough", reason: skip };

  const startedAt = now();
  const state = buildState(input, config);
  let tools = input.tools;
  let shortlistTokens = 0;
  let result: SystemOneResult;
  try {
    if (tools.length > MAX_TOOLS) {
      ({ tools, inputTokens: shortlistTokens } = await shortlist(tools, state, config, askJev));
      if (tools.length === 0) return { mode: "passthrough", reason: "jev_unexpected_answer", detail: "the tool shortlist came back empty" };
    }
    // Other features' questions ride in the same call: one Jev request per routing point.
    result = await askJev({ state, questions: { ...buildQuestions(tools, config.promptLocale ?? config.locale), ...extra }, model: config.jevModel });
  } catch (error) {
    // Fail open: a Jev outage must never stop the session.
    return { mode: "passthrough", reason: `jev_error: ${error instanceof Error ? error.message : String(error)}` };
  }

  const answers = result.answers;
  const picked = answers[TOOL_KEY];
  const needs = answers[NEEDS_TOOL_KEY];
  if (picked?.type !== "choice" || needs?.type !== "noul") {
    return {
      mode: "passthrough",
      reason: "jev_unexpected_answer",
      detail: unusableAnswer([TOOL_KEY, NEEDS_TOOL_KEY], Object.keys(answers), result.dropped),
      answers,
    };
  }
  const jev: JevTrace = {
    choice: inert(picked.choice),
    confidence: picked.confidence,
    needsTool: needs.noul,
    topProbabilities: Object.fromEntries(
      Object.entries(picked.probabilities ?? {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([name, probability]) => [inert(name), probability]),
    ),
    inputTokens: result.usage.input_tokens + shortlistTokens,
    latencyMs: Math.round(now() - startedAt),
    ...(tools === input.tools ? {} : { shortlist: tools.map((tool) => tool.name) }),
  };

  if (picked.confidence < config.minConfidence) return { mode: "passthrough", reason: "low_confidence", jev, answers };
  // Two independent questions must agree before the router says anything.
  const wantsTool = picked.choice !== NO_TOOL;
  if (wantsTool ? needs.noul < 0.3 : needs.noul > 0.7) {
    return { mode: "passthrough", reason: "jev_answers_disagree", jev, answers };
  }
  // A hint can suggest a tool; suggesting silence would only risk ending the turn early.
  if (!wantsTool) return { mode: "passthrough", reason: "no_tool_needed", jev, answers };

  const tool = tools.find((candidate) => candidate.name === picked.choice);
  if (!tool) return { mode: "passthrough", reason: "jev_unknown_tool", jev, answers };
  if (tool.kind === "hosted") return { mode: "passthrough", reason: "hosted_tool_selected", jev, answers };
  return { mode: "hint", tool: tool.name, confidence: picked.confidence, jev, answers };
}

/** The hint Claude reads; it leaves Claude free to ignore a pick that does not fit. */
export function hintText(tool: string, locale?: Locale): string {
  return text("routing.hint", locale, { tool });
}
