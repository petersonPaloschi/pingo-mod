import { describe, expect, test } from "claude-code/testing";

import { askTimed, type AskJev } from "../hooks/core/request.ts";
import type { SystemOneRequest, SystemOneResult } from "../hooks/core/types.ts";

const request: SystemOneRequest = {
  state: { conversation: [{ role: "user", content: "search for a symbol" }] },
  questions: { answer: { type: "noul", instructions: "Is this answerable?" } },
  model: "jev-latest",
};

describe("askTimed", () => {
  test("passes through the request and preserves usage and measured latency", async () => {
    let time = 100;
    let received: SystemOneRequest | undefined;
    const result: SystemOneResult = {
      answers: { answer: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 1234, output_tokens: 12 },
    };
    const ask: AskJev = async (dto) => {
      received = dto;
      time = 145;
      return result;
    };

    const timed = await askTimed(request, ask, () => time);
    expect(received).toBe(request);
    expect(timed).toEqual({ result, latencyMs: 45 });
  });

  test("turns a rejected timeout into a fail-open reason", async () => {
    const timed = await askTimed(request, async () => {
      throw new Error("request timed out");
    }, () => 10);

    expect(timed).toEqual({ failure: "jev_error: request timed out" });
  });

  test("leaves answer validation to the policy caller", async () => {
    const malformed: SystemOneResult = { answers: {}, usage: { input_tokens: 55, output_tokens: 0 } };
    const timed = await askTimed(request, async () => malformed, () => 200);
    expect(timed).toEqual({ result: malformed, latencyMs: 0 });
  });
});
