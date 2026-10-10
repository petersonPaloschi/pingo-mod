// Trilha, the shared identity: hues that hold on light and dark terminals, dot meters that fill by halves, Deck rows
// whose node tells their state by a glyph, and a failed slot of the timeline marked by a glyph, not by color alone.
import { expect, mock, test } from "claude-code/testing";

import { rowGlyph } from "../hooks/deck/rows.ts";
import { SVG_TEXT } from "../hooks/deck/theme.ts";
import type { DeckRow } from "../hooks/deck/model.ts";
import { css, dotMeter, FONT_WEIGHT, HUE, PAINT, PRISMA_GALLERY_CSS, PRISMA_GALLERY_DESIGN, SVG_PAINT } from "../hooks/theme.ts";
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

test("every hue keeps 3:1 on a dark and a light terminal, and the ink on it keeps 4.7:1", () => {
  for (const [name, hue] of Object.entries(HUE)) {
    expect({ name, dark: contrast(css(hue), "#1e1e1e") >= 3 }).toEqual({ name, dark: true });
    expect({ name, light: contrast(css(hue), "#ffffff") >= 3 }).toEqual({ name, light: true });
    expect({ name, svg: contrast(SVG_PAINT.onFill, css(hue)) >= 3 }).toEqual({ name, svg: true });
    expect({ name, ink: contrast(PAINT.onFill, css(hue)) >= 4.7 }).toEqual({ name, ink: true });
  }
});

test("SVG body text stays readable on light and dark backgrounds", () => {
  expect(contrast(SVG_TEXT.body, "#1e1e1e") >= 3).toBe(true);
  expect(contrast(SVG_TEXT.body, "#ffffff") >= 3).toBe(true);
});

test("the Prisma browser gallery inherits shared brand and layout tokens", () => {
  expect(PRISMA_GALLERY_DESIGN.palette.accent).toBe(css(HUE.brand));
  expect(PRISMA_GALLERY_DESIGN.palette.inverse).toBe(PAINT.onFill);
  expect(PRISMA_GALLERY_CSS).toContain(`minmax(${PRISMA_GALLERY_DESIGN.grid.minimumCardWidthPixels}px,1fr)`);
  expect(PRISMA_GALLERY_CSS).toContain(`font-weight:${FONT_WEIGHT.semibold}`);
});

test("a dot meter fills by halves and always keeps its length", () => {
  expect(dotMeter(0)).toEqual(["", "○○○○○○○○○○"]);
  expect(dotMeter(1, 4)).toEqual(["●●●●", ""]);
  expect(dotMeter(0.45)).toEqual(["●●●●◐", "○○○○○"]);
  expect(dotMeter(0.12)).toEqual(["●", "○○○○○○○○○"]);
  for (const share of [0, 0.03, 0.26, 0.5, 0.74, 0.99, 1, 1.4, -1]) expect([...dotMeter(share).join("")].length).toBe(10);
});

test("a Deck row's node is its state's glyph, each state its own, and the route an arrow", () => {
  const row = (kind: DeckRow["kind"], style: DeckRow["style"] = "run") =>
    ({ id: kind, kind, style, title: "", pct: 0, marks: [], right: "", short: "", strips: null }) as DeckRow;
  const styles: DeckRow["style"][] = ["run", "ask", "hot", "done", "ok", "warn"];
  expect(new Set(styles.map((style) => rowGlyph(row("bar", style)))).size).toBe(styles.length);
  expect(styles.map((style) => rowGlyph(row("meter", style)))).toEqual(["●", "?", "!", "✓", "◔", "◑"]);
  expect(rowGlyph(row("route"))).toBe("→");
});

test("the timeline marks a slot whose request failed with ×, under the line", async ($, on) => {
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
  expect(await ui.find({ type: "Text", text: /^ *×$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^× under the line marks a slot with a failed request/ })).toBeDefined();
  await ui.unmount();
});
