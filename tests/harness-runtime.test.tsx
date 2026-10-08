import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import { DEFAULT_FEATURES, PARTICIPATE_KEY, type Features } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import { text } from "../hooks/i18n.ts";
import { answerJev, noul, pick, step } from "./helpers.ts";

const ORIGIN = { kind: "composer" } as const;
const DONE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const ADVISOR_HINT = text("planning.hint.advisor", "en");
const SPAWN = { prompt: "Check the build.", description: "check the build", subagentType: "Explore", provider: { plugin: "engine", tier: "core" }, parentModel: "claude-opus-5-5", background: false, fork: false };

type WorldOptions = {
  features?: Partial<Features>;
  routing?: boolean;
  key?: boolean;
  env?: Record<string, string>;
  answers?: Record<string, Answer>;
};

const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 120,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 120, contentRows: 120 },
} as never;

function world(on: On, opts: WorldOptions = {}) {
  mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });
  mock.store(on, {
    provider: "typesafe",
    features: { ...DEFAULT_FEATURES, tools: false, advisor: true, ...opts.features },
    ...(opts.routing === false ? { routing: false } : {}),
  });
  mock.env(on, { ...(opts.key === false ? {} : { TYPESAFE_API_KEY: "test-key" }), ...opts.env });
  let hold = false;
  let reached = () => {};
  let release = () => {};
  let errors: Record<string, string> = {};
  let messagesFail = false;
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: ["Read", "Bash", "Edit"].map((name) => ({ name, description: `${name} tool`, mcp: false })) }));
  on("session.messages", async () => {
    if (messagesFail) throw new Error("message observer failed");
    return { value: [] } as never;
  });
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-harness" }));
  on("settings.read", async () => ({ value: { advisorModel: "claude-opus-5-5" } }) as never);
  on("prompt.compose", async () => ({ sections: [] }) as never);
  const jev = { asked: [] as SystemOneRequest[] };
  on("http.fetch", async (_$, e) => {
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    jev.asked.push(request);
    const answers = answerJev(request, {
      advisor: pick("consult", 0.9),
      ...(opts.answers ?? {}),
    });
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });

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
  on("turn.step", async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: "Done.", toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model } };
  });
  on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: e.tool_use_id.replace("toolu", "agent") }));

  const toolCalls: string[] = [];
  on("tool.call", async (_$, e) => {
    const call = e as unknown as { tool: string; command?: string; tool_use_id?: string };
    toolCalls.push(call.tool_use_id ?? "");
    if (call.tool === "Edit") return { result: "updated" } as never;
    if (call.tool === "Read" && call.tool_use_id === "toolu-final-denied") return { deny: "not allowed" } as never;
    if (call.tool === "Bash") {
      const error = errors[call.tool_use_id ?? ""] ?? "failed";
      return { isError: true, result: error, text: error } as never;
    }
    return { result: "ok" } as never;
  });
  let stopMode: "pass" | "block" | "prevent" | "throw" = "pass";
  let stopNextCalls = 0;
  on("classic.Stop", async () => {
    stopNextCalls++;
    if (stopMode === "block") return { block: "downstream block" } as never;
    if (stopMode === "prevent") return { preventContinuation: true } as never;
    if (stopMode === "throw") throw new Error("downstream stop failed");
    return {} as never;
  });
  on("classic.PostToolBatch", async () => ({ additionalContext: [] }) as never);

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

  return {
    jev,
    toolCalls,
    enter,
    setErrors: (next: Record<string, string>) => { errors = next; },
    failMessages: () => { messagesFail = true; },
    setStopMode: (next: typeof stopMode) => { stopMode = next; },
    stopNextCalls: () => stopNextCalls,
  };
}

async function flowDraw($: Engine) {
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-flow" });
  const drawn = JSON.stringify(await ui.drawn());
  await ui.unmount();
  return drawn;
}

const hasHint = (value: unknown, hint: string) => ((value as { context?: readonly string[] } | undefined)?.context ?? []).some((block) => block.includes(hint));
const hasContext = (value: unknown) => (((value as { additionalContext?: readonly string[] } | undefined)?.additionalContext ?? []).length > 0);
const postBatch = ($: Engine, toolCalls: unknown[], agent_id?: string) => $.classic.PostToolBatch({ tool_calls: toolCalls, ...(agent_id ? { agent_id } : {}) } as never);

