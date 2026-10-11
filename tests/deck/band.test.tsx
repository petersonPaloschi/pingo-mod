import { expect, test } from "claude-code/testing";

import { ASK, ORIGIN } from "./helpers.ts";

import { DECK_VERSION } from "../../hooks/deck/model.ts";
import { displayWidth } from "../../hooks/layout.ts";
import { DECK_DESIGN } from "../../hooks/theme.ts";
import { routeSvg } from "../../hooks/deck/rows.ts";
import { DESKTOP_STYLES } from "../../hooks/deck/styles-desktop.ts";
import { TERMINAL_STYLES } from "../../hooks/deck/styles-terminal.ts";
import { shot } from "../textshot.ts";

import { DESKTOP, TERMINAL, TODOS, deckWorld, inAnHour, spawn } from "./helpers.ts";

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;

const FOOTER = {
  plugin: "jev",
  component: "SessionMode",
  requestId: "session-mode",
  viewport: { columns: 120, rows: 40 },
  props: { modes: [] },
} as const;

const PICKER = {
  plugin: "jev",
  component: "Pane",
  requestId: "deck-style",
  viewport: { columns: 120, rows: 40 },
  props: { title: "Deck style", isFocused: true, bodyColumns: 100, placement: "inline", scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const;

const PANEL = { ...PICKER, requestId: "deck-panel", props: { ...PICKER.props, title: "Deck" } } as const;

const LOCALE = { options: { locale: "en" } } as const;

/** The session the Deck tests run in: a terminal in /work. */
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;


// the route a router reports through its own status and log lines
const fakeRouter = {
  name: "jev-model-router",
  register(on: any) {
    on("prompt.submit", async ($: any, e: any, next: any) => {
      $.ui.log("[jev-model-router] jev: tier fast (0.87) · effort 0.4 → low (0.71) · risky 0.02 · 249ms");
      $.ui.status("jev · fast 0.87 → low");
      return next(e);
    });
  },
};

// effort routed, model only suggested: the row must not claim a cheaper model
const effortOnlyRouter = {
  name: "jev-model-router",
  register(on: any) {
    on("prompt.submit", async ($: any, e: any, next: any) => {
      $.ui.log("[jev-model-router] jev: tier fast (0.91) · effort 0.2 → low (0.8) · risky 0.01 · 200ms");
      $.ui.status("jev · fast 0.91 → low");
      return next(e);
    });
  },
};

// a router whose backend refuses: the row says so instead of showing the last good route
const brokeRouter = {
  name: "jev-model-router",
  register(on: any) {
    on("prompt.submit", async ($: any, e: any, next: any) => {
      $.ui.log("[jev-model-router] typesafe responded 402");
      $.ui.status("jev · no answer");
      return next(e);
    });
  },
};

test("expanded HUD draws plan, context, limits and the pet on both surfaces", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on, new Map([["deck", { open: true, style: { terminal: "segments", desktop: "pixel" } }]]));
  await $.session.start(SESSION);
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "Refactor the auth module" });
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);

  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /^Refactor the auth/ })).toBeDefined();
  expect(await term.find({ type: "Text", text: /124k \/ 1M/ })).toBeDefined();
  expect(await term.find({ type: "Text", text: /Session · 5h/ })).toBeDefined();
  expect(await term.find({ type: "Text", text: /↻ 1:1\d:\d\d/ })).toBeDefined();
  // the terminal pet is a braille raster in pingo's band, not a picture
  expect(await term.find({ key: "deck-pet" })).toBeDefined();
  await term.unmount();

  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  const lane = await desk.find({ type: "Svg" });
  expect(lane?.props.source).toMatch(/@keyframes mv\d+/);
  expect(await desk.find({ type: "Text", text: /Weekly · 7d/ })).toBeDefined();
  await desk.unmount();
  expect(saved.get("deck")).toBeDefined();
});

test("every CLI and Desktop style draws a valid bar", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  for (const style of TERMINAL_STYLES) {
    await $.command.run({ command: "deck", ...ASK, args: "style " + style });
    await $.command.run({ command: "deck", ...ASK, args: "expand" });
    const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
    expect(await term.find({ type: "Text", text: /Fixing auth/ })).toBeDefined();
    await term.unmount();
  }
  for (const style of DESKTOP_STYLES) {
    await $.command.run({ command: "deck", ...ASK, args: "style " + style });
    await $.command.run({ command: "deck", ...ASK, args: "expand" });
    const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
    expect(await desk.find({ key: "row-bar:todo" })).toBeDefined();
    await desk.unmount();
  }
});

