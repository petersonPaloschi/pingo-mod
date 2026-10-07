// Jev's routing beyond the tool hint: participation, model and effort per turn, delegation,
// subagents' model and effort, the feature switches and the live log.
import type { On } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { planAgent, planHint, planSummary, planTurn, type Features } from "../hooks/core/plan.ts";
import { hintText } from "../hooks/core/decide.ts";
import { AGENT_MASCOTS } from "../hooks/mascots/agents.ts";
import type { Answer, RouterInput } from "../hooks/core/types.ts";
import { ASK, engine, fakeJev, features, jevAsk, noul, paneProps, pick, requests, step } from "./helpers.ts";

const CONFIG = { jevModel: "jev-latest", minConfidence: 0.7, maxStateChars: 60_000, maxMessageChars: 4_000 };
const INPUT: RouterInput = {
  system: "",
  turns: [{ role: "user", text: "refactor the auth module" }],
  tools: [
    { kind: "function", name: "Read", description: "Read a file" },
    { kind: "function", name: "Edit", description: "Edit a file" },
  ],
};
const AGENTS = [{ name: "Explore", description: "Searches the codebase" }];

describe("planTurn", () => {
  test("every question rides in one Jev call, and confident answers are taken", async () => {
    const j = jevAsk({
      tool: pick("Read", 0.9),
      needs_tool: noul(0.9),
      participate: noul(0.8),
      model: pick("opus", 0.85),
      effort: pick("high", 0.8),
      delegate: pick("Explore", 0.75),
    });
    const plan = await planTurn(INPUT, CONFIG, j.ask, features({ participation: true, model: true, effort: true, delegation: true }), AGENTS);
    expect(j.asked).toHaveLength(1);
    expect(Object.keys(j.asked[0]!.questions).sort()).toEqual(["delegate", "effort", "model", "needs_tool", "participate", "tool"]);
    expect(plan.decision).toMatchObject({ mode: "hint", tool: "Read" });
    expect(plan.model).toEqual({ value: "opus", confidence: 0.85 });
    expect(plan.effort).toEqual({ value: "high", confidence: 0.8 });
    expect(plan.delegate?.value).toBe("Explore");
    const hint = planHint(plan, hintText)!;
    expect(hint).toContain('"Read" tool');
    expect(hint).toContain('"Explore" subagent');
  });

  test("Jev staying out cancels the hint and the delegation, but keeps the model and effort", async () => {
    const j = jevAsk({
      tool: pick("Read", 0.95),
      needs_tool: noul(0.9),
      participate: noul(0.2),
      model: pick("sonnet", 0.9),
      effort: pick("low", 0.85),
      delegate: pick("Explore", 0.9),
    });
    const plan = await planTurn(INPUT, CONFIG, j.ask, features({ participation: true, model: true, effort: true, delegation: true }), AGENTS);
    expect(plan.decision).toMatchObject({ mode: "passthrough", reason: "jev_declined" });
    expect(plan.model).toEqual({ value: "sonnet", confidence: 0.9 });
    expect(plan.effort).toEqual({ value: "low", confidence: 0.85 });
    expect(plan.delegate).toBeUndefined();
    expect(planHint(plan, hintText)).toBeUndefined();
    expect(planSummary(plan)).toBe("stayed out (participate 0.20) · model sonnet · effort low");
  });

  test("a trivial request Jev stays out of still goes to Haiku, without effort", async () => {
    const j = jevAsk({ needs_tool: noul(0.1), participate: noul(0.1), model: pick("haiku", 0.92), effort: pick("low", 0.9) });
    const plan = await planTurn(INPUT, CONFIG, j.ask, features({ participation: true, model: true, effort: true }), AGENTS);
    expect(plan.decision).toMatchObject({ mode: "passthrough", reason: "jev_declined" });
    expect(plan.model?.value).toBe("haiku");
    expect(plan.effort).toBeUndefined();
    expect(plan.effortIgnored?.value).toBe("low");
  });

  test("an unsure answer leaves Claude Code's own choice", async () => {
    const j = jevAsk({ tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("haiku", 0.5), effort: pick("low", 0.6) });
    const plan = await planTurn(INPUT, CONFIG, j.ask, features({ model: true, effort: true }), AGENTS);
    expect(plan.model).toBeUndefined();
    expect(plan.effort).toBeUndefined();
  });

  test("a Haiku choice omits effort and records why", async () => {
    const j = jevAsk({
      tool: pick("Read", 0.9),
      needs_tool: noul(0.9),
      model: pick("haiku", 0.9),
      effort: pick("max", 0.9),
    });
    const plan = await planTurn(INPUT, CONFIG, j.ask, features({ model: true, effort: true }), AGENTS);
    expect(plan.model?.value).toBe("haiku");
    expect(plan.effort).toBeUndefined();
    expect(plan.effortIgnored?.value).toBe("max");
  });

  test("with the tool hint off, only the other questions are asked", async () => {
    const j = jevAsk({ model: pick("sonnet", 0.9) });
    const plan = await planTurn(INPUT, CONFIG, j.ask, features({ tools: false, model: true }), AGENTS);
    expect(Object.keys(j.asked[0]!.questions)).toEqual(["model"]);
    expect(plan.decision).toMatchObject({ mode: "passthrough", reason: "tools_feature_off" });
    expect(plan.model?.value).toBe("sonnet");
  });

  test("with every feature off, Jev is not called", async () => {
    const j = jevAsk({});
    const plan = await planTurn(INPUT, CONFIG, j.ask, features({ tools: false }), AGENTS);
    expect(j.asked).toHaveLength(0);
    expect(plan.decision).toMatchObject({ reason: "features_off" });
  });

  test("a subagent's model and effort come from its task", async () => {
    const j = jevAsk({ model: pick("opus", 0.9), effort: pick("max", 0.9) });
    const plan = await planAgent({ description: "find usages", prompt: "Find every caller of decide()", subagentType: "Explore" }, CONFIG, j.ask, features({ agents: true }));
    expect(plan.model?.value).toBe("opus");
    expect(plan.effort?.value).toBe("max");
    expect(j.asked[0]!.state).toMatchObject({ agent_type: "Explore", task_description: "find usages" });
  });

  test("the subagent task sent to Jev is clipped to the documented limits", async () => {
    const j = jevAsk({ model: pick("opus", 0.9), effort: pick("high", 0.8) });
    await planAgent(
      { description: "d".repeat(500), prompt: "p".repeat(5_000), subagentType: "Explore" },
      CONFIG,
      j.ask,
      features({ agents: true }),
    );
    const state = j.asked[0]!.state;
    expect(state.agent_type).toBe("Explore");
    expect(state.task_description).toHaveLength(400);
    expect(state.task_prompt).toHaveLength(4_000);
  });

  test("a Haiku subagent plan ignores effort", async () => {
    const j = jevAsk({ model: pick("haiku", 0.9), effort: pick("max", 0.9) });
    const plan = await planAgent({ description: "find usages", prompt: "Find every caller of decide()", subagentType: "Explore" }, CONFIG, j.ask, features({ agents: true }));
    expect(plan.model?.value).toBe("haiku");
    expect(plan.effort).toBeUndefined();
    expect(plan.effortIgnored?.value).toBe("max");
  });
});

