// The "Request advisor consultation" feature: Jev's advisor question rides in the prompt's one
// routing call, and a confident "consult" attaches a hint. Claude still decides whether it calls the
// advisor; the plugin never changes the advisor the person configured.
import type { On, RenderPropsOf } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import { ADVISOR_KEY, DEFAULT_FEATURES, turnQuestions, type Features } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import { text } from "../hooks/i18n.ts";
import { noul, pick, step } from "./helpers.ts";

const ORIGIN = { kind: "composer" } as const;
const ASK = { origin: ORIGIN, presentation: { isFullscreen: true, columns: 160 } } as const;
const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 120,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 120, contentRows: 120 },
} as unknown as RenderPropsOf["Pane"];
const HINT = text("planning.hint.advisor", "en");
const TOOL = { tool: pick("Read", 0.9), needs_tool: noul(0.9) };
const DONE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** The engine beneath the mod, with a Jev key; `table` answers each question Jev is asked. */
function world(on: On, features: Partial<Features>, table: Record<string, Answer>, opts: { status?: number; routing?: boolean; key?: boolean } = {}) {
  mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });
  mock.store(on, { provider: "typesafe", features: { ...DEFAULT_FEATURES, ...features }, ...(opts.routing === false ? { routing: false } : {}) });
  mock.env(on, opts.key === false ? {} : { TYPESAFE_API_KEY: "test-key" });
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: [{ name: "Read", description: "Read a file", mcp: false }] }));
  on("session.messages", async () => ({ value: [] }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-advisor" }));
  on("settings.read", async () => ({ value: { advisorModel: "claude-opus-5-5" } }) as never);
  on("prompt.compose", async () => ({ sections: [] }));
  const jev = { asked: [] as SystemOneRequest[] };
  on("http.fetch", async (_$, e) => {
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    jev.asked.push(request);
    if (opts.status) return { value: { status: opts.status, ok: false, headers: {}, text: "provider failed" } };
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(request.questions ?? {})) {
      const answer = table[key];
      if (!answer) continue;
      const offered = answer.type === "choice" && question.type === "choice" && key === "model"
        ? Object.keys(question.criteria).find((id) => id.startsWith(`claude-${answer.choice}-`)) : undefined;
      answers[key] = offered && answer.type === "choice" ? { ...answer, choice: offered, probabilities: { [offered]: 1 } } : answer;
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });
  // An idle prompt held at the bottom lets the test fire turn.start before it resolves, as the engine does.
  const hold = { on: false, reached: () => {}, release: () => {} };
  on("prompt.submit", async (_$, e) => {
    if (hold.on && !e.turnId) {
      const held = new Promise<void>((resolve) => (hold.release = resolve));
      hold.reached();
      await held;
    }
    return { text: e.text, ...(e.context ? { context: e.context } : {}) };
  });
  on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", async (_$, e) => ({ text: e.answer }));
  const sent: string[] = [];
  on("turn.step", async function* (_$, e) {
    sent.push(e.model);
    return { turnId: e.turnId, index: e.index, answer: "Done.", toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model } };
  });
  /** An idle prompt the engine runs as turn `turnId`. */
  async function enter($: Engine, words: string, turnId: string) {
    hold.on = true;
    const bottom = new Promise<void>((resolve) => (hold.reached = resolve));
    const submitted = $.prompt.submit({ text: words, wait: false, origin: ORIGIN });
    await bottom;
    await $.turn.start({ text: words, turnId });
    hold.release();
    return submitted;
  }
  return { jev, sent, enter };
}

type Submitted = { context?: readonly string[] };
const hinted = (result: unknown) => ((result as Submitted).context ?? []).some((block) => block.includes(HINT));

/** The Models tab's line for the advisor at the latest prompt. */
async function advisorRow($: Engine) {
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-models" });
  const drawn = JSON.stringify(await ui.drawn());
  await ui.unmount();
  return drawn;
}

