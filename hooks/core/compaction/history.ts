import { type ContextToolResult, type ContextMessage, type ContextToolCall, type ContextHistoryEntry } from "./types.ts";
import { truncateContextText, contextInputText, contextResultNote } from "./text.ts";

export function isContextPinned(
  index: number,
  total: number,
  preserveRecentMessages: number,
): boolean {
  return index === 0 || index >= total - preserveRecentMessages;
}

/**
 * Pairs every tool_use with its tool_result by `tool_use_id`. Calls without a
 * result are not candidates (there is nothing to drop yet).
 */
export function collectContextToolCalls(
  messages: readonly ContextMessage[],
  preserveRecentMessages: number,
): ContextToolCall[] {
  const results = new Map<string, { index: number; result: ContextToolResult }>();
  messages.forEach((message, index) => {
    for (const result of message.toolResults ?? []) {
      results.set(result.tool_use_id, { index, result });
    }
  });
  const calls: ContextToolCall[] = [];
  messages.forEach((message, callIndex) => {
    for (const tool of message.toolUses) {
      const found = results.get(tool.tool_use_id);
      if (!found) continue;
      calls.push({
        id: `t${calls.length + 1}`,
        tool_use_id: tool.tool_use_id,
        tool: tool.tool,
        input: tool.input,
        callIndex,
        resultIndex: found.index,
        resultChars: found.result.text.length,
        isError: found.result.isError ?? false,
        pinned:
          isContextPinned(callIndex, messages.length, preserveRecentMessages) ||
          isContextPinned(found.index, messages.length, preserveRecentMessages),
      });
    }
  });
  return calls;
}


/**
 * Folds runs of adjacent call-only entries into one entry each, so the
 * per-entry envelope is paid once per run; the call lines keep their ids.
 */
export function mergeContextCallRuns(history: readonly ContextHistoryEntry[], pinned: (e: ContextHistoryEntry) => boolean): ContextHistoryEntry[] {
  const merged: ContextHistoryEntry[] = [];
  for (const entry of history) {
    const previous = merged[merged.length - 1];
    const isFoldableContextEntry = (e: ContextHistoryEntry): boolean =>
      !pinned(e) && e.text.length === 0 && typeof e.tool_calls?.[0] === 'string';
    if (previous && isFoldableContextEntry(previous) && isFoldableContextEntry(entry) && previous.role === entry.role) {
      previous.tool_calls = [...(previous.tool_calls as string[]), ...(entry.tool_calls as string[])];
      continue;
    }
    merged.push({ ...entry });
  }
  return merged;
}

export function contextCallsByMessage(calls: readonly ContextToolCall[]): Map<number, ContextToolCall[]> {
  const byMessage = new Map<number, ContextToolCall[]>();
  for (const call of calls) {
    const list = byMessage.get(call.callIndex) ?? [];
    list.push(call);
    byMessage.set(call.callIndex, list);
  }
  return byMessage;
}

export function contextHistoryEntries(
  messages: readonly ContextMessage[],
  calls: readonly ContextToolCall[],
  inputChars: number,
): ContextHistoryEntry[] {
  const byMessage = contextCallsByMessage(calls);
  const entries: ContextHistoryEntry[] = [];
  messages.forEach((message, i) => {
    const toolCalls = (byMessage.get(i) ?? []).map((call) => ({
      id: call.id,
      tool: call.tool,
      input: contextInputText(call.input, inputChars),
      result: contextResultNote(call),
    }));
    if (message.text.trim().length === 0 && toolCalls.length === 0) return;
    const entry: ContextHistoryEntry = { i, role: message.role, text: message.text };
    if (toolCalls.length > 0) entry.tool_calls = toolCalls;
    entries.push(entry);
  });
  return entries;
}

/** The last three user prompts, as the default `goal`. */
export function contextGoalFromMessages(messages: readonly ContextMessage[]): string {
  return messages
    .filter(
      (message) =>
        message.role === 'user' &&
        message.text.trim().length > 0 &&
        (message.toolResults ?? []).length === 0,
    )
    .slice(-3)
    .map((message) => truncateContextText(message.text, 500))
    .join('\n');
}
