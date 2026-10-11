// Context compaction asks Jev about each tool call: an answer that is missing or malformed keeps its call (the
// others still apply), and only a few requests, each carrying the whole state, go out at once.
import { expect, test } from "claude-code/testing";

import {
  collectContextToolCalls,
  compactContext,
  contextQuestionsFor,
  estimateContextTokens,
  fitContextState,
  resolveContextOptions,
  type ContextJevAnswer,
  type ContextJevAsker,
  type ContextMessage,
} from "../hooks/core/compaction.ts";

/** One Read call and its long result, as two messages. */
const read = (n: number): ContextMessage[] => [
  { role: "assistant", text: "", toolUses: [{ tool_use_id: `u${n}`, tool: "Read", input: { file_path: `src/f${n}.ts` } }] },
  { role: "user", text: "", toolUses: [], toolResults: [{ tool_use_id: `u${n}`, text: "x".repeat(2000) }] },
];
const transcript = (calls: number): ContextMessage[] => [
  { role: "user", text: "Fix the loader", toolUses: [] },
  ...Array.from({ length: calls }, (_, i) => read(i + 1)).flat(),
];
/** Only the first message is pinned, so every call is asked about. */
const OPTIONS = { preserveRecentMessages: 0 };

/** A request size with room for exactly one call's questions beside the fitted state: one request per call. */
function oneCallPerRequest(messages: readonly ContextMessage[]): number {
  const resolved = resolveContextOptions(OPTIONS);
  const calls = collectContextToolCalls(messages, resolved.preserveRecentMessages);
  const state = fitContextState(messages, calls, resolved);
  const question = Math.max(...calls.map((call) => estimateContextTokens(JSON.stringify(contextQuestionsFor(call)))));
  return state.tokens + 20 + question;
}

test("an answer missing for one call keeps that call, and the other answers still apply", async () => {
  const asker: ContextJevAsker = {
    // t1 may go entirely; t2's result is not answered at all
    ask: async () => ({ answers: { call_t1: { type: "noul", noul: 0 }, result_t1: { type: "noul", noul: 0 }, call_t2: { type: "noul", noul: 0 } } }),
  };
  const result = await compactContext(transcript(2), asker, OPTIONS);
  expect(result.decisions.map((decision) => [decision.id, decision.reason])).toEqual([["t1", "call_dropped"], ["t2", "kept"]]);
  expect(result.stats.callsDropped).toBe(1);
});

test("a malformed answer keeps its call instead of failing the compaction", async () => {
  const asker: ContextJevAsker = {
    ask: async (_state, questions) => ({
      answers: Object.fromEntries(Object.keys(questions).map((name): [string, ContextJevAnswer] => [name, { type: "noul", noul: Number.NaN }])),
    }),
  };
  const result = await compactContext(transcript(2), asker, OPTIONS);
  expect(result.decisions.every((decision) => decision.reason === "kept")).toBe(true);
  expect(result.messages).toHaveLength(5);
});

test("compaction keeps at most four requests in flight", async () => {
  const messages = transcript(12);
  let open = 0;
  let peak = 0;
  let requests = 0;
  const asker: ContextJevAsker = {
    ask: async (_state, questions) => {
      requests++;
      open++;
      peak = Math.max(peak, open);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      open--;
      return { answers: Object.fromEntries(Object.keys(questions).map((name): [string, ContextJevAnswer] => [name, { type: "noul", noul: 1 }])) };
    },
  };
  const result = await compactContext(messages, asker, { ...OPTIONS, maxRequestTokens: oneCallPerRequest(messages) });
  expect(requests).toBe(12);
  expect(result.stats.requests).toBe(12);
  expect(peak).toBe(4);
});

test("a request that fails still fails the compaction, and no new request starts after it", async () => {
  let requests = 0;
  const asker: ContextJevAsker = {
    ask: async () => {
      requests++;
      throw new Error("provider down");
    },
  };
  const messages = transcript(12);
  await expect(compactContext(messages, asker, { ...OPTIONS, maxRequestTokens: oneCallPerRequest(messages) })).rejects.toThrow("provider down");
  expect(requests).toBeLessThanOrEqual(4);
});
