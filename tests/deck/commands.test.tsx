import { expect, test } from "claude-code/testing";

import { ASK, ORIGIN } from "./helpers.ts";

import { DECK_VERSION } from "../../hooks/deck/model.ts";

import { DEFAULT_USAGE, DESKTOP, TERMINAL, TODOS, deckWorld, inAnHour, spawn } from "./helpers.ts";

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

const deck = (args: string) => ({ command: "deck", ...ASK, args }) as const;

// stands in for jev-model-router: the same status and log lines, on a prompt
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

test("/deck city names the weather city, fetches its forecast and shows it", LOCALE, async ($, on) => {
  const { saved, fetched } = deckWorld(on, undefined, { city: { name: "Lisbon", latitude: 38.72, longitude: -9.14, country: "Portugal" } });
  await $.session.start(SESSION);
  const out = await $.command.run(deck("city Lisbon"));
  expect(out.text).toBe("Weather city set to Lisbon, Portugal.");
  expect(fetched).toContain("https://geocoding-api.open-meteo.com/v1/search?count=1&name=Lisbon");
  expect(fetched).toContain("https://api.open-meteo.com/v1/forecast?latitude=38.72&longitude=-9.14&current=temperature_2m,weather_code");
  expect((saved.get("deck") as any).city).toEqual({ name: "Lisbon", lat: 38.72, lon: -9.14 });
  expect((saved.get("deck") as any).show.weather).toBe(true);
  expect((await $.command.run(deck("status"))).text).toMatch(/ · city Lisbon · Deck /);
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /21° cloudy · Lisbon/ })).toBeDefined();
  await term.unmount();
  const desk = await $.ui.mount({ ...BAND, surface: DESKTOP });
  expect(await desk.find({ type: "Text", text: /21° Lisbon/ })).toBeDefined();
});

test("a city the lookup does not find keeps weather off", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on, undefined, { city: null });
  await $.session.start(SESSION);
  const out = await $.command.run(deck("city Atlantis"));
  expect(out.text).toBe('No city found for "Atlantis".');
  expect((saved.get("deck") as any)?.city ?? null).toBeNull();
});

test("a failed weather lookup says so, and changes nothing", LOCALE, async ($, on) => {
  const { state, saved } = deckWorld(on);
  state.network = false;
  await $.session.start(SESSION);
  const out = await $.command.run(deck("city Lisbon"));
  expect(out.text?.startsWith("Weather lookup failed:")).toBe(true);
  expect((saved.get("deck") as any)?.city ?? null).toBeNull();
});

test("weather that cannot be fetched stays silent: the band shows the city while it loads", LOCALE, async ($, on) => {
  const saved = new Map<string, unknown>([["deck", { open: true, show: { weather: true }, city: { name: "Lisbon", lat: 38.72, lon: -9.14 } }]]);
  const { state } = deckWorld(on, saved);
  state.network = false;
  await $.session.start(SESSION);
  const term = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await term.find({ type: "Text", text: /… Lisbon/ })).toBeDefined();
});

