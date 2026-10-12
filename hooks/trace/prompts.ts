import type { TraceAdvice, TraceMessage, TracePlan, TraceState } from "../../types";
import { type Submitted } from "./types.ts";
import { KEPT_ADVISOR, KEPT_INBOX, KEPT_RECEIVED, ANSWER_MAX } from "./constants.ts";
import { clip, omit, nextId, withRun, activeRun, changeMessage } from "./state.ts";

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
export const looseMessages = (s: TraceState) => [...s.inbox, ...s.runs.flatMap((run) => run.received)];

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
    .filter((message) => (message.state === "queued" || message.state === "withdrawn") && row.includes(message.text.replace(/(?:\.\.\.|…)$/, "")))
    .sort((a, b) => a.at - b.at)[0];
  return found ? changeMessage(s, found.id, (message) => ({ ...message, state: "delivered" })) : s;
}

/** What was typed during a turn that ended, neither read inside it nor entered after it, was taken back. */
export function withdrawLeft(s: TraceState): TraceState {
  const carried = new Set(s.carried ?? []);
  const left = (message: TraceMessage) => message.state === "queued" && !carried.has(message.id);
  return {
    ...s,
    runs: s.runs.map((run) => (run.endedAt !== undefined && run.received.some(left)
      ? { ...run, received: run.received.map((message) => (left(message) ? { ...message, state: "withdrawn" } : message)) }
      : run)),
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
