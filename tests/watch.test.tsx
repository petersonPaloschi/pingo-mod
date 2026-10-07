// The Models tab: what each function decided at a prompt and why, and what it takes for the model
// to change next.
import type { On, RenderPropsOf } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

import { DEFAULT_FEATURES, type Features, type TurnPlan } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import { forecast, settleModel, turnFunctions, type TurnContext } from "../hooks/watch.ts";
import type { TurnDecision } from "../types";
import { text } from "../hooks/i18n.ts";

const ORIGIN = { kind: "composer" } as const;
const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 100,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 80, contentRows: 80 },
} as unknown as RenderPropsOf["Pane"];
const pick = (choice: string, confidence: number): Answer => ({ type: "choice", choice, confidence, probabilities: { [choice]: 1 } });
const noul = (value: number): Answer => ({ type: "noul", noul: value });
const DONE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

const ON: Features = { tools: true, participation: true, model: true, effort: true, delegation: true, agents: false };
const CTX: TurnContext = { features: ON, routing: true, hasKey: true, userModel: false, minConfidence: 0.7, session: { currentModel: "claude-opus-5-5" } };
const planOf = (answers: Record<string, Answer>, extra: Partial<TurnPlan> = {}): TurnPlan => ({
  decision: { mode: "hint", tool: "Read", confidence: 0.9, answers },
  ...extra,
});
const fn = (fns: ReturnType<typeof turnFunctions>, id: string) => fns.find((one) => one.id === id)!;

describe("turnFunctions", () => {
  test("a malformed tool answer preserves valid model and effort decisions", () => {
    const plan: TurnPlan = {
      decision: { mode: "passthrough", reason: "jev_unexpected_answer", answers: { model: pick("sonnet", 0.9), effort: pick("high", 0.9) } },
      model: { value: "sonnet", confidence: 0.9 },
      effort: { value: "high", confidence: 0.9 },
    };
    const fns = turnFunctions(plan, CTX);
    expect(fn(fns, "tools").result).toBe("failed");
    expect(fn(fns, "model").result).toBe("applied");
    expect(fn(fns, "effort").result).toBe("applied");
    expect(fn(fns, "delegation").result).toBe("failed");
  });

  test("a provider failure does not mark a manually chosen model as failed", () => {
    const fns = turnFunctions({ decision: { mode: "passthrough", reason: "jev_error: 401 from TypeSafe" } }, { ...CTX, userModel: true });
    expect(fn(fns, "model")).toMatchObject({ result: "off", why: "user_model" });
    expect(fn(fns, "tools").result).toBe("failed");
  });

  test("a switch above the bar is applied, with the confidence it needed", () => {
    const fns = turnFunctions(planOf({ model: pick("claude-sonnet-5-5", 0.9) }, { model: { value: "sonnet", confidence: 0.9 } }), CTX);
    expect(fn(fns, "model")).toMatchObject({ result: "applied", value: "claude-sonnet-5-5", from: "claude-opus-5-5", confidence: 0.9, needed: 0.85 });
  });

  test("a downgrade below the bar is held back with the confidence it lacked", () => {
    const fns = turnFunctions(
      planOf({ model: pick("claude-haiku-4-5-20251001", 0.8) }, { modelReason: "downgrade_confidence", retainedModel: "claude-opus-5-5" }),
      CTX,
    );
    expect(fn(fns, "model")).toMatchObject({ result: "kept", why: "downgrade_confidence", value: "claude-haiku-4-5-20251001", confidence: 0.8, needed: 0.85 });
  });

  test("Jev keeping the model, a model you picked and a disabled feature each say so", () => {
    const keep = turnFunctions(planOf({ model: pick("keep_current_model", 0.9) }, { modelReason: "keep_current" }), CTX);
    expect(fn(keep, "model")).toMatchObject({ result: "none", why: "keep_current" });
    const picked = turnFunctions(planOf({}), { ...CTX, userModel: true });
    expect(fn(picked, "model")).toMatchObject({ result: "off", why: "user_model" });
    const off = turnFunctions(planOf({}), { ...CTX, features: { ...ON, model: false, effort: false } });
    expect(fn(off, "model")).toMatchObject({ result: "off", why: "feature_off" });
    expect(fn(off, "effort")).toMatchObject({ result: "off", why: "feature_off" });
  });

  test("effort on Haiku, an unsure effort and a delegation Jev declined are not lost", () => {
    const haiku = turnFunctions(planOf({}, { effortIgnored: { value: "high", confidence: 0.9 } }), CTX);
    expect(fn(haiku, "effort")).toMatchObject({ result: "kept", why: "haiku_no_effort", value: "high" });
    const unsure = turnFunctions(planOf({ effort: pick("max", 0.4), delegate: pick("no_delegation", 0.2) }), CTX);
    expect(fn(unsure, "effort")).toMatchObject({ result: "kept", why: "low_confidence", value: "max", confidence: 0.4, needed: 0.7 });
    const declined = turnFunctions(planOf({}, { delegate: { value: "no_delegation", confidence: 0.9 } }), CTX);
    expect(fn(declined, "delegation")).toMatchObject({ result: "none", why: "no_delegation" });
  });

  test("participation, the tool hint and a failed call", () => {
    const out = turnFunctions(
      { decision: { mode: "passthrough", reason: "jev_declined", answers: { participate: noul(0.2) } }, participate: 0.2 },
      CTX,
    );
    expect(fn(out, "participation")).toMatchObject({ result: "applied", value: "out", confidence: 0.2 });
    expect(fn(out, "tools")).toMatchObject({ result: "none", why: "jev_declined" });
    const failed = turnFunctions({ decision: { mode: "passthrough", reason: "jev_error: HTTP 500" } }, CTX);
    expect(failed.filter((one) => one.id !== "delegation").every((one) => one.result === "failed")).toBe(true);
    const paused = turnFunctions({ decision: { mode: "passthrough", reason: "no_api_key" } }, { ...CTX, hasKey: false });
    expect(paused.every((one) => one.result === "off" && one.why === "no_api_key")).toBe(true);
  });
});

