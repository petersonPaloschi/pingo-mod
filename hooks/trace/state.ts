import type { TraceAgent, TraceConsult, TraceMessage, TraceRun, TraceState } from "../../types";
import { type RunTiming } from "./types.ts";
import { TRACE_SCHEMA, KEPT_RUNS, TEXT_MAX } from "./constants.ts";
import { GLYPH } from "../theme.ts";

export const emptyTrace = (): TraceState => ({ schemaVersion: TRACE_SCHEMA, seq: 0, turns: 0, inbox: [], runs: [] });

/** A value of another schema (the old FlowState, or nothing yet) starts empty rather than being misread. */
export function traceOf(value: unknown): TraceState {
  return value !== null && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === TRACE_SCHEMA ? (value as TraceState) : emptyTrace();
}

/** One line, cut between code points. */
export function clip(text: string, max = TEXT_MAX): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length > max ? chars.slice(0, Math.max(0, max - GLYPH.ellipsis.length)).join("") + GLYPH.ellipsis : line;
}

/** "builtin", "mcp:<server>" for an MCP tool (`mcp__<server>__<tool>`), or "server:<name>" for one the API ran. */
export function toolSource(name: string): string {
  const mcp = /^mcp__(.+?)__/.exec(name);
  return mcp ? `mcp:${mcp[1]}` : "builtin";
}

/** A run is done once its main turn ended and none of its subagents still runs. */
export const isDone = (run: TraceRun) => run.endedAt !== undefined && !run.agents.some((agent) => agent.state === "running");

export function traceConsults(trace: TraceState): TraceConsult[] {
  const messages = [
    ...trace.inbox,
    ...trace.runs.flatMap((run) => [...(run.message ? [run.message] : []), ...run.received]),
  ];
  const byId = new Map<string, TraceConsult>();
  for (const consult of [...trace.runs.flatMap((run) => run.consults), ...messages.flatMap((message) => message.consults)]) {
    const prior = byId.get(consult.id);
    if (!prior) {
      byId.set(consult.id, consult);
      continue;
    }
    byId.set(consult.id, {
      ...prior,
      ...consult,
      ...(consult.endedAt === undefined && prior.endedAt !== undefined ? { endedAt: prior.endedAt } : {}),
      ...(consult.error === undefined && prior.error ? { error: prior.error } : {}),
      ...(consult.observed === undefined && prior.observed ? { observed: prior.observed } : {}),
      ...(prior.usage || consult.usage ? { usage: { ...prior.usage, ...consult.usage } } : {}),
    });
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}



export function runTiming(run: TraceRun, now: number): RunTiming {
  const promptAt = run.message?.at ?? run.startedAt;
  const mainResponseMs = run.endedAt === undefined ? undefined : Math.max(0, run.endedAt - promptAt);
  const complete = isDone(run);
  const completedAt = complete
    ? Math.max(run.endedAt!, ...run.agents.map((agent) => agent.endedAt ?? run.endedAt!))
    : now;
  return {
    promptAt,
    ...(mainResponseMs !== undefined ? { mainResponseMs } : {}),
    totalMs: Math.max(0, completedAt - promptAt),
    complete,
  };
}

/** The models responses named in a run: the main loop's and every subagent's, each once. */
export const confirmedModels = (run: TraceRun) => [...new Set([...run.main.observed, ...run.agents.flatMap((agent) => agent.observed)])];

export const add = <T>(list: T[], item: T): T[] => (list.includes(item) ? list : [...list, item]);

export function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _gone, ...rest } = value;
  return rest;
}

export function nextId(s: TraceState, prefix: string): [TraceState, string] {
  const seq = s.seq + 1;
  return [{ ...s, seq }, `${prefix}${seq}`];
}

export function newRun(id: string, confirmed: boolean, n: number, kind: TraceRun["kind"], text: string, at: number): TraceRun {
  return {
    id,
    confirmed,
    n,
    kind,
    text,
    startedAt: at,
    received: [],
    consults: [],
    consultCount: 0,
    main: { sent: [], observed: [], requests: 0 },
    steps: [],
    tools: [],
    toolCount: 0,
    toolSources: {},
    denied: 0,
    failed: 0,
    agents: [],
    advisor: [],
    edits: 0,
    files: [],
  };
}

