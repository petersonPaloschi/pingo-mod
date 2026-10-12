// The cast on the Deck as a session draws it: Pingo alone while nobody is at work, a subagent named over its mascot
// while it works, saying what it does, and gone soon after it ends.
import { expect, test } from "claude-code/testing";

import { CAST_LEAVE_MS, LANE_ROWS } from "../../hooks/deck/cast.ts";
import { petLaneColumns } from "../../hooks/deck/pet.ts";
import { TERMINAL, deckWorld, spawn } from "./helpers.ts";

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const LOCALE = { options: { locale: "en" } } as const;

/** The name row of a lane's cells as the host gets them: each cell is its character, its color and its ground (the first is read). */
function nameRow(cells: unknown, columns: number): string {
  const bytes = Uint8Array.from(atob(String(cells)), (char) => char.charCodeAt(0));
  const numbers = new Uint32Array(bytes.buffer);
  let row = "";
  for (let i = 0; i < columns; i++) row += String.fromCodePoint(numbers[i * 3]!);
  return row;
}

test("the Deck's lane shows Pingo alone, then each subagent while it works, and lets it go when it ends", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on, undefined, { spawn: () => ({ model: "claude-haiku-4-5", agentId: "a1" }) });
  await $.session.start(SESSION);
  const columns = petLaneColumns(110);
  const names = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
    const lane = await ui.find({ type: "Raster", key: "deck-pet" } as never);
    await ui.unmount();
    expect(lane?.props.rows).toBe(LANE_ROWS);
    return nameRow(lane?.props.cells, columns);
  };
  // nobody at work: Pingo alone, Jev and the features with no task included
  let row = await names();
  expect(row.trim()).toBe("Pingo");

  await $.agent.spawn(spawn("explore routes"));
  row = await names();
  expect(row.indexOf("Explore")).toBeGreaterThan(row.indexOf("Pingo"));
  // its balloon says what it was sent to do
  expect(row).toContain("(Explore: explore routes)");

  await $.turn.complete({ turnId: "x", agentId: "a1", answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });
  // it ends: its balloon is gone at once and it hops a goodbye, up a row over its name, then back in its place
  row = await names();
  expect(row).not.toContain("explore routes");
  await clock.advance(300);
  row = await names();
  expect(row).toMatch(/(^| )Explore( |$)/);
  expect(row).not.toContain("(");
  await clock.advance(CAST_LEAVE_MS + 150);
  row = await names();
  expect(row.trim()).toBe("Pingo");
});
