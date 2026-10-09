import { expect, test } from "claude-code/testing";

import { ASK, DEFAULT_USAGE, DESKTOP, NOW, deckWorld, inAnHour } from "./helpers.ts";

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;

const LOCALE = { options: { locale: "en" } } as const;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

const round = (v: number) => Math.round(v * 100) / 100;

const measure = (fiveHour: number) =>
  ({
    context: { tokens: 1, window: 10, percent: 10 },
    rateLimits: [{ kind: "five_hour", percentUsed: fiveHour, resetsAt: inAnHour() }],
    changed: ["rateLimits"],
  }) as never;

// ten minutes of the mock clock are four thousand ticks of the band's loop, a lot for the kit's default five seconds
test("the usage history survives a restart, and the burn rate reads it", { ...LOCALE, timeoutMs: 30_000 }, async ($, on) => {
  const { saved, state, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "style spark" });
  await $.session.measure(measure(31));
  await clock.advance(10 * 60_000);
  await $.session.measure(measure(40));
  // the history holds the first reading and the newest one: a poll in between kept its own point
  const fiveHour = (saved.get("deckHist") as any).five_hour as { t: number; p: number }[];
  expect(fiveHour[0]).toEqual({ t: NOW, p: 31 });
  expect(fiveHour[fiveHour.length - 1]).toEqual({ t: NOW + 10 * 60_000, p: 40 });

  // a new session: the same store, and the limit still at 40%
  state.sessionId = "session-2";
  state.usage = { ...DEFAULT_USAGE, rateLimits: [{ kind: "five_hour", percentUsed: 40, resetsAt: inAnHour() }] };
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  // the rows unfold over a few frames
  await clock.advance(1000);
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  expect(await desk.find({ key: "row-limit:five_hour" })).toBeDefined();
  expect(JSON.stringify(await desk.drawn())).toMatch(/\+54%\/h/);
});

test("the spend a session counts is kept per session, so a restart does not count it twice", LOCALE, async ($, on) => {
  const { saved, state } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "deck", ...ASK, args: "cost on" });
  expect(round((saved.get("deckSpend") as any).spend.dayUsd)).toBe(0.42);
  // another session costs as much again: both count
  state.sessionId = "session-2";
  await $.session.start(SESSION);
  expect(round((saved.get("deckSpend") as any).spend.dayUsd)).toBe(0.84);
  // back in the first session, whose cost has not moved: nothing is counted twice
  state.sessionId = "session-1";
  await $.session.start(SESSION);
  expect(round((saved.get("deckSpend") as any).spend.dayUsd)).toBe(0.84);
});