test("the style picker lists every style and a key press picks one per surface", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "style" });
  const term = await $.ui.mount({ ...PICKER, surface: TERMINAL });
  for (const k of TERMINAL_STYLES) expect(await term.find({ key: "style-" + k })).toBeDefined();
  await term.press({ key: "style-dots" });
  await term.unmount();
  const desk = await $.ui.mount({ ...PICKER, surface: DESKTOP });
  expect(await desk.find({ type: "Svg" })).toBeDefined();
  for (const k of DESKTOP_STYLES) expect(await desk.find({ key: "style-" + k })).toBeDefined();
  await desk.press({ key: "style-line" });
  expect((saved.get("deck") as any).style).toEqual({ terminal: "dots", desktop: "line" });
});

test("collapsed line puts the usage limits first", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await ui.find({ type: "Text", text: /^5h 31% ↻/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^Fixing auth 3\/5/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Session · 5h/ })).toBeUndefined();
});

test("the router's status and log become the route row", { ...LOCALE, plugins: [fakeRouter] }, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "rename a variable" });
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/⇄ Model route — opus (=|→) opus · effort low · jev fast 0\.87/);
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /conf 0\.87/ })).toBeDefined();
  await term.unmount();
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  expect(await desk.find({ key: "row-route" })).toBeDefined();
});

test("a suggested model the router did not apply reads as kept, not cheaper", { ...LOCALE, plugins: [effortOnlyRouter] }, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "rename a variable" });
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/opus = opus · effort low · jev fast 0\.91, suggested haiku, not applied \(= kept\)/);
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /jev: haiku · not applied/ })).toBeDefined();
});

test("a router with no answer shows the reason, not a stale route", { ...LOCALE, plugins: [brokeRouter] }, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  for (let i = 0; i < 3; i++) await $.prompt.submit({ wait: false, origin: ORIGIN, text: "hi" });
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/⇄ Model route — no answer \(typesafe 402\), kept opus · check router key or credit/);
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /! typesafe 402/ })).toBeDefined();
});

test("the route SVG leaves room for the localized kept label", () => {
  const row = { route: { noAnswer: true, to: "opus", reason: "router unavailable", hint: "" } } as never;
  const english = routeSvg(row, 320, [], "en");
  const portuguese = routeSvg(row, 320, [], "pt");
  expect(english).toContain('<rect x="34"');
  expect(portuguese).toContain('<rect x="53"');
});

test("a VS Code surface gets the Desktop look", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  const ui = await $.ui.mount({ ...BAND, surface: "vscode" as never });
  const drawn = JSON.stringify(await ui.drawn());
  expect(drawn).toContain('"type":"Svg"');
  expect(drawn).toContain("· 4 rows");
  expect(drawn).not.toContain('"type":"Image"');
});

test("/deck panel draws the expanded Deck in a pane", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "collapse" });
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  const out = await $.command.run({ command: "deck", ...ASK, args: "panel" });
  expect(out.text).toBe("Deck opened in a panel.");
  const pane = await $.ui.mount({ ...PANEL, surface: "vscode" as never });
  const drawn = JSON.stringify(await pane.drawn());
  expect(drawn).toContain('"type":"Svg"');
  // expanded even while the band is collapsed, every row at once
  expect(drawn).toContain("· 4 rows");
  expect(drawn).toContain("Weekly · 7d");
});

test("/deck version names the running version", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  const out = await $.command.run({ command: "deck", ...ASK, args: "version" });
  expect(out.text).toMatch(/^Deck \d+\.\d+\.\d+$/);
  // the Deck version is one constant; the plugin manifest carries the plugin's own version
  expect(out.text).toBe("Deck " + DECK_VERSION);
});

test("the footer HUD button counts bars and toggles the HUD", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  for (const surface of [TERMINAL, DESKTOP]) {
    const ui = await $.ui.mount({ ...FOOTER, surface });
    const button = await ui.find({ key: "deck-footer" });
    expect(button?.props.label).toBe("Deck 1");
    await ui.unmount();
  }
  const ui = await $.ui.mount({ ...FOOTER, surface: TERMINAL });
  await ui.press({ key: "deck-footer" });
  expect((saved.get("deck") as any).open).toBe(true);
});

test("/deck pet off removes the lane", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "pet off" });
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  const first = await desk.find({ type: "Svg" });
  expect(first === undefined || !/@keyframes mv/.test(String(first?.props.source))).toBe(true);
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ key: "deck-pet" })).toBeUndefined();
});

