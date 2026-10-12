// Pingo's balloon holds the session's goal: each request the person sends goes to Resumo, an agent of Pingo's own,
// whose one-sentence summary Pingo says from then on, between turns too, until a request sets another goal. Claude's
// own steps and the clock never change it; a failed, refused, empty or late summary leaves the last goal standing.
import type { On } from "claude-code";
import { expect, test, type Engine } from "claude-code/testing";

import { DEFAULT_FEATURES } from "../../hooks/core/plan.ts";
import { RESUMO_TIMEOUT_MS } from "../../hooks/core/resumo.ts";
import { petLaneColumns } from "../../hooks/deck/pet.ts";
import { ORIGIN, TERMINAL, deckWorld } from "./helpers.ts";

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const LOCALE = { options: { locale: "en" } } as const;
const COLUMNS = petLaneColumns(110);
const PINGO_ONLY = { ...DEFAULT_FEATURES, farol: false, clareza: false, prisma: false, semente: false, lapida: false, sentinela: false, vigia: false, contexto: false, codeQuality: false };
const TYPE = "jev:resumo";
const GOAL = "Fix the loader retries";

/** The name row of a lane's cells: each cell's character and its color. */
function nameRow(cells: unknown): { text: string; colors: number[] } {
  const bytes = Uint8Array.from(atob(String(cells)), (char) => char.charCodeAt(0));
  const numbers = new Uint32Array(bytes.buffer);
  let text = "";
  const colors: number[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    text += String.fromCodePoint(numbers[i * 3]!);
    colors.push(numbers[i * 3 + 1]!);
  }
  return { text, colors };
}

/**
 * One look at a fresh terminal band, unmounted after: its lane's name row, whether Pingo's name sits in a balloon, and
 * what Pingo's line under the lane says. Drawing the band is also what lets the next request be summed up.
 */
async function look($: Engine) {
  const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  const row = nameRow((await ui.find({ type: "Raster", key: "deck-pet" } as never))?.props.cells);
  const line = (await ui.find({ type: "Button", key: "deck-speech-pingo" } as never))?.props.label as string | undefined;
  const lineName = await ui.find({ type: "Text", text: /Pingo:$/ });
  await ui.unmount();
  return { row: row.text, inBalloon: row.text.includes("(Pingo"), line, lineColor: lineName?.props.color };
}

declare const setTimeout: (callback: () => void, ms: number) => unknown;

async function settle(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
}

/** A Deck world with Pingo alone, Resumo's type registered, and its spawns recorded; `refuse` makes the next ones fail. */
function goalWorld(on: On) {
  const spawns: { type?: string; prompt: string }[] = [];
  const control = { refuse: false };
  const world = deckWorld(on, new Map([["features", PINGO_ONLY]]), {
    // the kit hands a plugin's spawn over in the Agent tool's own spelling (subagent_type)
    spawn: async (_$: unknown, e: { subagentType?: string; subagent_type?: string; prompt: string }) => {
      spawns.push({ type: e.subagentType ?? e.subagent_type, prompt: e.prompt });
      return control.refuse ? { deny: "no agents now" } : { model: "claude-sonnet-5-5", agentId: `g${spawns.length}` };
    },
  });
  on("agent.register", async (_$, e) => ({ value: { agent: `jev:${e.name}` } }) as never);
  return { ...world, spawns, control };
}

type GoalWorld = ReturnType<typeof goalWorld>;

/** The person sends `text` with the band on screen; answers once the summary it starts is spawned (or refused). */
async function ask($: Engine, world: GoalWorld, text: string) {
  const before = world.spawns.length;
  await look($);
  await $.prompt.submit({ wait: false, origin: ORIGIN, text });
  await settle(() => world.spawns.length > before);
  expect(world.spawns).toHaveLength(before + 1);
  const id = `g${world.spawns.length}`;
  world.state.agents = [{ id, type: TYPE, status: "running" } as never];
  return { id, prompt: world.spawns.at(-1)!.prompt };
}

/** Resumo's turn ending with `answer`, as its agent `id`. */
const ended = ($: Engine, id: string, answer: string, reason = "answer") =>
  $.turn.complete({ turnId: `resumo-${id}`, agentId: id, answer, durationMs: 10, isAborted: false, reason } as never);

test("the person's request sets Pingo's goal: its balloon says it between turns, its line while Claude works, never Claude's steps", LOCALE, async ($, on) => {
  const world = goalWorld(on);
  await $.session.start(SESSION);
  const asked = "The loader gives up after three tries; make it retry with backoff until it connects";
  const first = await ask($, world, asked);
  expect(world.spawns[0]!.type).toBe(TYPE);
  expect(first.prompt).toContain(`<new_request>${asked}</new_request>`);
  expect(first.prompt).toContain("There is no goal yet");
  await ended($, first.id, `The person wants the loader to keep trying.\nGOAL: ${GOAL}`);

  // between turns, Pingo says the goal in its balloon; its line comes only with Claude's turn
  let seen = await look($);
  expect(seen.row).toContain(`Pingo: ${GOAL}`);
  expect(seen.inBalloon).toBe(true);
  expect(seen.line).toBeUndefined();

  // while Claude works, the balloon and the line say the goal, not what Claude is doing
  await $.turn.start({ turnId: "t1", text: asked } as never);
  await $.tool.call({ tool: "Read", file_path: "/work/hooks/register.tsx" } as never);
  seen = await look($);
  expect(seen.row).toContain(`Pingo: ${GOAL}`);
  expect(seen.row).not.toContain("Reading");
  expect(seen.line).toContain(GOAL);
  expect(seen.line).not.toContain("Reading");
  // Pingo's name on its line takes the theme's text color, never black
  expect(seen.lineColor).toBe("text");

  // the turn ends: the line goes, the goal stays in the balloon
  await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);
  seen = await look($);
  expect(seen.row).toContain(`Pingo: ${GOAL}`);
  expect(seen.inBalloon).toBe(true);
  expect(seen.line).toBeUndefined();
});