// twenty minutes of the mock clock is eight thousand ticks of the band's loop: more than the kit's default five seconds on a busy machine
test("the forecast is fetched again every twenty minutes while a city is set", { ...LOCALE, timeoutMs: 30_000 }, async ($, on) => {
  const { fetched, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run(deck("city Lisbon"));
  const before = fetched.filter((url) => url.startsWith("https://api.open-meteo.com/")).length;
  await clock.advance(20 * 60_000);
  expect(fetched.filter((url) => url.startsWith("https://api.open-meteo.com/")).length).toBe(before + 1);
});

test("/deck panel opens the Deck pane, and /deck panel off closes it", LOCALE, async ($, on) => {
  const { panes } = deckWorld(on);
  await $.session.start(SESSION);
  expect((await $.command.run(deck("panel"))).text).toBe("Deck opened in a panel.");
  expect(panes).toContain("deck-panel");
  expect((await $.command.run(deck("panel off"))).text).toBe("Deck panel closed.");
  expect(panes).not.toContain("deck-panel");
});

test("/deck style opens the picker, and a name that is no style says which exist", LOCALE, async ($, on) => {
  const { panes } = deckWorld(on);
  await $.session.start(SESSION);
  const opened = await $.command.run(deck("style"));
  expect(opened.text).toBeUndefined();
  expect(panes).toContain("deck-style");
  const bad = await $.command.run(deck("style nope"));
  expect(bad.text).toBe(
    'No style "nope". CLI: segments, line, solid, dots, pixel, spark · Desktop: pixel, segments, line, solid, dots, spark',
  );
  const set = await $.command.run(deck("style spark"));
  expect(set.text).toBe("Style spark for CLI and Desktop.");
});

test("/deck quiet on keeps the router's status and log lines off the transcript; quiet off lets them through", { ...LOCALE, plugins: [fakeRouter] }, async ($, on) => {
  const { logs, statuses } = deckWorld(on);
  await $.session.start(SESSION);
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "rename a variable" });
  expect(statuses).toEqual([]);
  expect(logs.map((l) => l.to)).toEqual(["debug"]);
  expect((await $.command.run(deck("quiet off"))).text).toBe("Deck quiet: off.");
  await $.prompt.submit({ wait: false, origin: ORIGIN, text: "rename it again" });
  expect(statuses).toEqual(["jev · fast 0.87 → low"]);
  expect(logs.map((l) => l.to)).toEqual(["debug", "transcript"]);
});

test("/deck cost keeps a running spend, counting each session's new cost once", LOCALE, async ($, on) => {
  const { saved, state } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run(deck("cost on"));
  expect(round((saved.get("deckSpend") as any).spend.dayUsd)).toBe(0.42);
  state.sessionId = "session-2";
  state.usage = { ...DEFAULT_USAGE, cost: { usd: 0.1 } };
  await $.session.start(SESSION);
  expect(round((saved.get("deckSpend") as any).spend.dayUsd)).toBe(0.52);
  state.sessionId = "session-1";
  state.usage = { ...DEFAULT_USAGE, cost: { usd: 0.5 } };
  await $.session.start(SESSION);
  expect(round((saved.get("deckSpend") as any).spend.dayUsd)).toBe(0.6);
  expect((saved.get("deckSpend") as any).costSeen).toEqual({ "session-1": 0.5, "session-2": 0.1 });
  expect((await $.command.run(deck("cost off"))).text).toBe("Spend tracking off.");
});

test("/deck sound on plays the chime, and sound off stops every cue", LOCALE, async ($, on) => {
  const { played, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run(deck("sound on"));
  expect(played).toEqual([{ asset: "sounds/chime.wav", gain: 0.6 }]);
  await $.command.run(deck("sound off"));
  played.length = 0;
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await clock.advance(300);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS.map((t) => ({ ...t, status: "completed" })) } as never);
  await clock.advance(300);
  expect(played).toEqual([]);
});

test("a finishing step plays the tick, and a finished plan plays the fanfare", LOCALE, async ($, on) => {
  const { played, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await clock.advance(300);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS.map((t) => ({ ...t, status: "completed" })).slice(0, 4).concat([{ ...TODOS[4]!, status: "in_progress" }]) } as never);
  await clock.advance(300);
  expect(played.map((p) => p.asset)).toContain("sounds/tick.wav");
  await $.tool.call({ tool: "TodoWrite", todos: TODOS.map((t) => ({ ...t, status: "completed" })) } as never);
  await clock.advance(300);
  expect(played.map((p) => p.asset)).toContain("sounds/fanfare.wav");
  expect(played.every((p) => p.gain === 0.6)).toBe(true);
});

