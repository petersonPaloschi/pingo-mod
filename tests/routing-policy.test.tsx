import { describe, expect, test } from "claude-code/testing";
import { noul, pick, step, world } from "./helpers.ts";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-4-5-20251001";
const ASK = { origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as const;

const answers = (model: string, effort: string, modelConfidence = 0.9) => ({
  tool: pick("Read", 0.9),
  needs_tool: noul(0.9),
  model: pick(model, modelConfidence),
  effort: pick(effort, 0.9),
});

const ROUTING = { model: true, effort: true };

describe("routing policy at runtime", () => {
  test("all routing features off preserves the original Haiku model and effort", async ($, on) => {
    const { sent } = world(on, {
      tools: false,
      participation: false,
      model: false,
      effort: false,
      delegation: false,
      agents: false,
      advisor: false,
    }, answers("haiku", "max"));

    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "summarize this file", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "off", index: 0, model: HAIKU, effort: "high", messageCount: 1 });

    expect(sent[0]).toEqual({ model: HAIKU, effort: "high" });
  });

  test("turning routing off mid-turn stops applying the pending model and effort", async ($, on) => {
    const { sent } = world(on, ROUTING, answers("sonnet", "max"), { empty: (index) => index === 0 });

    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename this function", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "mid-turn", index: 0, model: OPUS, effort: "high", messageCount: 1 });
    await $.command.run({ command: "jev", args: "routing off", ...ASK } as never);
    await step($ as never, { turnId: "mid-turn", index: 1, model: OPUS, effort: "high", messageCount: 1 });

    expect(sent).toEqual([
      { model: SONNET, effort: "max" },
      { model: OPUS, effort: "high" },
    ]);
  });

  test("a selected effort is applied to Opus when the event has no effort", async ($, on) => {
    const { sent } = world(on, ROUTING, answers("opus", "max"));

    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "inspect this code", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "no-effort", index: 0, model: OPUS, messageCount: 1 });

    expect(sent[0]).toEqual({ model: OPUS, effort: "max" });
  });

  for (const [label, model] of [
    ["1m model", "claude-opus-5-5[1m]"],
    ["Bedrock model", "us.anthropic.claude-opus-4-6-v1:0"],
  ]) {
    test(`a planned Haiku keeps the chosen effort on a non-switchable ${label}`, async ($, on) => {
      const { sent } = world(on, ROUTING, answers("haiku", "max"));

      await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
      await $.prompt.submit({ text: "make this change quickly", wait: false, origin: ASK.origin });
      await step($ as never, { turnId: label, index: 0, model, effort: "high", messageCount: 1 });

      expect(sent[0]).toEqual({ model, effort: "max" });
    });
  }

  test("a blocked Sonnet candidate falls back to the event model and keeps effort", async ($, on) => {
    const { sent } = world(on, ROUTING, answers("sonnet", "max"), { empty: (index) => index < 2 });

    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "trace this call", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "fallback", index: 0, model: OPUS, effort: "high", messageCount: 1 });
    await step($ as never, { turnId: "fallback", index: 1, model: OPUS, effort: "high", messageCount: 1 });
    await step($ as never, { turnId: "fallback", index: 2, model: OPUS, effort: "high", messageCount: 1 });

    expect(sent).toEqual([
      { model: SONNET, effort: "max" },
      { model: SONNET, effort: "max" },
      { model: OPUS, effort: "max" },
    ]);
  });

  test("a low-confidence model on turn two does not reuse Sonnet from turn one", async ($, on) => {
    const table = answers("sonnet", "max");
    const { sent } = world(on, ROUTING, table);

    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "first request", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "first", index: 0, model: OPUS, effort: "high", messageCount: 1 });

    table.model = pick("haiku", 0.2);
    await $.prompt.submit({ text: "second request", wait: false, origin: ASK.origin });
    await step($ as never, { turnId: "second", index: 0, model: OPUS, effort: "high", messageCount: 2 });

    expect(sent[0]?.model).toBe(SONNET);
    expect(sent[1]?.model).toBe(OPUS);
  });

  test("explicit subagent model, fork, and workflow stay unchanged and receive no Haiku effort", async ($, on) => {
    const { jev, sent } = world(on, { agents: true, model: true, effort: true }, answers("haiku", "max"));
    const received: { model?: string; fork?: boolean; workflow?: unknown }[] = [];
    const agentIds = ["explicit-model", "forked", "workflow"];
    on("agent.spawn", async (_$, e) => {
      received.push({ model: e.model, fork: e.fork, workflow: e.workflow });
      return { model: e.model ?? OPUS, agentId: agentIds[received.length - 1]! };
    });

    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const common = {
      prompt: "inspect the requested files",
      description: "inspect files",
      subagentType: "Explore",
      provider: { plugin: "engine", tier: "core" },
      parentModel: OPUS,
      background: false,
    };
    await $.agent.spawn({ ...common, tool_use_id: "explicit-model", model: HAIKU, fork: false } as never);
    await $.agent.spawn({ ...common, tool_use_id: "forked", fork: true } as never);
    await $.agent.spawn({ ...common, tool_use_id: "workflow", workflow: "review", fork: false } as never);

    await step($ as never, { turnId: "agents", index: 0, model: HAIKU, agentId: "explicit-model", messageCount: 1 });
    await step($ as never, { turnId: "agents", index: 0, model: OPUS, agentId: "forked", messageCount: 1 });
    await step($ as never, { turnId: "agents", index: 0, model: OPUS, agentId: "workflow", messageCount: 1 });

    expect(jev.calls).toBe(0);
    expect(received).toEqual([
      { model: HAIKU, fork: false, workflow: undefined },
      { model: undefined, fork: true, workflow: undefined },
      { model: undefined, fork: false, workflow: "review" },
    ]);
    expect(sent).toEqual([
      { model: HAIKU, effort: undefined, agentId: "explicit-model" },
      { model: OPUS, effort: undefined, agentId: "forked" },
      { model: OPUS, effort: undefined, agentId: "workflow" },
    ]);
  });

  test("a subagent receives selected effort even when its original event has none", async ($, on) => {
    const { sent } = world(on, { agents: true, model: true, effort: true }, answers("opus", "max"));
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? OPUS, agentId: "no-effort-agent" }));

    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({
      tool_use_id: "no-effort-agent",
      prompt: "inspect the implementation",
      description: "inspect implementation",
      subagentType: "Explore",
      provider: { plugin: "engine", tier: "core" },
      parentModel: OPUS,
      background: false,
      fork: false,
    } as never);
    await step($ as never, { turnId: "subagent-effort", index: 0, model: OPUS, agentId: "no-effort-agent", messageCount: 1 });

    expect(sent[0]).toEqual({ model: OPUS, effort: "max", agentId: "no-effort-agent" });
  });
});