describe("settleModel", () => {
  const turn = (fns: TurnDecision["fns"]): TurnDecision => ({ seq: 1, time: 0, turn: 1, consulted: true, fns, settled: false });
  const applied = turn([{ id: "model", result: "applied", value: "claude-sonnet-5-5", from: "claude-opus-5-5", confidence: 0.9, needed: 0.85 }]);

  test("the first request says whether the model was switched, held back or already running", () => {
    expect(settleModel(applied, { kind: "switched", from: "claude-opus-5-5", to: "claude-sonnet-5-5" }).fns[0]).toMatchObject({ result: "applied" });
    expect(settleModel(applied, { kind: "held", why: "user_model", from: "claude-opus-5-5", to: "claude-sonnet-5-5" }).fns[0]).toMatchObject({ result: "kept", why: "user_model" });
    expect(settleModel(applied, { kind: "same", model: "claude-sonnet-5-5" }).fns[0]).toMatchObject({ result: "none", why: "same_model" });
    expect(settleModel(applied, undefined).settled).toBe(true);
  });
});

const round = (value: number) => Math.round(value * 1000) / 1000;

describe("forecast", () => {
  const base = {
    routing: true,
    hasKey: true,
    features: ON,
    userModel: false,
    current: "claude-opus-5-5",
    switchable: true,
    cacheReadTokens: 0,
    minConfidence: 0.7,
    available: ["claude-haiku-4-5-20251001", "claude-sonnet-5-5", "claude-opus-5-5"],
    blocked: [] as string[],
  };

  test("a downgrade needs more than an upgrade, and a warm cache needs more again", () => {
    const cold = forecast(base);
    expect(cold.blockers).toEqual([]);
    expect(cold.targets.map((t) => [t.tier, t.direction, round(t.needed)])).toEqual([["haiku", "down", 0.85], ["sonnet", "down", 0.85]]);
    const warm = forecast({ ...base, cacheReadTokens: 9000 });
    expect(warm.cacheWarm).toBe(true);
    expect(warm.targets.map((t) => round(t.needed))).toEqual([0.925, 0.925]);
    const up = forecast({ ...base, current: "claude-haiku-4-5-20251001" });
    expect(up.targets.map((t) => [t.tier, t.direction, round(t.needed)])).toEqual([["sonnet", "up", 0.7], ["opus", "up", 0.7]]);
  });

  test("blockers name what keeps Jev's pick from changing anything", () => {
    expect(forecast({ ...base, features: { ...ON, model: false } }).blockers).toEqual(["feature_off"]);
    expect(forecast({ ...base, userModel: true }).blockers).toEqual(["user_model"]);
    expect(forecast({ ...base, current: "claude-opus-5-5[1m]", switchable: false }).blockers).toEqual(["model_id"]);
    expect(forecast({ ...base, routing: false, hasKey: false }).blockers).toEqual(["routing_disabled"]);
    expect(forecast({ ...base, blocked: ["claude-sonnet-5-5"] }).targets.find((t) => t.tier === "sonnet")?.blocked).toBe(true);
  });
});

