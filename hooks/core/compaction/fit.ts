import { type ContextMessage, type ContextToolCall, type ContextHistoryEntry, type ContextState, type ContextFittedState, type ResolvedContextOptions } from "./types.ts";
import { CONTEXT_STATE_DESCRIPTION, CONTEXT_INPUT_CHARS, CONTEXT_TEXT_HEAD, CONTEXT_TEXT_TAIL, estimateContextTokens, abridgeContextText, compactContextCall } from "./text.ts";
import { isContextPinned, mergeContextCallRuns, contextCallsByMessage, contextHistoryEntries, contextGoalFromMessages } from "./history.ts";


/**
 * Builds the Jev state from the whole conversation and shrinks it in stages
 * until it fits `maxStateTokens`: tool inputs are truncated, then long texts
 * are abridged oldest-first (pinned messages last), then old messages collapse
 * to a one-line note, then old tool calls shrink to one line each, then old
 * messages that carry no call are left out, then runs of old call-only
 * messages are folded into one entry. Throws when even that is too big.
 */
export function fitContextState(
  messages: readonly ContextMessage[],
  calls: readonly ContextToolCall[],
  options: Pick<ResolvedContextOptions, 'maxStateTokens' | 'preserveRecentMessages' | 'goal'>,
): ContextFittedState {
  const goal = options.goal || contextGoalFromMessages(messages);
  const contextStateOf = (history: ContextHistoryEntry[]): ContextState => ({
    context: CONTEXT_STATE_DESCRIPTION,
    goal,
    history,
  });
  const contextEntryTokens = (entry: ContextHistoryEntry): number => estimateContextTokens(JSON.stringify(entry)) + 1;
  const baseTokens = estimateContextTokens(JSON.stringify(contextStateOf([])));
  const contextFittedState = (history: ContextHistoryEntry[], tokens: number, stage: string): ContextFittedState => ({
    state: contextStateOf(history),
    tokens,
    stage,
  });

  let history: ContextHistoryEntry[] = [];
  let perEntry: number[] = [];
  let tokens = 0;
  const rebuildContextHistory = (inputChars: number): void => {
    history = contextHistoryEntries(messages, calls, inputChars);
    perEntry = history.map(contextEntryTokens);
    tokens = baseTokens + perEntry.reduce((sum, n) => sum + n, 0);
  };
  const contextFits = (): boolean => tokens <= options.maxStateTokens;
  const shrinkContextHistory = (index: number, change: (entry: ContextHistoryEntry) => void): void => {
    const entry = history[index];
    if (!entry) return;
    change(entry);
    const now = contextEntryTokens(entry);
    tokens += now - (perEntry[index] ?? 0);
    perEntry[index] = now;
  };

  rebuildContextHistory(CONTEXT_INPUT_CHARS[0]);
  if (contextFits()) return contextFittedState(history, tokens, 'full');

  for (const limit of CONTEXT_INPUT_CHARS.slice(1)) {
    rebuildContextHistory(limit);
    if (contextFits()) return contextFittedState(history, tokens, `inputs<=${limit}`);
  }

  const contextPinned = (entry: ContextHistoryEntry): boolean =>
    isContextPinned(entry.i, messages.length, options.preserveRecentMessages);
  const indices = history.map((_, index) => index);
  const order = [
    ...indices.filter((index) => !contextPinned(history[index]!)),
    ...indices.filter((index) => contextPinned(history[index]!)),
  ];

  for (const index of order) {
    const entry = history[index]!;
    if (entry.text.length <= CONTEXT_TEXT_HEAD + CONTEXT_TEXT_TAIL + 40) continue;
    shrinkContextHistory(index, (e) => {
      e.text = abridgeContextText(e.text, CONTEXT_TEXT_HEAD, CONTEXT_TEXT_TAIL);
    });
    if (contextFits()) return contextFittedState(history, tokens, 'texts abridged');
  }

  for (const index of order) {
    const entry = history[index]!;
    if (contextPinned(entry) || entry.text.length === 0) continue;
    const original = messages[entry.i]?.text.length ?? entry.text.length;
    shrinkContextHistory(index, (e) => {
      e.text = `[… ${original} chars omitted …]`;
    });
    if (contextFits()) return contextFittedState(history, tokens, 'old messages collapsed');
  }

  const byMessage = contextCallsByMessage(calls);
  for (const index of order) {
    const entry = history[index]!;
    const own = byMessage.get(entry.i);
    if (contextPinned(entry) || !own) continue;
    shrinkContextHistory(index, (e) => {
      e.tool_calls = own.map(compactContextCall);
    });
    if (contextFits()) return contextFittedState(history, tokens, 'old calls compacted');
  }

  const left = new Set<number>();
  for (const index of order) {
    const entry = history[index]!;
    if (contextPinned(entry) || entry.tool_calls) continue;
    left.add(index);
    tokens -= perEntry[index] ?? 0;
    if (contextFits()) {
      return contextFittedState(
        history.filter((_, i) => !left.has(i)),
        tokens,
        'old messages left out',
      );
    }
  }

  history = mergeContextCallRuns(
    history.filter((_, i) => !left.has(i)),
    contextPinned,
  );
  perEntry = history.map(contextEntryTokens);
  tokens = baseTokens + perEntry.reduce((sum, n) => sum + n, 0);
  if (contextFits()) return contextFittedState(history, tokens, 'old calls merged');

  throw new Error(
    `history too large for Jev (~${tokens} tokens after truncation, limit ${options.maxStateTokens})`,
  );
}
