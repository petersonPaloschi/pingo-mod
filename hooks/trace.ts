// The Flow tab's record (state key `flowV2`, schema 2): what each main-loop run did, as the SDK's
// events show it. Pure reducers: register.tsx reads the events and keeps the state, so a reload
// keeps the record and a test feeds the reducers events in any order.
//
// Association is never guessed from a counter or from text. A message is tied to a run only when
// the engine confirms it: the turn that starts while its idle submission is still entering. A
// message typed into a running turn names that turn and stays queued. A subagent's turns raise no
// turn.start: its steps, tools and advisor calls join the run that spawned it.
import type { AdvisorInfo, AgentState, TraceAdvice, TraceAdvisor, TraceAgent, TraceConsult, TraceMessage, TracePlan, TraceRun, TraceState, TraceStep, TraceTool } from "../types";

export const TRACE_SCHEMA = 2;
/** Finished runs kept; runs still active (or with a subagent still running) are always kept. */
export const KEPT_RUNS = 40;
const KEPT_STEPS = 24;
const KEPT_TOOLS = 30;
const KEPT_CONSULTS = 12;
const KEPT_ADVISOR = 24;
const KEPT_INBOX = 6;
const KEPT_RECEIVED = 6;
const KEPT_FILES = 40;
const TEXT_MAX = 200;
/** An answer, a subagent's result or the advisor's guidance, as the Flow tab quotes it. */
const ANSWER_MAX = 240;

export const emptyTrace = (): TraceState => ({ schemaVersion: TRACE_SCHEMA, seq: 0, turns: 0, inbox: [], runs: [] });

/** A value of another schema (the old FlowState, or nothing yet) starts empty rather than being misread. */
export function traceOf(value: unknown): TraceState {
  return value !== null && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === TRACE_SCHEMA ? (value as TraceState) : emptyTrace();
}

/** One line, cut between code points. */
export function clip(text: string, max = TEXT_MAX): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : line;
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

export interface RunTiming {
  /** The submitted prompt time, before Jev planning when the message is linked. */
  promptAt: number;
  /** Prompt-to-main-turn completion; absent until the main turn ends. */
  mainResponseMs?: number;
  /** Prompt-to-last relevant completion, using the latest parallel branch end. */
  totalMs: number;
  complete: boolean;
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

const add = <T>(list: T[], item: T): T[] => (list.includes(item) ? list : [...list, item]);

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _gone, ...rest } = value;
  return rest;
}

function nextId(s: TraceState, prefix: string): [TraceState, string] {
  const seq = s.seq + 1;
  return [{ ...s, seq }, `${prefix}${seq}`];
}