// --- The mod in the engine ---

const PANE_PROPS = paneProps(100, 60);

function world(on: On, features: Partial<Features>, table: Record<string, Answer>) {
  engine(on, { features, now: "2026-10-06T12:00:00Z" });
  fakeJev(on, table);
  on("prompt.submit", async (_$, e) => ({ text: e.text }));
  return requests(on);
}

describe("routing in a session", () => {
  test("model and effort chosen by Jev apply to the turn's requests", async ($, on) => {
    const sent = world(on, { model: true, effort: true }, { tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("sonnet", 0.9), effort: pick("max", 0.8) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", effort: "high", messageCount: 1 });
    expect(sent[0]).toEqual({ model: "claude-sonnet-5-5", effort: "max" });

    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-live" });
    expect(await ui.find({ type: "Text", text: /consulted: .*model sonnet · effort max/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /changed request 1: model opus-5-5→sonnet-5-5, effort high→max/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /“Done\.”/ })).toBeDefined();
    // Each speaker is named in the gutter: Jev and Claude.
    expect(await ui.find({ type: "Text", text: /^\(\^‿\^\)\s+Jev\s*$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^\s*Claude\s*$/ })).toBeDefined();
    await ui.unmount();
  });

  test("with the model feature off, the request goes as Claude Code built it", async ($, on) => {
    const sent = world(on, { model: false }, { tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("haiku", 0.99) });
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", effort: "high", messageCount: 1 });
    expect(sent[0]).toEqual({ model: "claude-opus-5-5", effort: "high" });
  });

  test("a Haiku choice does not receive inherited effort", async ($, on) => {
    const sent = world(on, { model: true, effort: true }, { tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("haiku", 0.9), effort: pick("max", 0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", effort: "high", messageCount: 1 });
    expect(sent[0]).toEqual({ model: "claude-haiku-4-5-20251001", effort: undefined });
  });

  test("a subagent gets Jev's model at spawn and its effort on each request", async ($, on) => {
    const sent = world(on, { agents: true }, { model: pick("opus", 0.9), effort: pick("max", 0.9) });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "agent-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const spawned = await $.agent.spawn({
      tool_use_id: "toolu_1",
      prompt: "Find every caller of decide()",
      description: "find callers",
      subagentType: "Explore",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-opus-5-5",
      background: false,
      fork: false,
    } as never);
    expect(spawned).toMatchObject({ model: "opus", agentId: "agent-1" });
    await step($ as never, { turnId: "t2", index: 0, model: "claude-opus-5-5", effort: "medium", messageCount: 1, agentId: "agent-1" });
    expect(sent[0]).toEqual({ model: "claude-opus-5-5", effort: "max", agentId: "agent-1" });
  });

  test("Pingo shows the asking mood while Jev chooses a subagent model", async ($, on) => {
    engine(on, { features: { agents: true }, now: "2026-10-06T12:00:00Z", sessionId: "session-asking" });
    let startFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { startFetch = resolve; });
    let finishFetch!: (response: { value: { status: number; ok: boolean; headers: Record<string, string>; text: string } }) => void;
    const pendingResponse = new Promise<{ value: { status: number; ok: boolean; headers: Record<string, string>; text: string } }>((resolve) => {
      finishFetch = resolve;
    });
    on("http.fetch", async () => {
      startFetch();
      return pendingResponse;
    });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "agent-asking" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });

    const spawning = $.agent.spawn({
      tool_use_id: "toolu-asking",
      prompt: "Find the callers",
      description: "find callers",
      subagentType: "Explore",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-opus-5-5",
      background: false,
      fork: false,
    } as never);
    await fetchStarted;
    const asking = await ui.find({ type: "Text", text: /\(◌_◌\)/ });
    expect(await ui.find({ type: "Raster", key: "pingo" } as never)).toBeDefined();
    finishFetch({
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({ answers: { model: pick("opus", 0.9), effort: pick("max", 0.9) }, usage: { input_tokens: 200, output_tokens: 0 } }),
      },
    });
    await spawning;

    expect(asking).toBeDefined();
    await ui.unmount();
  });

  test("a Haiku subagent does not receive effort", async ($, on) => {
    const sent = world(on, { agents: true }, { model: pick("haiku", 0.9), effort: pick("max", 0.9) });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "agent-3" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const spawned = await $.agent.spawn({
      tool_use_id: "toolu_3",
      prompt: "Find every caller of decide()",
      description: "find callers",
      subagentType: "Explore",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-opus-5-5",
      background: false,
      fork: false,
    } as never);
    expect(spawned).toMatchObject({ model: "haiku", agentId: "agent-3" });
    await step($ as never, { turnId: "t3", index: 0, model: "claude-haiku-4-5-20251001", messageCount: 1, agentId: "agent-3" });
    expect(sent[0]).toEqual({ model: "claude-haiku-4-5-20251001", effort: undefined, agentId: "agent-3" });
  });

  test("a model Claude asked for explicitly is kept", async ($, on) => {
    world(on, { agents: true }, { model: pick("haiku", 0.9) });
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "agent-2" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const spawned = await $.agent.spawn({
      tool_use_id: "toolu_2",
      prompt: "Plan the migration",
      description: "plan",
      subagentType: "Plan",
      provider: { plugin: "engine", tier: "core" },
      model: "opus",
      parentModel: "claude-opus-5-5",
      background: false,
      fork: false,
    } as never);
    expect(spawned).toMatchObject({ model: "opus" });
  });
});

