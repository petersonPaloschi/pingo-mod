// Jev-guided session compaction, moved into Pingo's existing feature core.
export type ContextRole = 'user' | 'assistant';

/**
 * A tool_use block of an assistant message. `text` and `isError` mirror the
 * outcome once the transcript holds it (Claude Code attaches them).
 */
export interface ContextToolUse {
  tool_use_id: string;
  tool: string;
  input: Record<string, unknown>;
  text?: string;
  isError?: boolean;
}

/** A tool_result block of a user message. */
export interface ContextToolResult {
  tool_use_id: string;
  text: string;
  isError?: boolean;
}

/**
 * One transcript message. The shape is a subset of Claude Code's
 * `SessionMessage`, so a session transcript can be passed in as is.
 */
export interface ContextMessage {
  role: ContextRole;
  text: string;
  toolUses: ContextToolUse[];
  toolResults?: ContextToolResult[];
}

export interface ContextSessionMessage extends ContextMessage {
  handle?: unknown;
}

/** A tool call paired with its result by `tool_use_id`. */
export interface ContextToolCall {
  /** Short id used in the Jev state and question names (`t1`, `t2`, ...). */
  id: string;
  tool_use_id: string;
  tool: string;
  input: Record<string, unknown>;
  /** Index of the message holding the tool_use block. */
  callIndex: number;
  /** Index of the message holding the tool_result block. */
  resultIndex: number;
  resultChars: number;
  isError: boolean;
  /** In the first or the newest preserved messages; never a candidate. */
  pinned: boolean;
}

export interface ContextCallAnswer {
  /** Jev's probability that the call itself still matters. */
  keepCall: number;
  /** Jev's probability that the full result still needs to stay verbatim. */
  keepResult: number;
}

export type ContextCallAction = 'keep' | 'drop_result' | 'drop_call';

export interface ContextCallDecision extends ContextCallAnswer {
  id: string;
  tool: string;
  action: ContextCallAction;
  reason: 'pinned' | 'kept' | 'result_dropped' | 'call_dropped';
}

export interface ContextHistoryToolCall {
  id: string;
  tool: string;
  input: string;
  result: string;
}

export interface ContextHistoryEntry {
  i: number;
  role: ContextRole;
  text: string;
  /** Structured per call, or one compact line per call once the state has to shrink. */
  tool_calls?: ContextHistoryToolCall[] | string[];
}

/** The state sent with every Jev request: the whole history, results omitted. */
export interface ContextState {
  context: string;
  goal: string;
  history: ContextHistoryEntry[];
}

export interface ContextFittedState {
  state: ContextState;
  tokens: number;
  /** Which fitting stage produced the state, for diagnostics. */
  stage: string;
}

export interface ContextOptions {
  /** Ongoing task description; defaults to the last few user prompts. */
  goal?: string;
  /** Minimum keep probability for a call or result to stay. Default 0.5. */
  keepThreshold?: number;
  /** Newest messages never touched (the first message is always kept). Default 6. */
  preserveRecentMessages?: number;
  /** Estimated token ceiling for the state. Default 25000. */
  maxStateTokens?: number;
  /** Estimated token ceiling for state plus one batch of questions. Default 30000. */
  maxRequestTokens?: number;
  /** Characters of a dropped tool result to retain. Default 300. */
  truncateHeadChars?: number;
}

export interface ResolvedContextOptions {
  goal: string;
  keepThreshold: number;
  preserveRecentMessages: number;
  maxStateTokens: number;
  maxRequestTokens: number;
  truncateHeadChars: number;
}

export interface ContextConfigOptions extends ContextOptions {
  compactAtPercent?: number;
  minReductionRatio?: number;
}

export interface ResolvedContextConfig extends ResolvedContextOptions {
  compactAtPercent: number;
  minReductionRatio: number;
}

export interface ContextResult {
  /** The compacted transcript; untouched messages are the input objects. */
  messages: ContextMessage[];
  decisions: ContextCallDecision[];
  stats: {
    messagesBefore: number;
    messagesAfter: number;
    charsBefore: number;
    charsAfter: number;
    calls: number;
    kept: number;
    resultsDropped: number;
    callsDropped: number;
    pinned: number;
    stateTokens: number;
    /** Which fitting stage the state needed, '' when no request was made. */
    stateStage: string;
    requests: number;
    ms: number;
  };
}

/** The `state` of a Jev request: a string or any JSON-serialisable object. */
export type ContextJevState = string | object;

export interface ContextNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: {
    true?: string;
    false?: string;
  };
}

export interface ContextChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface ContextScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type ContextJevQuestion = ContextNoulQuestion | ContextChoiceQuestion | ContextScoreQuestion;
export type ContextJevQuestions = Record<string, ContextJevQuestion>;

