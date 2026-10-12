import { expect, test } from "claude-code/testing";

import { ASK, DESKTOP, TERMINAL, TODOS, deckWorld } from "./helpers.ts";

import { DEFAULT_SETTINGS, SECTIONS } from "../../hooks/deck/settings.ts";
import { deckUsage } from "../../hooks/deck/wire.ts";

// the Deck tab of the Jev dashboard: every /deck command as a control, through the same code the command runs
const PANE = {
  plugin: "jev",
  component: "Pane",
  requestId: "jev",
  viewport: { columns: 120, rows: 40 },
  props: { title: "Jev", isFocused: true, bodyColumns: 100, placement: "dock", scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const;

const LOCALE = { options: { locale: "en" } } as const;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the Deck's settings hold now, as the store has them. */
const saved = (store: Map<string, unknown>) => store.get("deck") as any;

// the drawn tree, read as plain data
const kids = (n: any): any[] => [n?.children ?? []].flat(Infinity).filter((k) => k != null && k !== false);
const leaves = (n: any): string => (typeof n === "string" || typeof n === "number" ? String(n) : n && typeof n === "object" ? kids(n).map(leaves).join("") : "");
const everyNode = (n: any): any[] => (n && typeof n === "object" ? [n, ...kids(n).flatMap(everyNode)] : []);
// a card: its title is written on its top edge, in a Box laid over the frame
const sectionOf = (tree: unknown, heading: string) =>
  everyNode(tree).find((n) => n.type === "Box" && kids(n).some((k) => k?.props?.position === "absolute" && leaves(k).endsWith(heading + " -")));

// the control that stands for each /deck verb: a verb added to the usage block with no control here fails below
const CONTROL_OF: Record<string, string> = {
  "": "deck-band",
  expand: "deck-band",
  style: "deck-style-pick",
  "<section>": "deck-show-plans",
  city: "deck-city",
  quiet: "deck-quiet",
  panel: "deck-panel-open",
  size: "deck-size",
  collapsed: "deck-look",
  cost: "deck-cost",
  auto: "deck-auto",
  sound: "deck-sound",
  demo: "deck-demo",
  clear: "deck-clear",
};
// the two verbs the status block answers
const SHOWN: Record<string, RegExp> = { version: /^Deck \d+\.\d+\.\d+$/, status: /^Showing: /m };
const GROUPS = ["Band above the prompt", "What the band shows", "Alerts and extras", "Weather city", "Panel and sample plan", "What the band shows now"];
const CONTROL_KEYS = [
  ...Object.values(CONTROL_OF),
  ...SECTIONS.map((section) => `deck-show-${section}`),
  "deck-all-on", "deck-all-off", "deck-style-cli", "deck-style-desktop", "deck-panel-close",
];

/**
 * Counts the draws of the Jev pane. A plugin in the outermost tier sees each draw before Jev's own hook and
 * reports it as a status line, which the world records; a plugin runs apart from the test, so it cannot count here.
 */
const drawCounter = {
  name: "draw-counter",
  tier: "prepend" as const,
  register(on: any) {
    on("ui.render", { component: "Pane", requestId: "jev" }, async ($: any, e: any, next: any) => {
      await $.ui.status("draw-count");
      return next(e);
    });
  },
};
const drawsOf = (statuses: readonly string[]) => statuses.filter((line) => line === "draw-count").length;

test("the Deck tab groups its settings and keeps command controls on both surfaces", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  for (const surface of [TERMINAL, DESKTOP]) {
    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: "tab-deck" });
    for (const line of deckUsage(DEFAULT_SETTINGS, "en").split("\n")) {
      const verb = line.split(/ {2,}/)[0]!.split(" ")[1] ?? "";
      expect([...Object.keys(CONTROL_OF), ...Object.keys(SHOWN)]).toContain(verb);
    }
    for (const heading of GROUPS) expect(await ui.find({ type: "Text", text: heading })).toBeDefined();
    for (const key of CONTROL_KEYS) expect(await ui.find({ key })).toBeDefined();
    for (const matcher of Object.values(SHOWN)) expect(await ui.find({ type: "Text", text: matcher })).toBeDefined();
    await ui.unmount();
  }
});