describe("features tab", () => {
  test("one press switches a feature, and /jev status reports it", async ($, on) => {
    world(on, {}, {});
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-features" });
    expect(await ui.find({ type: "Text", text: "Model per turn" })).toBeDefined();
    await ui.press({ key: "feature-model" });
    const status = (await $.command.run({ command: "jev", args: "status", ...ASK })).text ?? "";
    expect(status).toContain("Model per turn");
    const off = await $.command.run({ command: "jev", args: "feature model off", ...ASK });
    expect(off.text).toBe("Model per turn: disabled.");
    await ui.unmount();
  });

  test("the live log distinguishes your entries from Jev's", async ($, on) => {
    world(on, {}, {});
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-features" });
    await ui.press({ key: "feature-model" });
    await ui.press({ key: "feature-effort" });
    await ui.press({ key: "tab-live" });
    // Two lines of yours in a row: one face and name, then a blank gutter.
    expect(await ui.find({ type: "Text", text: /^\[•‿•\]\s+You\s*$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Model per turn: enabled" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Effort per turn: enabled" })).toBeDefined();
    expect(await ui.find({ type: "Raster", key: "dice" } as never)).toBeDefined();
    await ui.unmount();
  });

  test("every tab still draws on the desktop app", async ($, on) => {
    world(on, {}, {});
    const ui = await $.ui.mount({ plugin: "jev", surface: "desktop", component: "Pane", requestId: "jev", props: PANE_PROPS });
    for (const key of ["tab-live", "tab-features"]) {
      await ui.press({ key });
      expect(await ui.find({ type: "Text", text: /Live|Features/ })).toBeDefined();
    }
    await ui.unmount();
  });
});