export interface ContextNoulAnswer {
  type?: 'noul';
  noul: number;
}

export interface ContextChoiceAnswer {
  type?: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ContextScoreAnswer {
  type?: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export type ContextJevAnswer = ContextNoulAnswer | ContextChoiceAnswer | ContextScoreAnswer;

export interface ContextJevResponse {
  model?: string;
  answers: Record<string, ContextJevAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  [key: string]: unknown;
}

/** The Pingo Jev adapter used to answer context decisions. */
export interface ContextJevAsker {
  ask(state: ContextJevState, questions: ContextJevQuestions): Promise<ContextJevResponse>;
}

/** A `noul` answer's value, or undefined when it is missing or not a finite number. */
export function contextNoulAnswer(answers: Record<string, ContextJevAnswer>, name: string): number | undefined {
  const answer = answers[name];
  return answer && "noul" in answer && typeof answer.noul === "number" && Number.isFinite(answer.noul) ? answer.noul : undefined;
}

export const CONTEXT_STATE_DESCRIPTION =
  'A coding assistant conversation is being compacted to free context. `history` is the whole conversation so far, oldest first; tool outputs are replaced by a short `result` note and long texts may be abridged. Each question asks whether one tool call, or the full output of that call, still needs to stay in the history verbatim. Whatever is not kept is deleted permanently, but the assistant can always re-run a tool or re-read a file.';

/** Successive caps on the serialised tool input included per call. */
const CONTEXT_INPUT_CHARS = [1000, 200, 60] as const;
/** Cap on each input value in a call's one-line form, before the line itself is cut. */
const CONTEXT_CALL_VALUE_CHARS = 200;
const CONTEXT_TEXT_HEAD = 400;
const CONTEXT_TEXT_TAIL = 150;

const CONTEXT_TOKEN_PIECES = /[A-Za-z]+|\d+|[^\sA-Za-z\d]/g;

/**
 * Estimates tokens without a tokenizer: a word costs one token per six
 * letters, a digit half a token, any other symbol nine tenths. Calibrated
 * against the usage Jev reports for real transcripts, where it lands 2–18%
 * above the true count; a plain characters-per-token ratio undercounts the
 * JSON-heavy states by up to 40%.
 */
export function estimateContextTokens(text: string): number {
  let tokens = 0;
  for (const [piece] of text.matchAll(CONTEXT_TOKEN_PIECES)) {
    const first = piece.charCodeAt(0);
    if (first >= 48 && first <= 57) tokens += piece.length / 2;
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      tokens += 1 + Math.floor((piece.length - 1) / 6);
    } else tokens += 0.9;
  }
  return Math.ceil(tokens);
}

export function truncateContextText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function abridgeContextText(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + 40) return text;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[… ${omitted} chars omitted …]\n${text.slice(-tail)}`;
}

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

function contextInputText(input: Record<string, unknown>, limit: number): string {
  let json = '';
  try {
    json = JSON.stringify(input);
  } catch {
    json = '[unserializable input]';
  }
  return truncateContextText(json, limit);
}

function contextResultNote(call: ContextToolCall): string {
  return `${call.isError ? 'error' : 'ok'}, ${call.resultChars} chars (omitted)`;
}

/** One call as a single line, for when the structured form is too costly. */
function compactContextCall(call: ContextToolCall): string {
  const input = Object.entries(call.input)
    .map(([key, value]) => {
      // cut before the whitespace pass: a file's whole content would be scanned for a one-line summary
      const text = typeof value === 'string'
        ? value.slice(0, CONTEXT_CALL_VALUE_CHARS)
        : contextInputText({ [key]: value }, CONTEXT_CALL_VALUE_CHARS);
      return `${key}=${text.replace(/\s+/g, ' ')}`;
    })
    .join(' ');
  return `${call.id} ${call.tool} ${truncateContextText(input, CONTEXT_INPUT_CHARS[2])} → ${
    call.isError ? 'error' : 'ok'
  } ${call.resultChars}ch`;
}

/**
 * Folds runs of adjacent call-only entries into one entry each, so the
 * per-entry envelope is paid once per run; the call lines keep their ids.
 */
function mergeContextCallRuns(history: readonly ContextHistoryEntry[], pinned: (e: ContextHistoryEntry) => boolean): ContextHistoryEntry[] {
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

function contextCallsByMessage(calls: readonly ContextToolCall[]): Map<number, ContextToolCall[]> {
  const byMessage = new Map<number, ContextToolCall[]>();
  for (const call of calls) {
    const list = byMessage.get(call.callIndex) ?? [];
    list.push(call);
    byMessage.set(call.callIndex, list);
  }
  return byMessage;
}

function contextHistoryEntries(
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

export const DEFAULT_CONTEXT_OPTIONS: ResolvedContextOptions = {
  goal: '',
  keepThreshold: 0.5,
  preserveRecentMessages: 6,
  maxStateTokens: 25_000,
  maxRequestTokens: 30_000,
  truncateHeadChars: 300,
};

/** Tokens the request envelope (`model`, key names) adds around state and questions. */
const CONTEXT_REQUEST_OVERHEAD_TOKENS = 20;

function contextFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveContextOptions(options: ContextOptions = {}): ResolvedContextOptions {
  return {
    goal: options.goal ?? DEFAULT_CONTEXT_OPTIONS.goal,
    keepThreshold: contextFinite(options.keepThreshold, DEFAULT_CONTEXT_OPTIONS.keepThreshold),
    preserveRecentMessages: Math.max(
      0,
      Math.floor(
        contextFinite(options.preserveRecentMessages, DEFAULT_CONTEXT_OPTIONS.preserveRecentMessages),
      ),
    ),
    maxStateTokens: Math.max(1, contextFinite(options.maxStateTokens, DEFAULT_CONTEXT_OPTIONS.maxStateTokens)),
    maxRequestTokens: Math.max(
      1,
      contextFinite(options.maxRequestTokens, DEFAULT_CONTEXT_OPTIONS.maxRequestTokens),
    ),
    truncateHeadChars: Math.max(
      0,
      Math.floor(contextFinite(options.truncateHeadChars, DEFAULT_CONTEXT_OPTIONS.truncateHeadChars)),
    ),
  };
}

export function resolveContextConfig(options: ContextConfigOptions = {}): ResolvedContextConfig {
  return {
    ...resolveContextOptions(options),
    compactAtPercent: contextFinite(options.compactAtPercent, 60),
    minReductionRatio: contextFinite(options.minReductionRatio, 0.25),
  };
}

/** The two `noul` questions asked about one call: keep the call, keep its result. */
export function contextQuestionsFor(call: ContextToolCall): ContextJevQuestions {
  return {
    [`call_${call.id}`]: {
      type: 'noul',
      instructions: `Tool call ${call.id} (${call.tool}) should stay in the history: knowing this call was made, with its input, still matters for what the assistant does next`,
    },
    [`result_${call.id}`]: {
      type: 'noul',
      instructions: `The full output of tool call ${call.id} (${call.tool}, ${call.resultChars} chars) should stay in the history verbatim: the assistant still needs its contents and re-running the tool would not do`,
    },
  };
}

/**
 * Splits the candidate calls into batches whose questions, together with the
 * (always complete) state, fit one request.
 */
export function batchContextCalls(
  calls: readonly ContextToolCall[],
  stateTokens: number,
  options: Pick<ResolvedContextOptions, 'maxRequestTokens'>,
): ContextToolCall[][] {
  const budget = options.maxRequestTokens - stateTokens - CONTEXT_REQUEST_OVERHEAD_TOKENS;
  const batches: ContextToolCall[][] = [];
  let current: ContextToolCall[] = [];
  let currentTokens = 0;
  for (const call of calls) {
    const tokens = estimateContextTokens(JSON.stringify(contextQuestionsFor(call)));
    if (current.length > 0 && currentTokens + tokens > budget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    if (current.length === 0 && tokens > budget) {
      throw new Error(
        `state leaves no room for questions (~${stateTokens} of ${options.maxRequestTokens} tokens)`,
      );
    }
    current.push(call);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function decideContextCall(
  call: Pick<ContextToolCall, 'id' | 'tool' | 'pinned'>,
  answer: ContextCallAnswer,
  options: Pick<ResolvedContextOptions, 'keepThreshold'>,
): ContextCallDecision {
  const base = { id: call.id, tool: call.tool, ...answer };
  if (call.pinned) return { ...base, action: 'keep', reason: 'pinned' };
  if (answer.keepResult >= options.keepThreshold) {
    return { ...base, action: 'keep', reason: 'kept' };
  }
  if (answer.keepCall >= options.keepThreshold) {
    return { ...base, action: 'drop_result', reason: 'result_dropped' };
  }
  return { ...base, action: 'drop_call', reason: 'call_dropped' };
}

async function askContextBatch(
  asker: ContextJevAsker,
  state: ContextState,
  batch: readonly ContextToolCall[],
): Promise<Map<string, ContextCallAnswer>> {
  const questions: ContextJevQuestions = Object.assign({}, ...batch.map(contextQuestionsFor));
  const { answers } = await asker.ask(state, questions);
  // An answer missing or malformed keeps what it was about, as a call left unanswered is kept: one bad answer
  // costs that call its compaction, not the whole run.
  return new Map(
    batch.map((call) => [
      call.id,
      {
        keepCall: contextNoulAnswer(answers, `call_${call.id}`) ?? 1,
        keepResult: contextNoulAnswer(answers, `result_${call.id}`) ?? 1,
      },
    ]),
  );
}

/** Requests to Jev in flight at once while compacting: each carries the whole fitted state. */
const CONTEXT_PARALLEL_REQUESTS = 4;

/** Runs `work` on every item, at most `limit` at a time, results in the items' order; the first failure stops it. */
async function inTurns<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function truncatedContextResultText(text: string, isError: boolean, headChars: number): string {
  if (text.length <= headChars + 120) return text;
  const head = headChars > 0 ? `${text.slice(0, headChars)}\n` : '';
  return `${head}[context compaction removed ${text.length - headChars} chars of this tool result${
    isError ? ' (error)' : ''
  }; re-run the tool if needed]`;
}

/**
 * Rebuilds the conversation from the decisions. A dropped call disappears
 * together with its result; a dropped result keeps a bounded head and note.
 * Messages that lose all their content are removed; untouched messages are
 * returned as the same objects they came in as.
 */
export function applyContextDecisions(
  messages: readonly ContextMessage[],
  decisions: readonly ContextCallDecision[],
  calls: readonly ContextToolCall[],
  headChars: number,
): ContextMessage[] {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const actions = new Map<string, ContextCallDecision['action']>();
  for (const decision of decisions) {
    const call = byId.get(decision.id);
    if (call && decision.action !== 'keep') actions.set(call.tool_use_id, decision.action);
  }
  const kept: ContextMessage[] = [];
  for (const message of messages) {
    const touched =
      message.toolUses.some((tool) => actions.has(tool.tool_use_id)) ||
      (message.toolResults ?? []).some((result) => actions.has(result.tool_use_id));
    if (!touched) {
      kept.push(message);
      continue;
    }
    const toolUses = message.toolUses
      .filter((tool) => actions.get(tool.tool_use_id) !== 'drop_call')
      .map((tool) => {
        if (actions.get(tool.tool_use_id) !== 'drop_result') return tool;
        const text = truncatedContextResultText(
          tool.text ?? '',
          tool.isError ?? false,
          headChars,
        );
        if ((tool.text ?? '') === text) return tool;
        const copy: ContextToolUse = {
          tool_use_id: tool.tool_use_id,
          tool: tool.tool,
          input: tool.input,
          text,
        };
        if (tool.isError) copy.isError = true;
        return copy;
      });
    const toolResults = (message.toolResults ?? [])
      .filter((result) => actions.get(result.tool_use_id) !== 'drop_call')
      .map((result) => {
        if (actions.get(result.tool_use_id) !== 'drop_result') return result;
        const text = truncatedContextResultText(result.text, result.isError ?? false, headChars);
        return text === result.text
          ? result
          : {
              tool_use_id: result.tool_use_id,
              text,
              isError: result.isError,
            };
      });
    if (
      !message.toolUses.some(
        (tool) => actions.get(tool.tool_use_id) === 'drop_call',
      ) &&
      !(message.toolResults ?? []).some(
        (result) => actions.get(result.tool_use_id) === 'drop_call',
      ) &&
      toolUses.every((tool, index) => tool === message.toolUses[index]) &&
      toolResults.every(
        (result, index) => result === message.toolResults?.[index],
      )
    ) {
      kept.push(message);
      continue;
    }
    if (message.text.trim().length === 0 && toolUses.length === 0 && toolResults.length === 0) {
      continue;
    }
    const rebuilt: ContextMessage = { role: message.role, text: message.text, toolUses };
    if (toolResults.length > 0) rebuilt.toolResults = toolResults;
    kept.push(rebuilt);
  }
  return kept;
}

/** Characters of text, tool input and tool output a message holds. */
export function contextMessageChars(message: ContextMessage): number {
  let total = message.text.length;
  for (const tool of message.toolUses) {
    try {
      total += JSON.stringify(tool.input).length;
    } catch {
      total += 20;
    }
  }
  for (const result of message.toolResults ?? []) total += result.text.length;
  return total;
}

export function contextReductionRatio(result: Pick<ContextResult, 'stats'>): number {
  const { charsBefore, charsAfter } = result.stats;
  return charsBefore === 0 ? 0 : (charsBefore - charsAfter) / charsBefore;
}

function contextCount(decisions: readonly ContextCallDecision[], reason: ContextCallDecision['reason']): number {
  return decisions.filter((decision) => decision.reason === reason).length;
}

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