describe("the recovery harness at runtime", () => {
  test("records the advisor plan and recovers only on a repeated same command and error", async ($, on) => {
    const setup = world(on);
    setup.setErrors({
      "toolu-build-1": "failure A",
      "toolu-build-2": "failure B",
      "toolu-test-1": "failure B",
      "toolu-build-3": "failure B",
      "toolu-test-2": "failure B",
      "toolu-deploy-1": "failure C",
      "toolu-deploy-2": "failure C",
      "toolu-main-worker-1": "shared failure",
      "toolu-agent-worker-1": "shared failure",
      "toolu-agent-worker-2": "shared failure",
      "toolu-main-worker-2": "shared failure",
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const prompt = await setup.enter($, "build the project", "t1");
    expect(hasHint(prompt, ADVISOR_HINT)).toBe(true);
    expect(Object.keys(setup.jev.asked[0]!.questions)).toEqual(["advisor"]);
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });

    const calls = [
      { tool: "Bash", command: "build", tool_use_id: "toolu-build-1" },
      { tool: "Bash", command: "build", tool_use_id: "toolu-build-2" },
      { tool: "Bash", command: "test", tool_use_id: "toolu-test-1" },
      { tool: "Bash", command: "build", tool_use_id: "toolu-build-3" },
      { tool: "Bash", command: "test", tool_use_id: "toolu-test-2" },
    ];
    const results = [] as unknown[];
    for (const call of calls) {
      const toolResult = await $.tool.call(call as never);
      expect((toolResult as { context?: unknown }).context).toBeUndefined();
      results.push(await postBatch($, [{ tool_name: call.tool, tool_use_id: call.tool_use_id, tool_input: { command: call.command } }]));
    }
    expect({
      promptHint: hasHint(prompt, ADVISOR_HINT),
      batchRecovery: results.map(hasContext),
    }).toEqual({ promptHint: true, batchRecovery: [false, false, false, true, true] });

    const mainFirst = await $.tool.call({ tool: "Bash", command: "worker", tool_use_id: "toolu-main-worker-1" } as never);
    expect((mainFirst as { context?: unknown }).context).toBeUndefined();
    expect(hasContext(await postBatch($, [{ tool_name: "Bash", tool_use_id: "toolu-main-worker-1", tool_input: { command: "worker" } }]))).toBe(false);

    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-worker" } as never);
    await step($ as never, { turnId: "worker-turn", index: 0, model: "claude-sonnet-5-5", messageCount: 1, agentId: "agent-worker" });
    const agentFirst = await $.tool.call({ tool: "Bash", command: "worker", tool_use_id: "toolu-agent-worker-1", agentId: "agent-worker" } as never);
    expect((agentFirst as { context?: unknown }).context).toBeUndefined();
    expect(hasContext(await postBatch($, [{ tool_name: "Bash", tool_use_id: "toolu-agent-worker-1", tool_input: { command: "worker" } }], "agent-worker"))).toBe(false);
    await $.tool.call({ tool: "Bash", command: "worker", tool_use_id: "toolu-agent-worker-2", agentId: "agent-worker" } as never);
    expect(hasContext(await postBatch($, [{ tool_name: "Bash", tool_use_id: "toolu-agent-worker-2", tool_input: { command: "worker" } }], "agent-worker"))).toBe(true);
    await $.tool.call({ tool: "Bash", command: "worker", tool_use_id: "toolu-main-worker-2" } as never);
    expect(hasContext(await postBatch($, [{ tool_name: "Bash", tool_use_id: "toolu-main-worker-2", tool_input: { command: "worker" } }]))).toBe(true);

    await $.tool.call({ tool: "Bash", command: "deploy", tool_use_id: "toolu-deploy-1" } as never);
    const pending = await $.tool.call({ tool: "Bash", command: "deploy", tool_use_id: "toolu-deploy-2" } as never);
    expect((pending as { context?: unknown }).context).toBeUndefined();
    const denied = await $.tool.call({ tool: "Read", file_path: "src/blocked.ts", tool_use_id: "toolu-final-denied" } as never);
    expect((denied as { context?: unknown }).context).toBeUndefined();
    const finalBatch = await postBatch($, [
      { tool_name: "Bash", tool_use_id: "toolu-deploy-2", tool_input: { command: "deploy" }, tool_response: "failure C" },
      { tool_name: "Read", tool_use_id: "toolu-final-denied", tool_input: { file_path: "src/blocked.ts" }, tool_response: "not allowed" },
    ]);
    expect(hasContext(finalBatch)).toBe(true);
    expect(setup.toolCalls).toHaveLength(12);

    expect(setup.jev.asked).toHaveLength(1);
    const drawn = await flowDraw($);
    expect(drawn).toContain("Before plan · requested");
    expect(drawn).toContain("Repeated tool failure · requested");

    setup.setErrors({ "toolu-observer": "observer failure" });
    setup.failMessages();
    const observedFailure = await $.tool.call({ tool: "Bash", command: "observer", tool_use_id: "toolu-observer" } as never);
    expect((observedFailure as { isError?: boolean }).isError).toBe(true);
    expect(setup.toolCalls).toHaveLength(13);
  });

  const gates: { name: string; options: WorldOptions }[] = [
    { name: "advisor disabled", options: { features: { advisor: false } } },
    { name: "routing disabled", options: { routing: false } },
    { name: "provider key missing", options: { key: false } },
    { name: "Claude traffic disabled", options: { env: { DISABLE_TELEMETRY: "1" } } },
    { name: "participation declined", options: { features: { participation: true }, answers: { [PARTICIPATE_KEY]: noul(0.1) } } },
  ];

  for (const gate of gates) {
    test(`does not attach recovery guidance when ${gate.name}`, async ($, on) => {
      const setup = world(on, gate.options);
      setup.setErrors({ [`toolu-${gate.name}-1`]: "same failure", [`toolu-${gate.name}-2`]: "same failure" });
      await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
      await setup.enter($, "build the project", `t-${gate.name}`);
      await step($ as never, { turnId: `t-${gate.name}`, index: 0, model: "claude-opus-5-5", messageCount: 1 });
      await $.tool.call({ tool: "Bash", command: "build", tool_use_id: `toolu-${gate.name}-1` } as never);
      await $.tool.call({ tool: "Bash", command: "build", tool_use_id: `toolu-${gate.name}-2` } as never);
      const batch = await postBatch($, [{ tool_name: "Bash", tool_use_id: `toolu-${gate.name}-2`, tool_input: { command: "build" }, tool_response: "same failure" }]);
      expect(hasContext(batch)).toBe(false);
      expect((await flowDraw($)).match(/Repeated tool failure · requested/g) ?? []).toHaveLength(0);
    });
  }
});

