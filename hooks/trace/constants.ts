

export const TRACE_SCHEMA = 2;
/** Finished runs kept; runs still active (or with a subagent still running) are always kept. */
export const KEPT_RUNS = 40;
export const KEPT_STEPS = 24;
export const KEPT_TOOLS = 30;
export const KEPT_CONSULTS = 12;
export const KEPT_ADVISOR = 24;
export const KEPT_INBOX = 6;
export const KEPT_RECEIVED = 6;
export const KEPT_FILES = 40;
export const TEXT_MAX = 200;
/** An answer, a subagent's result or the advisor's guidance, as the Flow tab quotes it. */
export const ANSWER_MAX = 240;

// --- Settings and housekeeping ---

/** Variables read only for being set: any non-empty value, "0" included, stops feature-flag fetching. */
export const PRESENCE_FLAGS = ["DISABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] as const;
/** Standard on/off variables: 1, true, yes or on (any casing) turn them on. */
export const BOOLEAN_FLAGS = ["DO_NOT_TRACK"] as const;
export const PROVIDER_FLAGS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"] as const;
