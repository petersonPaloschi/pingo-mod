import { expect, test } from "claude-code/testing";

import {
  COST_SESSIONS,
  DECK_VERSION,
  activityRow,
  burnRate,
  callAnswered,
  elapsed,
  countdown,
  createDeckState,
  dismissRow,
  histFrom,
  humanReset,
  newBar,
  placeBar,
  spendFrom,
  spendRecord,
  startAgent,
  takeUsage,
  costSeenFrom,
  type DeckRow,
} from "../../hooks/deck/model.ts";
import { DEFAULT_SETTINGS, SECTIONS, parseSettings, serializeSettings, withSection } from "../../hooks/deck/settings.ts";
import { text } from "../../hooks/i18n.ts";
import { en } from "../../hooks/strings/en.ts";
import { pt } from "../../hooks/strings/pt.ts";
import { applyDeckCommand, deckWords } from "../../hooks/deck/wire.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const HOUR = 3600_000;

test("the defaults are Deck's", () => {
  expect(DEFAULT_SETTINGS).toEqual({
    show: { plans: true, agents: true, context: true, limits: true, route: true, pet: true, clock: true, weather: false },
    style: { terminal: "solid", desktop: "pixel" },
    open: false,
    auto: true,
    sound: true,
    quiet: true,
    size: "compact",
    collapsed: "chips",
    cost: false,
    city: null,
  });
});

test("a saved value keeps what it can read and falls back for the rest", () => {
  const s = parseSettings({
    open: "yes",
    size: "huge",
    collapsed: "rings",
    city: { name: " Lisbon ", lat: 38.7, lon: -9.1, extra: 1 },
    style: { terminal: "x".repeat(40), desktop: "dots" },
    show: { pet: false, unknown: true },
  });
  expect(s.open).toBe(false);
  expect(s.size).toBe("compact");
  expect(s.collapsed).toBe("rings");
  expect(s.city).toEqual({ name: "Lisbon", lat: 38.7, lon: -9.1 });
  expect(s.style).toEqual({ terminal: "solid", desktop: "dots" });
  expect(s.show.pet).toBe(false);
  expect(s.show.clock).toBe(true);
  expect(Object.keys(s.show)).toEqual([...SECTIONS]);
});

test("a city with a coordinate off the map is dropped, and nothing else is", () => {
  expect(parseSettings({ city: { name: "Nowhere", lat: 120, lon: 0 } }).city).toBeNull();
  expect(parseSettings("not an object")).toEqual(DEFAULT_SETTINGS);
});

test("saved settings read back as they were written", () => {
  const s = { ...DEFAULT_SETTINGS, open: true, cost: true, city: { name: "Lisbon", lat: 38.72, lon: -9.14 }, show: { ...DEFAULT_SETTINGS.show, weather: true } };
  expect(parseSettings(serializeSettings(s))).toEqual(s);
  expect(withSection(DEFAULT_SETTINGS, "pet", false).show.pet).toBe(false);
  expect(DEFAULT_SETTINGS.show.pet).toBe(true);
});

test("unknown bounded style ids survive a settings round-trip", () => {
  const s = parseSettings({ style: { terminal: "future-terminal", desktop: "future-desktop" } });
  expect(s.style).toEqual({ terminal: "future-terminal", desktop: "future-desktop" });
  expect(parseSettings(serializeSettings(s)).style).toEqual(s.style);
});

test("expand and collapse set the band and reply", () => {
  const open = applyDeckCommand(DEFAULT_SETTINGS, "expand", "en");
  expect(open.settings.open).toBe(true);
  expect(open.text).toBe("Deck expanded.");
  const shut = applyDeckCommand(open.settings, "collapse", "en");
  expect(shut.settings.open).toBe(false);
  expect(shut.text).toBe("Deck collapsed.");
});

test("a style name sets the surfaces it fits, and a name no surface has is refused", () => {
  const set = applyDeckCommand(DEFAULT_SETTINGS, "style dots", "en");
  expect(set.settings.style).toEqual({ terminal: "dots", desktop: "dots" });
  expect(set.text).toBe("Style dots for CLI and Desktop.");
  const bad = applyDeckCommand(DEFAULT_SETTINGS, "style nope", "en");
  expect(bad.settings).toBe(DEFAULT_SETTINGS);
  expect(bad.text).toBe('No style "nope". CLI: segments, line, solid, dots, pixel, spark · Desktop: pixel, segments, line, solid, dots, spark');
});

test("a section switch turns one section, and all turns every one", () => {
  const pet = applyDeckCommand(DEFAULT_SETTINGS, "pet off", "en");
  expect(pet.settings.show.pet).toBe(false);
  expect(pet.settings.show.clock).toBe(true);
  expect(pet.text).toBe("Deck pet: off.");
  const every = applyDeckCommand(DEFAULT_SETTINGS, "all off", "en");
  for (const s of SECTIONS) expect(every.settings.show[s]).toBe(false);
  const weather = applyDeckCommand(DEFAULT_SETTINGS, "weather on", "en");
  expect(weather.settings.show.weather).toBe(true);
});

