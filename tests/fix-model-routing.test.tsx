// The main loop's model switch stays safe, a refusal needs more than one empty answer, a prompt
// typed mid-turn keeps the running turn's plan, and another plugin's tool call is left alone.
import type { On, RenderPropsOf } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

import { DEFAULT_FEATURES, type Features } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import { answerJev, noul, pick, step } from "./helpers.ts";

const ORIGIN = { kind: "composer" } as const;
const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 100,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 60, contentRows: 60 },
} as unknown as RenderPropsOf["Pane"];
const ANSWERS = { tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("sonnet", 0.9) };
const DONE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** The engine beneath the mod; `empty` says which requests come back with no response. */
function world(on: On, features: Partial<Features>, empty: (index: number) => boolean = () => false, table: Record<string, Answer> = ANSWERS) {
  mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });
  mock.store(on, { provider: "typesafe", features: { ...DEFAULT_FEATURES, ...features } });
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
  const sent: string[] = [];
  const sentEfforts: unknown[] = [];
  on("turn.step", async function* (_$, e) {
    sent.push(e.model);
    sentEfforts.push(e.effort);
    return empty(e.index)
      ? { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: null, usage: null }
      : { turnId: e.turnId, index: e.index, answer: "Done.", toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model } };
  });
  return { sent, sentEfforts, jev, toasts };
}

