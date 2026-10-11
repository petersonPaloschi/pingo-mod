import { type ContextToolUse, type ContextToolResult, type ContextMessage, type ContextSessionMessage, type ContextToolCall, type ContextCallAnswer, type ContextOptions, type ContextResult, type ContextJevAsker } from "./types.ts";
import { resolveContextOptions, batchContextCalls, decideContextCall, askContextBatch, CONTEXT_PARALLEL_REQUESTS, inTurns } from "./options.ts";
import { collectContextToolCalls } from "./history.ts";
import { fitContextState } from "./fit.ts";
import { applyContextDecisions, contextMessageChars, contextCount } from "./decisions.ts";


/**
 * Compacts a transcript by asking Jev, for every tool call outside the pinned
 * first and newest messages, whether the call and whether its result must
 * stay. The whole history (results omitted, fitted into `maxStateTokens`) is
 * sent as state with every batch of questions, a few batches at a time. A
 * missing or malformed answer keeps its call. Throws when a Jev request fails
 * or the history cannot be fitted; the caller decides whether to fall back.
 */
export async function compactContext(
  messages: readonly ContextMessage[],
  asker: ContextJevAsker,
  options: ContextOptions = {},
): Promise<ContextResult> {
  const started = Date.now();
  const resolved = resolveContextOptions(options);
  const calls = collectContextToolCalls(messages, resolved.preserveRecentMessages);
  const candidates = calls.filter((call) => !call.pinned);
  const charsBefore = messages.reduce((sum, message) => sum + contextMessageChars(message), 0);

  let fitted: { tokens: number; stage: string } = { tokens: 0, stage: '' };
  let batches: ContextToolCall[][] = [];
  const answers = new Map<string, ContextCallAnswer>();
  if (candidates.length > 0) {
    const state = fitContextState(messages, calls, resolved);
    fitted = state;
    batches = batchContextCalls(candidates, state.tokens, resolved);
    const answered = await inTurns(batches, CONTEXT_PARALLEL_REQUESTS, (batch) => askContextBatch(asker, state.state, batch));
    for (const map of answered) for (const [id, answer] of map) answers.set(id, answer);
  }

  const decisions = calls.map((call) =>
    decideContextCall(call, answers.get(call.id) ?? { keepCall: 1, keepResult: 1 }, resolved),
  );
  const kept = applyContextDecisions(
    messages,
    decisions,
    calls,
    resolved.truncateHeadChars,
  );
  return {
    messages: kept,
    decisions,
    stats: {
      messagesBefore: messages.length,
      messagesAfter: kept.length,
      charsBefore,
      charsAfter: kept.reduce((sum, message) => sum + contextMessageChars(message), 0),
      calls: calls.length,
      kept: contextCount(decisions, 'kept'),
      resultsDropped: contextCount(decisions, 'result_dropped'),
      callsDropped: contextCount(decisions, 'call_dropped'),
      pinned: contextCount(decisions, 'pinned'),
      stateTokens: fitted.tokens,
      stateStage: fitted.stage,
      requests: batches.length,
      ms: Date.now() - started,
    },
  };
}

export function restoreContextMessages(
  input: readonly ContextSessionMessage[],
  output: readonly ContextMessage[],
): ContextSessionMessage[] {
  const messages = new Map<ContextMessage, ContextSessionMessage>();
  const uses = new Map<ContextToolUse, ContextToolUse>();
  const results = new Map<ContextToolResult, ContextToolResult>();
  for (const message of input) {
    messages.set(message, message);
    for (const tool of message.toolUses) uses.set(tool, tool);
    for (const result of message.toolResults ?? []) results.set(result, result);
  }
  return output.map((message) => {
    const own = messages.get(message);
    if (own) return own;
    const rebuilt: ContextSessionMessage = {
      role: message.role,
      text: message.text,
      toolUses: message.toolUses.map((tool) => uses.get(tool) ?? tool),
    };
    if (message.toolResults && message.toolResults.length > 0) {
      rebuilt.toolResults = message.toolResults.map((result) => results.get(result) ?? result);
    }
    return rebuilt;
  });
}

export async function compactContextSession(
  messages: readonly ContextSessionMessage[],
  asker: ContextJevAsker,
  options: ContextOptions = {},
): Promise<{ result: ContextResult; messages: ContextSessionMessage[] }> {
  const result = await compactContext(messages, asker, options);
  return { result, messages: restoreContextMessages(messages, result.messages) };
}
