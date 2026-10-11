// The Flow tab's record (state key `flowV2`, schema 2): what each main-loop run did, as the SDK's
// events show it. Pure reducers: register.tsx reads the events and keeps the state, so a reload
// keeps the record and a test feeds the reducers events in any order.
//
// Association is never guessed from a counter or from text. A message is tied to a run only when
// the engine confirms it: the turn that starts while its idle submission is still entering. A
// message typed into a running turn names that turn and stays queued. A subagent's turns raise no
// turn.start: its steps, tools and advisor calls join the run that spawned it.

export type { RunTiming, Submitted, ConsultWhere, StepStart, ServerToolUse, StepEnd, TurnEndReason, ToolStart, ToolEnd, AgentStart } from "./trace/types.ts";
export { TRACE_SCHEMA, KEPT_RUNS, PRESENCE_FLAGS, BOOLEAN_FLAGS, PROVIDER_FLAGS } from "./trace/constants.ts";
export { emptyTrace, traceOf, clip, toolSource, isDone, traceConsults, runTiming, confirmedModels } from "./trace/state.ts";
export { submitPrompt, planMessage, noteAdvice, promptEntered, rowText, promptRow, queuedDelivered, lastAsked } from "./trace/prompts.ts";
export { consultStart, consultEnd } from "./trace/consults.ts";
export { startTurn, stepStart, stepEnd, completeTurn, toolStart, toolEnd, agentStart } from "./trace/turns.ts";
export { advisorBlocker, setAdvisorInfo, clearTrace } from "./trace/advisor.ts";
