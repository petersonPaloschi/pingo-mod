// The questions put to Jev: which tool fits next, and whether a tool is needed at all.
import type { Questions, RouterTool } from "./types.ts";

/** Choice label meaning "reply in text, call nothing". */
export const NO_TOOL = "no_tool_needed";
/** Choice label a shard uses to say "the right tool is not in this group". */
export const NONE_OF_THESE = "none_of_these";
/** Most tools one tool question may offer; bigger rosters are shortlisted first. */
export const MAX_TOOLS = 120;
export const SHORTLIST_PER_SHARD = 3;
const MAX_DESCRIPTION_CHARS = 1024;
/** Characters one tool question may spend on descriptions (~12k tokens). */
const QUESTION_CHAR_BUDGET = 48_000;

export const TOOL_KEY = "tool";
export const NEEDS_TOOL_KEY = "needs_tool";
export const shardKey = (index: number) => `shard:${index}`;

function toolCriteria(tools: RouterTool[]): Record<string, string | null> {
  const limit = Math.min(MAX_DESCRIPTION_CHARS, Math.floor(QUESTION_CHAR_BUDGET / tools.length));
  const criteria: Record<string, string | null> = {};
  for (const tool of tools) {
    const params = Object.keys(tool.parameters?.properties ?? {});
    // Descriptions lead with what the tool is for; the tail is usage detail Jev doesn't need.
    const description = tool.description?.trim().slice(0, limit);
    criteria[tool.name] = description || (params.length ? `Parameters: ${params.join(", ")}` : null);
  }
  return criteria;
}

/** First pass over a roster too big for one question: every shard is ranked in one Jev call. */
export function buildShortlistQuestions(tools: RouterTool[]): { questions: Questions; shards: RouterTool[][] } {
  const shardCount = Math.ceil(tools.length / MAX_TOOLS);
  const size = Math.ceil(tools.length / shardCount);
  const shards = Array.from({ length: shardCount }, (_, index) => tools.slice(index * size, (index + 1) * size));
  const questions: Questions = {};
  shards.forEach((shard, index) => {
    questions[shardKey(index)] = {
      type: "choice",
      instructions:
        "Given the conversation, which of these tools would best advance the user's latest request " +
        "if the assistant called it next?",
      criteria: { ...toolCriteria(shard), [NONE_OF_THESE]: "None of the tools in this list fits the next step." },
    };
  });
  return { questions, shards };
}

/** The tool question and the needs-a-tool check, asked together. */
export function buildQuestions(tools: RouterTool[]): Questions {
  const criteria = toolCriteria(tools);
  criteria[NO_TOOL] =
    "No tool call is needed right now: the assistant should reply to the user in plain text " +
    "(answer directly, ask a clarifying question, or report results that tools already returned).";
  return {
    [TOOL_KEY]: {
      type: "choice",
      instructions:
        "Given the conversation, what should the assistant do next? " +
        "Pick the single tool whose call best advances the user's latest request.",
      criteria,
    },
    [NEEDS_TOOL_KEY]: {
      type: "noul",
      instructions:
        "Does the assistant need to call one of its tools now, rather than reply to the user in plain text?",
    },
  };
}
