// Who is on the Deck's lane is who is at work, as a session tells it: Jev while a call of his is open, the Comandante
// while it judges, each subagent while it runs. Each says what it is doing in a balloon, from what it really does,
// and each leaves on its own once its task ends, after a goodbye hop.
import { expect, test, type Engine } from "claude-code/testing";

import { CAST_LEAVE_MS } from "../../hooks/deck/cast.ts";
import { petLaneColumns } from "../../hooks/deck/pet.ts";
import { HUE } from "../../hooks/theme.ts";
import { comandanteStore, pick } from "../helpers.ts";
import { TERMINAL, deckWorld, spawn } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 210, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 200, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const LOCALE = { options: { locale: "en" } } as const;
const COLUMNS = petLaneColumns(200);

/** The name row of a lane's cells as the host gets them: its text, and each cell's color. */
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

/** A fresh band's name row and the names on its speech line: a mounted lane is only repainted by the clock's blit. */
async function look($: Engine, requestId = "look") {
  const ui = await $.ui.mount({ ...BAND, requestId, surface: TERMINAL });
  const name = nameRow((await ui.find({ type: "Raster", key: "deck-pet" } as never))?.props.cells);
  const speech = async (id: string) => (await ui.find({ type: "Button", key: `deck-speech-${id}` } as never))?.props.label as string | undefined;
  // the color a name is written in on the lane
  const colorOf = (label: string) => name.colors[name.text.indexOf(label)];
  return { ui, row: name.text, speech, colorOf };
}

