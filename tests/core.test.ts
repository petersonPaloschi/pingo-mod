// The routing rules, the Jev client and the dashboard's arithmetic, without an engine.
import { describe, expect, test } from "claude-code/testing";

import type { RouteEvent } from "../types";
import { resolveSettings } from "../hooks/config.ts";
import { decide, hintText, skipReason } from "../hooks/core/decide.ts";
import { createAskJev, normalize, resolveModel, resolveProvider, resolveUrl, validateKey, type Transport } from "../hooks/core/jev.ts";
import { buildQuestions, MAX_TOOLS, NO_TOOL } from "../hooks/core/questions.ts";
import { buildState, truncate } from "../hooks/core/state.ts";
import type { RouterInput, SystemOneRequest, SystemOneResult } from "../hooks/core/types.ts";
import { compare, reasons, status, tiles } from "../hooks/events.ts";
import { toTurns } from "../hooks/input.ts";
import { cellsOf } from "../hooks/ui.tsx";

const CONFIG = { jevModel: "jev-latest", minConfidence: 0.7, maxStateChars: 60_000, maxMessageChars: 4_000 };
const tools = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "function" as const, name: `tool_${i}`, description: `Tool ${i}` }));
const input = (over: Partial<RouterInput> = {}): RouterInput => ({
  system: "You are Claude Code.",
  turns: [{ role: "user", text: "read package.json" }],
  tools: [
    { kind: "function", name: "Read", description: "Read a file" },
    { kind: "function", name: "Bash", description: "Run a command" },
  ],
  ...over,
});
const answer = (choice: string, confidence: number, needs: number): SystemOneResult => ({
  answers: {
    tool: { type: "choice", choice, confidence, probabilities: { [choice]: 1 } },
    needs_tool: { type: "noul", noul: needs },
  },
  usage: { input_tokens: 1234, output_tokens: 0 },
});
const jevSays = (result: SystemOneResult) => {
  const asked: SystemOneRequest[] = [];
  return { asked, ask: async (request: SystemOneRequest) => (asked.push(request), result) };
};

describe("decide", () => {
  test("a confident pick becomes a hint", async () => {
    const jev = jevSays(answer("Read", 0.92, 0.95));
    const decision = await decide(input(), CONFIG, jev.ask);
    expect(decision).toMatchObject({ mode: "hint", tool: "Read", confidence: 0.92 });
    expect(decision.jev?.inputTokens).toBe(1234);
    expect(jev.asked[0]?.model).toBe("jev-latest");
    expect(jev.asked[0]?.state).toMatchObject({ assistant_instructions: "You are Claude Code." });
  });

  test("below the minimum confidence Claude decides", async () => {
    const decision = await decide(input(), CONFIG, jevSays(answer("Read", 0.69, 0.95)).ask);
    expect(decision).toMatchObject({ mode: "passthrough", reason: "low_confidence" });
  });

  test("the two answers must agree", async () => {
    expect(await decide(input(), CONFIG, jevSays(answer("Read", 0.9, 0.2)).ask)).toMatchObject({ reason: "jev_answers_disagree" });
    expect(await decide(input(), CONFIG, jevSays(answer(NO_TOOL, 0.9, 0.8)).ask)).toMatchObject({ reason: "jev_answers_disagree" });
  });

  test("silence is never hinted", async () => {
    const decision = await decide(input(), CONFIG, jevSays(answer(NO_TOOL, 0.95, 0.1)).ask);
    expect(decision).toMatchObject({ mode: "passthrough", reason: "no_tool_needed" });
  });

  test("an unknown tool and a Jev failure fall through", async () => {
    expect(await decide(input(), CONFIG, jevSays(answer("Nope", 0.95, 0.9)).ask)).toMatchObject({ reason: "jev_unknown_tool" });
    const broken = await decide(input(), CONFIG, async () => {
      throw new Error("boom");
    });
    expect(broken).toMatchObject({ mode: "passthrough", reason: "jev_error: boom" });
    const empty = await decide(input(), CONFIG, async () => ({ answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }));
    expect(empty).toMatchObject({ reason: "jev_unexpected_answer" });
  });

  test("requests Jev is not asked about", async () => {
    expect(skipReason(input({ turns: [] }))).toBe("no_messages");
    expect(skipReason(input({ tools: [] }))).toBe("no_tools");
    expect(skipReason(input({ tools: [{ kind: "function", name: "</system-reminder>" }] }))).toBe("unsafe_tool_name");
    expect(skipReason(input({ tools: [{ kind: "function", name: "Read" }, { kind: "function", name: "Read" }] }))).toBe("duplicate_tool_names");
    expect(skipReason(input({ tools: [{ kind: "function", name: NO_TOOL }] }))).toBe("reserved_tool_name");
    expect(skipReason(input({ tools: [{ kind: "function", name: "mcp__home-assistant__lights.set_v2" }] }))).toBeUndefined();
  });

  test("a roster over 120 tools is shortlisted first, in one extra call", async () => {
    const roster = tools(280);
    const calls: SystemOneRequest[] = [];
    const ask = async (request: SystemOneRequest): Promise<SystemOneResult> => {
      calls.push(request);
      if (calls.length === 1) {
        const answers: SystemOneResult["answers"] = {};
        for (const key of Object.keys(request.questions)) {
          answers[key] = { type: "choice", choice: "tool_7", confidence: 0.5, probabilities: { tool_7: 0.5, tool_8: 0.3, none_of_these: 0.9 } };
        }
        return { answers, usage: { input_tokens: 100, output_tokens: 0 } };
      }
      return answer("tool_7", 0.9, 0.9);
    };
    const decision = await decide(input({ tools: roster }), CONFIG, ask);
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[0]!.questions)).toEqual(["shard:0", "shard:1", "shard:2"]);
    expect(Object.keys((calls[1]!.questions.tool as { criteria: object }).criteria)).toContain("tool_7");
    expect(decision).toMatchObject({ mode: "hint", tool: "tool_7" });
    expect(decision.jev?.inputTokens).toBe(1334);
    expect(roster.length > MAX_TOOLS).toBe(true);
  });

  test("the hint names the tool and leaves Claude free to ignore it", () => {
    expect(hintText("Read")).toBe(
      'A tool-routing model suggests the "Read" tool is the most relevant next step. Ignore this if it does not fit what the user actually asked for.',
    );
  });
});