describe("the advisor question", () => {
  test("is off by default, and only asked when the feature is on", () => {
    expect(DEFAULT_FEATURES.advisor).toBe(false);
    expect(turnQuestions(DEFAULT_FEATURES, [])[ADVISOR_KEY]).toBeUndefined();
    const question = turnQuestions({ ...DEFAULT_FEATURES, advisor: true }, [])[ADVISOR_KEY];
    if (question?.type !== "choice") throw new Error("expected a choice question");
    expect(Object.keys(question.criteria)).toEqual(["none", "consult"]);
  });

  test("with the defaults, no advisor question and no hint", async ($, on) => {
    const { jev } = world(on, {}, { ...TOOL, advisor: pick("consult", 0.99) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const result = await $.prompt.submit({ text: "plan the migration", wait: false, origin: ORIGIN });
    expect(jev.asked).toHaveLength(1);
    expect(jev.asked[0]!.questions.advisor).toBeUndefined();
    expect(hinted(result)).toBe(false);
  });

  test("alone, it turns zero Jev calls into one, and a confident consult attaches the hint", async ($, on) => {
    const { jev } = world(on, { tools: false, advisor: true }, { advisor: pick("consult", 0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const result = await $.prompt.submit({ text: "design the cache layer", wait: false, origin: ORIGIN });
    expect(jev.asked).toHaveLength(1);
    expect(Object.keys(jev.asked[0]!.questions)).toEqual(["advisor"]);
    expect(hinted(result)).toBe(true);
    expect(await advisorRow($)).toContain("hint attached: consult the advisor (0.90); Claude decides whether to call it");
  });

  test("rides in the prompt's one routing call beside the tool and the model", async ($, on) => {
    const { jev, sent, enter } = world(on, { model: true, advisor: true }, { ...TOOL, model: pick("sonnet", 0.95), advisor: pick("consult", 0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const result = await enter($, "fix the flaky race", "t1");
    expect(jev.asked).toHaveLength(1);
    expect(Object.keys(jev.asked[0]!.questions).sort()).toEqual(["advisor", "model", "needs_tool", "tool"]);
    expect(hinted(result)).toBe(true);
    // The model switch goes on as before; the advisor setting is never touched.
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    expect(sent).toEqual(["claude-sonnet-5-5"]);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-flow" });
    expect(await ui.find({ type: "Text", text: /hint attached: tool Read · advisor/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Opus 5\.5 → sent Sonnet 5\.5 → answered Sonnet 5\.5/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /no call observed/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /configured in settings: Opus 5\.5/ })).toBeDefined();
    await ui.unmount();
  });

  test("a malformed tool answer does not void a valid advisor answer", async ($, on) => {
    world(on, { advisor: true }, { tool: pick("Read", 0.9), advisor: pick("consult", 0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const result = await $.prompt.submit({ text: "review the design", wait: false, origin: ORIGIN });
    expect(hinted(result)).toBe(true);
  });
});

describe("no hint", () => {
  const cases: [string, Partial<Features>, Record<string, Answer>, string][] = [
    ["a consult below the minimum confidence is held back", { advisor: true }, { ...TOOL, advisor: pick("consult", 0.5) }, "wanted a consultation at 0.50, needs ≥ 0.70: no hint"],
    ["Jev says no consultation", { advisor: true }, { ...TOOL, advisor: pick("none", 0.95) }, "no extra consultation indicated"],
    ["an answer outside the two options", { advisor: true }, { ...TOOL, advisor: pick("maybe", 0.95) }, "no usable answer: no hint"],
    ["Jev stays out (participation)", { participation: true, advisor: true }, { ...TOOL, participate: noul(0.2), advisor: pick("consult", 0.95) }, "Jev stayed out: no hint"],
    ["participation is on but its answer is missing", { participation: true, advisor: true }, { ...TOOL, advisor: pick("consult", 0.95) }, "no participation answer: no hint"],
  ];
  for (const [name, features, table, row] of cases) {
    test(name, async ($, on) => {
      world(on, features, table);
      await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
      const result = await $.prompt.submit({ text: "do the thing", wait: false, origin: ORIGIN });
      expect(hinted(result)).toBe(false);
      expect(await advisorRow($)).toContain(row);
    });
  }

  test("participation takes part: the advisor answer counts", async ($, on) => {
    world(on, { participation: true, advisor: true }, { ...TOOL, participate: noul(0.9), advisor: pick("consult", 0.95) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect(hinted(await $.prompt.submit({ text: "do the thing", wait: false, origin: ORIGIN }))).toBe(true);
  });

  test("Jev fails", async ($, on) => {
    world(on, { advisor: true }, { advisor: pick("consult", 0.95) }, { status: 401 });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect(hinted(await $.prompt.submit({ text: "do the thing", wait: false, origin: ORIGIN }))).toBe(false);
    expect(await advisorRow($)).toContain(text("ui.models.failed", "en"));
  });

  test("routing off, or no key: Jev is not asked", async ($, on) => {
    const { jev } = world(on, { advisor: true }, { advisor: pick("consult", 0.95) }, { routing: false });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect(hinted(await $.prompt.submit({ text: "do the thing", wait: false, origin: ORIGIN }))).toBe(false);
    expect(jev.asked).toHaveLength(0);
  });

  test("no key: Jev is not asked", async ($, on) => {
    const { jev } = world(on, { advisor: true }, { advisor: pick("consult", 0.95) }, { key: false });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect(hinted(await $.prompt.submit({ text: "do the thing", wait: false, origin: ORIGIN }))).toBe(false);
    expect(jev.asked).toHaveLength(0);
  });

  test("a prompt typed into a running turn is not routed", async ($, on) => {
    const { jev } = world(on, { tools: false, advisor: true }, { advisor: pick("consult", 0.95) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const result = await $.prompt.submit({ text: "and also this", wait: false, origin: ORIGIN, turnId: "t1" } as never);
    expect(jev.asked).toHaveLength(0);
    expect(hinted(result)).toBe(false);
  });
});

describe("the switch", () => {
  test("/jev feature advisor on, and the Features tab names it", async ($, on) => {
    world(on, {}, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const done = await $.command.run({ command: "jev", args: "feature advisor on", ...ASK } as never);
    expect(done.text).toContain("Request advisor consultation");
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-features" });
    expect(await ui.find({ type: "Text", text: "Request advisor consultation" })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "feature-advisor" } as never)).toBeDefined();
    await ui.unmount();
  });
});

describe("the measurement", () => {
  test("the Models tab compares finished runs with and without the hint", async ($, on) => {
    const table: Record<string, Answer> = { ...TOOL, advisor: pick("consult", 0.9) };
    const { enter } = world(on, { advisor: true }, table);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "plan the migration", "t1");
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 10, isAborted: false, reason: "answer" });
    table.advisor = pick("none", 0.9);
    await enter($, "rename a variable", "t2");
    await $.turn.complete({ turnId: "t2", answer: "Done.", durationMs: 10, isAborted: false, reason: "answer" });
    const drawn = await advisorRow($);
    expect(drawn).toContain("Advisor hint, measured");
    expect(drawn).toContain("with hint: 1 run · advisor called in 0% · 0.0 calls per run · 0s on average · 15 tokens on average · 100% completed");
    expect(drawn).toContain("without hint: 1 run · advisor called in 0%");
  });
});