/** The engine beneath the mod: Jev answers from `table`, and a request reports the model it was sent on. */
function world(on: On, features: Partial<Features>, table: Record<string, Answer>, failStatus?: number) {
  mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });
  mock.store(on, { provider: "typesafe", features: { ...DEFAULT_FEATURES, ...features } });
  mock.env(on, { TYPESAFE_API_KEY: "test-key" });
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: [{ name: "Read", description: "Read a file", mcp: false }] }));
  on("session.messages", async () => ({ value: [] }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-watch" }));
  on("prompt.compose", async () => ({ sections: [] }));
  on("http.fetch", async (_$, e) => {
    if (failStatus) return { value: { status: failStatus, ok: false, headers: {}, text: "provider refused the test credential" } };
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(request.questions ?? {})) {
      const answer = table[key];
      if (!answer) continue;
      const offered = answer.type === "choice" && question.type === "choice"
        ? Object.keys(question.criteria).find((id) => id === answer.choice || id.startsWith(`claude-${answer.choice}-`)) : undefined;
      answers[key] = offered && answer.type === "choice" ? { ...answer, choice: offered, probabilities: { [offered]: 1 } } : answer;
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });
  on("prompt.submit", async (_$, e) => ({ text: e.text, ...(e.context ? { context: e.context } : {}) }));
  on("classic.PostModelSwitch", () => ({}));
  on("tool.call", async () => ({ result: "ok" }) as never);
  on("turn.complete", async (_$, e) => ({ text: e.answer }));
  on("turn.step", async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: "Done.", toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model } };
  });
}

async function step($: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } }, e: object) {
  const stream = $.turn.step(e as never);
  for await (const _ of stream) void _;
  return stream.result;
}

describe("the Models tab", () => {
  const opusStep = { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 };

  test("a provider error is recorded as a consultation attempt", async ($, on) => {
    world(on, { model: true }, {}, 401);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "implement the function", wait: false, origin: ORIGIN });
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-models" });
    const drawn = JSON.stringify(await ui.drawn());
    expect(drawn).toContain(text("ui.models.asked", "en", { latency: "0 ms" }));
    expect(drawn).not.toContain(text("ui.models.skipped", "en"));
    expect(drawn).toContain(text("ui.models.failed", "en"));
    await ui.unmount();
  });

  test("shows a switch with the confidence it needed", async ($, on) => {
    world(on, { model: true }, { tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("sonnet", 0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    await step($ as never, opusStep);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-models" });
    expect(await ui.find({ type: "Text", text: /switched opus-5-5 → sonnet-5-5 · confidence 0\.90 \(needed 0\.85\)/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Jev decides once per prompt/ })).toBeDefined();
    await ui.unmount();
  });

  test("says why a model change did not happen, and what it would take", async ($, on) => {
    world(on, { model: true }, { tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("haiku", 0.8) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "format the file", wait: false, origin: ORIGIN });
    await step($ as never, opusStep);
    const ui = await $.ui.mount({ plugin: "jev", surface: "desktop", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-models" });
    expect(await ui.find({ type: "Text", text: /kept opus-5-5; Jev wanted haiku-4-5 at 0\.80, needs ≥ 0\.85/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /↓ haiku-4-5\s+needs ≥ 0\.85/ })).toBeDefined();
    await ui.unmount();
  });

  test("names what blocks a change: a disabled feature, a model you picked", async ($, on) => {
    world(on, {}, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-models" });
    expect(await ui.find({ type: "Text", text: /the Model per turn feature is off/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /No routing point yet/ })).toBeDefined();
    await ui.unmount();
  });

  test("/jev models opens the tab", async ($, on) => {
    world(on, { model: true }, {});
    const opened: string[] = [];
    on("ui.open", async (_$, e) => {
      opened.push(e.id);
      return { value: {} } as never;
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.command.run({ command: "jev", args: "models", origin: ORIGIN, presentation: { isFullscreen: true, columns: 160 } } as never);
    expect(opened).toContain("jev");
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    expect(await ui.find({ type: "Text", text: "Running now" })).toBeDefined();
    await ui.unmount();
  });
});
