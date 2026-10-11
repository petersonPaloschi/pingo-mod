// Contexto: Jev judges a compaction that happens (the person's /compact, the engine's threshold, Pingo's own). The
// engine's precompute, worked out ahead of time and perhaps never used, is skipped: nothing is computed or kept, so
// the compaction that comes runs through Contexto whole and Jev is asked once, not on every precompute.
import { expect, test } from "claude-code/testing";
import { DEFAULT_FEATURES } from "../hooks/core/contracts.ts";
import { DEFAULT_USAGE, deckWorld } from "./deck/helpers.ts";
import { comandanteJev } from "./helpers.ts";

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const MESSAGES = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `message ${i} ${"x".repeat(400)}`, toolUses: [] }));

/** A world with Contexto `on` (and a Jev key), where core's own compaction is counted and skipped. */
function contextoWorld(on: Parameters<typeof deckWorld>[0], contexto = true) {
  const jev = comandanteJev(on, {});
  deckWorld(on, new Map<string, unknown>([
    ["features", { ...DEFAULT_FEATURES, codeQuality: false, contexto }],
    ["credentials", { apiKey: "test-key", provider: "typesafe" }],
  ]));
  let core = 0;
  on("session.compact", async () => {
    core++;
    return { skip: "core" };
  });
  return { jev, core: () => core };
}

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