test("collapsed also folds the band; size, cost, auto, sound and quiet are plain switches", () => {
  const folded = applyDeckCommand({ ...DEFAULT_SETTINGS, open: true }, "collapsed text", "en");
  expect(folded.settings.collapsed).toBe("text");
  expect(folded.settings.open).toBe(false);
  expect(applyDeckCommand(DEFAULT_SETTINGS, "size roomy", "en").text).toBe("Deck is roomy: the wider spacing.");
  expect(applyDeckCommand(DEFAULT_SETTINGS, "cost on", "en").settings.cost).toBe(true);
  expect(applyDeckCommand(DEFAULT_SETTINGS, "cost on", "en").text).toMatch(/^Tracking spend today and this month\./);
  expect(applyDeckCommand(DEFAULT_SETTINGS, "auto off", "en").settings.auto).toBe(false);
  expect(applyDeckCommand(DEFAULT_SETTINGS, "sound on", "en").settings.sound).toBe(true);
  expect(applyDeckCommand(DEFAULT_SETTINGS, "quiet off", "en").settings.quiet).toBe(false);
});

test("an unknown or incomplete argument changes nothing and shows the usage", () => {
  const bad = applyDeckCommand(DEFAULT_SETTINGS, "pet maybe", "en");
  expect(bad.settings).toBe(DEFAULT_SETTINGS);
  expect(bad.text).toContain("/deck city <name>");
  expect(bad.text).toContain("/deck panel [off]");
  expect(applyDeckCommand(DEFAULT_SETTINGS, "frobnicate", "en").text).toBe(bad.text);
});

test("command words and values are not case-sensitive, and the city keeps its own words", () => {
  expect(applyDeckCommand(DEFAULT_SETTINGS, "PET OFF", "en").settings.show.pet).toBe(false);
  expect(deckWords("  city   New York ")).toEqual({ verb: "city", rest: ["New", "York"] });
});

test("the English and Portuguese Deck strings have the same keys, and placeholders fill", () => {
  const deckKeys = (catalog: Record<string, string>) => Object.keys(catalog).filter((key) => key.startsWith("deck.")).sort();
  expect(deckKeys(pt)).toEqual(deckKeys(en));
  expect(text("deck.reply.set", "en", { name: "pet", value: "off" })).toBe("Deck pet: off.");
  expect(text("deck.reply.set", "en", {})).toBe("Deck {name}: {value}.");
  expect(text("deck.reply.set", "pt", { name: "pet", value: "desligado" })).toBe("Deck pet: desligado.");
});

test("the activity line shows how long a turn has run, unpadded: 42s, then 1m 5s", () => {
  expect(elapsed(0)).toBe("0s");
  expect(elapsed(9_400)).toBe("9s");
  expect(elapsed(42_000)).toBe("42s");
  expect(elapsed(65_000)).toBe("1m 5s");
  expect(elapsed(3_605_000)).toBe("60m 5s");
  const s = createDeckState(NOW, "x", new Date(NOW));
  s.activity = { title: "Fix the login bug", start: NOW - 65_000, tools: 2, action: "Editing auth.ts", done: false, doneAt: null, agentsDoneAt: null };
  expect(activityRow(s, DEFAULT_SETTINGS.show, NOW, "en")?.right).toBe("1m 5s");
});

