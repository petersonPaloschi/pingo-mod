// Jev-guided session compaction, moved into Pingo's existing feature core.

export type { ContextRole, ContextToolUse, ContextToolResult, ContextMessage, ContextSessionMessage, ContextToolCall, ContextCallAnswer, ContextCallAction, ContextCallDecision, ContextHistoryToolCall, ContextHistoryEntry, ContextState, ContextFittedState, ContextOptions, ResolvedContextOptions, ContextConfigOptions, ResolvedContextConfig, ContextResult, ContextJevState, ContextNoulQuestion, ContextChoiceQuestion, ContextScoreQuestion, ContextJevQuestion, ContextJevQuestions, ContextNoulAnswer, ContextChoiceAnswer, ContextScoreAnswer, ContextJevAnswer, ContextJevResponse, ContextJevAsker } from "./compaction/types.ts";
export { contextNoulAnswer, DEFAULT_CONTEXT_OPTIONS, resolveContextOptions, resolveContextConfig, contextQuestionsFor, batchContextCalls, decideContextCall } from "./compaction/options.ts";
export { CONTEXT_STATE_DESCRIPTION, estimateContextTokens, truncateContextText } from "./compaction/text.ts";
export { isContextPinned, collectContextToolCalls, contextGoalFromMessages } from "./compaction/history.ts";
export { fitContextState } from "./compaction/fit.ts";
export { applyContextDecisions, contextMessageChars, contextReductionRatio } from "./compaction/decisions.ts";
export { compactContext, restoreContextMessages, compactContextSession } from "./compaction/compact.ts";