test("a permission prompt held past its delay opens the band and alerts", LOCALE, async ($, on) => {
  const { saved, played, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await clock.advance(300);
  await $.tool.check({ tool: "Bash", input: { command: "rm -rf build" } });
  await clock.advance(800);
  expect((saved.get("deck") as any).open).toBe(true);
  expect(played.map((p) => p.asset)).toContain("sounds/alert.wav");
});

test("/deck auto off keeps the band shut for a permission prompt", LOCALE, async ($, on) => {
  const { saved, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run(deck("auto off"));
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.tool.check({ tool: "Bash", input: { command: "rm -rf build" } });
  await clock.advance(800);
  expect((saved.get("deck") as any).open).toBe(false);
  const out = await $.command.run(deck("status"));
  expect(out.text).toMatch(/^\? Tasks — Fixing auth 3\/5/m);
});

test("a reply ending in a question opens the band and marks the live bar", LOCALE, async ($, on) => {
  const { saved, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: "Shall I run the suite?" } as never);
  await clock.advance(300);
  expect((saved.get("deck") as any).open).toBe(true);
  expect((await $.command.run(deck("status"))).text).toMatch(/^\? Tasks — Fixing auth 3\/5/m);
});

test("the runtime's own report settles a subagent that finished without a turn end", LOCALE, async ($, on) => {
  const { state, clock } = deckWorld(on, undefined, { spawn: () => ({ model: "claude-haiku-4-5", agentId: "a1" }) });
  await $.session.start(SESSION);
  await $.agent.spawn(spawn("scan the repo"));
  expect((await $.command.run(deck("status"))).text).toMatch(/Agents 0\/1/);
  state.agents = [{ id: "a1", status: "completed" }];
  await clock.advance(2200);
  expect((await $.command.run(deck("status"))).text).toMatch(/✓ Agents — Done 1\/1/);
});

test("the usage is read again every minute", LOCALE, async ($, on) => {
  const { state, clock } = deckWorld(on);
  await $.session.start(SESSION);
  state.usage = { ...DEFAULT_USAGE, rateLimits: [{ kind: "five_hour", percentUsed: 45, resetsAt: inAnHour() }] };
  await clock.advance(60_000);
  expect((await $.command.run(deck("status"))).text).toMatch(/Session · 5h — 5h · 45% used/);
});

test("/deck clear removes the rows and says so", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  expect((await $.command.run(deck("clear"))).text).toBe("Deck rows cleared.");
  // the bars go; the context and the limits are meters, not bars, and stay
  const out = (await $.command.run(deck("status"))).text;
  expect(out).not.toMatch(/Tasks/);
  expect(out).toMatch(/● Context/);
});

test("/deck expand, collapse and the bare toggle reply and save the band's state", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on);
  await $.session.start(SESSION);
  expect((await $.command.run(deck("expand"))).text).toBe("Deck expanded.");
  expect((saved.get("deck") as any).open).toBe(true);
  expect((await $.command.run(deck("collapse"))).text).toBe("Deck collapsed.");
  expect((saved.get("deck") as any).open).toBe(false);
  expect((await $.command.run(deck(""))).text).toBe("Deck expanded.");
  expect((await $.command.run(deck(""))).text).toBe("Deck collapsed.");
});

test("/deck size and /deck collapsed save their choice; collapsed also folds the band", LOCALE, async ($, on) => {
  const { saved } = deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run(deck("expand"));
  expect((await $.command.run(deck("size roomy"))).text).toBe("Deck is roomy: the wider spacing.");
  expect((saved.get("deck") as any).size).toBe("roomy");
  await $.command.run(deck("collapsed rings"));
  expect((saved.get("deck") as any).collapsed).toBe("rings");
  expect((saved.get("deck") as any).open).toBe(false);
});

test("the usage help names every command, city and panel included", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  const out = await $.command.run(deck("nonsense"));
  for (const line of ["/deck city <name>", "/deck panel [off]", "/deck quiet on|off", "/deck version", "/deck status"]) {
    expect(out.text).toContain(line);
  }
});

test("Deck's words follow the Portuguese locale", { options: { locale: "pt" } }, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  expect((await $.command.run(deck("status"))).text).toMatch(/Exibindo: /);
  expect((await $.command.run(deck("version"))).text).toBe("Deck " + DECK_VERSION);
  expect((await $.command.run(deck("clear"))).text).toBe("Linhas do Deck removidas.");
});
