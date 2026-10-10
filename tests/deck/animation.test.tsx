import { expect, test } from "claude-code/testing";

import { DESKTOP, TERMINAL, TODOS, deckWorld } from "./helpers.ts";

import { LANE_ROWS } from "../../hooks/deck/cast.ts";
import { petLaneColumns } from "../../hooks/deck/pet.ts";

// What the Deck's animation costs: how often the UI is drawn again, and how the terminal pet moves without that.
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

const PANEL = { ...PANE, requestId: "deck-panel", props: { ...PANE.props, title: "Deck", placement: "inline", scroll: { offset: 0, bodyRows: 12 } } } as const;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

/**
 * Counts the draws of the band and of the Jev pane. A plugin in the outermost tier sees each draw before Jev's
 * own hook and reports it as a status line, which the world records; a plugin runs apart from the test.
 */
const drawCounter = {
  name: "draw-counter",
  tier: "prepend" as const,
  register(on: any) {
    on("ui.render", { component: "AbovePrompt" }, async ($: any, e: any, next: any) => {
      await $.ui.status("draw-band");
      return next(e);
    });
    on("ui.render", { component: "Pane", requestId: "jev" }, async ($: any, e: any, next: any) => {
      await $.ui.status("draw-pane");
      return next(e);
    });
  },
};
const OPTIONS = { options: { locale: "en" }, plugins: [drawCounter] } as const;

const draws = (statuses: readonly string[], what: "band" | "pane") => statuses.filter((line) => line === `draw-${what}`).length;

/** Three seconds of the mock clock in 150 ms steps, a read after each, so every invalidation is drawn as the host would draw it. */
async function threeSeconds(ui: { find: (query: { type: string }) => Promise<unknown> }, clock: { advance: (ms: number) => Promise<void> }, statuses: string[]) {
  statuses.length = 0;
  for (let i = 0; i < 20; i++) {
    await clock.advance(150);
    await ui.find({ type: "Text" });
  }
}

/** A turn at work: a todo list on its bar and an activity row, both animating. */
async function atWork($: any) {
  await $.turn.start({ text: "work", turnId: "t1" });
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.tool.call({ tool: "Read", file_path: "/a.ts" } as never);
}

test("a turn at work redraws a terminal band every other frame at most", OPTIONS, async ($, on) => {
  const { clock, statuses } = deckWorld(on);
  await $.session.start(SESSION);
  await atWork($);
  const terminal = await $.ui.mount({ ...BAND, surface: TERMINAL });
  await threeSeconds(terminal, clock, statuses);
  // 150 ms frames, redrawn every other one, plus the clock's second: the whole UI was drawn 23 times when every frame drew it
  expect(draws(statuses, "band")).toBeLessThanOrEqual(16);
  await terminal.unmount();
});

test("a turn at work redraws a desktop band no more than the clock does", OPTIONS, async ($, on) => {
  const { clock, statuses } = deckWorld(on);
  await $.session.start(SESSION);
  await atWork($);
  const desktop = await $.ui.mount({ ...BAND, surface: DESKTOP });
  await threeSeconds(desktop, clock, statuses);
  // desktop rows and pet move by CSS: only the clock and a new scene ask for a redraw
  expect(draws(statuses, "band")).toBeLessThanOrEqual(6);
  await desktop.unmount();
});

test("with the dashboard open the rows' motion slows again, for the band and for the dashboard", OPTIONS, async ($, on) => {
  const { clock, statuses } = deckWorld(on);
  await $.session.start(SESSION);
  await atWork($);
  const band = await $.ui.mount({ ...BAND, surface: TERMINAL });
  const pane = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await band.find({ type: "Text" });
  await threeSeconds(band, clock, statuses);
  expect(draws(statuses, "pane")).toBeLessThanOrEqual(10);
  expect(draws(statuses, "band")).toBeLessThanOrEqual(10);
  await pane.unmount();
  await band.unmount();
});

test("an idle band is drawn again about once a second, on either surface", OPTIONS, async ($, on) => {
  const { clock, statuses } = deckWorld(on);
  await $.session.start(SESSION);
  for (const surface of [TERMINAL, DESKTOP]) {
    const band = await $.ui.mount({ ...BAND, surface });
    await threeSeconds(band, clock, statuses);
    expect(draws(statuses, "band")).toBeLessThanOrEqual(6);
    await band.unmount();
  }
});