test("/jev deck opens the Deck tab, and a command typed elsewhere shows in it", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  await $.command.run({ command: "jev", ...ASK, args: "deck" });
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  expect(await ui.find({ type: "Text", text: "Band above the prompt" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "What the band shows" })).toBeDefined();
  expect((await ui.find({ key: "deck-size" }))?.props.value).toBe("compact");
  await $.command.run({ command: "deck", ...ASK, args: "size roomy" });
  expect((await ui.find({ key: "deck-size" }))?.props.value).toBe("roomy");
  await ui.unmount();
});

test("the band toggle, the collapsed look and the size run their /deck commands", LOCALE, async ($, on) => {
  const { saved: store, clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  await ui.press({ key: "deck-band" });
  expect(saved(store).open).toBe(true);
  expect(await ui.find({ type: "Text", text: /Deck expanded\./ })).toBeDefined();
  await clock.advance(1000);
  await ui.press({ key: "deck-band" });
  expect(saved(store).open).toBe(false);
  expect(await ui.find({ type: "Text", text: /Deck collapsed\./ })).toBeDefined();
  await ui.select({ key: "deck-look", value: "rings" });
  expect(saved(store).collapsed).toBe("rings");
  await ui.select({ key: "deck-size", value: "roomy" });
  expect(saved(store).size).toBe("roomy");
  expect(await ui.find({ type: "Text", text: /Deck is roomy/ })).toBeDefined();
  await ui.unmount();
});

test("the last reply shows under the section that owns its command, and nowhere else", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  await ui.select({ key: "deck-size", value: "roomy" });
  let tree = await ui.drawn();
  expect(leaves(sectionOf(tree, "Band above the prompt"))).toContain("Deck is roomy");
  expect(leaves(sectionOf(tree, "Panel and sample plan"))).not.toContain("Deck is roomy");
  // one reply at a time: the next command's takes its place, in its own section
  await ui.press({ key: "deck-clear" });
  tree = await ui.drawn();
  expect(leaves(sectionOf(tree, "Panel and sample plan"))).toContain("Deck rows cleared");
  expect(leaves(sectionOf(tree, "Band above the prompt"))).not.toContain("Deck rows cleared");
  expect(leaves(sectionOf(tree, "Band above the prompt"))).not.toContain("Deck is roomy");
  await ui.unmount();
});

test("a reply goes away once the settings change somewhere else", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  await ui.press({ key: "deck-band" });
  await clock.advance(1000);
  expect(await ui.find({ type: "Text", text: /Deck expanded\./ })).toBeDefined();
  expect((await ui.find({ key: "deck-band" }))?.props.label).toBe("[x] Expanded");
  // collapsed at the prompt: the button follows, and the reply that said "expanded" must not stay under it
  await $.command.run({ command: "deck", ...ASK, args: "collapse" });
  await clock.advance(1000);
  expect((await ui.find({ key: "deck-band" }))?.props.label).toBe("[ ] Collapsed");
  expect(await ui.find({ type: "Text", text: /Deck expanded\./ })).toBeUndefined();
  await ui.unmount();
});

test("the style Selects set one surface each and say so, and the picker button opens the picker without wiping the note", LOCALE, async ($, on) => {
  const { saved: store, panes } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: DESKTOP });
  await ui.press({ key: "tab-deck" });
  await ui.select({ key: "deck-style-cli", value: "dots" });
  expect(saved(store).style).toEqual({ terminal: "dots", desktop: "pixel" });
  expect(await ui.find({ type: "Text", text: /Style dots for CLI\./ })).toBeDefined();
  await ui.select({ key: "deck-style-desktop", value: "spark" });
  expect(saved(store).style).toEqual({ terminal: "dots", desktop: "spark" });
  expect(await ui.find({ type: "Text", text: /Style spark for Desktop\./ })).toBeDefined();
  expect((await ui.find({ key: "deck-style-cli" }))?.props.value).toBe("dots");
  await ui.press({ key: "deck-style-pick" });
  expect(panes).toContain("deck-style");
  expect(await ui.find({ type: "Text", text: /Style spark for Desktop\./ })).toBeDefined();
  await ui.unmount();
});

