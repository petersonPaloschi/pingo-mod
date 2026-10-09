// Robustness: concurrent request logging, stable subagent numbers, teammates across turns, and scroll fallback.
import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

import { DEFAULT_FEATURES, type Features } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import type { RouteEvent } from "../types";
import { PANE_PROPS as basePaneProps, pick, step } from "./helpers.ts";

const ASK = { origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as const;
const PANE_PROPS = {
  ...basePaneProps,
  bodyColumns: 100,
  scroll: { ...basePaneProps.scroll, bodyRows: 20 },
};
const SPAWN = {
  tool_use_id: "toolu-agent",
  prompt: "Find every caller of decide().",
  description: "find callers",
  subagentType: "Custom",
  provider: { plugin: "engine", tier: "core" },
  parentModel: "claude-opus-5-5",
  background: false,
  fork: false,
};
/**
 * A session with Jev answering from `table`. The store is the test's own, so it can be read back,
 * and each store call waits a tick, as a file write does, so concurrent writers interleave.
 */
function world(on: On, features: Partial<Features> = {}, table: Record<string, Answer> = {}) {
  const clock = mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });
  const store: Record<string, unknown> = { provider: "typesafe", features: { ...DEFAULT_FEATURES, ...features } };
  const tick = async () => {
    await Promise.resolve();
  };
  on("store.get", async (_$, e) => {
    await tick();
    return { value: store[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(store[e.key])) };
  });
  on("store.set", async (_$, e) => {
    await tick();
    await tick();
    store[e.key] = JSON.parse(JSON.stringify(e.value));
    return { value: undefined };
  });
  on("store.delete", async (_$, e) => {
    delete store[e.key];
    return { value: undefined };
  });
  on("store.keys", async () => ({ value: Object.keys(store) }));
  mock.env(on, { TYPESAFE_API_KEY: "test-key" });
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: [{ name: "Read", description: "Read a file", mcp: false }] }));
  on("session.messages", async () => ({ value: [] }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-robust" }));
  on("prompt.compose", async () => ({ sections: [] }));
  on("http.fetch", async (_$, e) => {
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    const answers: Record<string, Answer> = {};
    for (const key of Object.keys(request.questions ?? {})) if (table[key]) answers[key] = table[key]!;
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });
  const sent: { model: string; effort?: unknown; agentId?: string }[] = [];
  on("turn.step", async function* (_$, e) {
    sent.push({ model: e.model, effort: e.effort, ...(e.agentId ? { agentId: e.agentId } : {}) });
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: "end_turn" as const, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model } };
  });
  on("turn.complete", async (_$, e) => ({ text: e.answer }));
  const opened: string[] = [];
  on("ui.open", async (_$, e) => {
    opened.push(e.id);
    return { value: { isPlaced: true } } as never;
  });
  on("ui.close", async () => ({ value: undefined }) as never);
  return { clock, store, sent, opened };
}

describe("the request log", () => {
  test("requests finishing at once each keep their event, numbered once", async ($, on) => {
    const { store } = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    // The main loop and two subagents finish a request together.
    await Promise.all([
      step($ as never, { turnId: "t-main", index: 0, model: "claude-opus-5-5", messageCount: 1 }),
      step($ as never, { turnId: "t-a", index: 0, model: "claude-sonnet-5-5", messageCount: 1, agentId: "agent-a" }),
      step($ as never, { turnId: "t-b", index: 0, model: "claude-sonnet-5-5", messageCount: 1, agentId: "agent-b" }),
    ]);
    const kept = store.events as RouteEvent[];
    expect(kept).toHaveLength(3);
    expect(kept.map((event) => event.seq)).toEqual([1, 2, 3]);
    // The pane shows the same list the store holds, not a stale copy.
    const status = (await $.command.run({ command: "jev", args: "status", ...ASK })).text ?? "";
    expect(status).toContain("Requests logged: 3 ");
  });

  test("numbers keep counting up after the log is cleared", async ($, on) => {
    const { store } = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await step($ as never, { turnId: "t1", index: 1, model: "claude-opus-5-5", messageCount: 2 });
    await $.command.run({ command: "jev", args: "clear", ...ASK });
    expect(store.events).toEqual([]);
    await step($ as never, { turnId: "t2", index: 0, model: "claude-opus-5-5", messageCount: 3 });
    expect((store.events as RouteEvent[]).map((event) => event.seq)).toEqual([3]);
  });
});