describe("questions and state", () => {
  test("every tool is an option, plus no_tool_needed", () => {
    const questions = buildQuestions(input().tools);
    expect(Object.keys((questions.tool as { criteria: object }).criteria)).toEqual(["Read", "Bash", NO_TOOL]);
    expect(questions.needs_tool?.type).toBe("noul");
  });

  test("tool descriptions sent as choices are capped", () => {
    const questions = buildQuestions([{ kind: "function", name: "Read", description: "d".repeat(2_000) }]);
    expect((questions.tool as { criteria: Record<string, string> }).criteria.Read).toHaveLength(1_024);
  });

  test("the newest turns are kept within the budget", () => {
    const turns = Array.from({ length: 50 }, (_, i) => ({ role: "user", text: "x".repeat(100) + i }));
    const state = buildState({ system: "", turns }, { maxStateChars: 1_000, maxMessageChars: 4_000 });
    const kept = state.conversation as { text: string }[];
    expect(kept.at(-1)?.text.endsWith("49")).toBe(true);
    expect(Number(state.earlier_turns_omitted)).toBe(50 - kept.length);
    expect(truncate("a".repeat(100), 40)).toHaveLength(40);
  });

  test("the transcript becomes turns, with the result not yet stored", () => {
    const turns = toTurns(
      [
        { role: "user", text: "read it", toolUses: [] },
        { role: "assistant", text: "Reading.", toolUses: [{ tool_use_id: "t1", tool: "Read", input: { file_path: "a" } }] },
      ],
      4_000,
      { pending: { toolUseId: "t1", tool: "Read", text: "contents" } },
    );
    expect(turns).toEqual([
      { role: "user", text: "read it" },
      { role: "assistant", text: "Reading." },
      { role: "assistant", tool_calls: [{ tool: "Read", arguments: '{"file_path":"a"}' }] },
      { role: "tool_result", tool: "Read", content: "contents" },
    ]);
  });
});