test("Deck prints the plugin's own version as a bare x.y.z", () => {
  expect(DECK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

test("the usage history keeps 26 hours and the newest 400 points", () => {
  const points = Array.from({ length: 401 }, (_, i) => ({ t: NOW - 25 * HOUR + i * 1000, p: i }));
  const saved = { five_hour: [{ t: NOW - 27 * HOUR, p: 1 }, ...points], junk: "x" };
  const hist = histFrom(saved, NOW);
  expect(hist.junk).toBeUndefined();
  expect(hist.five_hour).toHaveLength(400);
  expect(hist.five_hour![0]!.p).toBe(1);
  expect(hist.five_hour!.every((x) => NOW - x.t <= 26 * HOUR)).toBe(true);
});

test("the spend keeps the counts of the last thirty sessions and the current one", () => {
  const s = createDeckState(NOW, "now", new Date(NOW));
  s.costSeen = 1.5;
  const saved = { costSeen: Object.fromEntries(Array.from({ length: 31 }, (_, i) => ["s" + i, i])) };
  const record = spendRecord(s, saved, "now");
  const ids = Object.keys(record.costSeen);
  expect(ids).toHaveLength(COST_SESSIONS);
  expect(record.costSeen.now).toBe(1.5);
  expect(record.costSeen.s0).toBeUndefined();
  expect(costSeenFrom(saved, "s30")).toBe(30);
  expect(costSeenFrom(saved, "absent")).toBeNull();
});

test("a stale day or month starts at zero", () => {
  const spend = spendFrom({ day: "2026-10-06", dayUsd: 3, month: "2026-10", monthUsd: 5 }, new Date(NOW));
  expect(spend).toEqual({ day: "2026-10-07", dayUsd: 0, month: "2026-10", monthUsd: 5 });
});

test("a burn rate reads per hour for a window and per day for the week, and needs five minutes of history", () => {
  const s = createDeckState(NOW, "x", new Date(NOW));
  s.hist.five_hour = [{ t: NOW - 10 * 60_000, p: 30 }, { t: NOW, p: 40 }];
  expect(burnRate(s, "five_hour", NOW, "en")).toBe("+60%/h");
  s.hist.seven_day = [{ t: NOW - HOUR, p: 60 }, { t: NOW, p: 61 }];
  expect(burnRate(s, "seven_day", NOW, "en")).toBe("+24%/day");
  s.hist.context = [{ t: NOW - 60_000, p: 10 }, { t: NOW, p: 20 }];
  expect(burnRate(s, "context", NOW, "en")).toBe("");
});

test("the countdowns read a day or more as days, and the rings as one unit", () => {
  const inHours = new Date(NOW + HOUR + 14 * 60_000).toISOString();
  expect(countdown(inHours, NOW)).toBe("1:14:00");
  const inDays = new Date(NOW + (3 * 24 + 5) * HOUR + 7 * 60_000).toISOString();
  expect(countdown(inDays, NOW)).toBe("3d 5h 07m");
  expect(humanReset(inDays, NOW)).toBe("3d 5h");
  expect(humanReset(new Date(NOW + HOUR + 7 * 60_000).toISOString(), NOW)).toBe("1h7m");
});

test("a plan leaves with its bar, and a meter or route row names the section it hides", () => {
  const s = createDeckState(NOW, "x", new Date(NOW));
  const todo = newBar("todo", "Refactor", "todo", [{ name: "Tasks", steps: [{ title: "a", status: "active" }] }] as never, NOW);
  placeBar(s, todo);
  const row = { id: "bar:todo", kind: "bar", bar: todo } as unknown as DeckRow;
  expect(dismissRow(s, row)).toBeNull();
  expect(todo.dismissed).toBe(true);
  const plan = newBar("plan-x", "Plan X", "plan", [], NOW);
  placeBar(s, plan);
  expect(dismissRow(s, { id: "bar:plan-x", kind: "bar", bar: plan } as unknown as DeckRow)).toBeNull();
  expect(s.bars.has("plan-x")).toBe(false);
  expect(dismissRow(s, { id: "route", kind: "route" } as unknown as DeckRow)).toBe("route");
  expect(dismissRow(s, { id: "limit:five_hour", kind: "meter", section: "limits" } as unknown as DeckRow)).toBe("limits");
});

test("a subagent with no bar of its own goes on the Agents bar; one under a bar goes on that bar", () => {
  const s = createDeckState(NOW, "x", new Date(NOW));
  startAgent(s, { id: "a1", description: "scan the repo", subagentType: "Explore", model: "claude-haiku-4-5" }, NOW, "en");
  expect(s.agents.get("a1")).toMatchObject({ home: "agents", model: "haiku", tool: "Starting", depth: 0, title: "scan the repo" });
  expect(s.bars.has("agents")).toBe(true);
  const plan = newBar("plan-x", "Plan X", "plan", [{ name: "Stage", steps: [{ title: "s", status: "active" }] }] as never, NOW);
  placeBar(s, plan);
  startAgent(s, { id: "a2", description: "", subagentType: "Plan", model: "", parentAgentId: "a1" }, NOW, "en");
  expect(s.agents.get("a2")).toMatchObject({ home: "agents", depth: 1, title: "Plan" });
});

test("an approved plan becomes a bar only when its call ran cleanly", () => {
  const s = createDeckState(NOW, "x", new Date(NOW));
  const call = { tool: "ExitPlanMode", input: { plan: "# Checkout\n\n## Backend\n1. Add table\n" } };
  callAnswered(s, call, { deny: "no" }, NOW, "en");
  expect(s.bars.size).toBe(0);
  callAnswered(s, call, { result: "ok" }, NOW, "en");
  expect(s.bars.get("plan-checkout")?.title).toBe("Checkout");
});

test("a usage reading drops the demo's sample numbers when it is measured, or when it has real ones", () => {
  const s = createDeckState(NOW, "x", new Date(NOW));
  s.demoUsage = true;
  s.usage = { context: { tokens: 1, window: 10, percent: 10 }, rateLimits: [{ kind: "five_hour", percentUsed: 31 }] };
  // a poll with no real numbers keeps the sample limits; a reading with no context percentage clears the context row
  takeUsage(s, { context: null, rateLimits: [] }, NOW, false, false);
  expect(s.demoUsage).toBe(true);
  expect(s.usage.rateLimits).toEqual([{ kind: "five_hour", percentUsed: 31 }]);
  expect(s.usage.context).toBeNull();
  takeUsage(s, { context: null, rateLimits: [] }, NOW, false, true);
  expect(s.demoUsage).toBe(false);
  expect(s.usage).toEqual({ context: null, rateLimits: [] });
});
