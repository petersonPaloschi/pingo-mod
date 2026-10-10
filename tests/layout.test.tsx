// Pane content stays measurable so the host can scroll it with the wheel and keys.
import type { RenderPropsOf } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import { rowsOf } from "../hooks/layout.ts";
import { PINGO_FACE } from "./helpers.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const props = (bodyRows: number) =>
  ({ title: "Jev", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows } }) as unknown as RenderPropsOf["Pane"];

test("rows are estimated the way the terminal lays them out", () => {
  const text = (children: string, extra: Record<string, unknown> = {}) => ({ type: "Text", props: extra, children: [children] });
  const column = { type: "Box", props: { flexDirection: "column", rowGap: 1 }, children: [text("one"), text("two")] };
  expect(rowsOf(column, 40)).toBe(3);
  // A long text wraps at the width it has; a truncated one does not.
  expect(rowsOf(text("x".repeat(100)), 40)).toBe(3);
  expect(rowsOf(text("x".repeat(100), { wrap: "truncate" }), 40)).toBe(1);
  // A row is as tall as its tallest child.
  expect(rowsOf({ type: "Box", props: { flexDirection: "row" }, children: [{ type: "Raster", props: { rows: 6, columns: 14 } }, column] }, 60)).toBe(6);
});

test("plain navigation and selects reserve their actual columns when rows wrap", () => {
  const nav = { type: "Box", props: { flexDirection: "row", flexWrap: "wrap", columnGap: 1 }, children: [
    { type: "Button", props: { label: "Overview", hotkey: "1", plain: true } },
    { type: "Button", props: { label: "Live", hotkey: "2", plain: true } },
  ] };
  expect(rowsOf(nav, 19)).toBe(1);
  expect(rowsOf(nav, 18)).toBe(2);
  const selects = { ...nav, children: [
    { type: "Select", props: { label: "Style", value: "simple", options: [{ value: "simple", label: "Simple" }] } },
    { type: "Select", props: { label: "Scope", value: "all", options: [{ value: "all", label: "All" }] } },
  ] };
  expect(rowsOf(selects, 28)).toBe(1);
  expect(rowsOf(selects, 27)).toBe(2);
});

test("the terminal exposes overflowing content to the host's native pane scroll", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: props(14) });
  for (const tab of ["tab-deck", "tab-features", "tab-ai", "tab-configuration"]) {
    await ui.press({ key: tab });
    const root = (await ui.drawn()) as { props?: Record<string, unknown> };
    expect(root.props?.height).toBeUndefined();
    expect(root.props?.overflow).toBeUndefined();
    expect(rowsOf(root, 80)).toBeGreaterThan(14);
  }
  // The engine sees the whole tree, including fields beyond the visible window.
  expect(await ui.find({ type: "Text", text: /^jev · / })).toBeDefined();
  expect(await ui.find({ type: "Button", key: "tab-configuration" } as never)).toBeDefined();
  expect(await ui.find({ key: "clear" })).toBeDefined();
  await ui.unmount();
});

test("the live tab keeps Pingo and the run sequence above its log", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: props(30) });
  await ui.press({ key: "tab-live" });
  expect(await ui.find({ type: "Text", text: PINGO_FACE })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Nothing yet/ })).toBeDefined();
  await ui.unmount();
});

test("the desktop app draws the pane in the flow, with no fixed height", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "desktop", component: "Pane", requestId: "jev", props: props(24) });
  const root = (await ui.drawn()) as { props?: Record<string, unknown> };
  expect(root.props?.height).toBeUndefined();
  await ui.unmount();
});
