// What the tests share: answers, the engine beneath the mod and a fake Jev, written once so every
// file stubs the provider the same way. Not a test file itself.
import type { On, RenderPropsOf } from "claude-code";
import { mock } from "claude-code/testing";

import { DEFAULT_FEATURES, type Features } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest, SystemOneResult } from "../hooks/core/types.ts";

export const pick = (choice: string, confidence: number): Answer => ({ type: "choice", choice, confidence, probabilities: { [choice]: 1 } });
export const noul = (value: number): Answer => ({ type: "noul", noul: value });

/** The default features with some switched. */
export const features = (over: Partial<Features> = {}): Features => ({ ...DEFAULT_FEATURES, ...over });

/** A finished request's usage. */
export const DONE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

export const ORIGIN = { kind: "composer" } as const;
export const ASK = { origin: ORIGIN, presentation: { isFullscreen: true, columns: 160 } } as const;

/** The dashboard pane's props, at a size tall enough to show what a test reads. */
export const paneProps = (bodyColumns = 100, rows = 80) => ({
  title: "Jev",
  isFocused: true,
  bodyColumns,
  placement: "dock",
  scroll: { offset: 0, bodyRows: rows, contentRows: rows },
}) as unknown as RenderPropsOf["Pane"];

/**
 * Jev's answers to `request`, from a table by question key. A choice names an option the question
 * offered: the option itself, or the configured id an alias stands for ("opus" → "claude-opus-…").
 */
export function answersFor(request: SystemOneRequest, table: Record<string, Answer>): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(request.questions ?? {})) {
    const answer = table[key];
    if (!answer) continue;
    const offered = answer.type === "choice" && question.type === "choice"
      ? Object.keys(question.criteria).find((id) => id === answer.choice || id.startsWith(`claude-${answer.choice}-`))
      : undefined;
    answers[key] = offered && answer.type === "choice" ? { ...answer, choice: offered, probabilities: { [offered]: 1 } } : answer;
  }
  return answers;
}

/** Jev as an in-memory call, for the core's functions. */
export function jevAsk(table: Record<string, Answer>) {
  const asked: SystemOneRequest[] = [];
  const ask = async (request: SystemOneRequest): Promise<SystemOneResult> => {
    asked.push(request);
    return { answers: answersFor(request, table), usage: { input_tokens: 300, output_tokens: 0 } };
  };
  return { asked, ask };
}

/** Jev behind the provider's HTTP endpoint, for the mod in the engine; `status` fails every call. */
export function fakeJev(on: On, table: Record<string, Answer>, opts: { status?: number } = {}) {
  const asked: SystemOneRequest[] = [];
  on("http.fetch", async (_$, e) => {
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    asked.push(request);
    if (opts.status) return { value: { status: opts.status, ok: false, headers: {}, text: "provider failed" } };
    const text = JSON.stringify({ answers: answersFor(request, table), usage: { input_tokens: 200, output_tokens: 0 } });
    return { value: { status: 200, ok: true, headers: {}, text } };
  });
  return { asked };
}

export interface EngineOptions {
  features?: Partial<Features>;
  now?: string;
  sessionId?: string;
  model?: string;
  /** Routing switched off in the store. */
  routing?: boolean;
  /** No Jev key in the environment. */
  key?: boolean;
  /** The test keeps its own store: none is mocked. */
  ownStore?: boolean;
}

/** The engine calls the mod makes at every routing point, answered as a quiet session would. */
export function engine(on: On, opts: EngineOptions = {}) {
  const clock = mock.clock(on, { now: Date.parse(opts.now ?? "2026-10-07T12:00:00Z") });
  if (!opts.ownStore) {
    mock.store(on, { provider: "typesafe", features: features(opts.features), ...(opts.routing === false ? { routing: false } : {}) });
  }
  mock.env(on, opts.key === false ? {} : { TYPESAFE_API_KEY: "test-key" });
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: [{ name: "Read", description: "Read a file", mcp: false }] }));
  on("session.messages", async () => ({ value: [] }));
  on("session.model", async () => ({ value: opts.model ?? "claude-opus-5-5" }));
  on("session.id", async () => ({ value: opts.sessionId ?? "session-1234" }));
  on("prompt.compose", async () => ({ sections: [] }));
  return { clock };
}

/** Each model request the mod sent on, answered at once. */
export function requests(on: On, answer = "Done.") {
  const sent: { model: string; effort?: unknown; agentId?: string }[] = [];
  on("turn.step", async function* (_$, e) {
    sent.push({ model: e.model, effort: e.effort, ...(e.agentId ? { agentId: e.agentId } : {}) });
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model } };
  });
  return sent;
}

/** Runs one model request through the mod and returns its result. */
export async function step($: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } }, e: object) {
  const stream = $.turn.step(e as never);
  for await (const _ of stream) void _;
  return stream.result;
}
