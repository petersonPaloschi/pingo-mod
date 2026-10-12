// Fichário, the shared identity: hues that hold on light and dark terminals and land on their own ANSI color, bracket
// meters whose ends are never misread, mascot shades, Deck rows whose state is told by a glyph, and a failed slot of the
// timeline marked by a glyph, not by color alone.
import { expect, mock, test } from "claude-code/testing";

import { rowGlyph } from "../hooks/deck/rows.ts";
import { SVG_TEXT } from "../hooks/deck/theme.ts";
import type { DeckRow } from "../hooks/deck/model.ts";
import { AGENT_MASCOT_PALETTE, bracketMeter, css, FEATURE_MASCOT_PALETTE, FONT_WEIGHT, HUE, inkOn, meter, PRISMA_GALLERY_CSS, PRISMA_GALLERY_DESIGN, shadeOf, SVG_PAINT } from "../hooks/theme.ts";
import { PANE_PROPS } from "./helpers.ts";

/** WCAG relative luminance and contrast ratio of two "#rrggbb" colors. */
function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("every hue keeps 3:1 on a dark and a light ground", () => {
  for (const [name, hue] of Object.entries(HUE)) {
    expect({ name, dark: contrast(css(hue), "#1e1e1e") >= 3 }).toEqual({ name, dark: true });
    expect({ name, light: contrast(css(hue), "#ffffff") >= 3 }).toEqual({ name, light: true });
    expect({ name, svg: contrast(SVG_PAINT.onFill, css(hue)) >= 3 }).toEqual({ name, svg: true });
  }
});

test("SVG body text stays readable on light and dark backgrounds", () => {
  expect(contrast(SVG_TEXT.body, "#1e1e1e") >= 3).toBe(true);
  expect(contrast(SVG_TEXT.body, "#ffffff") >= 3).toBe(true);
});

test("the Prisma browser gallery inherits shared brand and layout tokens", () => {
  expect(PRISMA_GALLERY_DESIGN.palette.accent).toBe(css(HUE.brand));
  expect(PRISMA_GALLERY_CSS).toContain(`minmax(${PRISMA_GALLERY_DESIGN.grid.minimumCardWidthPixels}px,1fr)`);
  expect(PRISMA_GALLERY_CSS).toContain(`font-weight:${FONT_WEIGHT.semibold}`);
  // the words on the gallery's dark keys and button, and on its chosen mix, stay readable
  const { palette } = PRISMA_GALLERY_DESIGN;
  expect(PRISMA_GALLERY_CSS).toContain(`kbd{background:${palette.ink};color:${palette.onInk}`);
  expect(PRISMA_GALLERY_CSS).toContain(`#submit{background:${palette.ink};color:${palette.onInk}}`);
  expect(contrast(palette.onInk, palette.ink) >= 4.5).toBe(true);
});

test("a meter fills whole cells, shows any share above nothing and leaves one empty short of everything", () => {
  expect(meter(0)).toEqual(["", ".........."]);
  expect(meter(1, 4)).toEqual(["####", ""]);
  expect(meter(0.45)).toEqual(["#####", "....."]);
  expect(meter(0.01)).toEqual(["#", "........."]);
  expect(meter(0.99)).toEqual(["#########", "."]);
  expect(bracketMeter(0.45)).toBe("[#####.....]");
  expect(bracketMeter(0, 4)).toBe("[....]");
  for (const share of [0, 0.03, 0.26, 0.5, 0.74, 0.99, 1, 1.4, -1, Number.NaN]) expect([...meter(share).join("")].length).toBe(10);
});

/** The ANSI color a hex lands on in a 16-color terminal, by the downsampling chalk uses (ansi-styles). */
function ansi16(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const code = 16 + 36 * Math.round((r! / 255) * 5) + 6 * Math.round((g! / 255) * 5) + Math.round((b! / 255) * 5);
  const rest = code - 16;
  const [red, green, blue] = [Math.floor(rest / 36) / 5, Math.floor((rest % 36) / 6) / 5, (rest % 6) / 5];
  return ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"][(Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red)]!;
}

test("in 16 colors the states stay apart: ok green, warn yellow, fail red, brand blue, info cyan, neutral white", () => {
  const landed = { ok: ansi16(css(HUE.ok)), warn: ansi16(css(HUE.warn)), fail: ansi16(css(HUE.fail)), brand: ansi16(css(HUE.brand)), info: ansi16(css(HUE.info)), plum: ansi16(css(HUE.plum)), neutral: ansi16(css(HUE.neutral)) };
  expect(landed).toEqual({ ok: "green", warn: "yellow", fail: "red", brand: "blue", info: "cyan", plum: "magenta", neutral: "white" });
});

test("every mascot keeps 3:1 on both grounds and has a darker shade for its underside", () => {
  for (const [name, color] of Object.entries({ ...AGENT_MASCOT_PALETTE, ...FEATURE_MASCOT_PALETTE, jev: HUE.brand })) {
    expect({ name, dark: contrast(css(color), "#1e1e1e") >= 3, light: contrast(css(color), "#ffffff") >= 3 }).toEqual({ name, dark: true, light: true });
    expect({ name, darker: luminance(css(shadeOf(color))) < luminance(css(color)) }).toEqual({ name, darker: true });
    // a balloon, a pill or a pane's head writes words on the mascot's color: its ink keeps 4.5:1
    expect({ name, ink: contrast(css(inkOn(color)), css(color)) >= 4.5 }).toEqual({ name, ink: true });
  }
  // a ground too dark for the dark ink (Code Quality's royal blue) turns it white
  expect(inkOn(FEATURE_MASCOT_PALETTE.codeQuality)).toBe(0xffffff);
});

test("a Deck row's node is its state's glyph, each state its own, and the route an arrow", () => {
  const row = (kind: DeckRow["kind"], style: DeckRow["style"] = "run") =>
    ({ id: kind, kind, style, title: "", pct: 0, marks: [], right: "", short: "", strips: null }) as DeckRow;
  const styles: DeckRow["style"][] = ["run", "ask", "hot", "done", "ok", "warn"];
  expect(new Set(styles.map((style) => rowGlyph(row("bar", style)))).size).toBe(styles.length);
  expect(styles.map((style) => rowGlyph(row("meter", style)))).toEqual(["*", "?", "!", "+", "o", "O"]);
  expect(rowGlyph(row("route"))).toBe("->");
});

test("the timeline marks a slot whose request failed with x, under the line", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  const event = {
    seq: 1,
    time: "2026-10-06T11:59:00.000Z",
    session: "s1",
    model: "claude-opus-5-5",
    tools: 30,
    mode: "hint",
    tool: "Read",
    confidence: 0.91,
    durationMs: 2100,
    usage: { input: 12000, output: 300, cached: 11000, cacheWrite: 0 },
    jev: { choice: "Read", confidence: 0.91, latencyMs: 420, inputTokens: 900 },
  };
  const failure = { ...event, seq: 2, time: "2026-10-06T11:58:00.000Z", mode: "passthrough", reason: "jev_error: timeout", tool: undefined, jev: undefined };
  mock.store(on, { events: [event, failure] });
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.id", async () => ({ value: "session-timeline" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("classic.SessionStart", () => ({}));
  await $.classic.SessionStart({ source: "clear" });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-overview" });
  expect(await ui.find({ type: "Text", text: /^ *x$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^x under the line marks a slot with a failed request/ })).toBeDefined();
  await ui.unmount();
});