export const withRun = (s: TraceState, id: string, change: (run: TraceRun) => TraceRun): TraceState => ({ ...s, runs: s.runs.map((run) => (run.id === id ? change(run) : run)) });
export const activeRun = (s: TraceState) => (s.active ? s.runs.find((run) => run.id === s.active) : undefined);
export const runOfAgent = (s: TraceState, agentId: string) => s.runs.findLast((run) => run.agents.some((agent) => agent.id === agentId));

export function endRun(s: TraceState, id: string, at: number, reason: NonNullable<TraceRun["reason"]>): TraceState {
  const ended = withRun(s, id, (run) => (run.endedAt === undefined ? { ...run, endedAt: at, reason } : run));
  return ended.active === id ? omit(ended, "active") : ended;
}

/** Keeps every run still active and the latest finished ones. */
export function prune(s: TraceState): TraceState {
  const done = s.runs.filter(isDone);
  if (done.length <= KEPT_RUNS) return s;
  const drop = new Set(done.slice(0, done.length - KEPT_RUNS).map((run) => run.id));
  return { ...s, runs: s.runs.filter((run) => !drop.has(run.id)) };
}

/**
 * The main loop's running run. A main step naming another turn means the open one never saw its
 * end (the loop runs one turn at a time); an event with no run open (a reload mid-turn, a tool
 * before any turn.start) opens one, which takes the engine's id from its first step.
 */
export function ensureMain(s: TraceState, at: number, turnId?: string): [TraceState, string] {
  const active = activeRun(s);
  if (active && (!turnId || active.id === turnId)) return [s, active.id];
  const known = turnId ? s.runs.find((run) => run.id === turnId) : undefined;
  // A late event of a run that already ended stays with it.
  if (known && known.endedAt !== undefined) return [s, known.id];
  if (active && turnId && !active.confirmed && !known) {
    const renamed = { ...withRun(s, active.id, (run) => ({ ...run, id: turnId, confirmed: true })), active: turnId };
    return [renamed, turnId];
  }
  let next = active ? endRun(s, active.id, at, "superseded") : s;
  if (known) return [{ ...next, active: known.id }, known.id];
  let id = turnId;
  if (!id) [next, id] = nextId(next, "run-");
  const turns = next.turns + 1;
  return [prune({ ...next, turns, active: id, runs: [...next.runs, newRun(id, Boolean(turnId), turns, "unlinked", "", at)] }), id];
}

/** The run a subagent belongs to; one never seen start (a workflow's, a reload's) joins the running run. */
export function ensureAgent(s: TraceState, agentId: string, at: number): [TraceState, string] {
  const known = runOfAgent(s, agentId);
  if (known) return [s, known.id];
  const [next, runId] = ensureMain(s, at);
  const agent: TraceAgent = { id: agentId, type: "agent", description: "", observed: [], state: "running", startedAt: at, tools: 0, requests: 0 };
  return [withRun(next, runId, (run) => ({ ...run, agents: [...run.agents, agent] })), runId];
}

export const withAgent = (s: TraceState, runId: string, agentId: string, change: (agent: TraceAgent) => TraceAgent) =>
  withRun(s, runId, (run) => ({ ...run, agents: run.agents.map((agent) => (agent.id === agentId ? change(agent) : agent)) }));

/** Where a message is kept: the inbox, a run's received list, or as the message that started a run. */
export function changeMessage(s: TraceState, id: string, change: (message: TraceMessage) => TraceMessage): TraceState {
  if (s.inbox.some((message) => message.id === id)) return { ...s, inbox: s.inbox.map((message) => (message.id === id ? change(message) : message)) };
  return {
    ...s,
    runs: s.runs.map((run) =>
      run.message?.id === id
        ? { ...run, message: change(run.message) }
        : run.received.some((message) => message.id === id)
          ? { ...run, received: run.received.map((message) => (message.id === id ? change(message) : message)) }
          : run,
    ),
  };
}
