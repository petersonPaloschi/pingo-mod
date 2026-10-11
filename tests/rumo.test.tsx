// Rumo: a request that says when the work is done ("até os testes passarem") makes Jev propose a goal; once the person
// sends it, Claude gets one more turn at a time until Jev judges it met, impossible or out of turns. Jev speaks for it,
// the Comandante judges the goal first, an open Portão hold pauses it, and its own prompts never start a new one.
import { expect, test, type TestBody } from "claude-code/testing";
import { DEFAULT_FEATURES } from "../hooks/core/contracts.ts";
import { goalCondition, RUMO_MARK, rumoProposal, rumoStatus } from "../hooks/core/rumo.ts";
import type { Answer } from "../hooks/core/types.ts";
import { ASK, deckWorld, TERMINAL } from "./deck/helpers.ts";
import { comandanteJev, PANE_PROPS, pick } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const REQUEST = "Corrija o cast até todos os testes do deck passarem.";
const done = (turnId: string, answer: string, isAborted = false) =>
  ({ turnId, answer, durationMs: 10, isAborted, reason: isAborted ? "aborted" : "answer" }) as never;
const wait = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
async function settle(isDone: () => boolean) {
  for (let i = 0; i < 80 && !isDone(); i++) await wait();
}

const store = (features: Record<string, boolean> = {}) => new Map<string, unknown>([
  ["features", { ...DEFAULT_FEATURES, codeQuality: false, rumo: true, ...features }],
  ["credentials", { apiKey: "test-key", provider: "typesafe" }],
]);

/** A world where Jev answers from `table` (a test may change it) and every prompt that reaches the engine is kept with its origin. */
function rumoWorld(on: Parameters<typeof deckWorld>[0], table: Record<string, Answer>, saved = store()) {
  const submitted: { text: string; origin?: string }[] = [];
  const jev = comandanteJev(on, table);
  const world = deckWorld(on, saved, {
    promptSubmit: async (_$: unknown, e: { text: string; origin?: { kind?: string } }) => {
      submitted.push({ text: e.text, ...(e.origin?.kind ? { origin: e.origin.kind } : {}) });
      return { text: e.text };
    },
  });
  const asked = (name: string) => jev.asked.filter((request) => request.questions?.[name]).length;
  const rumoSent = () => submitted.filter((one) => one.text.startsWith(RUMO_MARK));
  return { ...world, jev, submitted, asked, rumoSent };
}

async function autonomos($: Parameters<TestBody>[0]) {
  await $.command.run({ command: "jev", ...ASK, args: "autonomos" });
  return $.ui.mount({ plugin: "jev", component: "Pane", requestId: "jev", surface: TERMINAL, props: PANE_PROPS });
}

const person = ($: Parameters<TestBody>[0], text: string) => $.prompt.submit({ text, wait: false, origin: { kind: "composer" } } as never);

test("the condition is the clause after the cue; Jev's answers are read with their confidence", () => {
  expect(goalCondition(REQUEST)).toBe("todos os testes do deck passarem");
  expect(goalCondition("fix the parser until the build is green, then stop")).toBe("the build is green");
  expect(goalCondition("Explique o cast")).toBeUndefined();
  expect(goalCondition("até já")).toBeUndefined();
  expect(rumoProposal({ goal: pick("checkable", 0.9), turns: pick("3", 0.9) }, 0.7)).toEqual({ turns: 3 });
  expect(rumoProposal({ goal: pick("checkable", 0.9) }, 0.7)).toEqual({ turns: 8 });
  expect(rumoProposal({ goal: pick("vague", 0.9) }, 0.7)).toBeUndefined();
  expect(rumoProposal({ goal: pick("checkable", 0.5) }, 0.7)).toBeUndefined();
  expect(rumoStatus({ status: pick("met", 0.9) }, 0.7)).toBe("met");
  expect(rumoStatus({ status: pick("met", 0.4) }, 0.7)).toBeUndefined();
});

test("off by default, a request with a condition asks Jev nothing", async ($, on) => {
  const world = rumoWorld(on, { goal: pick("checkable", 0.95) }, new Map<string, unknown>([["credentials", { apiKey: "test-key", provider: "typesafe" }]]));
  await $.session.start(SESSION);
  await person($, REQUEST);
  await settle(() => false);
  expect(world.asked("goal")).toBe(0);
});