test("a toggle per section and the show-all and hide-all buttons run /deck <section> and /deck all", LOCALE, async ($, on) => {
  const { saved: store } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  await ui.press({ key: "deck-show-weather" });
  expect(saved(store).show.weather).toBe(true);
  await ui.press({ key: "deck-show-plans" });
  expect(saved(store).show.plans).toBe(false);
  await ui.press({ key: "deck-all-off" });
  expect(SECTIONS.every((id) => saved(store).show[id] === false)).toBe(true);
  await ui.press({ key: "deck-all-on" });
  expect(SECTIONS.every((id) => saved(store).show[id] === true)).toBe(true);
  for (const id of SECTIONS) expect(await ui.find({ key: `deck-show-${id}` })).toBeDefined();
  await ui.unmount();
});

test("the auto, sound, quiet and cost toggles run their commands", LOCALE, async ($, on) => {
  const { saved: store, played } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  await ui.press({ key: "deck-auto" });
  expect(saved(store).auto).toBe(false);
  await ui.press({ key: "deck-quiet" });
  expect(saved(store).quiet).toBe(false);
  await ui.press({ key: "deck-cost" });
  expect(saved(store).cost).toBe(true);
  expect(await ui.find({ type: "Text", text: /Tracking spend today and this month/ })).toBeDefined();
  await ui.press({ key: "deck-sound" });
  expect(saved(store).sound).toBe(false);
  expect(played).toHaveLength(0);
  await ui.press({ key: "deck-sound" });
  expect(saved(store).sound).toBe(true);
  expect(played.map((p) => p.asset)).toEqual(["sounds/chime.wav"]);
  await ui.unmount();
});

test("the city field keeps what is typed, looks the city up on Enter, and keeps the text when it finds none", LOCALE, async ($, on) => {
  const { saved: store, fetched, state } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  expect(await ui.find({ type: "Text", text: /No city set yet\./ })).toBeDefined();
  await ui.input({ key: "deck-city", kind: "change", text: "Lisb" });
  // a redraw must not wipe the field
  expect((await ui.find({ key: "deck-city" }))?.props.value).toBe("Lisb");
  await ui.input({ key: "deck-city", kind: "change", text: "Lisbon" });
  await ui.input({ key: "deck-city", text: "Lisbon" });
  expect(fetched.some((url) => url.startsWith("https://geocoding-api.open-meteo.com/") && url.includes("Lisbon"))).toBe(true);
  expect(saved(store).city).toMatchObject({ name: "Lisbon" });
  expect(saved(store).show.weather).toBe(true);
  expect(await ui.find({ type: "Text", text: /Weather city set to Lisbon, Portugal\./ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Now: Lisbon/ })).toBeDefined();
  // a city that is not found says so beside the field, keeps the old city, and leaves the text there to correct
  state.city = null;
  await ui.input({ key: "deck-city", text: "Lisbonn" });
  expect(await ui.find({ type: "Text", text: /No city found for "Lisbonn"\./ })).toBeDefined();
  expect(saved(store).city).toMatchObject({ name: "Lisbon" });
  expect((await ui.find({ key: "deck-city" }))?.props.value).toBe("Lisbonn");
  // an empty Enter looks nothing up
  const before = fetched.length;
  await ui.input({ key: "deck-city", text: "   " });
  expect(fetched).toHaveLength(before);
  await ui.unmount();
});

test("switching weather on with a saved city fetches the forecast at once, from the tab and from the command", LOCALE, async ($, on) => {
  const { fetched } = deckWorld(on);
  await $.session.start(SESSION);
  const forecasts = () => fetched.filter((url) => url.startsWith("https://api.open-meteo.com/v1/forecast")).length;
  await $.command.run({ command: "deck", ...ASK, args: "city Lisbon" });
  await $.command.run({ command: "deck", ...ASK, args: "weather off" });
  const start = forecasts();
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  await ui.press({ key: "deck-show-weather" });
  expect(forecasts()).toBe(start + 1);
  await ui.press({ key: "deck-all-off" });
  expect(forecasts()).toBe(start + 1);
  await ui.press({ key: "deck-all-on" });
  expect(forecasts()).toBe(start + 2);
  await $.command.run({ command: "deck", ...ASK, args: "weather off" });
  await $.command.run({ command: "deck", ...ASK, args: "weather on" });
  expect(forecasts()).toBe(start + 3);
  await ui.unmount();
});

