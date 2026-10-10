import type { On } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { defaultPolicy, editPolicy, ORCHESTRATION_STORE } from "../hooks/core/orchestration.ts";
import { step, world } from "./helpers.ts";

const COMPLEX_PROMPT = "Refatore a arquitetura do fluxo de orquestração em hooks/orchestrate.ts e hooks/core/objective.ts, e investigue a causa raiz do teste flaky que ainda falha.";

type Entry = { kind: string; text: string; detail?: string };

/** The Live feed as the mod last wrote it. */
function liveFeed(on: On): () => Entry[] {
  let feed: Entry[] = [];
  on("state.set", async (_$, e, next) => {
    if (e.key === "feed") feed = e.value as Entry[];
    return next(e);
  });
  return () => feed;
}

/** The controlled advisor: records each completion and answers with fixed guidance. */
function guidanceModel(on: On) {
  const calls: { model: string; effort?: string; prompt: string }[] = [];
  on("model.complete", async (_$, e) => {
    calls.push({ model: e.model, effort: e.effort, prompt: String((e as { prompt: unknown }).prompt) });
    return { value: { isAnswered: true, text: "Check the loader contract first.", usage: { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never;
  });
  return calls;
}

describe("the advisor decides per prompt while orchestration is off", () => {
  test("a simple prompt leaves the advisor off, with the decision in Live", async ($, on) => {
    const setup = world(on, {});
    const feed = liveFeed(on);
    const calls = guidanceModel(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const submitted = await $.prompt.submit({ text: "qual é a versão do node?", wait: false, origin: { kind: "composer" } }) as { context?: string[] };
    expect(calls).toEqual([]);
    expect(setup.jev.calls).toBe(0);
    expect(submitted.context?.join("\n") ?? "").not.toMatch(/advisor guidance/);
    const line = feed().find((entry) => entry.text.startsWith("Advisor off"));
    expect(line?.text).toMatch(/simple request \(score -?\d+, turns on from 4\)/);
    expect(line?.detail).toMatch(/decided by local heuristic, no extra call · executor native/);
  });

  test("a complex prompt turns the advisor on with its chosen model, and the guidance rides along", async ($, on) => {
    const setup = world(on, {});
    const feed = liveFeed(on);
    const calls = guidanceModel(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const submitted = await $.prompt.submit({ text: COMPLEX_PROMPT, wait: false, origin: { kind: "composer" } }) as { context?: string[] };
    expect(setup.jev.calls).toBe(0);
    expect(calls.map(({ model, effort }) => ({ model, effort }))).toEqual([{ model: "claude-sonnet-5-5", effort: "high" }]);
    expect(calls[0]!.prompt).toContain("causa raiz");
    expect(submitted.context?.join("\n")).toMatch(/Pingo advisor guidance \(plan; optional, not approval\):\nCheck the loader contract first\./);
    expect(feed().find((entry) => entry.text.startsWith("Advisor on"))?.text).toBe("Advisor on · Sonnet 5.5 high · complex request (score 5, turns on from 4)");
    expect(feed().some((entry) => entry.text.startsWith("Advisor answered · Sonnet 5.5 high"))).toBe(true);
    // The main loop stays native: orchestration off never rewrites the executor.
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 1 });
    expect(setup.sent).toEqual([{ model: "claude-opus-5-5", effort: "medium" }]);
  });

  test("the user's fixed advisor choices win over the local decision", async ($, on) => {
    const setup = world(on, {});
    const feed = liveFeed(on);
    const calls = guidanceModel(on);
    setup.store[ORCHESTRATION_STORE] = editPolicy(defaultPolicy(), (p) => { p.advice = "off"; });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: COMPLEX_PROMPT, wait: false, origin: { kind: "composer" } });
    expect(calls).toEqual([]);
    expect(feed().some((entry) => entry.text === "Advisor off · fixed to off")).toBe(true);
    // Always on with a pinned advisor: a simple prompt gets guidance from exactly that profile.
    setup.store[ORCHESTRATION_STORE] = editPolicy(defaultPolicy(), (p) => { p.advice = "on"; p.override.advisor = { model: "claude-opus-5-5", effort: "medium" }; });
    await $.prompt.submit({ text: "hello", wait: false, origin: { kind: "composer" } });
    expect(calls.map(({ model, effort }) => ({ model, effort }))).toEqual([{ model: "claude-opus-5-5", effort: "medium" }]);
    expect(feed().find((entry) => entry.text.startsWith("Advisor on"))?.detail).toMatch(/model by override/);
  });

  test("with Jev inactive (routing off) the advisor makes no call", async ($, on) => {
    const setup = world(on, {});
    setup.store.routing = false;
    const feed = liveFeed(on);
    const calls = guidanceModel(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: COMPLEX_PROMPT, wait: false, origin: { kind: "composer" } });
    expect(calls).toEqual([]);
    expect(feed().some((entry) => entry.text === "Advisor off · Jev inactive (routing off)")).toBe(true);
  });

  test("a failed consult is logged as a failure, not as off, and adds nothing to the prompt", async ($, on) => {
    world(on, {});
    const feed = liveFeed(on);
    on("model.complete", async () => ({ value: { isAnswered: false, reason: "timeout" } }) as never);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const submitted = await $.prompt.submit({ text: COMPLEX_PROMPT, wait: false, origin: { kind: "composer" } }) as { context?: string[] };
    expect(submitted.context?.join("\n") ?? "").not.toMatch(/advisor guidance/);
    expect(feed().find((entry) => entry.text.startsWith("Advisor failed"))?.text).toMatch(/^Advisor failed · Sonnet 5\.5 high · timeout · /);
  });
});