describe("the main loop's model switch", () => {
  test("a manual model is not reclassified and keeps its supported effort planning", async ($, on) => {
    const { sent, sentEfforts, jev } = world(on, { model: true, effort: true }, () => false,
      { ...ANSWERS, model: pick("haiku", 0.99), effort: pick("max", 0.99) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.classic.PostModelSwitch({ from_model: "claude-sonnet-5-5", to_model: "claude-opus-5-5", context_tokens: 0,
      prompt_cache_warm: false, cache_ttl: "5m", estimated_cache_write_usd: 0, pricing: "catalog", requested_model: "opus", source: "command" });
    await $.prompt.submit({ text: "investigate the race condition", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", effort: "high", messageCount: 1 });
    expect(jev.asked[0]!.questions.model).toBeUndefined();
    expect(sent).toEqual(["claude-opus-5-5"]);
    expect(sentEfforts).toEqual(["max"]);
  });

  test("a session on a [1m] context keeps its model", async ($, on) => {
    const { sent } = world(on, { model: true });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5[1m]", messageCount: 1 });
    expect(sent).toEqual(["claude-opus-5-5[1m]"]);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-live" });
    expect(await ui.find({ type: "Text", text: /kept opus-5-5\[1m\] over Jev's sonnet-5-5/ })).toBeDefined();
    await ui.unmount();
  });

  test("a provider's model id (Bedrock, Vertex) is kept", async ($, on) => {
    const { sent } = world(on, { model: true });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    for (const [n, id] of ["us.anthropic.claude-opus-5-5-v1:0", "anthropic.claude-opus-5-5", "claude-opus-5-5@20260101"].entries()) {
      await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
      await step($ as never, { turnId: `t${n}`, index: 0, model: id, messageCount: 1 });
    }
    expect(sent).toEqual(["us.anthropic.claude-opus-5-5-v1:0", "anthropic.claude-opus-5-5", "claude-opus-5-5@20260101"]);
  });

  test("a model the person picked with /model is kept, until they go back to the default", async ($, on) => {
    const { sent } = world(on, { model: true });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const SWITCH = { from_model: "claude-sonnet-5-5", to_model: "claude-opus-5-5", context_tokens: 0, prompt_cache_warm: false, cache_ttl: "5m", estimated_cache_write_usd: 0, pricing: "catalog" } as const;
    await $.classic.PostModelSwitch({ ...SWITCH, requested_model: "opus", source: "command" });
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await $.classic.PostModelSwitch({ ...SWITCH, requested_model: null, source: "picker" });
    await $.prompt.submit({ text: "rename another", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t2", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    expect(sent).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
  });
});

describe("a switched model that comes back empty", () => {
  test("excluding one failed candidate leaves other model changes available", async ($, on) => {
    const table = { ...ANSWERS };
    const { sent, jev } = world(on, { model: true }, (index) => index < 2, table);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "fix the local bug", wait: false, origin: ORIGIN });
    for (const index of [0, 1]) await step($ as never, { turnId: "t1", index, model: "claude-opus-5-5", messageCount: index + 1 });
    table.model = pick("haiku", 0.99);
    await $.prompt.submit({ text: "format the file", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t2", index: 2, model: "claude-opus-5-5", messageCount: 3 });
    expect(sent).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    const question = jev.asked.at(-1)!.questions.model;
    if (question?.type !== "choice") throw new Error("expected a model question");
    expect(Object.keys(question.criteria)).not.toContain("claude-sonnet-5-5");
  });

  test("an uncertain downgrade keeps the last successful model across turns", async ($, on) => {
    const table = { ...ANSWERS };
    const { sent } = world(on, { model: true }, () => false, table);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "implement the function", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    table.model = pick("haiku", 0.8);
    await $.prompt.submit({ text: "fix the next issue", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t2", index: 1, model: "claude-opus-5-5", messageCount: 2 });
    expect(sent).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
  });

  test("a configured exact model version reaches the native request", { options: { claude_models: "claude-sonnet-4-6,claude-opus-5-5", locale: "pt" } }, async ($, on) => {
    const { sent, jev } = world(on, { model: true }, () => false, { ...ANSWERS, model: pick("claude-sonnet-4-6", 0.99) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "implemente esta função", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    expect(sent).toEqual(["claude-sonnet-4-6"]);
    expect(jev.asked[0]!.questions.model?.instructions).toContain("Select the least costly");
    expect(jev.asked[0]!.state.current_request).toBe("implemente esta função");
  });

  test("one empty answer (an interrupt, a dropped connection) does not stop model switching", async ($, on) => {
    const { sent } = world(on, { model: true }, (index) => index === 0);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await step($ as never, { turnId: "t1", index: 1, model: "claude-opus-5-5", messageCount: 2 });
    expect(sent).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
  });

  test("two empty answers in a row exclude that model for the session", async ($, on) => {
    const { sent } = world(on, { model: true }, (index) => index < 2);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    for (const index of [0, 1, 2]) await step($ as never, { turnId: "t1", index, model: "claude-opus-5-5", messageCount: index + 1 });
    expect(sent).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  });
});

describe("a prompt typed into a running turn", () => {
  test("is not routed and leaves the running turn's plan alone", async ($, on) => {
    const { sent, jev } = world(on, { model: true });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    expect(jev.calls).toBe(1);
    const queued = await $.prompt.submit({ text: "also fix the tests", wait: false, origin: ORIGIN, turnId: "t1" } as never);
    expect(jev.calls).toBe(1);
    expect((queued as { context?: readonly string[] }).context).toBeUndefined();
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    expect(sent).toEqual(["claude-sonnet-5-5"]);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-live" });
    expect(await ui.find({ type: "Text", text: /joins the running turn/ })).toBeDefined();
    await ui.unmount();
  });
});

describe("another plugin's own tool call", () => {
  const OTHER = {
    name: "other",
    register(on: On) {
      on("turn.complete", async ($, e, next) => {
        const done = await $.tool.call({ tool: "Read", file_path: "notes.md" });
        $.ui.toast(`context ${(done.context ?? []).length}`);
        return next(e);
      });
    },
  };

  test("is passed through: no Jev request, no hint on its result", { plugins: [OTHER] }, async ($, on) => {
    const { jev, toasts } = world(on, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    // Claude's own tool call is routed, as a control.
    const own = await $.tool.call({ tool: "Read", file_path: "README.md", tool_use_id: "toolu-own" } as never);
    expect(jev.calls).toBe(1);
    expect(own.context?.length).toBe(1);
    await $.turn.complete({ turnId: "t1", answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    expect(jev.calls).toBe(1);
    expect(toasts).toEqual(["context 0"]);
  });

  const OTHER_WITH_ID = {
    name: "other",
    register(on: On) {
      on("turn.complete", async ($, e, next) => {
        const done = await $.tool.call({ tool: "Read", file_path: "notes.md", tool_use_id: "toolu-other" } as never);
        $.ui.toast(`context ${(done.context ?? []).length}`);
        return next(e);
      });
    },
  };

  test("is passed through by its origin, even when it carries a tool_use_id", { plugins: [OTHER_WITH_ID] }, async ($, on) => {
    const { jev, toasts } = world(on, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.turn.complete({ turnId: "t1", answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    expect(jev.calls).toBe(0);
    expect(toasts).toEqual(["context 0"]);
  });
});
