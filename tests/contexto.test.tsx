// Contexto: Jev judges a compaction that happens (the person's /compact, the engine's threshold, Pingo's own). The
// engine's precompute, worked out ahead of time and perhaps never used, is skipped: nothing is computed or kept, so
// the compaction that comes runs through Contexto whole and Jev is asked once, not on every precompute.
import { expect, test } from "claude-code/testing";
import { DEFAULT_FEATURES } from "../hooks/core/contracts.ts";
import { ASK, DEFAULT_USAGE, deckWorld } from "./deck/helpers.ts";
import { comandanteJev } from "./helpers.ts";

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const MESSAGES = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `message ${i} ${"x".repeat(400)}`, toolUses: [] }));

/** A process environment shared by every loop, with writes observable independently of the transcript hooks. */
function contextEnvironment(on: Parameters<typeof deckWorld>[0], previous?: string) {
  let current = previous;
  const writes: (string | undefined)[] = [];
  const change = (value: string | undefined) => {
    current = value;
  };
  on("env.get", { name: "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" }, async () => ({ value: current }));
  on("env.set", { name: "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" }, async (_$, e) => {
    change(e.value);
    writes.push(current);
    return { value: {} };
  });
  return { writes, current: () => current, change };
}

const TURN = { turnId: "t1", answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as const;

/** A world with Contexto `on` (and a Jev key), where core's own compaction is counted and skipped. */
function contextoWorld(on: Parameters<typeof deckWorld>[0], contexto = true, table: Parameters<typeof comandanteJev>[1] = {}) {
  const jev = comandanteJev(on, table);
  const deck = deckWorld(on, new Map<string, unknown>([
    ["features", { ...DEFAULT_FEATURES, codeQuality: false, contexto }],
    ["credentials", { apiKey: "test-key", provider: "typesafe" }],
  ]));
  let core = 0;
  on("session.compact", async () => {
    core++;
    return { skip: "core" };
  });
  return { ...deck, jev, core: () => core };
}

test("Contexto sets 25% for native main and subagent compactions and restores the host on toggle", async ($, on) => {
  const env = contextEnvironment(on, "80");
  contextoWorld(on);
  await $.session.start(SESSION);
  expect(env.current()).toBe("25");
  await $.command.run({ command: "jev", args: "feature contexto off", ...ASK });
  expect(env.current()).toBe("80");
  await $.command.run({ command: "jev", args: "feature contexto on", ...ASK });
  expect(env.writes).toEqual(["25", "80", "25"]);
});

test("Contexto off leaves the native threshold alone", async ($, on) => {
  const env = contextEnvironment(on, "70");
  contextoWorld(on, false);
  await $.session.start(SESSION);
  expect(env.writes).toEqual([]);
  expect(env.current()).toBe("70");
});

test("disabling Contexto preserves a threshold changed by another writer", async ($, on) => {
  const env = contextEnvironment(on);
  contextoWorld(on);
  await $.session.start(SESSION);
  env.change("40");
  await $.command.run({ command: "jev", args: "feature contexto off", ...ASK });
  expect(env.current()).toBe("40");
  expect(env.writes).toEqual(["25"]);
});

test("disabling Contexto unsets a threshold that was originally absent", async ($, on) => {
  const env = contextEnvironment(on);
  contextoWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "jev", args: "feature contexto off", ...ASK });
  expect(env.writes).toEqual(["25", undefined]);
});

for (const percent of [24.99, 25, 25.01, 90]) {
  test(`the main context compacts at ${percent}% only when at least 25% full`, async ($, on) => {
    contextEnvironment(on);
    const world = contextoWorld(on);
    await $.session.start(SESSION);
    world.state.usage = { ...DEFAULT_USAGE, context: { tokens: percent * 10_000, window: 1_000_000, percent } };
    await $.turn.complete(TURN);
    expect(world.core()).toBe(percent >= 25 ? 1 : 0);
  });
}

test("a missing percentage is calculated from the context tokens and window", async ($, on) => {
  contextEnvironment(on);
  const world = contextoWorld(on);
  await $.session.start(SESSION);
  world.state.usage = { ...DEFAULT_USAGE, context: { tokens: 250_000, window: 1_000_000, percent: null } };
  await $.turn.complete(TURN);
  expect(world.core()).toBe(1);
});