test("a permission prompt held past the delay turns the bar amber and alarms the pet", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.tool.check({ tool: "Bash", input: { command: "rm -rf build" } });
  let out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/^◆ Tasks — Fixing auth 3\/5/m);
  await clock.advance(800);
  out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/^\? Tasks — Fixing auth 3\/5/m);
  expect(out.text).toMatch(/pet alert/);
});

test("subagents become strips with their model, then finish", LOCALE, async ($, on) => {
  deckWorld(on, undefined, {
    spawn: (_$: any, e: any) => ({ model: e.description === "explore routes" ? "claude-haiku-4-5" : "sonnet", agentId: e.description === "explore routes" ? "a1" : "a2" }),
  });
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.agent.spawn(spawn("explore routes"));
  await $.agent.spawn(spawn("write fixtures"));
  await $.tool.call({ tool: "Grep", pattern: "auth", agentId: "a1" } as never);
  await $.tool.call({ tool: "TodoWrite", agentId: "a2", todos: TODOS.slice(0, 4) } as never);
  let out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/Fixing auth 3\/5 · 0\/2 agents/);
  expect(out.text).toMatch(/↳ explore routes: Grep \[running\] \{haiku\}/);
  expect(out.text).toMatch(/↳ write fixtures: Fixing auth 3\/4 \[running\] \{sonnet\}/);
  await $.turn.complete({ turnId: "x", agentId: "a1", answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });
  out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/1\/2 agents/);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  expect(await desk.find({ key: "row-bar:todo" })).toBeDefined();
  await desk.unmount();
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: / haiku / })).toBeDefined();
});

test("agents with no live bar get their own Agents bar", LOCALE, async ($, on) => {
  deckWorld(on, undefined, { spawn: () => ({ model: "claude-test", agentId: "solo" }) });
  await $.session.start(SESSION);
  await $.agent.spawn(spawn("scan the repo"));
  await $.tool.call({ tool: "Read", file_path: "a.ts", agentId: "solo" } as never);
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/^◆ Agents — Agents 0\/1/m);
  expect(out.text).toMatch(/↳ scan the repo: Read \[running\]/);
});

test("an approved plan becomes a bar with stages", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  const plan = "# Checkout rework\n\n## Backend\n1. Add cart table\n2. Write API\n\n## Frontend\n- Cart page\n- Pay button\n";
  await $.tool.call({ tool: "ExitPlanMode", plan } as never);
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/Checkout rework — Backend 1\/2/);
});

test("task tools: ids and statuses come from the results, and a new batch starts a fresh bar", LOCALE, async ($, on) => {
  let next = 1;
  deckWorld(on, undefined, {
    toolCall: (_$: any, e: any) => {
      if (e.tool === "TaskCreate") return { result: { task: { id: String(next++), subject: e.subject } } };
      if (e.tool === "TaskUpdate") return { result: { success: true, taskId: e.taskId, updatedFields: ["status"] } };
      return { result: "ok" };
    },
  });
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TaskCreate", subject: "Old one", description: "" } as never);
  await $.tool.call({ tool: "TaskUpdate", taskId: "1", status: "completed" } as never);
  for (const subject of ["Core", "JSON", "CLI", "Tests", "Run tests", "README"]) {
    await $.tool.call({ tool: "TaskCreate", subject, description: "", activeForm: subject + "ing" } as never);
  }
  for (const id of ["2", "3", "4", "5"]) await $.tool.call({ tool: "TaskUpdate", taskId: id, status: "completed" } as never);
  await $.tool.call({ tool: "TaskUpdate", taskId: "6", status: "in_progress" } as never);
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/— Run testsing 5\/6 \(73%\)/);
});

test("/deck demo runs a sample plan to the end and the pet celebrates", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "demo" });
  let out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/Orders module — Analysis 3\/3 · 0\/2 agents/);
  await clock.advance(1400 * 30);
  out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/Orders module — Done 12\/12/);
});

test("a turn without a todo list gets an activity bar that follows the tools", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "Fix the login bug" });
  await $.turn.start({ text: "Fix the login bug", turnId: "t1" });
  await $.tool.call({ tool: "Read", file_path: "/src/auth.ts" } as never);
  await $.tool.call({ tool: "Edit", file_path: "/src/auth.ts", old_string: "a", new_string: "b" } as never);
  let out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/◆ Fix the login bug — Editing auth\.ts 2 tools/);
  await $.turn.complete({ turnId: "t1", answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });
  out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/✓ Fix the login bug — Done 2 tools/);
  // a todo list in the next turn replaces it
  await $.turn.start({ text: "Next", turnId: "t2" });
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).not.toMatch(/Planning/);
  expect(out.text).toMatch(/Fixing auth 3\/5/);
});

