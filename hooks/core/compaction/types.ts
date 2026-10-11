

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