test("the panel buttons open and close the Deck pane, and the demo and clear buttons play and remove the rows", LOCALE, async ($, on) => {
  const { panes } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  expect(await ui.find({ type: "Text", text: /Orders module/ })).toBeUndefined();
  await ui.press({ key: "deck-panel-open" });
  expect(panes).toContain("deck-panel");
  expect(await ui.find({ type: "Text", text: /Deck opened in a panel\./ })).toBeDefined();
  await ui.press({ key: "deck-panel-close" });
  expect(panes).not.toContain("deck-panel");
  expect(await ui.find({ type: "Text", text: /Deck panel closed\./ })).toBeDefined();
  await ui.press({ key: "deck-demo" });
  expect(await ui.find({ type: "Text", text: /Sample plan running above the prompt/ })).toBeDefined();
  // the status block lists the sample plan's bar
  expect(await ui.find({ type: "Text", text: /Orders module/ })).toBeDefined();
  await ui.press({ key: "deck-clear" });
  expect(await ui.find({ type: "Text", text: /Deck rows cleared\./ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Orders module/ })).toBeUndefined();
  await ui.unmount();
});

test("the status block names the version the plugin runs, as /deck version does", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: DESKTOP });
  await ui.press({ key: "tab-deck" });
  const version = (await $.command.run({ command: "deck", ...ASK, args: "version" })).text!;
  expect(await ui.find({ type: "Text", text: new RegExp("^" + escapeRe(version) + "$") })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^Showing: .* - Deck \d+\.\d+\.\d+$/m })).toBeDefined();
  await ui.unmount();
});

test("the Deck tab follows Portuguese: its labels, the commands' own help, and the replies", { options: { locale: "pt" } }, async ($, on) => {
  const { saved: store } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  expect(await ui.find({ type: "Text", text: "Faixa acima do prompt" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "O que a faixa mostra" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "Alertas e extras" })).toBeDefined();
  expect((await ui.find({ key: "deck-look" }))?.props.value).toBe(DEFAULT_SETTINGS.collapsed);
  await ui.press({ key: "deck-clear" });
  expect(await ui.find({ type: "Text", text: /Linhas do Deck removidas\./ })).toBeDefined();
  await ui.select({ key: "deck-size", value: "roomy" });
  expect(saved(store).size).toBe("roomy");
  await ui.unmount();
});

test("a Deck change redraws the Jev pane only while its Deck tab is open", { ...LOCALE, plugins: [drawCounter] }, async ($, on) => {
  const { statuses } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.find({ type: "Text" });
  // on Overview the pane never reads Deck's state: a Deck command draws it no more
  const overview = drawsOf(statuses);
  expect(overview).toBeGreaterThan(0);
  for (const args of ["size roomy", "size compact", "sound off", "sound on"]) await $.command.run({ command: "deck", ...ASK, args });
  await ui.find({ type: "Text" });
  expect(drawsOf(statuses)).toBe(overview);
  // on the Deck tab each command draws it again
  await ui.press({ key: "tab-deck" });
  const open = drawsOf(statuses);
  await $.command.run({ command: "deck", ...ASK, args: "size roomy" });
  await ui.find({ type: "Text" });
  expect(drawsOf(statuses)).toBeGreaterThan(open);
  await ui.unmount();
});

test("the Deck tab alone does not keep the band's animation redrawing", { ...LOCALE, plugins: [drawCounter] }, async ($, on) => {
  const { clock, statuses } = deckWorld(on);
  await $.session.start(SESSION);
  const ui = await $.ui.mount({ ...PANE, surface: TERMINAL });
  await ui.press({ key: "tab-deck" });
  await ui.press({ key: "deck-demo" });
  await clock.advance(1500);
  expect(drawsOf(statuses)).toBeGreaterThan(0);
  const settled = drawsOf(statuses);
  // three seconds of a running sample plan, with no band on screen: only the plan's own steps redraw
  await clock.advance(3000);
  await ui.find({ type: "Text" });
  expect(drawsOf(statuses) - settled).toBeLessThan(10);
  await ui.unmount();
});
