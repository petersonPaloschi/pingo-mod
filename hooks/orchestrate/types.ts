import type { Effort } from "../core/contracts.ts";
import type { AskJev } from "../core/request.ts";
import { type Complete } from "../core/review.ts";
import type { Settings } from "../config.ts";
import type { TraceAdvice } from "../../types";

export type Tone = "info" | "good" | "warn" | "bad" | "muted";

/**
 * What register.tsx lends: the engine calls this module needs, as plain functions (only the hooks
 * module may hold `$`), plus its settings, Jev gate and client, live log and run bookkeeping.
 */
export interface Io {
  storeGet: (key: string) => Promise<unknown>;
  storeSet: (key: string, value: unknown) => Promise<unknown>;
  storeDelete: (key: string) => Promise<unknown>;
  now: () => Promise<number>;
  complete: Complete;
  spawn: (args: { prompt: string; description?: string; subagentType?: string; model?: string }) => Promise<{ agentId?: string; model?: string } | { deny: string }>;
  agents: () => Promise<readonly { id: string; status: string; description: string }[]>;
  run: (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  settings: () => Promise<Settings>;
  /** Why Jev cannot be asked now (routing off, no key), or undefined. */
  gate: (config: Settings) => Promise<string | undefined>;
  askJev: (config: Settings, where: { origin: "prompt" | "unit"; trigger?: string; agentId?: string }) => AskJev;
  log: (tone: Tone, line: string, detail?: string) => Promise<void>;
  /** The effort turn.step should size a subagent's requests with. */
  setAgentEffort: (agentId: string, effort: Effort) => void;
  /** Records the advisor's decision and outcome for the prompt being entered, for the Flow tab. */
  noteAdvice?: (change: Partial<TraceAdvice>) => Promise<void>;
  /** Guidance the local advisor gave this session while orchestration was off (no objective to count it on). */
  localAdviceUsed?: () => Promise<number>;
  /** Counts one more piece of local guidance for this session. */
  countLocalAdvice?: () => Promise<void>;
  /** This session's id: its objective is kept under a key of its own. */
  sessionId?: () => Promise<string | undefined>;
  /** Every key in the store, to drop objectives no session will read again. */
  storeKeys?: () => Promise<string[]>;
}