test("subagents finishing do not compact the main conversation", async ($, on) => {
  contextEnvironment(on);
  const world = contextoWorld(on);
  await $.session.start(SESSION);
  world.state.usage = { ...DEFAULT_USAGE, context: { tokens: 900_000, window: 1_000_000, percent: 90 } };
  await Promise.all(["a1", "a2", "nested"].map((agentId) => $.turn.complete({ ...TURN, agentId, turnId: agentId })));
  expect(world.core()).toBe(0);
});

test("native compactions clean each loop's own transcript, including nested subagents", async ($, on) => {
  const world = contextoWorld(on, true, {
    call_t1: { type: "noul", noul: 0 },
    result_t1: { type: "noul", noul: 0 },
  });
  await $.session.start(SESSION);
  for (const agentId of [undefined, "a1", "nested-a2"]) {
    const label = agentId ?? "main";
    const input = [
      { role: "user", text: `task for ${label}`, toolUses: [] },
      { role: "assistant", text: "", toolUses: [{ tool_use_id: label, tool: "Read", input: { file_path: `${label}.txt` } }] },
      { role: "user", text: "", toolUses: [], toolResults: [{ tool_use_id: label, text: "x".repeat(20_000) }] },
      ...MESSAGES,
    ];
    const result = await $.session.compact({ trigger: "auto", agentId, messages: input as never });
    expect(result.messages?.map((message) => message.text)).toEqual([input[0]!.text, ...MESSAGES.map((message) => message.text)]);
    expect(JSON.stringify(world.jev.asked.at(-1)?.state)).toContain(`${label}.txt`);
  }
  expect(world.jev.asked).toHaveLength(3);
  expect(world.core()).toBe(0);
});

test("a precompute is skipped: Jev is asked nothing, core keeps nothing, and no notice shows", async ($, on) => {
  const world = contextoWorld(on);
  await $.session.start(SESSION);
  const toasts = world.jev.toasts.length;
  const result = await $.session.compact({ trigger: "precompute", messages: MESSAGES as never });
  expect("skip" in result && typeof result.skip === "string").toBe(true);
  expect(world.jev.asked.length).toBe(0);
  expect(world.core()).toBe(0);
  expect(world.jev.toasts.length).toBe(toasts);
});

test("a compaction that happens still runs through Contexto", async ($, on) => {
  const world = contextoWorld(on);
  await $.session.start(SESSION);
  const toasts = world.jev.toasts.length;
  await $.session.compact({ trigger: "manual", messages: MESSAGES as never });
  // applied, too small or failed: each way Contexto worked on it and says so
  expect(world.jev.toasts.length).toBeGreaterThan(toasts);
});

test("with Contexto off, a precompute goes on to core as before", async ($, on) => {
  const world = contextoWorld(on, false);
  await $.session.start(SESSION);
  await $.session.compact({ trigger: "precompute", messages: MESSAGES as never });
  expect(world.core()).toBe(1);
  expect(world.jev.asked.length).toBe(0);
});

test("a feature failing at a turn's end does not cost that turn its compaction", async ($, on) => {
  let compactions = 0;
  let failing = false;
  let refused = 0;
  // no Jev key: Contexto hands each compaction on to core, where it is counted
  const world = deckWorld(on, new Map<string, unknown>([["features", { ...DEFAULT_FEATURES, codeQuality: false, contexto: true, vigia: true }]]), {
    fsWrite: async (_$: unknown, e: { path: string }) => {
      if (failing && /vigia/i.test(e.path)) {
        refused++;
        throw new Error("disk full");
      }
      return { value: undefined };
    },
  });
  on("session.compact", async () => {
    compactions++;
    return { skip: "counted" };
  });
  await $.session.start(SESSION);
  // Vigia's own record cannot be written at the turn's end, and the context is past Contexto's threshold
  failing = true;
  world.state.usage = { ...DEFAULT_USAGE, context: { tokens: 900_000, window: 1_000_000, percent: 90 } };
  await $.turn.complete({ turnId: "t1", answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });
  expect(refused).toBeGreaterThan(0);
  expect(compactions).toBe(1);
});
