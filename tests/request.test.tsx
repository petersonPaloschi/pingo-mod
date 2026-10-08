import { describe, expect, test } from "claude-code/testing";

import { decide, type DecideConfig } from "../hooks/core/decide.ts";
import { MAX_TOOLS, NONE_OF_THESE, NO_TOOL } from "../hooks/core/questions.ts";
import { askTimed } from "../hooks/core/request.ts";
import type { RouterInput, SystemOneRequest, SystemOneResult } from "../hooks/core/types.ts";

const input: RouterInput = {
  system: "You are Claude Code.",
  turns: [{ role: "user", text: "read package.json" }],
  tools: [{ kind: "function", name: "Read", description: "Read a file" }],
};
const config: DecideConfig = { jevModel: "jev-latest", minConfidence: 0.7, maxStateChars: 60_000, maxMessageChars: 4_000 };
const request: SystemOneRequest = {
  state: { conversation: [{ role: "user", content: "read package.json" }] },
  questions: { answer: { type: "noul", instructions: "Is this answerable?" } },
  model: "jev-latest",
};

describe("askTimed", () => {
  test("passes the request through and preserves returned usage and latency", async () => {
    let time = 100;
    let received: SystemOneRequest | undefined;
    const result: SystemOneResult = {
      answers: { answer: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 1234, output_tokens: 12 },
    };
    const timed = await askTimed(request, async (dto) => {
      received = dto;
      time = 145;
      return result;
    }, () => time);

    expect(received).toBe(request);
    expect(timed).toEqual({ result, latencyMs: 45 });
  });

  test("turns a rejected timeout into a fail-open reason", async () => {
    const timed = await askTimed(request, async () => {
      throw new Error("request timed out");
    }, () => 10);

    expect(timed).toEqual({ failure: "jev_error: request timed out" });
  });

  test("leaves malformed answers for core validation, which fails open", async () => {
    const malformed: SystemOneResult = { answers: {}, usage: { input_tokens: 55, output_tokens: 0 } };
    let time = 200;
    const timed = await askTimed(request, async () => {
      time = 235;
      return malformed;
    }, () => time);
    expect(timed).toEqual({ result: malformed, latencyMs: 35 });

    let decisionTime = 300;
    const decision = await decide(input, config, async () => malformed, () => {
      const current = decisionTime;
      decisionTime += 20;
      return current;
    });
    expect(decision).toMatchObject({ mode: "passthrough", reason: "jev_unexpected_answer" });
    expect(decision.jev).toMatchObject({ inputTokens: 55, latencyMs: 20 });
    expect(decision.jev?.choice).toBeUndefined();
    expect(decision.jev?.confidence).toBeUndefined();
  });

  test("keeps shortlist metrics when no usable tools remain", async () => {
    const malformed: SystemOneResult = { answers: {}, usage: { input_tokens: 89, output_tokens: 0 }, dropped: [{ name: "shard:0", why: "missing confidence" }] };
    const tools = Array.from({ length: MAX_TOOLS + 1 }, (_, i) => ({ kind: "function" as const, name: `tool_${i}` }));
    let calls = 0;
    let time = 500;
    const decision = await decide({ ...input, tools }, config, async () => {
      calls++;
      time += 35;
      return malformed;
    }, () => time);

    expect(calls).toBe(1);
    expect(decision).toMatchObject({ mode: "passthrough", reason: "jev_unexpected_answer", jev: { inputTokens: 89, latencyMs: 35 } });
    expect(decision.jev?.choice).toBeUndefined();
    expect(decision.jev?.confidence).toBeUndefined();
    expect(decision.mode === "passthrough" && decision.detail).toContain("missing confidence");
    expect(decision.mode === "passthrough" && decision.detail).toContain("Jev model jev-latest");
  });

  test("a valid empty shortlist still checks no-tool and asks the other features", async () => {
    const tools = Array.from({ length: MAX_TOOLS + 1 }, (_, i) => ({ kind: "function" as const, name: `tool_${i}` }));
    const calls: SystemOneRequest[] = [];
    let time = 500;
    const decision = await decide({ ...input, tools }, config, async (dto) => {
      calls.push(dto);
      time += calls.length === 1 ? 35 : 15;
      if (calls.length === 1) {
        const answers: SystemOneResult["answers"] = {};
        for (const [key, question] of Object.entries(dto.questions)) {
          if (question.type !== "choice") throw new Error("expected a shard choice");
          const probabilities = Object.fromEntries(Object.keys(question.criteria).map((name) => [name, name === NONE_OF_THESE ? 1 : 0]));
          answers[key] = { type: "choice", choice: NONE_OF_THESE, confidence: 0.9, probabilities };
        }
        return { answers, usage: { input_tokens: 89, output_tokens: 0 } };
      }
      return {
        answers: {
          tool: { type: "choice", choice: NO_TOOL, confidence: 0.9, probabilities: { [NO_TOOL]: 1 } },
          needs_tool: { type: "noul", noul: 0.1 },
          model: { type: "choice", choice: "sonnet", confidence: 0.9, probabilities: { sonnet: 1 } },
        },
        usage: { input_tokens: 17, output_tokens: 0 },
      };
    }, () => time, { model: { type: "choice", instructions: "Choose a model", criteria: { sonnet: null } } });

    expect(calls).toHaveLength(2);
    const toolQuestion = calls[1]!.questions.tool;
    if (toolQuestion?.type !== "choice") throw new Error("expected the no-tool choice");
    expect(Object.keys(toolQuestion.criteria)).toEqual([NO_TOOL]);
    expect(decision).toMatchObject({ mode: "passthrough", reason: "no_tool_needed", answers: { model: { choice: "sonnet" } } });
    expect(decision.jev).toMatchObject({ inputTokens: 106, latencyMs: 50, shortlist: [] });
  });
});
