import { expect, test } from "claude-code/testing";

import { cellsOf } from "../../hooks/dots.ts";
import { castLaneCells, castOf } from "../../hooks/deck/cast.ts";
import { createPet, petLaneColumns } from "../../hooks/deck/pet.ts";
import { ASK, NOW, TERMINAL, deckWorld } from "./helpers.ts";

const OPTIONS = { options: { locale: "en" }, plugins: [] } as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;
const PANE = {
  plugin: "jev",
  component: "Pane",
  requestId: "jev",
  viewport: { columns: 120, rows: 40 },
  props: { title: "Jev", isFocused: true, bodyColumns: 100, placement: "dock", scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const;

test("the idle second tick stays quiet when no Jev surface is on screen", OPTIONS, async ($, on) => {
  const { clock, invalidations } = deckWorld(on);
  await $.session.start(SESSION);

  await clock.advance(4000);

  expect(invalidations).toEqual([]);
});

test("a visible Jev pane keeps receiving second ticks after 2.5 seconds", OPTIONS, async ($, on) => {
  const { clock, invalidations } = deckWorld(on);
  await $.session.start(SESSION);
  const pane = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await pane.find({ type: "Text" });
  invalidations.length = 0;

  // The host draws the active pane after each invalidation; keep doing so past the 2.5 s visibility window.
  for (let i = 0; i < 5; i++) {
    await clock.advance(1000);
    await $.ui.render({ ...PANE, surface: TERMINAL });
  }

  expect(invalidations).toHaveLength(5);
  await pane.unmount();
});

test("the terminal pet blits a styled frame every 100 ms without a UI invalidation", OPTIONS, async ($, on) => {
  const preferences = { petHat: "cowboy", petShades: true };
  const { clock, invalidations, blits } = deckWorld(on, new Map([["featurePreferences", preferences]]));
  await $.session.start(SESSION);
  await $.command.run({ command: "pingo", ...ASK, args: "dance" });
  const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  const lane = await ui.find({ type: "Raster", key: "deck-pet" } as never);
  const columns = petLaneColumns(110);
  const expectedPet = { ...createPet(NOW), act: "jump" as const, dur: 5000, hat: "cowboy", shades: true };
  // nobody at work: Pingo stands alone, every feature switched on included (none has a task)
  const cast = castOf([], { open: false }, NOW);
  expect(cast).toEqual([]);
  expect(lane?.props.cells).toBe(cellsOf(castLaneCells(expectedPet, cast, NOW, columns)));
  invalidations.length = 0;

  await clock.advance(100);
  const at100 = blits.length;
  await clock.advance(50);
  expect(blits).toHaveLength(at100);
  await clock.advance(50);
  // the hop changes the drawing every 250 ms (up one row, back): the next frame is sent once it has changed
  await clock.advance(100);

  expect(blits.length).toBeGreaterThan(at100);
  expect(blits.at(-1)?.cells).toBe(cellsOf(castLaneCells(expectedPet, cast, NOW + 300, columns)));
  expect(invalidations).toEqual([]);
  await ui.unmount();
});
