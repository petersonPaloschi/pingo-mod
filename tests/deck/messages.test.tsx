// What the features and agents say above the prompt, however long or many: the features' lines take at most
// DECK_DESIGN.band.messages.maxRows rows together, a "+N" line naming the ones left out; the speech line under the
// Deck's lane stays one line; and the whole stack fits the rows the engine gives the band, the Deck taking what is left.
import type { ElementTable } from "claude-code";
import { expect, test } from "claude-code/testing";

import { renderDeck, type DeckBand, type Speech } from "../../hooks/deck/band.tsx";
import { createPet } from "../../hooks/deck/pet.ts";
import { DEFAULT_SETTINGS } from "../../hooks/deck/settings.ts";
import { displayWidth, rowsOf } from "../../hooks/layout.ts";
import { DECK_DESIGN } from "../../hooks/theme.ts";
import { stackAbove, type AboveBlock } from "../../hooks/ui.tsx";
import { render, shot } from "../textshot.ts";
import { ASK, TERMINAL, TODOS, deckWorld, spawn } from "./helpers.ts";

const WIDTHS = [40, 60, 80, 120] as const;
const MAX = DECK_DESIGN.band.messages.maxRows;
const LONG = "the reviewer found the answer hard to follow because it names the loader, the channel and the router without saying what each one does ".repeat(4);

type Element = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const element = (tag: string) => (props: Record<string, unknown>, ...children: unknown[]) => ({ type: tag, props, children: props.children ?? children });
const els = Object.fromEntries(["Box", "Text", "Button", "Select", "Input", "Raster", "Svg"].map((tag) => [tag, element(tag)])) as unknown as ElementTable;
const el = (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children });

const childrenOf = (node: Element): unknown[] => node.children ?? (Array.isArray(node.props?.children) ? (node.props.children as unknown[]) : node.props?.children === undefined ? [] : [node.props.children]);

function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node as Element, ...elements(childrenOf(node as Element))];
}

/** One line of a feature, as register.tsx draws them: its tab and its words, cut to the line. */
const line = (key: string, words: string) => el("Box", { key, flexDirection: "row", columnGap: 1, overflow: "hidden" }, el("Text", {}, "▌"), el("Text", { wrap: "truncate-end" }, words));

function block(id: string, rank: number, lines: unknown[], opened: string[]): AboveBlock {
  return { id, name: id[0]!.toUpperCase() + id.slice(1), color: 0x3d9898, rank, lines: lines as never, open: () => void opened.push(id) };
}

test("one short message is drawn as it is, on its own row", () => {
  for (const cols of WIDTHS) {
    const out = stackAbove(els, [block("farol", 2, [line("farol-line", "1 assumption to review · Farol")], [])], cols, "en");
    expect(out.length).toBe(1);
    expect(rowsOf(out, cols)).toBe(1);
    expect(render(out, cols).join("\n")).toContain("1 assumption");
  }
});

test("a long message with many details keeps to the rows, cut with … and the rest counted for its pane", async () => {
  for (const cols of WIDTHS) {
    const opened: string[] = [];
    const details = Array.from({ length: 10 }, (_, i) => line(`d${i}`, `${i + 1}. ${LONG}`));
    const out = stackAbove(els, [block("clareza", 0, [line("clareza-line", LONG), ...details], opened)], cols, "en");
    expect(rowsOf(out, cols)).toBeLessThanOrEqual(MAX);
    const drawn = render(out, cols);
    expect(drawn.length).toBeLessThanOrEqual(MAX);
    for (const row of drawn) expect(displayWidth(row.trimEnd())).toBeLessThanOrEqual(cols);
    expect(drawn[0]).toContain("…");
    // the details that did not fit are counted on a line that opens the pane, where the message is whole
    const hidden = elements(out).find((node) => node.props?.key === "clareza-hidden");
    expect(String(hidden?.props?.label)).toBe(`+${10 - (out.length - 2)} more in its pane`);
    await (hidden?.props?.onPress as () => void)();
    expect(opened).toEqual(["clareza"]);
  }
});