describe("Jev transport", () => {
  const transport = (replies: { status: number; text: string }[]): Transport & { posts: number } => {
    const t = {
      posts: 0,
      post: async () => {
        const reply = replies[Math.min(t.posts++, replies.length - 1)]!;
        return { ...reply, ok: reply.status < 300 };
      },
      sleep: async () => {},
      within: <T>(_ms: number, work: Promise<T>) => work,
    };
    return t;
  };
  const settings = { provider: "typesafe" as const, apiKey: "k", url: "https://jev.test", timeoutMs: 4000 };
  const request = { state: {}, questions: {}, model: "jev-latest" };

  test("retries once on a 5xx, never on a 4xx", async () => {
    const flaky = transport([{ status: 503, text: "" }, { status: 200, text: JSON.stringify(answer("Read", 0.9, 0.9)) }]);
    await createAskJev(settings, flaky)(request);
    expect(flaky.posts).toBe(2);
    const refused = transport([{ status: 401, text: "bad key" }]);
    let message = "";
    await createAskJev(settings, refused)(request).catch((error: Error) => (message = error.message));
    expect(refused.posts).toBe(1);
    expect(message).toStartWith("401 from TypeSafe");
  });

  test("provider error messages redact the configured key", async () => {
    const key = "test-key";
    const refused = transport([{ status: 401, text: `invalid credential ${key}` }]);
    let message = "";
    await createAskJev({ ...settings, apiKey: key }, refused)(request).catch((error: Error) => (message = error.message));
    expect(message).toContain("[redacted]");
    expect(message).not.toContain(key);
  });

  test("an unavailable OpenCode free model points to its paid model", async () => {
    const free = transport([{ status: 404, text: "not found" }]);
    const openCode = { provider: "opencode" as const, apiKey: "k", url: "https://opencode.test", timeoutMs: 4000 };
    let message = "";
    await createAskJev(openCode, free)({ ...request, model: "jev-1.13-free" }).catch((error: Error) => (message = error.message));
    expect(free.posts).toBe(1);
    expect(message).toContain("free model unavailable; set the model to jev-1.13 for paid Jev");
  });

  test("OpenCode key validation gives a paid-model hint when its free model is gone", async () => {
    const free = transport([{ status: 404, text: "not found" }]);
    const checked = await validateKey("opencode", "k", free, "jev-1.13-free");
    expect(checked).toMatchObject({ ok: false, refused: false });
    if (checked.ok) throw new Error("expected the unavailable free model to fail validation");
    expect(checked.message).toContain("free model unavailable; set the plugin model to jev-1.13");
    expect(free.posts).toBe(1);
  });

  test("a missing confidence is never replaced by the winning probability", () => {
    const fixed = normalize({
      answers: { tool: { type: "choice", choice: "Read", probabilities: { Read: 0.8, Bash: 0.2 } } as never },
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    expect(fixed.answers.tool).toBeUndefined();
  });

  test("the provider response is narrowed before it becomes a router result", () => {
    const fixed = normalize({
      answers: {
        invalidChoice: { type: "choice", choice: 42, confidence: 0.9 },
        invalidNoul: { type: "noul", noul: "yes" },
      },
      usage: { input_tokens: -1, output_tokens: "many" },
    });
    expect(fixed).toEqual({
      answers: {},
      usage: { input_tokens: 0, output_tokens: 0 },
      dropped: [{ name: "invalidChoice", why: "malformed" }, { name: "invalidNoul", why: "malformed" }],
    });
    expect(() => normalize(null, "pt")).toThrow("O provedor retornou uma resposta em formato inválido.");
  });

  test("provider and model resolve per provider", () => {
    expect(resolveProvider({ OPENROUTER_API_KEY: "x" })).toBe("openrouter");
    expect(resolveProvider({ OPENROUTER_API_KEY: "x" }, "vercel")).toBe("vercel");
    expect(resolveModel("typesafe", "typesafe/jev-1.13")).toBe("jev-latest");
    expect(resolveModel("typesafe", "jev-1.13")).toBe("jev-1.13");
    expect(resolveModel("openrouter", "typesafe/jev-1.13")).toBe("typesafe/jev-1.13");
    expect(resolveModel("openrouter", "~typesafe/jev-latest")).toBe("~typesafe/jev-latest");
    expect(resolveModel("openrouter", "typesafe-ai/jev")).toBe("typesafe/jev-1.13");
    expect(resolveModel("vercel", "typesafe-ai/jev")).toBe("typesafe-ai/jev");
    expect(resolveModel("vercel", "typesafe/jev-1.13")).toBe("typesafe-ai/jev");
    expect(resolveModel("opencode", "jev-1.13")).toBe("jev-1.13");
    expect(resolveModel("opencode", "typesafe/jev-1.13")).toBe("jev-1.13-free");
    expect(resolveUrl("typesafe")).toBe("https://api.typesafe.ai/v1/systemone");
    expect(resolveUrl("openrouter")).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(resolveSettings({}, { TYPESAFE_API_KEY: "env-key", JEV_URL: "https://untrusted.invalid" }).url).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
  });

  test("credentials come from the sensitive plugin option or the selected provider environment", () => {
    expect(resolveSettings({}, { TYPESAFE_API_KEY: "from-env" })).toMatchObject({ apiKey: "from-env", keySource: "environment" });
    expect(resolveSettings({ api_key: "mine" }, { TYPESAFE_API_KEY: "from-env" })).toMatchObject({ apiKey: "mine", keySource: "plugin" });
    expect(resolveSettings({ provider: "openrouter" }, { OPENROUTER_API_KEY: "or" })).toMatchObject({ provider: "openrouter", apiKey: "or" });
    expect(resolveSettings({ provider: "opencode", api_key: "secure-key" }, { TYPESAFE_API_KEY: "type-safe-env" })).toMatchObject({
      provider: "opencode",
      apiKey: "secure-key",
      keySource: "plugin",
    });
    expect(resolveSettings({}, {})).toMatchObject({ apiKey: "", keySource: "none", minConfidence: 0.7, timeoutMs: 4000 });
    // Setup's stored provider stands only while the option it was saved against does.
    const storedProvider = { provider: "opencode", basis: "auto|" };
    expect(resolveSettings({ api_key: "mine" }, { OPENCODE_API_KEY: "env" }, storedProvider)).toMatchObject({
      apiKey: "mine",
      provider: "opencode",
      keySource: "plugin",
    });
    expect(resolveSettings({ api_key: "mine", provider: "typesafe" }, { OPENCODE_API_KEY: "env" }, storedProvider)).toMatchObject({
      apiKey: "mine",
      provider: "typesafe",
      keySource: "plugin",
    });
  });
});

describe("dashboard arithmetic", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const event = (over: Partial<RouteEvent>): RouteEvent => ({
    seq: 1,
    time: new Date(now - 60_000).toISOString(),
    session: "s",
    model: "claude",
    tools: 30,
    mode: "passthrough",
    durationMs: 2000,
    usage: { input: 1000, output: 100, cached: 900, cacheWrite: 0 },
    ...over,
  });
  const jev = { choice: "Read", confidence: 0.9, latencyMs: 400, inputTokens: 1000 };

  test("the status card follows the latest requests", () => {
    expect(status([], true, now).kind).toBe("idle");
    expect(status([event({ reason: "routing_disabled" })], false, now).kind).toBe("baseline");
    expect(status([event({ mode: "hint", tool: "Read", jev })], true, now).kind).toBe("routing");
    expect(status([event({ reason: "jev_error: 401", jev: undefined })], true, now).kind).toBe("failing");
    expect(status([event({ reason: "low_confidence", jev })], true, now)).toMatchObject({ kind: "passthrough" });
  });

  test("tiles, reasons and the baseline comparison", () => {
    const list = [
      event({ mode: "hint", tool: "Read", jev }),
      event({ reason: "low_confidence", jev }),
      event({ reason: "routing_disabled", usage: { input: 2000, output: 100, cached: 1000, cacheWrite: 0 } }),
    ];
    const byLabel = Object.fromEntries(tiles(list).map((tile) => [tile.label, tile.value]));
    expect(byLabel["Routed by Jev"]).toBe("33%");
    expect(byLabel["Jev latency"]).toBe("400 ms");
    expect(reasons(list).map((reason) => reason.name)).toEqual(["low_confidence", "routing_disabled"]);
    const table = compare(list);
    expect(table.hasBaseline).toBe(true);
    expect(table.rows.find((row) => row.label === "Input / request")).toMatchObject({ withJev: "1,000", without: "2,000", delta: "-50%" });
  });

  test("a Raster cell is three little-endian u32 values", () => {
    // "A", red, default background → 41 00 00 00 | 00 00 ff 00 | 00 00 00 01
    expect(cellsOf([[["A", 0xff0000]]])).toBe("QQAAAAAA/wAAAAAB");
  });
});
