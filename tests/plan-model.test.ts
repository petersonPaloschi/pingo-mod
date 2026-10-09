import { describe, expect, test } from "claude-code/testing";

import { DEFAULT_FEATURES, modelTier, planAgent, supportsEffort, type AgentPlanConfig, type Features } from "../hooks/core/plan.ts";
import type { SystemOneRequest } from "../hooks/core/types.ts";
import { pick } from "./helpers.ts";

describe("Claude model IDs", () => {
  test("recognizes aliases and complete Anthropic, Vertex, and Bedrock identifiers", () => {
    expect(modelTier("sonnet")).toBe("sonnet");
    expect(modelTier("claude-3-7-sonnet-20250219")).toBe("sonnet");
    expect(modelTier("claude-sonnet-4@20250514")).toBe("sonnet");
    expect(modelTier("us.anthropic.claude-3-7-sonnet-20250219-v1:0")).toBe("sonnet");
    expect(modelTier("claude-opus-4-6[1m]")).toBe("opus");
    expect(modelTier("claude-opus-4-6-bogus")).toBeUndefined();
  });

  test("only sends effort to supported model generations", () => {
    expect(supportsEffort("sonnet")).toBe(true);
    expect(supportsEffort("claude-sonnet-4-5-20250929")).toBe(false);
    expect(supportsEffort("claude-sonnet-4-6")).toBe(true);
    expect(supportsEffort("global.anthropic.claude-opus-4-6-v1:0")).toBe(true);
    expect(supportsEffort("claude-opus-4-6-bogus")).toBe(false);
    expect(supportsEffort("haiku")).toBe(false);
  });
});

describe("subagent planning", () => {
  const config: AgentPlanConfig = {
    jevModel: "jev-latest",
    minConfidence: 0.7,
    maxMessageChars: 4_000,
  };
  const features: Features = { ...DEFAULT_FEATURES, agents: true };
  const task = { description: "Find usages", prompt: "Search the repository for this symbol.", subagentType: "search-reviewer" };

  test("sends task context and applies validated model and effort choices", async () => {
    const requests: SystemOneRequest[] = [];
    let time = 100;
    const plan = await planAgent(task, config, async (request) => {
      requests.push(request);
      time = 145;
      return {
        answers: { model: pick("sonnet", 0.9), effort: pick("high", 0.9) },
        usage: { input_tokens: 123, output_tokens: 0 },
      };
    }, features, () => time, { availableModels: ["sonnet"] });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.state).toMatchObject({
      agent_type: "search-reviewer",
      task_description: task.description,
      task_prompt: task.prompt,
      available_models: ["sonnet"],
    });
    expect(Object.keys(requests[0]!.questions)).toEqual(["model", "effort"]);
    expect(plan).toMatchObject({
      model: { value: "sonnet", confidence: 0.9 },
      effort: { value: "high", confidence: 0.9 },
      latencyMs: 45,
    });
  });

  test("provider failures and malformed answers leave the native choice in control", async () => {
    const failed = await planAgent(task, config, async () => { throw new Error("provider denied"); }, features, () => 100);
    expect(failed.error).toBe("provider denied");

    const malformed = await planAgent(task, config, async () => ({ answers: {}, usage: { input_tokens: 55, output_tokens: 0 } }), features, () => 100, {
      availableModels: ["haiku"],
    });
    expect(malformed.model).toBeUndefined();
    expect(malformed.effort).toBeUndefined();
    expect(malformed.modelReason).toBe("unavailable");
    expect(malformed.effortWhy).toBe("unavailable");
  });

  test("an unoffered model cannot replace the native spawn model", async () => {
    const plan = await planAgent(task, config, async () => ({
      answers: { model: pick("opus", 0.99), effort: pick("high", 0.9) },
      usage: { input_tokens: 55, output_tokens: 0 },
    }), features, () => 100, { availableModels: ["sonnet"] });
    expect(plan.model).toBeUndefined();
    expect(plan.modelReason).toBe("unavailable");
    expect(plan.effort?.value).toBe("high");
  });

  test("native Explore and Plan agents inherit their model and effort without another Jev call", async () => {
    for (const subagentType of ["Explore", "Plan"]) {
      let calls = 0;
      const plan = await planAgent({ ...task, subagentType }, config, async () => {
        calls++;
        throw new Error("should not ask Jev");
      }, features);
      expect(calls).toBe(0);
      expect(plan).toEqual({});
    }
  });
});
