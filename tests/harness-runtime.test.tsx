import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import { DEFAULT_FEATURES, type Features } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import { PANE_PROPS as basePaneProps, answerJev, mockStore, pick, step } from "./helpers.ts";

const ORIGIN = { kind: "composer" } as const;
const PANE_PROPS = {
  ...basePaneProps,
  bodyColumns: 120,
  scroll: { ...basePaneProps.scroll, bodyRows: 120 },
};
const SPAWN = {
  prompt: "Check the build.",
  description: "check the build",
  subagentType: "Custom",
  provider: { plugin: "engine", tier: "core" },
  parentModel: "claude-opus-5-5",
  background: false,
  fork: false,
};

type WorldOptions = {
  features?: Partial<Features>;
  storedFeatures?: unknown;
  routing?: boolean;
  key?: boolean;
  answers?: Record<string, Answer>;
};

function world(on: On, opts: WorldOptions = {}) {
  mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });
  const store: Record<string, unknown> = {
    provider: "typesafe",
    features: opts.storedFeatures ?? { ...DEFAULT_FEATURES, ...opts.features },
    ...(opts.routing === false ? { routing: false } : {}),
  };
  mockStore(on, store);
  mock.env(on, { ...(opts.key === false ? {} : { TYPESAFE_API_KEY: "test-key" }) });
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: ["Read", "Bash", "Edit"].map((name) => ({ name, description: `${name} tool`, mcp: false })) }));
  on("session.messages", async () => ({ value: [] }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-harness" }));
  on("settings.read", async () => ({ value: { advisorModel: "claude-opus-5-5" } }) as never);

  const jev = { asked: [] as SystemOneRequest[] };
  on("http.fetch", async (_$, e) => {
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    jev.asked.push(request);
    const answers = answerJev(request, opts.answers ?? {});
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });

  let hold = false;
  let reached = () => {};
  let release = () => {};
  on("prompt.submit", async (_$, e) => {
    if (hold && !e.turnId) {
      await new Promise<void>((resolve) => {
        release = resolve;
        reached();
      });
    }
    return { text: e.text, ...(e.context ? { context: e.context } : {}) };
  });
  on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", async (_$, e) => ({ text: e.answer }));

  const sent: { model: string; effort?: unknown; agentId?: string }[] = [];
  on("turn.step", async function* (_$, e) {
    sent.push({ model: e.model, ...(e.effort === undefined ? {} : { effort: e.effort }), ...(e.agentId ? { agentId: e.agentId } : {}) });
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "Done.",
      toolUses: [],
      stopReason: "end_turn" as const,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model },
    };
  });

  const spawned: { model?: string; fork?: boolean; workflow?: unknown }[] = [];
  on("agent.spawn", async (_$, e) => {
    spawned.push({ model: e.model, fork: e.fork, workflow: e.workflow });
    return { model: e.model ?? "claude-sonnet-5-5", agentId: e.tool_use_id.replace("toolu", "agent") };
  });
  on("ui.open", async () => ({ value: { isPlaced: true } }) as never);
  on("tool.call", async (_$, e) => {
    if (e.tool === "Edit") return { result: "updated" } as never;
    if (e.tool === "Bash") return { isError: true, result: "same failure", text: "same failure" } as never;
    return { result: "ok" } as never;
  });
  let stopNextCalls = 0;
  on("classic.Stop", async () => {
    stopNextCalls++;
    return {} as never;
  });
  on("classic.PostToolBatch", async () => ({ additionalContext: ["downstream"] }) as never);

  async function enter($: Engine, words: string, turnId: string) {
    hold = true;
    const bottom = new Promise<void>((resolve) => (reached = resolve));
    const submitted = $.prompt.submit({ text: words, wait: false, origin: ORIGIN });
    await bottom;
    await $.turn.start({ text: words, turnId });
    release();
    hold = false;
    return submitted;
  }

  return { jev, sent, spawned, store, enter, stopNextCalls: () => stopNextCalls };
}

describe("runtime without main-turn advice", () => {
  test("prompts, tool failures, and edited completion do not trigger Jev or block the user", async ($, on) => {
    const setup = world(on, {
      features: { agents: true },
      answers: { model: pick("sonnet", 0.95), effort: pick("max", 0.95) },
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const prompt = await setup.enter($, "edit the project", "t1");
    expect((prompt as { context?: unknown }).context).toBeUndefined();
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await $.tool.call({ tool: "Edit", file_path: "src/app.ts", old_string: "old", new_string: "new", tool_use_id: "toolu-edit" } as never);
    await $.tool.call({ tool: "Bash", command: "build", tool_use_id: "toolu-build-1" } as never);
    await $.tool.call({ tool: "Bash", command: "build", tool_use_id: "toolu-build-2" } as never);
    const batch = await $.classic.PostToolBatch({ tool_calls: [{ tool_name: "Bash", tool_use_id: "toolu-build-2", tool_input: { command: "build" } }] } as never);
    expect((batch as { additionalContext?: string[] }).additionalContext).toEqual(["downstream"]);
    const stop = await $.classic.Stop({ stop_hook_active: false } as never);
    expect((stop as { block?: unknown }).block).toBeUndefined();
    expect(setup.stopNextCalls()).toBe(1);
    expect(setup.jev.asked).toHaveLength(0);
  });

  test("native custom-agent spawns still select model and effort; explicit model choices are kept", async ($, on) => {
    const setup = world(on, {
      features: { agents: true },
      answers: { model: pick("sonnet", 0.95), effort: pick("high", 0.95) },
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-custom" } as never);
    expect(Object.keys(setup.jev.asked[0]!.questions).sort()).toEqual(["effort", "model"]);
    expect(setup.spawned[0]).toMatchObject({ model: "sonnet", fork: false });

    await step($ as never, { turnId: "agent-turn", index: 0, model: "claude-sonnet-5-5", agentId: "agent-custom", messageCount: 1 });
    expect(setup.sent[0]).toEqual({ model: "claude-sonnet-5-5", effort: "high", agentId: "agent-custom" });

    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-explicit", model: "claude-haiku-4-5-20251001" } as never);
    expect(setup.spawned[1]).toMatchObject({ model: "claude-haiku-4-5-20251001" });
    expect(setup.jev.asked).toHaveLength(1);
  });

  test("obsolete feature flags and commands are discarded from stored settings", async ($, on) => {
    const setup = world(on, {
      storedFeatures: { agents: true, tools: true, participation: true, model: true, effort: true, delegation: true, advisor: true },
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect(setup.store.features).toEqual({ agents: true });
    const result = await $.command.run({ command: "jev", args: "feature participation on", origin: ORIGIN } as never);
    expect(result.text).toContain("feature");
    expect(setup.store.features).toEqual({ agents: true });
  });

  test("retired tab commands open their consolidated destinations", async ($, on) => {
    world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    for (const [alias, label] of [["flow", "Live"], ["reasons", "Logs"], ["features", "Configuration"], ["setup", "Configuration"]]) {
      await $.command.run({ command: "jev", args: alias, origin: ORIGIN } as never);
      expect(JSON.stringify(await ui.drawn())).toContain(`❮ ${label} ❯`);
    }
    expect(await $.command.run({ command: "jev", args: "baseline", origin: ORIGIN } as never)).toMatchObject({ text: expect.stringContaining("Usage:") });
    await ui.unmount();
  });
});