test("many messages at once keep to the rows: the first by rank stay where they were, the rest are named on a +N line", async () => {
  for (const cols of WIDTHS) {
    const opened: string[] = [];
    // top to bottom as above the prompt: Vigia, Sentinela, Lapida, Semente, Clareza, Farol
    const blocks = [
      block("vigia", 3, [line("vigia-line", "2 other sessions"), line("vigia-1", LONG)], opened),
      block("sentinela", 5, [line("sentinela-line", "Sessions ? 1 waiting")], opened),
      block("lapida", 4, [line("lapida-line", "Lapida · review the rewrite"), line("lapida-1", "+ named the file")], opened),
      block("semente", 1, [line("semente-line", `2 ideas fit: ${LONG}`)], opened),
      block("clareza", 0, [line("clareza-line", `✗ ${LONG}`), line("clareza-offered", "Already know: API")], opened),
      block("farol", 2, [line("farol-line", "3 assumptions to review · Farol")], opened),
    ];
    const out = stackAbove(els, blocks, cols, "en");
    expect(rowsOf(out, cols)).toBeLessThanOrEqual(MAX);
    expect(render(out, cols).length).toBeLessThanOrEqual(MAX);
    const keys = out.map((node) => String((node as Element).props?.key));
    // the two first by rank keep their first lines, in the order they stand on screen, then the line for the others
    expect(keys).toEqual(["semente-line", "clareza-line", "above-left"]);
    const left = elements(out).filter((node) => String(node.props?.key).startsWith("above-left-"));
    expect(left.length).toBeGreaterThan(0);
    expect(render(out, cols).at(-1)).toContain("+4 more:");
    for (const name of left) await (name.props?.onPress as () => void)();
    expect(opened.length).toBe(left.length);
    expect(opened.every((id) => ["farol", "vigia", "lapida", "sentinela"].includes(id))).toBe(true);
  }
});

test("a first line wider than the rows left is left out rather than pushing the stack past them", () => {
  // a line whose parts wrap to four rows at any of these widths
  const wide = el("Box", { key: "sentinela-line", flexDirection: "row", flexWrap: "wrap", columnGap: 2 }, ...Array.from({ length: 4 }, (_, i) => el("Box", { flexShrink: 0, width: 38 }, el("Text", {}, `part ${i}`))));
  const out = stackAbove(els, [block("farol", 2, [line("farol-line", "1 assumption")], []), block("sentinela", 5, [wide], [])], 40, "en");
  expect(rowsOf(out, 40)).toBeLessThanOrEqual(MAX);
  expect(out.map((node) => String((node as Element).props?.key))).toEqual(["farol-line", "above-left"]);
});

/** The collapsed Deck band with its lane and what the cast says under it. */
function speaking(cols: number, speech: Speech[]): DeckBand {
  const now = Date.parse("2026-10-07T12:00:00Z");
  return {
    rows: [],
    settings: DEFAULT_SETTINGS,
    expanded: false,
    locale: "en",
    cols,
    now,
    caches: { head: new Map(), strip: new Map() },
    routeHist: [],
    spend: { day: "2026-10-07", dayUsd: 0, month: "2026-10", monthUsd: 0 },
    extras: ["12:00:00"],
    pet: createPet(now),
    speech,
    toggle: () => undefined,
    dismiss: () => undefined,
    foldAge: null,
    features: [],
    feature: () => undefined,
  };
}

const say = (id: string, name: string, words: string): Speech => ({ id, name, color: 0x3d9898, text: words, open: () => undefined });

