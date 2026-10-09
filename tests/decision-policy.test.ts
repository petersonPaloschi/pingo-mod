import { expect, test } from "claude-code/testing";
import { resolveSettings } from "../hooks/config.ts";
import { createAskJev, normalize, type Transport } from "../hooks/core/jev.ts";
import { agentQuestions } from "../hooks/core/plan.ts";
import { pick } from "./helpers.ts";

test("provider confidence and probabilities stay separate, and malformed distributions are discarded", () => {
  const valid = { type: "choice", choice: "Read", confidence: 0.42, probabilities: { Read: 0.61, Bash: 0.39 } };
  const result = normalize({ answers: {
    valid,
    absent: { ...valid, confidence: undefined },
    invalid: { ...valid, probabilities: { Read: 0.61, Bash: "0.39" } },
    unnormalised: { ...valid, probabilities: { Read: 0.7, Bash: 0.7 } },
    missingWinner: { ...valid, choice: "Write" },
    wrongWinner: { ...valid, choice: "Bash" },
  } });
  expect(result.answers).toEqual({ valid });
});

test("a provider cannot inject unoffered choices or probability keys into an accepted answer", async () => {
  const transport: Transport = {
    post: async () => ({ ok: true, status: 200, text: JSON.stringify({ answers: {
      tool: { type: "choice", choice: "Read", confidence: 0.95, probabilities: { Read: 0.8, hidden: 0.2 } },
      model: pick("hidden_model", 0.99),
      extra: { type: "noul", noul: 1 },
    } }) }),
    sleep: async () => undefined,
    within: async (_ms, promise) => promise,
  };
  const ask = createAskJev({ provider: "typesafe", apiKey: "test-key", url: "https://example.test", timeoutMs: 4000 }, transport);
  const result = await ask({ model: "jev-latest", state: {}, questions: {
    tool: { type: "choice", instructions: "Next tool?", criteria: { Read: "Read a file" } },
    model: { type: "choice", instructions: "Next model?", criteria: { sonnet: "Bounded work" } },
  } });
  expect(result.answers).toEqual({});
});

test("agent questions ask only for model and effort when enabled", () => {
  const questions = agentQuestions({ agents: true }, "en", { availableModels: ["sonnet"] });
  expect(Object.keys(questions)).toEqual(["model", "effort"]);
  expect(questions.model?.type).toBe("choice");
  expect(questions.effort?.type).toBe("choice");
  expect(agentQuestions({ agents: false })).toEqual({});
});

test("routing language is independent of the interface and configured candidates are bounded", () => {
  expect(resolveSettings({ locale: "pt" }, {}).promptLocale).toBe("en");
  expect(resolveSettings({ locale: "en", routing_locale: "pt" }, {}).promptLocale).toBe("pt");
  expect(resolveSettings({ claude_models: "claude-sonnet-4-6,invalid,claude-sonnet-4-6,claude-opus-5-5" }, {}).claudeModels)
    .toEqual(["claude-sonnet-4-6", "claude-opus-5-5"]);
  expect(resolveSettings({ claude_models: " " }, {}).claudeModels).toHaveLength(3);
});
