// Live orchestration: the policy in the store, the active objective, subagent profiles, mandatory
// reviews and the managed batch queue. register.tsx calls in from its hooks; the decisions
// themselves are the pure modules under core/ (orchestration, objective, review, queue).

export type { Tone, Io } from "./orchestrate/types.ts";
export { readPolicy, readObjective } from "./orchestrate/state.ts";
export { onPromptSubmit, mainProfile, userSwitchedModel, noteApplied } from "./orchestrate/policy.ts";
export { runCommand } from "./orchestrate/commands.ts";
export { planSpawn, spawned, noteEdit, diffEvidence, reviewPingoAgent, agentToolNote } from "./orchestrate/agents.ts";
export { BATCH_STORE, onAgentDone, batchSkillPrompt, readBatches, submitBatch, batchText, batchStatus } from "./orchestrate/batches.ts";
export { restore } from "./orchestrate/lifecycle.ts";