test("the terminal pet is repainted in place, on the lane the band drew", OPTIONS, async ($, on) => {
  const { clock, statuses, blits } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  const lane = await ui.find({ type: "Raster", key: "deck-pet" } as never);
  expect(lane?.props.columns).toBe(petLaneColumns(110));
  // the bodies' four rows and, above them, the row of names
  expect(lane?.props.rows).toBe(LANE_ROWS);
  await threeSeconds(ui, clock, statuses);
  await threeSeconds(ui, clock, statuses);
  expect(blits.length).toBeGreaterThan(3);
  const bytes = petLaneColumns(110) * LANE_ROWS * 12;
  for (const blit of blits) {
    expect(blit.requestId).toBe("above-prompt");
    expect(blit.key).toBe("deck-pet");
    expect(blit.columns).toBe(petLaneColumns(110));
    expect(blit.rows).toBe(LANE_ROWS);
    expect(blit.cells).toHaveLength(Math.ceil(bytes / 3) * 4);
  }
  // a frame that did not change is not sent again
  blits.slice(1).forEach((blit, i) => expect(blit.cells).not.toBe(blits[i]!.cells));
  await ui.unmount();
});

test("nothing is repainted that is not on screen: no band, or a desktop band, gets no repaint", OPTIONS, async ($, on) => {
  const { clock, blits } = deckWorld(on);
  await $.session.start(SESSION);
  await clock.advance(4000);
  expect(blits).toHaveLength(0);
  const desktop = await $.ui.mount({ ...BAND, surface: DESKTOP });
  await clock.advance(4000);
  await desktop.find({ type: "Text" });
  expect(blits).toHaveLength(0);
  await desktop.unmount();
});

test("only a terminal band's lane is repainted, and one that is gone is forgotten after a moment", OPTIONS, async ($, on) => {
  const { clock, statuses, blits } = deckWorld(on);
  await $.session.start(SESSION);
  const sent = (requestId: string) => blits.filter((blit) => blit.requestId === requestId).length;
  const band = await $.ui.mount({ ...BAND, surface: TERMINAL });
  // the Deck pane draws the band too, in its own site; a desktop band, in a third, has no cells to repaint
  const panel = await $.ui.mount({ ...PANEL, surface: TERMINAL });
  const desktop = await $.ui.mount({ ...BAND, requestId: "above-desktop", surface: DESKTOP });
  await threeSeconds(band, clock, statuses);
  await threeSeconds(band, clock, statuses);
  expect(sent("above-prompt")).toBeGreaterThan(0);
  expect(sent("deck-panel")).toBeGreaterThan(0);
  expect(sent("above-desktop")).toBe(0);
  await desktop.unmount();
  // the band goes, the pane stays: the pane's lane is still repainted, the band's stops
  await band.unmount();
  await threeSeconds(panel, clock, statuses);
  const bandSent = sent("above-prompt");
  const panelSent = sent("deck-panel");
  await threeSeconds(panel, clock, statuses);
  await threeSeconds(panel, clock, statuses);
  expect(sent("above-prompt")).toBe(bandSent);
  expect(sent("deck-panel")).toBeGreaterThan(panelSent);
  await panel.unmount();
});

test("a repaint the host refuses is not tried again until the band is drawn again", OPTIONS, async ($, on) => {
  const { clock, statuses, state, blits } = deckWorld(on);
  state.blit = "deny";
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  await threeSeconds(ui, clock, statuses);
  // one try per draw of the band, not one per frame: twenty frames, about three draws
  expect(blits.length).toBeGreaterThan(0);
  expect(blits.length).toBeLessThanOrEqual(draws(statuses, "band") + 1);
  await ui.unmount();
});

test("a host with no repaint still moves the pet, with a slow redraw and never a frame-rate one", OPTIONS, async ($, on) => {
  const { clock, statuses, state, blits } = deckWorld(on);
  state.blit = "throw";
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
  const lane = async () => (await ui.find({ type: "Raster", key: "deck-pet" } as never))?.props.cells;
  const before = await lane();
  statuses.length = 0;
  let during: unknown;
  for (let i = 0; i < 20; i++) {
    await clock.advance(150);
    await ui.find({ type: "Text" });
    // inside the first scene, an idle one three seconds long: the pet breathes, and the same instant never comes round again
    if (i === 8) during = await lane();
  }
  expect(blits).toHaveLength(0);
  // the band is drawn again about three times a second to carry the pet: more than the clock's one, never the frame rate
  expect(draws(statuses, "band")).toBeGreaterThan(6);
  expect(draws(statuses, "band")).toBeLessThanOrEqual(16);
  expect(during).not.toBe(before);
  await ui.unmount();
});

test("the desktop pet's source stays the same through a scene, so the app keeps its animation going", OPTIONS, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...BAND, surface: DESKTOP });
  const lane = async () => (await ui.findAll({ type: "Svg" })).find((svg) => String(svg.props.alt).startsWith("Pingo, "))?.props.source as string;
  const first = await lane();
  expect(first).toContain("@keyframes mv");
  // the first scene is an idle one, three seconds long
  await clock.advance(1100);
  await ui.find({ type: "Text" });
  expect(await lane()).toBe(first);
  await ui.unmount();
});
