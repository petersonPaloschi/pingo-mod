import type { TraceConsult, TraceMessage, TraceState } from "../../types";
import { type ConsultWhere } from "./types.ts";
import { KEPT_CONSULTS } from "./constants.ts";
import { clip, nextId, withRun, ensureMain, ensureAgent, changeMessage } from "./state.ts";

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