test("the goal changes only with a new request: Claude's steps, the clock and a plugin's prompt leave it, a request that keeps it too", LOCALE, async ($, on) => {
  const world = goalWorld(on);
  await $.session.start(SESSION);
  const first = await ask($, world, "Make the loader retry until it connects");
  await ended($, first.id, `GOAL: ${GOAL}`);

  // Claude works for a while: no new summary, the same goal
  await $.turn.start({ turnId: "t1", text: "Make the loader retry until it connects" } as never);
  for (const file of ["loader.ts", "retry.ts", "loader.test.ts"]) {
    await $.tool.call({ tool: "Read", file_path: `/work/hooks/${file}` } as never);
    await world.clock.advance(5_000);
  }
  await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);
  await world.clock.advance(20_000);
  expect(world.spawns).toHaveLength(1);
  expect((await look($)).row).toContain(`Pingo: ${GOAL}`);

  // a prompt a plugin sends is not the person's request
  await $.prompt.submit({ wait: false, origin: { kind: "plugin" }, text: "[Clareza] Rewrite your last answer" } as never);
  await settle(() => world.spawns.length > 1);
  expect(world.spawns).toHaveLength(1);

  // a request that goes on with the same work: Resumo is told the current goal, answers "same", and the goal stays
  const followUp = await ask($, world, "also add a test for it");
  expect(followUp.prompt).toContain(`<current_goal>${GOAL}</current_goal>`);
  await ended($, followUp.id, "GOAL: same");
  expect((await look($)).row).toContain(`Pingo: ${GOAL}`);

  // a request with another aim: the new goal takes the balloon
  const other = await ask($, world, "Now rename the settings screen to Preferences");
  await ended($, other.id, "GOAL: Rename the settings screen");
  const seen = await look($);
  expect(seen.row).toContain("Pingo: Rename the settings screen");
  expect(seen.row).not.toContain(GOAL);
});

test("a summary that fails, is refused, writes no goal or never comes back leaves the last goal; with none yet, Pingo's balloon holds its name alone", { ...LOCALE, timeoutMs: 30_000 }, async ($, on) => {
  const world = goalWorld(on);
  await $.session.start(SESSION);

  // no goal yet: Claude's turn puts Pingo's name alone in its balloon, never what Claude is doing, and no line
  await $.turn.start({ turnId: "t0", text: "hello" } as never);
  await $.tool.call({ tool: "Read", file_path: "/work/hooks/register.tsx" } as never);
  let seen = await look($);
  expect(seen.inBalloon).toBe(true);
  expect(seen.row).not.toContain("Pingo:");
  expect(seen.row).not.toContain("Reading");
  expect(seen.row).not.toContain("Thinking");
  expect(seen.line).toBeUndefined();
  await $.turn.complete({ turnId: "t0", answer: "Hi.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);

  const first = await ask($, world, "Make the loader retry until it connects");
  await ended($, first.id, `GOAL: ${GOAL}`);
  expect((await look($)).row).toContain(`Pingo: ${GOAL}`);

  // its agent fails: the goal it wrote is not taken
  const failed = await ask($, world, "Now rename the settings screen");
  await ended($, failed.id, "GOAL: Rename the settings screen", "error");
  expect((await look($)).row).toContain(`Pingo: ${GOAL}`);

  // it ends without a GOAL line
  const silent = await ask($, world, "Now rename the settings screen");
  await ended($, silent.id, "I could not tell what the session is after.");
  expect((await look($)).row).toContain(`Pingo: ${GOAL}`);

  // the host refuses to start it
  world.control.refuse = true;
  await ask($, world, "Now rename the settings screen");
  world.control.refuse = false;
  expect((await look($)).row).toContain(`Pingo: ${GOAL}`);

  // it has not answered yet: the last goal stays, then the deadline passes and a late answer is dropped
  const late = await ask($, world, "Now rename the settings screen");
  seen = await look($);
  expect(seen.row).toContain(`Pingo: ${GOAL}`);
  expect(seen.inBalloon).toBe(true);
  for (let waited = 0; waited <= RESUMO_TIMEOUT_MS; waited += 10_000) await world.clock.advance(10_000);
  await ended($, late.id, "GOAL: Rename the settings screen");
  seen = await look($);
  expect(seen.row).toContain(`Pingo: ${GOAL}`);
  expect(seen.row).not.toContain("Rename");
});
