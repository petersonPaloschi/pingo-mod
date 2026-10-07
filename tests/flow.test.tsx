// The Flow tab: the wave diagram, its steps, and the pane drawing it.
import type { RenderPropsOf } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import type { AgentRun, FlowState } from "../types";
import { flowLines, flowStep, prettyModel } from "../hooks/flow.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const FLOW: FlowState = { turn: 1, wave: [], waveTurn: 0, confirmed: false, edits: 0, files: [], working: false };
const run = (n: number, state: AgentRun["state"], extra: Partial<AgentRun> = {}): AgentRun => ({
  id: `a${n}`,
  n,
  mascot: "tetra",
  type: "Explore",
  description: `group ${n}`,
  prompt: "check it",
  model: "claude-sonnet-5-5",
  effort: "medium",
  startedAt: NOW - 30e3,
  ...(state === "running" ? {} : { endedAt: NOW - 5e3 }),
  state,
  tools: 2,
  requests: 1,
  tokensIn: 0,
  tokensOut: 0,
  ...extra,
});
const text = (lines: ReturnType<typeof flowLines>) => lines.map((parts) => parts.map((part) => part.text).join("")).join("\n");

test("before any wave the tab draws the pre-ship check sample", () => {
  const drawn = text(flowLines({ flow: FLOW, agents: [], model: "claude-opus-5-5", effort: "medium", cwd: "/home/me/vibe-site", now: NOW, width: 72 }));
  expect(drawn).toContain("PRE-SHIP CHECK · OPUS 5.5 + 5 SUBAGENTS");
  expect(drawn).toContain("Opus 5.5 · medium");
  for (const label of ["design", "mobile", "states", "real user", "launch", "you confirm", "back to main session"]) expect(drawn).toContain(label);
  expect(drawn).toContain("Check with five.  Confirm.  Fix with one.");
  expect(drawn).toContain("~/vibe-site $ ▌");
  expect(drawn).toContain("step [plan]  agents [0/5]  edits [0]");
  // Every line fits the pane.
  for (const line of drawn.split("\n")) expect([...line].length).toBeLessThanOrEqual(72);
});

test("a live wave shows each subagent, the step and the counts", () => {
  const agents = [run(1, "done"), run(2, "running", { effort: "high", jev: "effort high" }), run(3, "done")];
  const flow = { ...FLOW, wave: [1, 2, 3], waveTurn: 1, text: "check the site before launch" };
  const drawn = text(flowLines({ flow, agents, model: "claude-opus-5-5", effort: "high", now: NOW, width: 60 }));
  expect(drawn).toContain("FLOW · OPUS 5.5 + 3 SUBAGENTS");
  expect(drawn).toContain("group 2");
  expect(drawn).toContain("● 30s");
  expect(drawn).toContain("✓ 25s");
  expect(drawn).toContain("“check the site before launch”");
  expect(drawn).toContain("step [check]  agents [2/3]  edits [0]");
  for (const line of drawn.split("\n")) expect([...line].length).toBeLessThanOrEqual(60);
});

test("Flow includes a running subagent outside the latest completed wave", () => {
  const agents = [run(1, "done"), run(2, "running")];
  const flow = { ...FLOW, wave: [1], waveTurn: 1 };
  const drawn = text(flowLines({ flow, agents, now: NOW, width: 72 }));
  expect(drawn).toContain("group 2");
  expect(drawn).toContain("step [check]");
  expect(drawn).toContain("agents [1/2]");
});

test("the step follows the wave: check, review, fix, done", () => {
  const wave = [run(1, "done"), run(2, "done")];
  const flow = { ...FLOW, wave: [1, 2] };
  expect(flowStep(FLOW, [])).toBe("plan");
  expect(flowStep(flow, [run(1, "running"), run(2, "done")])).toBe("check");
  expect(flowStep(flow, wave)).toBe("review");
  expect(flowStep({ ...flow, confirmed: true, working: true }, wave)).toBe("fix");
  expect(flowStep({ ...flow, confirmed: true, edits: 3 }, wave)).toBe("done");
  expect(prettyModel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  expect(prettyModel("claude-opus-5-5")).toBe("Opus 5.5");
});

test("more subagents than fit are counted, not squeezed", () => {
  const agents = Array.from({ length: 8 }, (_, i) => run(i + 1, "running"));
  const drawn = text(flowLines({ flow: { ...FLOW, wave: agents.map((one) => one.n) }, agents, now: NOW, width: 45 }));
  expect(drawn).toMatch(/\+\d more on the Agents tab/);
  for (const line of drawn.split("\n")) expect([...line].length).toBeLessThanOrEqual(45);
});

const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 80,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 60 },
} as unknown as RenderPropsOf["Pane"];

test("the Flow tab draws on the terminal and the desktop app", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-flow" });
    expect(await ui.find({ type: "Text", text: /Fix with one/ })).toBeDefined();
    await ui.unmount();
  }
});

test("/jev flow opens the pane on the Flow tab", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  const opened: string[] = [];
  on("ui.open", async (_$, e) => {
    opened.push(e.id);
    return { value: {} } as never;
  });
  await $.command.run({ command: "jev", args: "flow", origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as never);
  expect(opened).toContain("jev");
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  expect(await ui.find({ type: "Text", text: /step \[plan\]/ })).toBeDefined();
  await ui.unmount();
});