test("a proposed goal waits for Enviar; then Claude gets one more turn at a time until Jev judges it met", async ($, on) => {
  const table: Record<string, Answer> = { goal: pick("checkable", 0.95), turns: pick("3", 0.95), status: pick("not_met", 0.95) };
  const world = rumoWorld(on, table);
  await $.session.start(SESSION);
  await person($, REQUEST);
  await settle(() => world.asked("goal") > 0);
  await $.turn.complete(done("t1", "I fixed two tests; one still fails."));
  // nothing goes to Claude before the person sends the goal
  expect(world.rumoSent()).toHaveLength(0);
  const ui = await autonomos($);
  await settle(() => false);
  expect(await ui.find({ type: "Text", text: "todos os testes do deck passarem" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^waiting for you$/ })).toBeDefined();
  const id = (await ui.findAll({ type: "Button" })).map((one: { props: { label?: string }; key?: string }) => String(one.key ?? "")).find((key) => key.startsWith("rumo-") && key.endsWith("-send"))!;
  await ui.press({ key: id });
  await settle(() => world.rumoSent().length > 0);
  // the turn had ended: Jev reads the last answer at once, and Claude gets its first extra turn, as Pingo's
  expect(world.rumoSent()).toHaveLength(1);
  expect(world.rumoSent()[0]!.text).toContain("todos os testes do deck passarem");
  expect(world.rumoSent()[0]!.origin).toBe("plugin");
  // Rumo's own prompt starts no goal of its own
  expect(world.asked("goal")).toBe(1);
  table.status = pick("met", 0.95);
  await $.turn.complete(done("t2", "All deck tests pass now."));
  await settle(() => world.asked("status") >= 2);
  await settle(() => false);
  expect(world.rumoSent()).toHaveLength(1);
  expect(await ui.find({ type: "Text", text: /^met$/ })).toBeDefined();
  await ui.unmount();
});

test("out of turns, the goal stops; an interrupted turn stops it too", async ($, on) => {
  const table: Record<string, Answer> = { goal: pick("checkable", 0.95), turns: pick("3", 0.95), status: pick("not_met", 0.95) };
  const world = rumoWorld(on, table);
  await $.session.start(SESSION);
  await person($, REQUEST);
  await settle(() => world.asked("goal") > 0);
  const ui = await autonomos($);
  const send = (await ui.findAll({ type: "Button" })).map((one: { key?: string }) => String(one.key ?? "")).find((key) => key.startsWith("rumo-") && key.endsWith("-send"))!;
  await ui.press({ key: send });
  await settle(() => world.rumoSent().length === 1);
  for (const turn of ["t2", "t3"]) {
    const before = world.rumoSent().length;
    await $.turn.complete(done(turn, "Still failing."));
    await settle(() => world.rumoSent().length > before);
  }
  expect(world.rumoSent()).toHaveLength(3);
  await $.turn.complete(done("t4", "Still failing."));
  await settle(() => world.asked("status") >= 4);
  await settle(() => false);
  expect(world.rumoSent()).toHaveLength(3);
  expect(await ui.find({ type: "Text", text: /^out of turns$/ })).toBeDefined();
  await ui.unmount();
});

test("the Comandante rejecting a goal blocks it: no Enviar, nothing goes to Claude", async ($, on) => {
  const world = rumoWorld(on, { goal: pick("checkable", 0.95), turns: pick("8", 0.95), verdict: pick("reject_risky", 0.9) }, store({ comandante: true }));
  await $.session.start(SESSION);
  await person($, REQUEST);
  await settle(() => world.jev.asked.some((request) => request.questions?.verdict));
  await settle(() => false);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /^blocked by the Comandante$/ })).toBeDefined();
  const keys = (await ui.findAll({ type: "Button" })).map((one: { key?: string }) => String(one.key ?? ""));
  expect(keys.some((key) => key.startsWith("rumo-") && key.endsWith("-send"))).toBe(false);
  expect(world.rumoSent()).toHaveLength(0);
  await ui.unmount();
});

