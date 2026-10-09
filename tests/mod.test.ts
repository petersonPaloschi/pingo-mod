import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

import { DEFAULT_FEATURES } from "../hooks/core/plan.ts";
import { mockStore, step } from "./helpers.ts";

const ORIGIN = { kind: "composer" } as const;

function world(on: On) {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  const store: Record<string, unknown> = { provider: "typesafe", features: { ...DEFAULT_FEATURES }, routing: true };
  mockStore(on, store);
  mock.env(on, { TYPESAFE_API_KEY: "test-key" });
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.model", async () => ({ value: "claude-sonnet-5-5" }));
  on("session.id", async () => ({ value: "session-mod" }));
  on("settings.read", async () => ({ value: {} }) as never);

  let fetched = 0;
  on("http.fetch", async () => {
    fetched++;
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const contexts: (readonly string[] | undefined)[] = [];
  on("prompt.submit", async (_$, e) => {
    contexts.push(e.context);
    return { text: e.text, ...(e.context ? { context: e.context } : {}) };
  });
  on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
  on("classic.SessionStart", async () => ({} as never));
  on("turn.step", async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "done",
      toolUses: [],
      stopReason: "end_turn" as const,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: "claude-observed-5-5" },
    };
  });
  return { store, contexts, fetched: () => fetched };
}

describe("main-request diagnostics", () => {
  test("does not call Jev for a prompt and records the observed model and usage", async ($, on) => {
    const setup = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "show me package.json", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-sonnet-5-5", messageCount: 1 });

    expect(setup.fetched()).toBe(0);
    expect(setup.contexts).toEqual([undefined]);
    expect(setup.store.events).toMatchObject([{
      model: "claude-observed-5-5",
      mode: "passthrough",
      reason: "not_asked",
      usage: { input: 10, output: 5, cached: 0, cacheWrite: 0 },
    }]);
    expect((setup.store.events as unknown[])[0]).not.toHaveProperty("tools");
  });

  test("routing-off diagnostics survive a session reset without a Jev request", async ($, on) => {
    const setup = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.command.run({ command: "jev", args: "routing off", origin: ORIGIN } as never);
    expect(await $.command.run({ command: "jev", args: "status", origin: ORIGIN } as never)).toMatchObject({ text: expect.stringContaining("Routing: off") });

    await $.classic.SessionStart({ source: "clear" } as never);
    await $.prompt.submit({ text: "show me package.json", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t2", index: 0, model: "claude-sonnet-5-5", messageCount: 1 });

    expect(setup.fetched()).toBe(0);
    expect((setup.store.events as { reason?: string }[]).at(-1)?.reason).toBe("routing_disabled");
  });
});