test("the speech line under the lane stays one line for a short message, a long one and many speakers", () => {
  const cases: [string, Speech[]][] = [
    ["short", [say("farol", "Farol", "1 assumption to review")]],
    ["long", [say("clareza", "Clareza", LONG)]],
    ["many", [say("clareza", "Clareza", LONG), say("farol", "Farol", "3 assumptions"), say("vigia", "Vigia", "a file clash"), say("pingo", "Pingo", "Reading register.tsx"), say("run-1", "Tetra·Explore", LONG), say("run-2", "Gem·Plan", LONG)]],
  ];
  for (const cols of WIDTHS) {
    for (const [name, speech] of cases) {
      const tree = renderDeck(els, speaking(cols, speech), "terminal");
      const row = elements(tree).find((node) => node.props?.key === "deck-speech");
      expect(row).toBeDefined();
      const drawn = render(row, cols);
      expect({ name, cols, rows: drawn.length }).toEqual({ name, cols, rows: 1 });
      expect(displayWidth(drawn[0]!.trimEnd())).toBeLessThanOrEqual(cols);
      // the lead's words open its pane; the "open" pill is part of the same button
      const lead = elements(row).find((node) => node.props?.key === `deck-speech-${speech[0]!.id}`);
      expect(String(lead?.props?.label)).toContain(speech[0]!.text.slice(0, 8));
      expect(drawn[0]).toContain("open");
    }
  }
});

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const NOTES = Array.from({ length: 8 }, (_, i) => `- change ${i + 1}: ${LONG.slice(0, 60)}`).join("\n");

test("messages arriving one after another never push the stack above the prompt past the engine's rows", { options: { locale: "en" }, timeoutMs: 30_000 }, async ($, on) => {
  const { clock } = deckWorld(on);
  on("model.fork", async () => ({ value: { isAnswered: true, text: `Fix the loader.\n<<<CHANGES>>>\n${NOTES}`, usage: { input_tokens: 40, output_tokens: 12 } } }) as never);
  on("prompt.read", async () => ({ value: { text: "fix loader", cursor: 0 } }) as never);
  on("prompt.fill", async () => ({ isFilled: true }) as never);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  const measure = async (step: string) => {
    for (const cols of [40, 60, 80, 100]) {
      const ui = await $.ui.mount({ ...BAND, surface: TERMINAL, props: { ...BAND.props, bodyColumns: cols } });
      // every row unfolded, so the Deck shows all it is given
      await clock.advance(2000);
      const drawn = shot(await ui.drawn(), cols, { rasters: "mask" });
      const rows = drawn.split("\n");
      if (rows.length > 20 || rows.some((row) => displayWidth(row) > cols)) throw new Error(`${step} ${cols}: ${rows.length} rows\n${drawn}`);
      await ui.unmount();
    }
  };
  await measure("quiet");
  // a short message: one assumption to review
  await $.tool.call({ tool: "mcp__jev__farol_assumption", tool_use_id: "toolu-farol-1", assumption: "The config lives in src/config.ts" } as never);
  await measure("short");
  // a long one: Lapida's rewrite with eight notes on what it changed
  await $.command.run({ command: "lapida", args: "fix loader", origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as never);
  await measure("long");
  // and more at once: another long assumption and subagents at work, each saying what it does under the lane
  await $.tool.call({ tool: "mcp__jev__farol_assumption", tool_use_id: "toolu-farol-2", assumption: LONG } as never);
  for (const name of ["Explore the auth module end to end", "Map every route the router knows", LONG]) await $.agent.spawn(spawn(name) as never).catch(() => undefined);
  await measure("many");
  // with the lane off, Farol says its assumptions on a line of its own above the prompt, with the others
  await $.command.run({ command: "deck", ...ASK, args: "pet off" });
  await measure("many, no lane");
  // the features' lines themselves (all but the last child, the Jev band and the Deck) never take more than their rows
  for (const cols of [40, 100]) {
    const ui = await $.ui.mount({ ...BAND, surface: TERMINAL, props: { ...BAND.props, bodyColumns: cols } });
    const parts = childrenOf((await ui.drawn()) as Element).flat();
    expect(parts.length).toBeGreaterThan(1);
    expect(rowsOf(parts.slice(0, -1), cols)).toBeLessThanOrEqual(MAX);
    await ui.unmount();
  }
});
