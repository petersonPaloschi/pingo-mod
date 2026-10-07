import { expect, test } from "claude-code/testing";
import { resolveSettings } from "../hooks/config.ts";
import { createAskJev, normalize, type Transport } from "../hooks/core/jev.ts";
import { DEFAULT_FEATURES, KEEP_MODEL, selectModel, turnQuestions } from "../hooks/core/plan.ts";
import { buildState } from "../hooks/core/state.ts";
import type { ChoiceAnswer } from "../hooks/core/types.ts";

const pick = (choice: string, confidence: number): ChoiceAnswer => ({ type: "choice", choice, confidence, probabilities: { [choice]: 1 } });

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

test("downgrades require stronger evidence than upgrades and warm cache raises the bar again", () => {
  expect(selectModel(pick("opus", 0.8), 0.7, { currentModel: "claude-sonnet-5-5" }).model?.value).toBe("opus");
  expect(selectModel(pick("haiku", 0.8), 0.7, { currentModel: "claude-opus-5-5" }))
    .toMatchObject({ retainedModel: "claude-opus-5-5", modelReason: "downgrade_confidence" });
  expect(selectModel(pick("haiku", 0.9), 0.7, { currentModel: "claude-opus-5-5", cacheReadTokens: 30000 }))
    .toMatchObject({ retainedModel: "claude-opus-5-5", modelReason: "cache_confidence" });
  expect(selectModel(pick("haiku", 0.99), 0.7, { currentModel: "claude-opus-5-5", cacheReadTokens: 30000 }).model?.value).toBe("haiku");
});

test("exact configured model versions are offered, preserved, and checked before applying", () => {
  const session = { currentModel: "claude-opus-5-5", availableModels: ["claude-sonnet-4-6", "claude-sonnet-5-5"] };
  const question = turnQuestions({ ...DEFAULT_FEATURES, model: true }, [], "en", session).model;
  if (question?.type !== "choice") throw new Error("expected a model choice");
  expect(Object.keys(question.criteria)).toEqual([...session.availableModels, KEEP_MODEL]);
  expect(question.criteria["claude-sonnet-4-6"]).toMatchObject({ model: "claude-sonnet-4-6" });
  expect(selectModel(pick("claude-sonnet-4-6", 0.99), 0.7, session).model)
    .toEqual({ value: "sonnet", confidence: 0.99, id: "claude-sonnet-4-6" });
  expect(selectModel(pick("claude-haiku-4-5-20251001", 0.99), 0.7, session).model).toBeUndefined();
  expect(selectModel(pick(KEEP_MODEL, 1), 0.7, session).retainedModel).toBe(session.currentModel);
  expect(selectModel(undefined, 0.7, session).retainedModel).toBe(session.currentModel);
});

test("routing language is independent of the interface and configured candidates are bounded", () => {
  expect(resolveSettings({ locale: "pt" }, {}).promptLocale).toBe("en");
  expect(resolveSettings({ locale: "en", routing_locale: "pt" }, {}).promptLocale).toBe("pt");
  expect(resolveSettings({ claude_models: "claude-sonnet-4-6,invalid,claude-sonnet-4-6,claude-opus-5-5" }, {}).claudeModels)
    .toEqual(["claude-sonnet-4-6", "claude-opus-5-5"]);
  expect(resolveSettings({ claude_models: " " }, {}).claudeModels).toHaveLength(3);
});

test("current request, latest observation, and execution metadata remain explicit after truncation", () => {
  const state = buildState({ system: "instructions", turns: [
    { role: "user", text: "old request" },
    { role: "tool_result", tool: "Read", content: "source content" },
    { role: "user", text: "compare this source" },
  ], session: { currentModel: "claude-sonnet-5-5", contextTokens: 30000, cacheReadTokens: 29000, availableModels: ["claude-sonnet-5-5"] } },
  { maxStateChars: 500, maxMessageChars: 100 });
  expect(state).toMatchObject({
    current_request: "compare this source",
    latest_tool_result: { tool: "Read", content: "source content" },
    session: { current_model: "claude-sonnet-5-5", context_tokens: 30000, cache_read_tokens: 29000, available_models: ["claude-sonnet-5-5"] },
  });
  expect(JSON.stringify(state).length).toBeLessThan(600);
});
