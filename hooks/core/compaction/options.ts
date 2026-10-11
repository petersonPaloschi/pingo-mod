import { type ContextToolCall, type ContextCallAnswer, type ContextCallDecision, type ContextState, type ContextOptions, type ResolvedContextOptions, type ContextConfigOptions, type ResolvedContextConfig, type ContextJevQuestions, type ContextJevAnswer, type ContextJevAsker } from "./types.ts";
import { estimateContextTokens } from "./text.ts";

/** A `noul` answer's value, or undefined when it is missing or not a finite number. */
export function contextNoulAnswer(answers: Record<string, ContextJevAnswer>, name: string): number | undefined {
  const answer = answers[name];
  return answer && "noul" in answer && typeof answer.noul === "number" && Number.isFinite(answer.noul) ? answer.noul : undefined;
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

export async function askContextBatch(
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
export const CONTEXT_PARALLEL_REQUESTS = 4;

/** Runs `work` on every item, at most `limit` at a time, results in the items' order; the first failure stops it. */
export async function inTurns<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
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