describe("subagent numbers", () => {
  test("a number is never handed out twice, even after its run was removed", async ($, on) => {
    const { opened } = world(on);
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: e.tool_use_id.replace("toolu", "agent") }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    for (const id of ["toolu-1", "toolu-2"]) await $.agent.spawn({ ...SPAWN, tool_use_id: id } as never);
    for (const agentId of ["agent-1", "agent-2"]) {
      await $.turn.complete({ turnId: "t", agentId, answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    }
    // Every finished run goes; the next one still is #3, not #1 again.
    await $.command.run({ command: "jev", args: "agents clear", ...ASK });
    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-3" } as never);
    opened.length = 0;
    await $.command.run({ command: "jev", args: "agent", ...ASK });
    expect(opened).toEqual(["jev-agent-3"]);
    const old = await $.command.run({ command: "jev", args: "agent 1", ...ASK });
    expect(old.text).toContain('No subagent "1"');

    // Removing the highest-numbered run does not free its number either.
    await $.turn.complete({ turnId: "t", agentId: "agent-3", answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    await $.command.run({ command: "jev", args: "agent 3 remove", ...ASK });
    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-4" } as never);
    opened.length = 0;
    await $.command.run({ command: "jev", args: "agent", ...ASK });
    expect(opened).toEqual(["jev-agent-4"]);
  });
});

describe("static mascot rendering", () => {
  test("does not schedule frames for the removed animated art", async ($, on) => {
    const { clock } = world(on);
    let blits = 0;
    on("ui.blit", async () => { blits++; return { value: {} }; });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    for (let i = 0; i < 5; i++) await clock.advance(100);
    expect(blits).toBe(0);
    await clock.settle();
  });
});

describe("teammates", () => {
  test("a teammate keeps Jev's effort and its type after its first turn ends", async ($, on) => {
    const { sent, store } = world(on, { agents: true }, { model: pick("opus", 0.9), effort: pick("max", 0.9) });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "mate-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({ ...SPAWN, isTeammate: true, background: true } as never);
    await step($ as never, { turnId: "w1", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 1, agentId: "mate-1" });
    await $.turn.complete({ turnId: "w1", agentId: "mate-1", answer: "first pass done", durationMs: 10, isAborted: false, reason: "answer" });
    // A message wakes it: its next turn still runs on the effort Jev chose.
    await step($ as never, { turnId: "w2", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 3, agentId: "mate-1" });
    expect(sent.map((one) => one.effort)).toEqual(["max", "max"]);
    expect((store.events as RouteEvent[]).map((event) => event.agent)).toEqual(["Custom", "Custom"]);
  });

  test("a teammate that wakes up shows as running again", async ($, on) => {
    world(on, { agents: true }, { model: pick("opus", 0.9), effort: pick("max", 0.9) });
    let runs: { id: string; state: string; endedAt?: number }[] = [];
    on("state.set", async (_$, e, next) => {
      if (e.key === "agents") runs = e.value as typeof runs;
      return next(e);
    });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "mate-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({ ...SPAWN, isTeammate: true, background: true } as never);
    await step($ as never, { turnId: "w1", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 1, agentId: "mate-1" });
    await $.turn.complete({ turnId: "w1", agentId: "mate-1", answer: "first pass done", durationMs: 10, isAborted: false, reason: "answer" });
    expect(runs.find((run) => run.id === "mate-1")?.state).toBe("done");
    await step($ as never, { turnId: "w2", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 3, agentId: "mate-1" });
    const awake = runs.find((run) => run.id === "mate-1");
    expect(awake?.state).toBe("running");
    expect(awake?.endedAt).toBeUndefined();
  });

  test("a teammate dropped by a clear comes back when it wakes up", async ($, on) => {
    const { opened } = world(on, { agents: true }, { model: pick("opus", 0.9), effort: pick("max", 0.9) });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "mate-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({ ...SPAWN, isTeammate: true, background: true } as never);
    await $.turn.complete({ turnId: "w1", agentId: "mate-1", answer: "first pass done", durationMs: 10, isAborted: false, reason: "answer" });
    await $.command.run({ command: "jev", args: "agents clear", ...ASK });
    await step($ as never, { turnId: "w2", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 3, agentId: "mate-1" });
    opened.length = 0;
    await $.command.run({ command: "jev", args: "agent", ...ASK });
    expect(opened).toEqual(["jev-agent-2"]);
  });

  test("an awake teammate counts as running; an idle one does not", async ($, on) => {
    world(on, { agents: true }, { model: pick("opus", 0.9), effort: pick("max", 0.9) });
    let activity: unknown;
    on("state.set", async (_$, e, next) => {
      if (e.key === "now") activity = (e.value as { activity?: unknown }).activity;
      return next(e);
    });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: e.tool_use_id === "toolu-mate" ? "mate-1" : "sub-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-mate", isTeammate: true, background: true } as never);
    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-sub" } as never);
    // The ordinary subagent ends while the teammate still works.
    await $.turn.complete({ turnId: "s1", agentId: "sub-1", answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    expect(activity).toContain("1");
    await $.turn.complete({ turnId: "w1", agentId: "mate-1", answer: "idle now", durationMs: 10, isAborted: false, reason: "answer" });
    expect(activity).not.toContain("1");
  });

  test("an ordinary subagent's record still goes when its turn ends", async ($, on) => {
    const { sent } = world(on, { agents: true }, { model: pick("opus", 0.9), effort: pick("max", 0.9) });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "sub-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn(SPAWN as never);
    await $.turn.complete({ turnId: "s1", agentId: "sub-1", answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    await step($ as never, { turnId: "s2", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 1, agentId: "sub-1" });
    expect(sent.at(-1)?.effort).toBe("medium");
  });
});

describe("pane scrolling", () => {
  test("a scroll hook that fails hands the move back to the engine", async ($, on) => {
    world(on);
    let broken = false;
    on("state.set", async (_$, e, next) => {
      if (broken && e.key === "scroll") return { deny: "state unavailable" } as never;
      return next(e);
    });
    const reached: number[] = [];
    on("ui.scroll", async (_$, e) => {
      reached.push(e.by);
      return {};
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    // The mod's own scroll state can no longer be written.
    broken = true;
    const result = await $.ui.scroll({ component: "Pane", requestId: "jev", offset: 0, by: 3, bodyRows: 20, contentRows: 60, origin: { kind: "person" } } as never);
    expect(result.deny).toBeUndefined();
    expect(reached).toEqual([3]);
    await ui.unmount();
  });
});