test("a plain chat turn shows while it thinks and goes away once answered", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "what does this do" });
  await $.turn.start({ text: "what does this do", turnId: "t1" });
  let out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/what does this do — Thinking/);
  await $.turn.complete({ turnId: "t1", answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });
  out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).not.toMatch(/what does this do/);
});

test("a long prompt as a bar title is cut short on Desktop", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  const long = "already updated, here is the screenshot of the whole thing";
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: long });
  await $.turn.start({ text: long, turnId: "t1" });
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  expect(await desk.find({ type: "Text", text: /^already updated, here…$/ })).toBeDefined();
  expect((await desk.find({ type: "Text", text: long }))?.props.wrap).toBe("truncate-end");
});

test("agents started without a todo list show as strips under the activity bar, with their model", LOCALE, async ($, on) => {
  deckWorld(on, undefined, {
    spawn: (_$: any, e: any) => ({
      model: e.description === "Map the orders tables" ? "claude-haiku-4-5" : "sonnet",
      agentId: e.description === "Map the orders tables" ? "a1" : "a2",
    }),
  });
  await $.session.start(SESSION);
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "Migrate the orders module" });
  await $.turn.start({ text: "Migrate the orders module", turnId: "t1" });
  await $.agent.spawn(spawn("Map the orders tables"));
  await $.agent.spawn(spawn("Draft the migration"));
  await $.tool.call({ tool: "Grep", pattern: "orders", agentId: "a1" } as never);
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/Migrate the orders module — .* · 0\/2 agents/);
  expect(out.text).toMatch(/↳ Map the orders tables: Grep \[running\] \{haiku\}/);
  expect(out.text).toMatch(/↳ Draft the migration: Starting \[running\] \{sonnet\}/);
  expect(out.text).not.toMatch(/^◆ Agents/m);
});

test("a usage update with one window keeps the other", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.session.measure({ context: { tokens: 1, window: 10, percent: 10 }, rateLimits: [{ kind: "seven_day", percentUsed: 50, resetsAt: inAnHour() }], changed: ["rateLimits"] } as never);
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/Session · 5h/);
  expect(out.text).toMatch(/7d · 50% used/);
});

test("bar titles use the typed words, not system reminders around them", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "<system-reminder>The user started this session without a folder.</system-reminder>\nUse 2 subagents to list files" });
  await $.turn.start({ text: "x", turnId: "t1" });
  await $.tool.call({ tool: "Read", file_path: "/a.ts" } as never);
  const out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/◆ Use 2 subagents to list files — /);
});

test("/deck collapsed text draws one plain status line with limits first", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.command.run({ command: "deck", ...ASK, args: "collapsed text" });
  expect((saved.get("deck") as any).collapsed).toBe("text");
  for (const surface of [TERMINAL, DESKTOP]) {
    const ui = await $.ui.mount({ ...BAND, surface });
    expect(await ui.find({ type: "Text", text: /^5h 31% ↻/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^Fixing auth 3\/5/ })).toBeDefined();
    await ui.unmount();
  }
});

test("the clock carries a ◷ on Desktop and none in the terminal", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  await clock.advance(1000);
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  expect(await desk.find({ type: "Text", text: /^◷ \d\d:\d\d:\d\d$/ })).toBeDefined();
  await desk.unmount();
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /^\d\d:\d\d:\d\d$/ })).toBeDefined();
  expect(await term.find({ type: "Text", text: /◷/ })).toBeUndefined();
});

test("expanding unfolds the rows one after another, and the toggle folds them away", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  let ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await ui.find({ type: "Text", text: /Weekly · 7d/ })).toBeUndefined();
  await ui.unmount();
  await clock.advance(1000);
  ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await ui.find({ type: "Text", text: /Weekly · 7d/ })).toBeDefined();
  await ui.press({ key: "deck-toggle" });
  await ui.unmount();
  await clock.advance(1000);
  ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await ui.find({ type: "Text", text: /Session · 5h/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /^5h 31% ↻/ })).toBeDefined();
});

test("desktop rows fade in while they unfold", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  await clock.advance(40);
  const ui = await $.ui.mount({ ...BAND, surface: DESKTOP });
  const row = await ui.find({ key: "row-bar:todo" });
  expect(JSON.stringify(row)).toMatch(/@keyframes rin/);
});

