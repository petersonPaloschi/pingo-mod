import { describe, expect, test } from "claude-code/testing";

import { decide } from "../hooks/core/decide.ts";
import { modelThreshold, modelTier, planAgent, planTurn, readTurnPlan, supportsEffort, type Features } from "../hooks/core/plan.ts";
import type { RouterInput } from "../hooks/core/types.ts";
import { noul, pick } from "./helpers.ts";

describe("Claude model IDs", () => {
  test("recognizes aliases and complete Anthropic, Vertex, and Bedrock identifiers", () => {
    expect(modelTier("sonnet")).toBe("sonnet");
    expect(modelTier("claude-3-7-sonnet-20250219")).toBe("sonnet");
    expect(modelTier("claude-sonnet-4@20250514")).toBe("sonnet");
    expect(modelTier("us.anthropic.claude-3-7-sonnet-20250219-v1:0")).toBe("sonnet");
    expect(modelTier("claude-opus-4-6[1m]")).toBe("opus");
    expect(modelTier("claude-opus-4-6-bogus")).toBeUndefined();
  });

  test("uses the same parsed generation for effort and downgrade thresholds", () => {
    expect(supportsEffort("sonnet")).toBe(true);
    expect(supportsEffort("claude-sonnet-4-5-20250929")).toBe(false);
    expect(supportsEffort("claude-sonnet-4-6")).toBe(true);
    expect(supportsEffort("global.anthropic.claude-opus-4-6-v1:0")).toBe(true);
    expect(supportsEffort("claude-opus-4-6-bogus")).toBe(false);
    expect(supportsEffort("haiku")).toBe(false);
    expect(modelThreshold("haiku", 0.7, {
      currentModel: "global.anthropic.claude-opus-4-6[1m]",
      cacheReadTokens: 100,
    })).toEqual({ needed: 0.925, reason: "cache_confidence" });
  });

  test("keeps valid model, effort, and advisor choices after an unexpected tool answer", () => {
    const features: Features = {
      tools: true,
      participation: false,
      model: true,
      effort: true,
      delegation: false,
      agents: false,
      advisor: true,
    };
    const plan = readTurnPlan({
      mode: "passthrough",
      reason: "jev_unexpected_answer",
      answers: {
        model: pick("sonnet", 0.9),
        effort: pick("high", 0.9),
        advisor: pick("consult", 0.9),
      },
    }, features, [], 0.7, { availableModels: ["sonnet"], currentModel: "sonnet", advisorAvailable: true });

    expect(plan.model?.value).toBe("sonnet");
    expect(plan.effort?.value).toBe("high");
    expect(plan.advisor?.value).toBe("consult");
  });

  test("missing participation blocks collaboration without hiding a tool failure", () => {
    const features: Features = {
      tools: true,
      participation: true,
      model: true,
      effort: true,
      delegation: true,
      agents: false,
      advisor: true,
    };
    const plan = readTurnPlan({
      mode: "passthrough",
      reason: "jev_unexpected_answer",
      answers: {
        model: pick("sonnet", 0.9),
        effort: pick("high", 0.9),
        delegate: pick("worker", 0.9),
        advisor: pick("consult", 0.9),
      },
    }, features, [{ name: "worker", description: "" }], 0.7, {
      availableModels: ["sonnet"],
      currentModel: "sonnet",
      advisorAvailable: true,
    });

    if (plan.decision.mode !== "passthrough") throw new Error("expected an unexpected-answer passthrough");
    expect(plan.decision).toMatchObject({ mode: "passthrough", reason: "jev_unexpected_answer" });
    expect(plan.model?.value).toBe("sonnet");
    expect(plan.effort?.value).toBe("high");
    expect(plan.delegate).toBeUndefined();
    expect(plan.delegateWhy).toBe("participation_unavailable");
    expect(plan.advisor).toBeUndefined();
    expect(plan.advisorWhy).toBe("participation_unavailable");
  });

  test("distinguishes a blocked advisor from a missing answer", () => {
    const plan = readTurnPlan({
      mode: "passthrough",
      reason: "jev_unexpected_answer",
      answers: { advisor: pick("consult", 0.9) },
    }, {
      tools: true,
      participation: false,
      model: false,
      effort: false,
      delegation: false,
      agents: false,
      advisor: true,
    }, [], 0.7, { advisorAvailable: false });

    expect(plan.advisor).toBeUndefined();
    expect(plan.advisorWhy).toBe("advisor_unavailable");
  });
});

describe("timed planning requests", () => {
  const config = { jevModel: "jev-latest", minConfidence: 0.7, maxStateChars: 60_000, maxMessageChars: 4_000 };
  const input: RouterInput = {
    system: "You are Claude Code.",
    turns: [{ role: "user", text: "read package.json" }],
    tools: [{ kind: "function", name: "Read", description: "Read a file" }],
    session: { currentModel: "sonnet", availableModels: ["sonnet"] },
  };
  const features: Features = {
    tools: false,
    participation: false,
    model: true,
    effort: true,
    delegation: false,
    agents: true,
    advisor: false,
  };

  test("ask-only records real latency and usage without a synthetic choice", async () => {
    let timeCalls = 0;
    const plan = await planTurn(input, config, async () => ({
      answers: { model: pick("sonnet", 0.9) },
      usage: { input_tokens: 123, output_tokens: 0 },
    }), features, [], () => timeCalls++ === 0 ? 100 : 147);

    expect(plan.jev).toEqual({ inputTokens: 123, latencyMs: 47 });
    expect(plan.jev?.choice).toBeUndefined();
    expect(plan.model?.value).toBe("sonnet");
  });

  test("shared confidence reading preserves unknown-tool and malformed-confidence reasons", async () => {
    const unknown = await decide(input, config, async () => ({
      answers: { tool: pick("Missing", 0.9), needs_tool: noul(0.9) },
      usage: { input_tokens: 123, output_tokens: 0 },
    }));
    const malformed = await decide(input, config, async () => ({
      answers: { tool: pick("Read", 1.1), needs_tool: noul(0.9) },
      usage: { input_tokens: 123, output_tokens: 0 },
    }));

    expect(unknown).toMatchObject({ mode: "passthrough", reason: "jev_unknown_tool" });
    expect(malformed).toMatchObject({ mode: "passthrough", reason: "jev_unexpected_answer" });
  });

  test("agent planning uses timed requests and strips the error reason prefix", async () => {
    const task = { description: "task", prompt: "do it", subagentType: "worker" };
    const failed = await planAgent(task, config, async () => { throw new Error("provider denied"); }, features, () => 100, {
      availableModels: ["haiku"],
    });

    expect(failed.error).toBe("provider denied");
  });
});
