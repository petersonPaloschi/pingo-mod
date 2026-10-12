// The Jev client and the dashboard's arithmetic, without an engine.
import { describe, expect, test } from "claude-code/testing";

import type { RouteEvent } from "../types";
import { resolveSettings } from "../hooks/config.ts";
import { createAskJev, normalize, resolveModel, resolveProvider, resolveUrl, validateKey, type Transport } from "../hooks/core/jev.ts";
import { askTimed } from "../hooks/core/request.ts";
import { readChoice } from "../hooks/core/selection.ts";
import { truncate } from "../hooks/core/state.ts";
import { reasons, status, tiles } from "../hooks/events.ts";
import { text } from "../hooks/i18n.ts";
import { cellsOf } from "../hooks/ui.tsx";

describe("agent task truncation", () => {
  test("keeps descriptions and prompts within their configured limit", () => {
    expect(truncate("a".repeat(100), 40)).toHaveLength(40);
    expect(truncate("abcdef", 4)).toBe("abcd");
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

  test("rounded provider distributions stay valid and confidence still gates a choice", async () => {
    for (const count of [120, 121]) {
      for (const confidence of [0.22, 0.9]) {
        const names = Array.from({ length: count }, (_, i) => `model_${i}`);
        const probabilities = Object.fromEntries(names.map((name, i) => [
          name,
          Math.round((i === 0 ? 0.22 : 0.78 / (count - 1)) * 100) / 100,
        ]));
        const criteria = Object.fromEntries(names.map((name) => [name, null]));
        const wire = transport([{
          status: 200,
          text: JSON.stringify({
            answers: { candidate: { type: "choice", choice: names[0], confidence, probabilities } },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        }]);
        const asked = await askTimed({
          ...request,
          questions: { candidate: { type: "choice", instructions: "Pick one candidate.", criteria } },
        }, createAskJev(settings, wire));
        if ("failure" in asked) throw new Error(asked.failure);
        const answer = asked.result.answers.candidate;
        expect(answer).toMatchObject({ type: "choice", choice: names[0], confidence });
        expect(readChoice(answer, names, 0.7)).toMatchObject(confidence < 0.7
          ? { reason: "low_confidence", held: { value: names[0], confidence, needed: 0.7 } }
          : { chosen: { value: names[0], confidence } });
      }
    }
  });

  test("retries once on a 5xx, never on a 4xx", async () => {
    const flaky = transport([{ status: 503, text: "" }, { status: 200, text: JSON.stringify({ answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }) }]);
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
    expect(fixed.dropped).toEqual([{ name: "tool", why: "missing confidence" }]);
  });

  test("a low in-range confidence remains valid and distinct from the winning probability", () => {
    const fixed = normalize({
      answers: { tool: { type: "choice", choice: "Read", confidence: 0.19, probabilities: { Read: 0.8, Bash: 0.2 } } },
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    expect(fixed.answers.tool).toMatchObject({ type: "choice", choice: "Read", confidence: 0.19 });
  });

  test("large rounded distributions allow accumulated drift but reject invalid sums", () => {
    const tail = (probability: number) => Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`tool_${i}`, probability]));
    const choice = (probabilities: Record<string, number>) => ({ type: "choice", choice: "Read", confidence: 0.22, probabilities });
    const accepted = {
      over: choice({ Read: 0.22, ...tail(0.01) }),
      under: choice({ Read: 0.66, ...tail(0) }),
      float: choice({ Read: 0.91, Bash: 0.060000000000000005, ...tail(0) }),
      boundary: choice({ Read: 0.71, ...Object.fromEntries(Array.from({ length: 59 }, (_, i) => [`tool_${i}`, 0.01])) }),
    };
    const result = normalize({ answers: {
      ...accepted,
      padded: choice({ Read: 0.7, Bash: 0.7, ...tail(0) }),
      precise: choice({ Read: 0.22, ...tail(0.0101) }),
      empty: choice({ Read: 0, ...tail(0) }),
      wrongWinner: { ...accepted.over, choice: "tool_0" },
    } });
    expect(result.answers).toEqual(accepted);
    expect(result.dropped).toEqual([
      { name: "padded", why: "probabilities do not sum to one" },
      { name: "precise", why: "probabilities do not sum to one" },
      { name: "empty", why: "probabilities do not sum to one" },
      { name: "wrongWinner", why: "choice is not highest-probability option" },
    ]);
  });

  test("missing usage stays unknown while a reported zero stays zero", () => {
    expect(normalize({ answers: {}, usage: { output_tokens: 8 } }).usage).toEqual({ output_tokens: 8 });
    expect(normalize({ answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }).usage)
      .toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(normalize({ answers: {}, usage: { input_tokens: -1, output_tokens: "many" } }).usage).toEqual({});
  });

  test("malformed choice answers identify the exact validation failure", () => {
    const fixed = normalize({
      answers: {
        confidenceOutOfRange: { type: "choice", choice: "Read", confidence: 1.1, probabilities: { Read: 1 } },
        probabilitiesMissing: { type: "choice", choice: "Read", confidence: 0.9 },
        probabilitiesNotMap: { type: "choice", choice: "Read", confidence: 0.9, probabilities: [] },
        probabilitiesInvalidValue: { type: "choice", choice: "Read", confidence: 0.9, probabilities: { Read: 1.1 } },
        probabilitiesDoNotSum: { type: "choice", choice: "Read", confidence: 0.9, probabilities: { Read: 0.7, Bash: 0.2 } },
        choiceMissing: { type: "choice", confidence: 0.9, probabilities: { Read: 1 } },
        choiceNotHighest: { type: "choice", choice: "Grep", confidence: 0.9, probabilities: { Read: 0.8, Grep: 0.2 } },
      },
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    expect(fixed.dropped).toEqual([
      { name: "confidenceOutOfRange", why: "invalid confidence" },
      { name: "probabilitiesMissing", why: "missing probabilities" },
      { name: "probabilitiesNotMap", why: "invalid probabilities" },
      { name: "probabilitiesInvalidValue", why: "invalid probabilities" },
      { name: "probabilitiesDoNotSum", why: "probabilities do not sum to one" },
      { name: "choiceMissing", why: "missing choice" },
      { name: "choiceNotHighest", why: "choice is not highest-probability option" },
    ]);
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
      usage: {},
      dropped: [{ name: "invalidChoice", why: "invalid choice" }, { name: "invalidNoul", why: "malformed" }],
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

  test("tiles and reasons preserve routing-disabled diagnostics", () => {
    const list = [
      event({ mode: "hint", tool: "Read", jev }),
      event({ reason: "low_confidence", jev }),
      event({ reason: "routing_disabled", usage: { input: 2000, output: 100, cached: 1000, cacheWrite: 0 } }),
    ];
    const byLabel = Object.fromEntries(tiles(list, "en").map((tile) => [tile.label, tile.value]));
    expect(byLabel[text("tile.routed.label", "en")]).toBe("33%");
    expect(byLabel[text("tile.latency.label", "en")]).toBe("400 ms");
    expect(reasons(list).map((reason) => reason.name)).toEqual(["low_confidence", "routing_disabled"]);
    expect(list[2]).toMatchObject({ reason: "routing_disabled", usage: { input: 2000, output: 100, cached: 1000, cacheWrite: 0 } });
  });

  test("token tiles distinguish unknown, reported zero, and partial Jev usage", () => {
    const get = (events: RouteEvent[]) => Object.fromEntries(tiles(events, "en").map((tile) => [tile.label, tile]));
    const missing = event({ reason: "jev_error: timeout", jev: undefined, usage: undefined });
    const unknown = get([missing]);
    expect(unknown[text("tile.input.label", "en")]?.value).toBe("-");
    expect(unknown[text("tile.output.label", "en")]?.value).toBe("-");
    expect(unknown[text("tile.jevInput.label", "en")]?.value).toBe("-");

    const zero = event({
      reason: "no_tool_needed",
      jev: { ...jev, inputTokens: 0 },
      usage: { input: 0, output: 0, cached: 0, cacheWrite: 0 },
    });
    const reportedZero = get([zero]);
    expect(reportedZero[text("tile.input.label", "en")]?.value).toBe("0");
    expect(reportedZero[text("tile.output.label", "en")]?.value).toBe("0");
    expect(reportedZero[text("tile.jevInput.label", "en")]?.value).toBe("0");

    const partial = event({
      reason: "low_confidence",
      jev: { ...jev, inputTokens: 12 },
      usage: { input: 10, output: 4, cached: 2, cacheWrite: 0 },
    });
    const mixed = get([partial, missing]);
    expect(mixed[text("tile.input.label", "en")]?.sub).toBe(text("tile.input.partial", "en", { percent: "17%", reported: "1", total: "2" }));
    expect(mixed[text("tile.output.label", "en")]?.sub).toBe(text("tile.output.partial", "en", { reported: "1", total: "2" }));
    expect(mixed[text("tile.jevInput.label", "en")]?.value).toBe("12");
    expect(mixed[text("tile.jevInput.label", "en")]?.sub).toBe(text("tile.jevInput.partial", "en", { reported: "1", total: "2" }));
  });

  test("scoped consults override legacy route advice for Jev metrics", () => {
    const legacy = event({ jev: { ...jev, inputTokens: 999, latencyMs: 5000 } });
    const consults = [
      { id: "j1", origin: "prompt" as const, model: "jev-requested", observed: "jev-1", usage: { input: 0, output: 17 }, questions: ["plan"], startedAt: 1000, endedAt: 1400 },
      { id: "j2", origin: "agent" as const, model: "jev-requested", error: "timeout", questions: ["effort"], startedAt: 2000 },
    ];
    const scoped = Object.fromEntries(tiles([legacy], "en", consults).map((tile) => [tile.label, tile]));

    expect(scoped[text("tile.latency.label", "en")]?.value).toBe("400 ms");
    expect(scoped[text("tile.jevInput.label", "en")]?.value).toBe("0");
    expect(scoped[text("tile.jevInput.label", "en")]?.sub).toBe(text("tile.jevInput.partial", "en", { reported: "1", total: "2" }));
    expect(scoped[text("tile.confidence.label", "en")]).toBeUndefined();
  });

  test("a Raster cell is three little-endian u32 values", () => {
    // "A", red, default background → 41 00 00 00 | 00 00 ff 00 | 00 00 00 01
    expect(cellsOf([[["A", 0xff0000]]])).toBe("QQAAAAAA/wAAAAAB");
  });
});