describe("the completion checkpoint at runtime", () => {
  test("does not interrupt an active run with no edits", async ($, on) => {
    const setup = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await setup.enter($, "check the project", "t-no-edit");
    const result = await $.classic.Stop({ stop_hook_active: false } as never);
    expect((result as { block?: unknown }).block).toBeUndefined();
    expect(setup.stopNextCalls()).toBe(1);
    expect(await flowDraw($)).toContain("Before done · not requested");
  });

  test("blocks an edited run once, preserves downstream stops, and never runs next twice", async ($, on) => {
    const setup = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const prompt = await setup.enter($, "edit the project", "t-edit");
    expect(hasHint(prompt, ADVISOR_HINT)).toBe(true);
    await step($ as never, { turnId: "t-edit", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await $.tool.call({ tool: "Edit", file_path: "src/app.ts", old_string: "old", new_string: "new", tool_use_id: "toolu-edit" } as never);

    setup.setStopMode("block");
    expect((await $.classic.Stop({ stop_hook_active: false } as never) as { block?: string }).block).toBe("downstream block");
    setup.setStopMode("prevent");
    expect((await $.classic.Stop({ stop_hook_active: false } as never) as { preventContinuation?: boolean }).preventContinuation).toBe(true);
    setup.setStopMode("throw");
    const failedDownstream = await $.classic.Stop({ stop_hook_active: false } as never);
    expect((failedDownstream as { block?: unknown }).block).toBeUndefined();
    expect(setup.stopNextCalls()).toBe(3);

    setup.setStopMode("pass");
    const blocked = await $.classic.Stop({ stop_hook_active: false } as never);
    expect((blocked as { block?: unknown }).block).toBeDefined();
    const activeHook = await $.classic.Stop({ stop_hook_active: true } as never);
    expect((activeHook as { block?: unknown }).block).toBeUndefined();
    const duplicate = await $.classic.Stop({ stop_hook_active: false } as never);
    expect((duplicate as { block?: unknown }).block).toBeUndefined();
    expect(setup.stopNextCalls()).toBe(6);
    const drawn = await flowDraw($);
    expect(drawn).toContain("1 edit · 1 file");
    expect((drawn.match(/Before done · requested/g) ?? [])).toHaveLength(1);
  });
});