test("rings: a ring per limit with its reset, and spend when cost is on", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "pet off" });
  await $.command.run({ command: "deck", ...ASK, args: "cost on" });
  await $.command.run({ command: "deck", ...ASK, args: "collapsed rings" });
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: "31%" })).toBeDefined();
  expect(await term.find({ type: "Text", text: /^5h · resets 1h1\dm$/ })).toBeDefined();
  expect(await term.find({ type: "Text", text: "$0.42" })).toBeDefined();
  await term.unmount();
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  const ring = await desk.find({ type: "Svg" });
  expect(ring?.props.alt).toBe("5h 31% used");
  expect(ring?.props.source).toMatch(/stroke-dasharray/);
  expect((saved.get("deckSpend") as any).spend.dayUsd).toBe(0.42);
});

test("spark: limit rows carry their history and a burn rate", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "style spark" });
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  await clock.advance(1000);
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /5h · 31% used/ })).toBeDefined();
  await term.unmount();
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  expect(await desk.find({ key: "row-limit:five_hour" })).toBeDefined();
});

test("/deck demo fills in a sample route and limits in a fresh session, and real readings replace them", LOCALE, async ($, on) => {
  deckWorld(on, undefined, { usage: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } });
  await $.session.start(SESSION);
  const r = await $.command.run({ command: "deck", ...ASK, args: "demo" });
  expect(r.text).toMatch(/sample routing and limits/);
  let out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).toMatch(/⇄ Model route — /);
  expect(out.text).toMatch(/Session · 5h — 5h · 31% used/);
  expect(out.text).toMatch(/Weekly · 7d — 7d · 64% used/);
  await $.session.measure({ context: { tokens: 1, window: 10, percent: 10 }, rateLimits: [{ kind: "seven_day", percentUsed: 50, resetsAt: inAnHour() }], changed: ["rateLimits"] } as never);
  out = await $.command.run({ command: "deck", ...ASK, args: "status" });
  expect(out.text).not.toMatch(/Session · 5h/);
  expect(out.text).toMatch(/7d · 50% used/);
});

test("at 40 columns the Deck pane draws every feature switch whole, on lines of their own, within its row budget", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  // more agents than the pane has lines for, so the rows fill whatever the switches leave
  for (const name of ["Explore auth", "Map routes", "Check tests", "Read docs", "Scan logs"]) await $.agent.spawn(spawn(name) as never).catch(() => undefined);
  await $.command.run({ command: "jev", ...ASK, args: "feature lapida off" });
  const pane = await $.ui.mount({ ...PANEL, surface: TERMINAL, props: { ...PANEL.props, bodyColumns: 40 } });
  const lines = shot(await pane.drawn(), 40, { rasters: "mask" }).split("\n");
  // the pane's budget, the pet's lane, header and switches included, and the rows take all that is left
  expect(lines.length).toBe(DECK_DESIGN.band.defaultMaxRows);
  for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(40);
  const title = lines.findIndex((line) => line.trim().startsWith("Features"));
  expect(lines[title]).toContain("▣ On  □ Off");
  // the switch lines sit under the title, only switches on them, each glyph and name whole
  const switchLines = lines.slice(title + 1).filter((line) => /^ {2}[▣□] /.test(line));
  const drawn = switchLines.join("  ");
  // Agents is off by default, Lapida was just turned off
  for (const label of ["□ Agents", "▣ Farol", "▣ Clareza", "▣ Pingo Vivo", "▣ Prisma", "▣ Semente", "□ Lapida", "▣ Sentinela", "▣ Vigia", "▣ Context"]) expect(drawn).toContain(label);
  for (const line of switchLines) expect(line.trim().split(/ {2}/).every((part) => /^[▣□] \S/.test(part))).toBe(true);
  await pane.unmount();
});

test("a band too short for its rows and the switches leaves the switches to the Deck pane", LOCALE, async ($, on) => {
  deckWorld(on, new Map([["deck", { open: true }]]));
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  const roomy = await $.ui.mount({ ...BAND, surface: TERMINAL, props: { ...BAND.props, bodyColumns: 40 } });
  expect(await roomy.find({ key: "deck-feature-clareza" })).toBeDefined();
  await roomy.unmount();
  // 9 lines: the pet's 4, the header, and 4 left, too few for the title, the switch lines and two rows
  const short = await $.ui.mount({ ...BAND, surface: TERMINAL, props: { ...BAND.props, bodyColumns: 40, maxRows: 9 } });
  expect(await short.find({ key: "deck-feature-clareza" })).toBeUndefined();
  // the rows keep the room: the context row's title is still drawn
  expect(await short.find({ type: "Text", text: /^Context$/ })).toBeDefined();
  await short.unmount();
  const pane = await $.ui.mount({ ...PANEL, surface: TERMINAL });
  expect(await pane.find({ key: "deck-feature-clareza" })).toBeDefined();
  await pane.unmount();
});