async function settle(done: () => Promise<boolean>) {
  for (let i = 0; i < 200 && !(await done()); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
}

test("Jev and the Comandante join while the Comandante judges through Jev, each saying what it does, then leave", LOCALE, async ($, on) => {
  // Jev's answer is held, so the call stays open while the lane is looked at (registered before the world, which
  // answers every other fetch)
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let asked = 0;
  on("http.fetch", { url: /systemone/ }, async () => {
    asked++;
    await held;
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { verdict: pick("approve_sound", 0.9) }, usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });
  on("ui.toast", async () => ({ value: undefined }) as never);
  const world = deckWorld(on, comandanteStore());
  await $.session.start(SESSION);

  // nobody at work yet
  let drawn = await look($);
  expect(drawn.row.trim()).toBe("Pingo");
  await drawn.ui.unmount();

  // an assumption to record: the Comandante judges it, asking Jev, before Farol keeps it
  const recorded = $.tool.call({ tool: "mcp__jev__farol_assumption", tool_use_id: "toolu-farol-1", assumption: "The config lives in src/config.ts" } as never);
  await settle(async () => asked > 0);
  await settle(async () => {
    const { ui, row } = await look($, "probe");
    await ui.unmount();
    return row.includes("Jev");
  });
  drawn = await look($);
  // both at work side by side, each in its balloon, saying what it really does
  expect(drawn.row).toContain("▐Jev: judging for the Comandante▌");
  expect(drawn.row).toContain("▐Comandante: judging an alert (Farol)▌");
  // under the lane the first at work says its words, and the other is named, each opening its own pane
  expect(await drawn.speech("comandante")).toContain("judging an alert (Farol)");
  expect(await drawn.speech("jev")).toBe("Jev");
  // Farol has nothing yet: the assumption waits for the verdict
  expect(drawn.row).not.toContain("▐Farol");
  await drawn.ui.unmount();

  release();
  await recorded;
  drawn = await look($);
  // the verdict came: Jev and the Comandante say goodbye, quiet; the assumption it approved is kept already
  // confirmed, so Farol has nothing for the person and does not join
  expect(drawn.row).not.toContain("▐Jev");
  expect(drawn.row).not.toContain("▐Comandante");
  expect(drawn.row).toContain("Jev");
  expect(drawn.row).toContain("Comandante");
  expect(drawn.row).not.toContain("Farol");
  await drawn.ui.unmount();
  await world.clock.advance(CAST_LEAVE_MS + 150);
  drawn = await look($);
  expect(drawn.row.trim()).toBe("Pingo");
  await drawn.ui.unmount();
});

test("two subagents at work stand together, each saying what it does, and each leaves on its own", LOCALE, async ($, on) => {
  let n = 0;
  const world = deckWorld(on, undefined, { spawn: () => ({ model: "claude-haiku-4-5", agentId: `a${++n}` }) });
  await $.session.start(SESSION);
  const end = (agentId: string) => $.turn.complete({ turnId: `t-${agentId}`, agentId, answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });

  await $.agent.spawn(spawn("explore routes"));
  await $.agent.spawn(spawn("map the loader"));
  world.state.agents = [{ id: "a1", status: "running" }, { id: "a2", status: "running" }];
  let drawn = await look($);
  expect(drawn.row).toContain("▐Tetra·Explore: explore routes▌");
  expect(drawn.row).toContain("▐Gem·Explore: map the loader▌");
  // planning a subagent with no Jev key asks Jev nothing: Jev never stood on the lane, not even for a goodbye
  expect(drawn.row).not.toContain("Jev");
  expect(await drawn.speech("a1")).toContain("explore routes");
  // the line under the lane says the first one's words, and names the other, which opens its own pane
  expect(await drawn.speech("a2")).toBe("Gem·Explore");
  await drawn.ui.unmount();

  // the first ends: it hops a goodbye and leaves, the second goes on saying what it does
  await end("a1");
  world.state.agents = [{ id: "a2", status: "running" }];
  drawn = await look($);
  expect(drawn.row).toContain("Tetra·Explore");
  expect(drawn.row).not.toContain("explore routes");
  expect(drawn.row).toContain("▐Gem·Explore: map the loader▌");
  await drawn.ui.unmount();
  await world.clock.advance(CAST_LEAVE_MS + 150);
  drawn = await look($);
  expect(drawn.row).not.toContain("Tetra");
  expect(drawn.row).toContain("▐Gem·Explore: map the loader▌");
  await drawn.ui.unmount();

  // then the second, and nobody is left but Pingo
  await end("a2");
  world.state.agents = [];
  await world.clock.advance(CAST_LEAVE_MS + 150);
  drawn = await look($);
  expect(drawn.row.trim()).toBe("Pingo");
  await drawn.ui.unmount();
});

test("when Jev's call fails, Jev and the Comandante leave with a failed goodbye, and Farol keeps the assumption", LOCALE, async ($, on) => {
  // Jev answers, once released, with an error the key's owner must fix: nothing to retry (registered before the world)
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let asked = 0;
  on("http.fetch", { url: /systemone/ }, async () => {
    asked++;
    await held;
    return { value: { status: 401, ok: false, headers: {}, text: "invalid key" } };
  });
  on("ui.toast", async () => ({ value: undefined }) as never);
  const world = deckWorld(on, comandanteStore());
  await $.session.start(SESSION);

  const recorded = $.tool.call({ tool: "mcp__jev__farol_assumption", tool_use_id: "toolu-farol-1", assumption: "The config lives in src/config.ts" } as never);
  await settle(async () => asked > 0);
  const busy = await look($);
  expect(busy.row).toContain("▐Jev: judging for the Comandante▌");
  expect(busy.row).toContain("▐Comandante: judging an alert (Farol)▌");
  await busy.ui.unmount();
  release();
  await recorded;
  const drawn = await look($);
  // both say goodbye, quiet, their names in the failure's red; the Comandante could not judge, so Farol keeps the
  // assumption for the person to review, as without the Comandante
  expect(drawn.row).not.toContain("▐Jev");
  expect(drawn.row).not.toContain("▐Comandante");
  expect(drawn.colorOf("Jev")).toBe(HUE.fail);
  expect(drawn.colorOf("Comandante")).toBe(HUE.fail);
  expect(drawn.row).toContain("▐Farol: 1 assumption to review▌");
  await drawn.ui.unmount();
  await world.clock.advance(CAST_LEAVE_MS + 150);
  const after = await look($);
  expect(after.row).not.toContain("Jev");
  expect(after.row).not.toContain("Comandante");
  expect(after.row).toContain("▐Farol: 1 assumption to review▌");
  await after.ui.unmount();
});