describe("subagents, each with its own live", () => {
  const SPAWN = {
    tool_use_id: "toolu-agent",
    prompt: "Find every caller of decide() and say which file each is in.",
    description: "find callers",
    subagentType: "Explore",
    provider: { plugin: "engine", tier: "core" },
    parentModel: "claude-opus-5-5",
    background: false,
    fork: false,
  };

  /** Tetra's face and name, as the Agents tab draws them. */
  const TETRA = `${AGENT_MASCOTS.tetra.face} Tetra`;

  /** Subagents start with the ids given, in order. */
  function agentWorld(on: On, ids: readonly string[] = ["agent-x"]) {
    world(on, {}, {});
    let spawned = 0;
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: ids[spawned++] ?? `agent-${spawned}` }));
    on("tool.call", async () => ({ result: "hooks/core/plan.ts: 2 callers" }) as never);
    on("turn.complete", async (_$, e) => ({ text: e.answer }));
    const opened: string[] = [];
    on("ui.open", async (_$, e) => {
      opened.push(e.id);
      return { value: { isPlaced: true } } as never;
    });
    return opened;
  }

  test("the Agents tab lists a running subagent with what it is doing, and its pane shows only its lines", async ($, on) => {
    agentWorld(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn(SPAWN as never);
    await $.tool.call({ tool: "Grep", pattern: "decide(", tool_use_id: "toolu-grep", agentId: "agent-x" } as never);
    await step($ as never, { turnId: "t-agent", index: 0, model: "claude-sonnet-5-5", messageCount: 2, agentId: "agent-x" });
    // A tool on the main loop: Claude's, not the subagent's.
    await $.tool.call({ tool: "Read", file_path: "README.md", tool_use_id: "toolu-main" } as never);

    const pane = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await pane.press({ key: "tab-agents" });
    // The subagent goes by its mascot: the first free one is Tetra.
    expect(await pane.find({ type: "Text", text: TETRA })).toBeDefined();
    expect(await pane.find({ type: "Text", text: "  Explore #1" })).toBeDefined();
    // Running: it cannot be removed yet.
    expect(await pane.find({ type: "Button", key: "agent-remove-1" } as never)).toBeUndefined();
    expect(await pane.find({ type: "Text", text: "  ● running" })).toBeDefined();
    expect(await pane.find({ type: "Text", text: /1 tool call · 1 request/ })).toBeDefined();
    await pane.unmount();

    const own = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev-agent-1", props: PANE_PROPS });
    expect(await own.find({ type: "Text", text: "find callers" })).toBeDefined();
    expect(await own.find({ type: "Text", text: /Find every caller of decide\(\)/ })).toBeDefined();
    expect(await own.find({ type: "Text", text: /[▸✓] Grep decide\(/ })).toBeDefined();
    // Its lines in the gutter: Tetra's face and name, not "Explore".
    expect(await own.find({ type: "Text", text: `${AGENT_MASCOTS.tetra.face.padEnd(6)}${"Tetra".padEnd(7)}` })).toBeDefined();
    expect(await own.find({ type: "Text", text: /“Done\.”/ })).toBeDefined();
    expect(await own.find({ type: "Text", text: /README\.md/ })).toBeUndefined();

    await $.turn.complete({ turnId: "t-agent", agentId: "agent-x", answer: "Two callers, both in plan.ts.", durationMs: 4200, isAborted: false, reason: "answer" });
    expect(await own.find({ type: "Text", text: "✓ done" })).toBeDefined();
    expect(await own.find({ type: "Text", text: "Two callers, both in plan.ts." })).toBeDefined();
    await own.unmount();
  });

  test("/jev agent opens a subagent's pane by number, by type, or the latest", async ($, on) => {
    const opened = agentWorld(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn(SPAWN as never);
    for (const args of ["agent 1", "agent explore", "agent"]) {
      opened.length = 0;
      await $.command.run({ command: "jev", args, ...ASK });
      expect(opened).toEqual(["jev-agent-1"]);
    }
    const missing = await $.command.run({ command: "jev", args: "agent 9", ...ASK });
    expect(missing.text).toContain('No subagent "9"');
  });

  test("the band counts running subagents", async ($, on) => {
    agentWorld(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn(SPAWN as never);
    const band = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "AbovePrompt", requestId: "band", props: { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 120 } as never });
    expect(await band.find({ type: "Text", text: AGENT_MASCOTS.tetra.face })).toBeDefined();
    expect(await band.find({ type: "Text", text: "1 subagent · /jev agents" })).toBeDefined();
    await band.unmount();
  });

  test("two subagents at once get two different mascots; a free one is handed out again", async ($, on) => {
    agentWorld(on, ["agent-1", "agent-2", "agent-3"]);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({ ...SPAWN, tool_use_id: "t1" } as never);
    await $.agent.spawn({ ...SPAWN, tool_use_id: "t2", subagentType: "Plan" } as never);
    const pane = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await pane.press({ key: "tab-agents" });
    expect(await pane.find({ type: "Text", text: TETRA })).toBeDefined();
    expect(await pane.find({ type: "Text", text: "<•ᴗ•> Gem" })).toBeDefined();
    // Tetra's agent ends; the next one wears Tetra again, since no running agent does.
    await $.turn.complete({ turnId: "t", agentId: "agent-1", answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    await $.agent.spawn({ ...SPAWN, tool_use_id: "t3" } as never);
    expect(await pane.find({ type: "Text", text: "  Explore #3" })).toBeDefined();
    await pane.unmount();
    const third = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev-agent-3", props: PANE_PROPS });
    expect(await third.find({ type: "Text", text: TETRA })).toBeDefined();
    await third.unmount();
  });

  test("finished subagents can be removed one by one or all at once; running ones stay", async ($, on) => {
    agentWorld(on, ["agent-1", "agent-2", "agent-3"]);
    on("ui.close", async () => ({ value: undefined }) as never);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    for (const id of ["t1", "t2", "t3"]) await $.agent.spawn({ ...SPAWN, tool_use_id: id } as never);
    for (const agentId of ["agent-1", "agent-2"]) {
      await $.turn.complete({ turnId: "t", agentId, answer: "done", durationMs: 10, isAborted: false, reason: "answer" });
    }
    const pane = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await pane.press({ key: "tab-agents" });
    await pane.press({ key: "agent-remove-1" });
    expect(await pane.find({ type: "Text", text: "  Explore #1" })).toBeUndefined();
    expect(await pane.find({ type: "Text", text: "  Explore #2" })).toBeDefined();

    const running = await $.command.run({ command: "jev", args: "agent 3 remove", ...ASK });
    expect(running.text).toContain("still running");
    await pane.press({ key: "agents-clear" });
    expect(await pane.find({ type: "Text", text: "  Explore #2" })).toBeUndefined();
    expect(await pane.find({ type: "Text", text: "  Explore #3" })).toBeDefined();
    const none = await $.command.run({ command: "jev", args: "agents clear", ...ASK });
    expect(none.text).toBe("No finished subagents to remove.");
    await pane.unmount();
  });
});