function newRun(id: string, confirmed: boolean, n: number, kind: TraceRun["kind"], text: string, at: number): TraceRun {
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

const withRun = (s: TraceState, id: string, change: (run: TraceRun) => TraceRun): TraceState => ({ ...s, runs: s.runs.map((run) => (run.id === id ? change(run) : run)) });
const activeRun = (s: TraceState) => (s.active ? s.runs.find((run) => run.id === s.active) : undefined);
const runOfAgent = (s: TraceState, agentId: string) => s.runs.findLast((run) => run.agents.some((agent) => agent.id === agentId));

function endRun(s: TraceState, id: string, at: number, reason: NonNullable<TraceRun["reason"]>): TraceState {
  const ended = withRun(s, id, (run) => (run.endedAt === undefined ? { ...run, endedAt: at, reason } : run));
  return ended.active === id ? omit(ended, "active") : ended;
}

/** Keeps every run still active and the latest finished ones. */
function prune(s: TraceState): TraceState {
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
function ensureMain(s: TraceState, at: number, turnId?: string): [TraceState, string] {
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
function ensureAgent(s: TraceState, agentId: string, at: number): [TraceState, string] {
  const known = runOfAgent(s, agentId);
  if (known) return [s, known.id];
  const [next, runId] = ensureMain(s, at);
  const agent: TraceAgent = { id: agentId, type: "agent", description: "", observed: [], state: "running", startedAt: at, tools: 0, requests: 0 };
  return [withRun(next, runId, (run) => ({ ...run, agents: [...run.agents, agent] })), runId];
}

const withAgent = (s: TraceState, runId: string, agentId: string, change: (agent: TraceAgent) => TraceAgent) =>
  withRun(s, runId, (run) => ({ ...run, agents: run.agents.map((agent) => (agent.id === agentId ? change(agent) : agent)) }));

/** Where a message is kept: the inbox, a run's received list, or as the message that started a run. */
function changeMessage(s: TraceState, id: string, change: (message: TraceMessage) => TraceMessage): TraceState {
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

// --- Messages ---

export interface Submitted {
  text: string;
  at: number;
  origin: string;
  /** prompt.submit's turnId: the turn running when it was typed or delivered. */
  during?: string;
}

/** A prompt.submit, recorded before Jev is asked. Returns the message's id. */
export function submitPrompt(s: TraceState, input: Submitted): [TraceState, string] {
  const [next, id] = nextId(s, "m");
  const message: TraceMessage = {
    id,
    text: clip(input.text),
    at: input.at,
    origin: input.origin,
    ...(input.during ? { during: input.during } : {}),
    state: input.during ? "queued" : "waiting",
    consults: [],
  };
  if (input.during) {
    // Shown at once in the run it arrived during; which run will carry it out stays open.
    const run = next.runs.find((one) => one.id === input.during) ?? activeRun(next);
    if (run) return [withRun(next, run.id, (one) => ({ ...one, received: [...one.received, message].slice(-KEPT_RECEIVED) })), id];
    return [{ ...next, inbox: [...next.inbox, message].slice(-KEPT_INBOX) }, id];
  }
  return [{ ...next, entering: id, inbox: [...next.inbox, message].slice(-KEPT_INBOX) }, id];
}

/** What Jev's routing point came to for the message. */
export function planMessage(s: TraceState, id: string, plan: TracePlan): TraceState {
  const next = changeMessage(s, id, (message) => ({ ...message, plan }));
  return {
    ...next,
    runs: next.runs.map((run) => run.message?.id === id && plan.checkpoints?.length
      ? { ...run, checkpoints: [...(run.checkpoints ?? []), ...plan.checkpoints].slice(-KEPT_ADVISOR) }
      : run),
  };
}

/**
 * The controlled advisor's decision for a message, then its outcome: merged into what was noted. It
 * follows the message into the run it starts, so it is kept before and after turn.start.
 */
export function noteAdvice(s: TraceState, id: string, change: Partial<TraceAdvice>): TraceState {
  return changeMessage(s, id, (message) => {
    const merged = { ...message.advice, ...change } as TraceAdvice;
    if (merged.guidance) merged.guidance = clip(merged.guidance, ANSWER_MAX);
    if (merged.problem) merged.problem = clip(merged.problem, 120);
    return { ...message, advice: merged };
  });
}

/**
 * prompt.submit's `next` resolved: the message entered, or was refused. One that entered stays `entering`: the
 * engine settles `next` before turn.start fires, so the turn that starts next is still its.
 */
export function promptEntered(s: TraceState, id: string, dropped?: string): TraceState {
  if (dropped === undefined) return s;
  const next = s.entering === id ? omit(s, "entering") : s;
  return changeMessage(next, id, (message) => ({ ...message, state: "dropped", dropped: clip(dropped, 120) }));
}

/** A conversation row's words (session.append's content): the text itself, or its text blocks joined. */
export function rowText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block === "object" && (block as { type?: unknown }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

/** Every message not yet in a run of its own: the inbox's, then each run's received ones. */
const looseMessages = (s: TraceState) => [...s.inbox, ...s.runs.flatMap((run) => run.received)];

/**
 * The conversation took a prompt row on the main loop (session.append's `prompt` door): the oldest message with
 * those words that waits, is queued, or was taken for withdrawn, entered, and the next main turn carries it.
 */
export function promptRow(s: TraceState, text: string): TraceState {
  const said = clip(text);
  const carried = s.carried ?? [];
  const found = looseMessages(s)
    .filter((message) => (message.state === "waiting" || message.state === "queued" || message.state === "withdrawn") && !carried.includes(message.id) && message.text === said)
    .sort((a, b) => a.at - b.at)[0];
  if (!found) return s;
  const next = { ...s, carried: [...carried, found.id] };
  return found.state === "withdrawn" ? changeMessage(next, found.id, (message) => ({ ...message, state: "queued" })) : next;
}

/**
 * A message typed during the running turn reached the model inside it (session.append's `delivery` door, a
 * queued_command): its row quotes the words, which Claude read there. The oldest such message is taken.
 */
export function queuedDelivered(s: TraceState, text: string): TraceState {
  const row = text.replace(/\s+/g, " ");
  const pool = activeRun(s)?.received ?? s.runs.flatMap((run) => run.received);
  const found = pool
    .filter((message) => (message.state === "queued" || message.state === "withdrawn") && row.includes(message.text.replace(/…$/, "")))
    .sort((a, b) => a.at - b.at)[0];
  return found ? changeMessage(s, found.id, (message) => ({ ...message, state: "delivered" })) : s;
}

/** What was typed during a turn that ended, neither read inside it nor entered after it, was taken back. */
function withdrawLeft(s: TraceState): TraceState {
  const carried = new Set(s.carried ?? []);
  const left = (message: TraceMessage) => message.state === "queued" && !carried.has(message.id);
  return {
    ...s,
    runs: s.runs.map((run) => (run.endedAt !== undefined && run.received.some(left)
      ? { ...run, received: run.received.map((message) => (left(message) ? { ...message, state: "withdrawn" } : message)) }
      : run)),
  };
}

// --- Jev ---

export interface ConsultWhere {
  /** A routing point at a prompt: the message it was asked for. */
  messageId?: string;
  /** Asked from inside a subagent's loop (an agent's planning names the parent loop). */
  agentId?: string;
}

/** A Jev call starts. Returns its id. */
export function consultStart(s: TraceState, where: ConsultWhere, consult: Omit<TraceConsult, "id" | "endedAt" | "error">): [TraceState, string] {
  const [next, id] = nextId(s, "j");
  const record: TraceConsult = { id, ...consult };
  const toRun = (state: TraceState, runId: string) =>
    withRun(state, runId, (run) => ({ ...run, consults: [...run.consults, record].slice(-KEPT_CONSULTS), consultCount: run.consultCount + 1 }));
  if (where.messageId) {
    const linked = next.runs.find((run) => run.message?.id === where.messageId);
    if (linked) return [toRun(next, linked.id), id];
    const waiting = [...next.inbox, ...next.runs.flatMap((run) => run.received)].some((message) => message.id === where.messageId);
    if (waiting) return [changeMessage(next, where.messageId, (message) => ({ ...message, consults: [...message.consults, record].slice(-KEPT_CONSULTS) })), id];
  }
  if (!where.agentId && !next.active) {
    // Asked with no turn running: for the message about to start one (its run takes the call), else told in the
    // latest run; never a run of its own, which would show as a request with no message.
    const entering = next.entering ? next.inbox.find((message) => message.id === next.entering && message.state === "waiting") : undefined;
    if (entering) return [changeMessage(next, entering.id, (message) => ({ ...message, consults: [...message.consults, record].slice(-KEPT_CONSULTS) })), id];
    const latest = next.runs.at(-1);
    if (latest) return [toRun(next, latest.id), id];
  }
  const [placed, runId] = where.agentId ? ensureAgent(next, where.agentId, consult.startedAt) : ensureMain(next, consult.startedAt);
  return [toRun(placed, runId), id];
}

/** A Jev call ends, answered or not. */
export function consultEnd(
  s: TraceState,
  id: string,
  at: number,
  error?: string,
  result?: { observed?: string; usage?: TraceConsult["usage"] },
): TraceState {
  const end = (list: readonly TraceConsult[]) => list.map((one) => (one.id === id ? {
    ...one,
    endedAt: at,
    ...(error ? { error: clip(error, 160) } : {}),
    ...(result?.observed ? { observed: result.observed } : {}),
    ...(result?.usage ? { usage: { ...result.usage } } : {}),
  } : one));
  const owns = (list: readonly TraceConsult[]) => list.some((one) => one.id === id);
  const message = (one: TraceMessage) => (owns(one.consults) ? { ...one, consults: end(one.consults) } : one);
  return {
    ...s,
    inbox: s.inbox.map(message),
    runs: s.runs.map((run) => (owns(run.consults) || run.received.some((one) => owns(one.consults)) ? { ...run, consults: end(run.consults), received: run.received.map(message) } : run)),
  };
}

/**
 * What the person last asked Claude for: the messages they typed (origin "composer") in the newest run that carried
 * any, the ones it ran together and the ones Claude read while it ran, oldest first. A plugin's own prompt (a
 * rewrite plan, a feature's feedback) is not the person's. Empty when they asked nothing yet.
 */
export function lastAsked(s: TraceState): string {
  for (const run of [...s.runs].reverse()) {
    const typed = [run.message, ...(run.also ?? []), ...run.received.filter((message) => message.state === "delivered")]
      .filter((message): message is TraceMessage => message?.origin === "composer" && message.text.trim() !== "");
    if (typed.length) return typed.map((message) => message.text.trim()).join("\n");
  }
  return "";
}

// --- Turns ---

/**
 * turn.start (the main loop's only): a run opens, carrying the messages whose prompt rows entered (the engine runs
 * several queued ones as one turn, its text only the last's), else the idle message entering, if any. What was
 * queued in a turn that ended and did not enter is taken for withdrawn.
 */
export function startTurn(s: TraceState, turnId: string, text: string, at: number): TraceState {
  const known = s.runs.find((run) => run.id === turnId);
  if (known) return known.endedAt === undefined ? { ...s, active: known.id } : s;
  let next = s.active ? endRun(s, s.active, at, "superseded") : s;
  const loose = looseMessages(next);
  const carried = (next.carried ?? []).map((id) => loose.find((message) => message.id === id)).filter((message): message is TraceMessage => message !== undefined);
  const entering = next.entering ? next.inbox.find((message) => message.id === next.entering && message.state === "waiting") : undefined;
  const taken = carried.length ? carried : entering ? [entering] : [];
  const turns = next.turns + 1;
  const run = newRun(turnId, true, turns, taken.length ? "message" : text.trim() ? "unlinked" : "continuation", clip(text), at);
  if (taken.length) {
    const [first, ...rest] = taken as [TraceMessage, ...TraceMessage[]];
    // The consultations made for the messages move to their run, which counts them.
    run.message = { ...first, state: "linked", consults: [] };
    if (rest.length) run.also = rest.map((message) => ({ ...message, state: "linked", consults: [] }));
    if (first.plan?.checkpoints?.length) run.checkpoints = [...first.plan.checkpoints];
    run.consults = taken.flatMap((message) => message.consults).slice(-KEPT_CONSULTS);
    run.consultCount = run.consults.length;
    const ids = new Set(taken.map((message) => message.id));
    // A queued one stays on the trail of the turn it was typed in, naming the run that carried it.
    next = {
      ...(entering && ids.has(entering.id) ? omit(next, "entering") : next),
      inbox: next.inbox.filter((message) => !ids.has(message.id)),
      runs: next.runs.map((one) => (one.received.some((message) => ids.has(message.id))
        ? { ...one, received: one.received.map((message) => (ids.has(message.id) ? { ...message, state: "linked", ranIn: turnId, consults: [] } : message)) }
        : one)),
    };
  }
  next = withdrawLeft(omit(next, "carried"));
  return prune({ ...next, turns, active: turnId, runs: [...next.runs, run] });
}

export interface StepStart {
  turnId: string;
  agentId?: string;
  index: number;
  original: string;
  sent: string;
  effort?: string;
  /** Why it went as it did (TraceStep.route). */
  route?: string;
  at: number;
}

/** turn.step going down: the request the engine resolved and the one sent. */
export function stepStart(s: TraceState, step: StepStart): TraceState {
  const record: TraceStep = {
    turnId: step.turnId,
    ...(step.agentId ? { agentId: step.agentId } : {}),
    index: step.index,
    original: step.original,
    sent: step.sent,
    ...(step.effort ? { effort: step.effort } : {}),
    ...(step.route ? { route: step.route } : {}),
    startedAt: step.at,
  };
  const pushStep = (run: TraceRun) => ({ ...run, steps: [...run.steps, record].slice(-KEPT_STEPS) });
  if (step.agentId) {
    const agentId = step.agentId;
    const [next, runId] = ensureAgent(s, agentId, step.at);
    // A teammate waking for its next turn runs again.
    const woken = withAgent(next, runId, agentId, (agent) => ({ ...omit(omit(agent, "endedAt"), "effort"), state: "running", requests: agent.requests + 1, ...(step.effort ? { effort: step.effort } : {}) }));
    return withRun(woken, runId, pushStep);
  }
  const [next, runId] = ensureMain(s, step.at, step.turnId);
  return withRun(next, runId, (run) =>
    pushStep({
      ...run,
      main: {
        ...run.main,
        original: run.main.original ?? step.original,
        sent: add(run.main.sent, step.sent),
        ...(step.effort ? { effort: step.effort } : {}),
        requests: run.main.requests + 1,
      },
    }),
  );
}

/** A server tool call as a step's response lists it (`serverToolUses`). */
export interface ServerToolUse {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
}

export interface StepEnd {
  turnId: string;
  agentId?: string;
  index: number;
  at: number;
  /** usage.model: the model the response named. */
  observed?: string;
  stop: string | null;
  serverToolUses?: readonly ServerToolUse[];
  /** Raw counters the response provided; absent fields stay unknown. */
  usage?: TraceStep["usage"];
  /** The tokens the response reported: input with cache reads and writes, and output. */
  tokens?: { input: number; output: number };
}

/**
 * turn.step's response is whole: the model it named, and the server tool calls it carried. A
 * resumed response may list a call again under the same id: it is the same call, its end filled in.
 */
export function stepEnd(s: TraceState, step: StepEnd): TraceState {
  const run = step.agentId ? runOfAgent(s, step.agentId) : (s.runs.find((one) => one.id === step.turnId) ?? activeRun(s));
  if (!run) return s;
  let next = withRun(s, run.id, (one) => {
    const at = one.steps.findLastIndex((rec) => rec.turnId === step.turnId && rec.index === step.index && rec.agentId === step.agentId && rec.endedAt === undefined);
    const steps = at < 0 ? one.steps : one.steps.map((rec, i) => (i === at ? {
      ...rec,
      endedAt: step.at,
      stop: step.stop,
      ...(step.observed ? { observed: step.observed } : {}),
      ...(step.usage ? { usage: { ...step.usage } } : {}),
    } : rec));
    const main = !step.agentId && step.observed ? { ...one.main, observed: add(one.main.observed, step.observed) } : one.main;
    let advisor = one.advisor;
    let tools = one.tools;
    let toolCount = one.toolCount;
    const toolSources = { ...one.toolSources };
    for (const use of step.serverToolUses ?? []) {
      if (use.name === "advisor") {
        const seen = advisor.find((call) => call.id === use.id);
        if (seen) {
          advisor = advisor.map((call) => (call.id === use.id && call.endedAt === undefined && use.endedAt !== undefined ? { ...call, endedAt: use.endedAt } : call));
        } else {
          const call: TraceAdvisor = {
            id: use.id,
            name: use.name,
            ...(step.agentId ? { agentId: step.agentId } : {}),
            turnId: step.turnId,
            step: step.index,
            startedAt: use.startedAt,
            ...(use.endedAt !== undefined ? { endedAt: use.endedAt } : {}),
          };
          advisor = [...advisor, call].slice(-KEPT_ADVISOR);
        }
      } else if (!tools.some((tool) => tool.id === use.id)) {
        // Another tool the API ran itself (a server-side search): a tool of the run, by its source.
        const source = `server:${use.name}`;
        const tool: TraceTool = {
          id: use.id,
          ...(step.agentId ? { agentId: step.agentId } : {}),
          name: use.name,
          source,
          startedAt: use.startedAt,
          ...(use.endedAt !== undefined ? { endedAt: use.endedAt, result: "ok" as const } : {}),
        };
        tools = [...tools, tool].slice(-KEPT_TOOLS);
        toolCount++;
        toolSources[source] = (toolSources[source] ?? 0) + 1;
      }
    }
    const tokens = step.tokens
      ? { input: (one.tokens?.input ?? 0) + step.tokens.input, output: (one.tokens?.output ?? 0) + step.tokens.output }
      : one.tokens;
    return { ...one, steps, main, advisor, tools, toolCount, toolSources, ...(tokens ? { tokens } : {}) };
  });
  if (step.agentId && step.observed) {
    const model = step.observed;
    next = withAgent(next, run.id, step.agentId, (agent) => ({ ...agent, observed: add(agent.observed, model) }));
  }
  return next;
}

export type TurnEndReason = "answer" | "aborted" | "refusal" | "error";

/** turn.complete: a main run ends, or one turn of a subagent's loop does; `answer` is what it said. */
export function completeTurn(s: TraceState, turnId: string, at: number, reason: TurnEndReason, agentId?: string, answer?: string): TraceState {
  const said = answer?.trim() ? clip(answer.trim(), ANSWER_MAX) : undefined;
  if (agentId) {
    const run = runOfAgent(s, agentId);
    if (!run) return s;
    const state: AgentState = reason === "aborted" ? "aborted" : reason === "error" ? "error" : "done";
    return prune(withAgent(s, run.id, agentId, (agent) => ({ ...agent, state, endedAt: at, ...(said ? { result: said } : {}) })));
  }
  const run = s.runs.find((one) => one.id === turnId) ?? (activeRun(s)?.confirmed === false ? activeRun(s) : undefined);
  if (!run) return s;
  // The engine takes its queue in before the turn ends: what was typed during it and neither read in it nor entered
  // was taken back (a later prompt row still brings one back).
  const ended = withdrawLeft(endRun(s, run.id, at, reason));
  return prune(said ? withRun(ended, run.id, (one) => ({ ...one, answer: said })) : ended);
}

// --- Tools and subagents ---

export interface ToolStart {
  id: string;
  agentId?: string;
  name: string;
  at: number;
}

/** tool.call going down: Claude's or a subagent's call, by the loop it ran in. */
export function toolStart(s: TraceState, call: ToolStart): TraceState {
  const [next, runId] = call.agentId ? ensureAgent(s, call.agentId, call.at) : ensureMain(s, call.at);
  const source = toolSource(call.name);
  const record: TraceTool = { id: call.id, ...(call.agentId ? { agentId: call.agentId } : {}), name: call.name, source, startedAt: call.at };
  const counted = withRun(next, runId, (run) =>
    run.tools.some((tool) => tool.id === call.id)
      ? run
      : { ...run, tools: [...run.tools, record].slice(-KEPT_TOOLS), toolCount: run.toolCount + 1, toolSources: { ...run.toolSources, [source]: (run.toolSources[source] ?? 0) + 1 } },
  );
  return call.agentId ? withAgent(counted, runId, call.agentId, (agent) => ({ ...agent, tools: agent.tools + 1 })) : counted;
}

export interface ToolEnd {
  id: string;
  agentId?: string;
  at: number;
  result: "ok" | "error" | "denied";
  /** A successful edit, and the file it touched when the call named one. */
  edit?: boolean;
  file?: string;
}

export function toolEnd(s: TraceState, end: ToolEnd): TraceState {
  const run = s.runs.findLast((one) => one.tools.some((tool) => tool.id === end.id)) ?? (end.agentId ? runOfAgent(s, end.agentId) : activeRun(s));
  if (!run) return s;
  return withRun(s, run.id, (one) => ({
    ...one,
    tools: one.tools.map((tool) => (tool.id === end.id ? { ...tool, endedAt: end.at, result: end.result } : tool)),
    denied: one.denied + (end.result === "denied" ? 1 : 0),
    failed: one.failed + (end.result === "error" ? 1 : 0),
    ...(end.edit && end.result === "ok" ? { edits: one.edits + 1, files: end.file ? add(one.files, end.file).slice(-KEPT_FILES) : one.files } : {}),
  }));
}

export interface AgentStart {
  id: string;
  /** The loop it was spawned from (`parentAgentId`); absent when the main loop spawned it. */
  parent?: string;
  toolUseId?: string;
  type: string;
  description: string;
  model?: string;
  background?: boolean;
  at: number;
}

/** agent.spawn resolved: the subagent joins the run of the loop that spawned it. */
export function agentStart(s: TraceState, start: AgentStart): TraceState {
  const [next, runId] = start.parent ? ensureAgent(s, start.parent, start.at) : ensureMain(s, start.at);
  const agent: TraceAgent = {
    id: start.id,
    ...(start.parent ? { parent: start.parent } : {}),
    ...(start.toolUseId ? { toolUseId: start.toolUseId } : {}),
    type: start.type,
    description: clip(start.description, 80),
    ...(start.model ? { model: start.model } : {}),
    observed: [],
    state: "running",
    ...(start.background ? { background: true } : {}),
    startedAt: start.at,
    tools: 0,
    requests: 0,
  };
  // A respawn under a known id (a teammate) keeps its numbers and runs again.
  return withRun(next, runId, (run) =>
    run.agents.some((one) => one.id === start.id)
      ? { ...run, agents: run.agents.map((one) => (one.id === start.id ? { ...one, ...omit(agent, "observed"), tools: one.tools, requests: one.requests } : one)) }
      : { ...run, agents: [...run.agents, agent] },
  );
}

// --- Settings and housekeeping ---

/** Variables read only for being set: any non-empty value, "0" included, stops feature-flag fetching. */
export const PRESENCE_FLAGS = ["DISABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] as const;
/** Standard on/off variables: 1, true, yes or on (any casing) turn them on. */
export const BOOLEAN_FLAGS = ["DO_NOT_TRACK"] as const;
export const PROVIDER_FLAGS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"] as const;

const isOn = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

/**
 * What keeps the advisor off in this environment, as the documentation words each variable: the
 * advisor needs feature-flag fetching and the Anthropic API. Informative only: nothing here is
 * proof that it is available when no variable is set.
 */
export function advisorBlocker(env: Readonly<Record<string, string | undefined>>): AdvisorInfo["blocked"] {
  for (const variable of PRESENCE_FLAGS) if (env[variable]) return { kind: "flags", variable };
  for (const variable of BOOLEAN_FLAGS) if (isOn(env[variable])) return { kind: "flags", variable };
  for (const variable of PROVIDER_FLAGS) if (isOn(env[variable])) return { kind: "provider", variable };
  return undefined;
}

export const setAdvisorInfo = (s: TraceState, info: AdvisorInfo): TraceState => ({ ...s, advisor: info });

/** `/jev clear`: finished runs and refused messages go; what still runs stays. */
export function clearTrace(s: TraceState): TraceState {
  return { ...s, runs: s.runs.filter((run) => !isDone(run)), inbox: s.inbox.filter((message) => message.state === "waiting") };
}
