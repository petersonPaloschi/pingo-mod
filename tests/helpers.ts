import type { On, RenderPropsOf } from "claude-code";
import { mock } from "claude-code/testing";

import { DEFAULT_FEATURES, type Features } from "../hooks/core/plan.ts";
import type { Answer, ChoiceAnswer, NoulAnswer, SystemOneRequest } from "../hooks/core/types.ts";

export const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 80,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} satisfies RenderPropsOf["Pane"];

const ASK = { origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as const;

export async function status($: { command: { run: (input: never) => Promise<{ text?: string }> } }) {
  return (await $.command.run({ command: "jev", args: "status", ...ASK } as never)).text ?? "";
}

export function successfulFetches(on: On) {
  const authorization: (string | undefined)[] = [];
  on("http.fetch", async (_$, e) => {
    authorization.push(e.init?.headers?.authorization);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  return authorization;
}

export const pick = (choice: string, confidence: number): ChoiceAnswer => ({
  type: "choice",
  choice,
  confidence,
  probabilities: { [choice]: 1 },
});

export const noul = (value: number): NoulAnswer => ({ type: "noul", noul: value });

export const DEFAULT_ANSWERS: Record<string, Answer> = {
  model: pick("sonnet", 0.9),
  effort: pick("medium", 0.9),
};

export function answerJev(request: SystemOneRequest, table: Record<string, Answer>): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(request.questions ?? {})) {
    const answer = table[key];
    if (!answer) continue;
    if (answer.type !== "choice" || question.type !== "choice") {
      answers[key] = answer;
      continue;
    }
    const offered = Object.keys(question.criteria).find((id) => id === answer.choice || id.startsWith("claude-" + answer.choice + "-"));
    answers[key] = offered ? { ...answer, choice: offered, probabilities: { [offered]: 1 } } : answer;
  }
  return answers;
}

type SentStep = { model: string; effort?: unknown; agentId?: string };
type WorldOptions = { empty?: (index: number) => boolean };
type MutableStore = Record<string, unknown> & { provider: string; features: Features };

export function mockStore(on: On, store: Record<string, unknown>): void {
  const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
  on("store.get", async (_$, e) => ({ value: clone(store[e.key]) }));
  on("store.set", async (_$, e) => {
    store[e.key] = clone(e.value);
    return { value: undefined };
  });
  on("store.delete", async (_$, e) => {
    delete store[e.key];
    return { value: undefined };
  });
  on("store.keys", async () => ({ value: Object.keys(store) }));
}

/** Shared native-agent session fixture. The answer table stays live between requests. */
export function world(
  on: On,
  flags: Partial<Features>,
  table: Record<string, Answer> = { ...DEFAULT_ANSWERS },
  { empty = () => false }: WorldOptions = {},
) {
  mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });

  const store: MutableStore = {
    provider: "typesafe",
    features: { ...DEFAULT_FEATURES, ...flags },
  };
  mockStore(on, store);

  mock.env(on, { TYPESAFE_API_KEY: "test-key" });
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: [{ name: "Read", description: "Read a file", mcp: false }] }));
  on("session.messages", async () => ({ value: [] }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-fix" }));
  on("prompt.compose", async () => ({ sections: [] }));

  const jev = { calls: 0, asked: [] as SystemOneRequest[] };
  on("http.fetch", async (_$, e) => {
    jev.calls++;
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    jev.asked.push(request);
    const answers = answerJev(request, table);
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });
  on("prompt.submit", async (_$, e) => ({ text: e.text, ...(e.context ? { context: e.context } : {}) }));
  on("classic.PostModelSwitch", () => ({}));
  on("tool.call", async () => ({ result: "ok" }) as never);
  on("turn.complete", async (_$, e) => ({ text: e.answer }));

  const toasts: string[] = [];
  on("ui.toast", async (_$, e) => {
    toasts.push(e.text);
    return { value: undefined } as never;
  });

  const sent: SentStep[] = [];
  on("turn.step", async function* (_$, e) {
    sent.push({ model: e.model, effort: e.effort, ...(e.agentId ? { agentId: e.agentId } : {}) });
    return empty(e.index)
      ? { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: null, usage: null }
      : {
          turnId: e.turnId,
          index: e.index,
          answer: "Done.",
          toolUses: [],
          stopReason: "end_turn" as const,
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model },
        };
  });

  return { jev, sent, store, toasts };
}

export async function step(
  $: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } },
  e: object,
) {
  const stream = $.turn.step(e as never);
  for await (const _ of stream) void _;
  return stream.result;
}
