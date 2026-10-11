import type { AskJev } from "../request.ts";
import type { SystemOneRequest, SystemOneResult } from "../types.ts";
import { text } from "../../i18n.ts";

export async function reportJevEvent(report: (event: JevEvent) => unknown, event: JevEvent): Promise<void> {
  try {
    await report(event);
  } catch {}
}

export interface JevSent {
  model: string;
  questions: string[];
  /** Turns in the state's conversation; 0 for a call over plain content, as sift's are. */
  turns: number;
  /** The state's size in JSON characters. */
  chars: number;
  /** Who spoke last, or "state" when the call carries no conversation. */
  role: string;
  /** The newest turn, or the start of the state, clipped. */
  last: string;
  /** Each question as Jev read it: its kind, the instructions (the prompt itself) and the options offered. */
  asks?: JevAsk[];
}

/** One question of a call, cut for the live log: what Jev was told to judge, and among what. */
export interface JevAsk {
  name: string;
  type: "choice" | "noul";
  prompt: string;
  /** The options' names, for a choice; their count is `optionCount`. */
  options: string[];
  optionCount: number;
}

/** One Jev call as its caller reports it, whichever process asked: the mod's routing points and sift alike. */
export type JevEvent =
  | { phase: "start"; call: string; at: number; sent: JevSent }
  | { phase: "end"; call: string; at: number; result: SystemOneResult }
  | { phase: "fail"; call: string; at: number; error: string };

const SENT_CLIP = 240;
const PROMPT_CLIP = 600;
const OPTIONS_KEPT = 12;

export function jevSent(request: SystemOneRequest): JevSent {
  const conversation = Array.isArray(request.state?.conversation) ? request.state.conversation : [];
  const last = conversation.at(-1) as Record<string, unknown> | undefined;
  const state = JSON.stringify(request.state);
  return {
    model: request.model,
    questions: Object.keys(request.questions),
    turns: conversation.length,
    chars: state.length,
    role: last ? String(last.role ?? "?") : "state",
    last: (last ? String(last.text ?? last.content ?? JSON.stringify(last.tool_calls ?? last)) : state).slice(0, SENT_CLIP),
    asks: Object.entries(request.questions).map(([name, question]) => {
      const options = question.type === "choice" ? Object.keys(question.criteria ?? {}) : [];
      return {
        name,
        type: question.type === "choice" ? "choice" : "noul",
        prompt: String(question.instructions ?? "").slice(0, PROMPT_CLIP),
        options: options.slice(0, OPTIONS_KEPT),
        optionCount: options.length,
      };
    }),
  };
}

/**
 * The one way to Jev: every caller wraps `createAskJev` in this, so `report` hears each call start
 * and end and the live log and the Flow tab show them all. A report that throws never fails the call.
 */
export function observeAskJev(ask: AskJev, report: (event: JevEvent) => unknown, now: () => number | Promise<number>, prefix = ""): AskJev {
  let count = 0;
  return async (request) => {
    const call = `${prefix}${++count}`;
    await reportJevEvent(report, { phase: "start", call, at: await now(), sent: jevSent(request) });
    let result: SystemOneResult;
    try {
      result = await ask(request);
    } catch (error) {
      await reportJevEvent(report, { phase: "fail", call, at: await now(), error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    await reportJevEvent(report, { phase: "end", call, at: await now(), result });
    return result;
  };
}

/** The setup check: one real call with a trivial question. */
