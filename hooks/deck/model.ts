// Deck state and its rules: plans and task bars, subagent strips, the activity line, model routes,
// usage history, spend, and the rows the band draws. Pure: every function takes the state it reads
// and the time it needs; the few that change state say so in their name and take DeckState first.
// Drawing lives in rows.ts; the hooks that feed this module live with the band.

export type { RowStyle, BarState, StepStatus, Step, Stage, Bar, AgentState, AgentTodo, Agent, Task, Activity, ContextUsage, RateLimit, Usage, UsageReading, HistPoint, Weather, Spend, RouteRoute, RouteNoAnswer, DeckRoute, DeckState, ToolUse, AgentOutcome, ToolCall, CallResult, SavedSpend, Where, TodoInput, TaskInput, TaskResult, RouteView, Mark, Strips, DeckRow, PetMood, DeckSound, ReactCues } from "./model/types.ts";
export { ASK_DELAY_MS, COST_SESSIONS, DECK_VERSION, TIER_MODEL, STYLE_GLYPH } from "./model/constants.ts";
export { createDeckState, slug, cleanPrompt, fmtK, fmtUsd, today, countdown, humanReset, elapsed, clockText, weatherText, limitName, shortModel, finishAgent, settleAgents, hasLiveAgents, startAgent, callStart, callDone, callAnswered, markWaiting, askedQuestion, promptSubmitted, turnStarted, turnEnded, taskCreated, taskCompleted, dismissRow, clearRows } from "./model/state.ts";
export { agentsOf, toolName, actionOf } from "./model/agents.ts";
export { costSeenFrom, spendRecord, histFrom, sampleUsage, series, burnRate, mergeLimits, takeUsage, dropDemoUsage, spendFrom, addSpend } from "./model/usage.ts";
export { where, newBar, barState, liveBar, placeBar, syncAgentsBar, stepOn, parsePlan, upsertTodos, applyTaskResult, syncTasksBar } from "./model/bars.ts";
export { emptyRoute, dropDemoRoute, readRouteStatus, readRouteLog, routeFromPingoEvent, takePingoRoute, routeRow } from "./model/routes.ts";
export { visibleStrips, stripTool, barRow, activityRow, sectionsOn, collectRows } from "./model/rows.ts";
export { collapsedOrder, petMood, react, statusText } from "./model/display.ts";
export { DEMO_ROUTE_HIST, demoStages, startDemo, demoTick, sampleRow } from "./model/demo.ts";
export { EFFORTS } from "./model/constants.ts";
