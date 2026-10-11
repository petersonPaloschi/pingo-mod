import type { TraceStep } from "../types";

export interface RunTiming {
  /** The submitted prompt time, before Jev planning when the message is linked. */
  promptAt: number;
  /** Prompt-to-main-turn completion; absent until the main turn ends. */
  mainResponseMs?: number;
  /** Prompt-to-last relevant completion, using the latest parallel branch end. */
  totalMs: number;
  complete: boolean;
}

// --- Messages ---

export interface Submitted {
  text: string;
  at: number;
  origin: string;
  /** prompt.submit's turnId: the turn running when it was typed or delivered. */
  during?: string;
}

// --- Jev ---

export interface ConsultWhere {
  /** A routing point at a prompt: the message it was asked for. */
  messageId?: string;
  /** Asked from inside a subagent's loop (an agent's planning names the parent loop). */
  agentId?: string;
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

export type TurnEndReason = "answer" | "aborted" | "refusal" | "error";

export interface ToolStart {
  id: string;
  agentId?: string;
  name: string;
  at: number;
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
