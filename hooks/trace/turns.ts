import type { AgentState, TraceAdvisor, TraceAgent, TraceMessage, TraceRun, TraceState, TraceStep, TraceTool } from "../types";
import { type StepStart, type StepEnd, type TurnEndReason, type ToolStart, type ToolEnd, type AgentStart } from "./types.ts";
import { KEPT_STEPS, KEPT_TOOLS, KEPT_CONSULTS, KEPT_ADVISOR, KEPT_FILES, ANSWER_MAX } from "./constants.ts";
import { clip, toolSource, add, omit, newRun, withRun, activeRun, runOfAgent, endRun, prune, ensureMain, ensureAgent, withAgent } from "./state.ts";
import { looseMessages, withdrawLeft } from "./prompts.ts";

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