test("a goal at work waits while Portão holds Claude's commit for the person", async ($, on) => {
  const table: Record<string, Answer> = {
    goal: pick("checkable", 0.95), turns: pick("8", 0.95), status: pick("not_met", 0.95),
    hold: pick("hold", 0.95), security: pick("skip", 0.95),
  };
  const world = rumoWorld(on, table, store({ portao: true }));
  on("process.run", async (_$, e) => ({ value: { exitCode: 0, stdout: e.argv[1] === "status" ? " M hooks/a.ts\n" : "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } }));
  await $.session.start(SESSION);
  await person($, REQUEST);
  await settle(() => world.asked("goal") > 0);
  const ui = await autonomos($);
  const send = (await ui.findAll({ type: "Button" })).map((one: { key?: string }) => String(one.key ?? "")).find((key) => key.startsWith("rumo-") && key.endsWith("-send"))!;
  await ui.press({ key: send });
  await settle(() => world.rumoSent().length === 1);
  // Claude tries to commit: Portão holds it, and the run waits for the person
  await $.tool.call({ tool: "Bash", command: "git commit -m x", tool_use_id: "toolu-c1" } as never);
  await settle(() => false);
  await $.turn.complete(done("t2", "Portão is checking the commit."));
  await settle(() => false);
  expect(world.rumoSent()).toHaveLength(1);
  expect(await ui.find({ type: "Text", text: /Portão holds Claude's commit/ })).toBeDefined();
  await ui.unmount();
});

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 80, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 78, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;

test("above the prompt Jev speaks for Rumo: the goal waiting, then at work with its turns; pressed, it opens the tab", { options: { locale: "en" } }, async ($, on) => {
  const table: Record<string, Answer> = { goal: pick("checkable", 0.95), turns: pick("8", 0.95), status: pick("not_met", 0.95) };
  const world = rumoWorld(on, table);
  await $.session.start(SESSION);
  await person($, REQUEST);
  await settle(() => world.asked("goal") > 0);
  let band = await $.ui.mount({ ...BAND, surface: TERMINAL });
  const line = await band.find({ type: "Button", key: "rumo-open" } as never);
  expect(String(line?.props.label)).toContain("Jev · Rumo: keep going until todos os testes do deck passarem?");
  await band.press({ key: "rumo-open" });
  expect(world.panes).toContain("jev");
  await band.unmount();
  const ui = await autonomos($);
  const send = (await ui.findAll({ type: "Button" })).map((one: { key?: string }) => String(one.key ?? "")).find((key) => key.startsWith("rumo-") && key.endsWith("-send"))!;
  await ui.press({ key: send });
  await settle(() => world.rumoSent().length === 1);
  await ui.unmount();
  band = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(String((await band.find({ type: "Button", key: "rumo-open" } as never))?.props.label)).toContain("turn 1/8");
  await band.unmount();
});

test("the Comandante approving a goal starts it at once, with no Enviar; once it ends, Limpar feitos removes it", async ($, on) => {
  const table: Record<string, Answer> = { goal: pick("checkable", 0.95), turns: pick("8", 0.95), status: pick("not_met", 0.95), verdict: pick("approve_fits", 0.9) };
  const world = rumoWorld(on, table, store({ comandante: true }));
  await $.session.start(SESSION);
  await person($, REQUEST);
  await settle(() => world.rumoSent().length === 1);
  expect(world.rumoSent()).toHaveLength(1);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /Comandante approved it and started the goal/ })).toBeDefined();
  const keys = (await ui.findAll({ type: "Button" })).map((one: { key?: string }) => String(one.key ?? ""));
  expect(keys.some((key) => key.startsWith("rumo-") && key.endsWith("-send"))).toBe(false);
  // still at work: nothing to clear yet
  expect(keys).not.toContain("rumo-clear");
  // the tab's buttons run apart: each press is back before its change is made
  await ui.press({ key: keys.find((key) => key.startsWith("rumo-") && key.endsWith("-stop"))! });
  await settle(() => false);
  await ui.unmount();
  const stopped = await autonomos($);
  await stopped.press({ key: "rumo-clear" });
  await settle(() => false);
  await stopped.unmount();
  const cleared = await autonomos($);
  expect(await cleared.find({ type: "Text", text: /Comandante approved it and started the goal/ })).toBeUndefined();
  expect(await cleared.find({ type: "Text", text: /No goal yet/ })).toBeDefined();
  await cleared.unmount();
});
