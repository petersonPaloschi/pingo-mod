// The fixed header: the pane is drawn exactly as tall as its room and scrolls its body itself.
import type { RenderPropsOf } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import { rowsOf } from "../hooks/layout.ts";

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

test("on the terminal the pane is exactly its room tall, header on top, body scrolled by the mod", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: props(14) });
  await ui.press({ key: "tab-configuration" });
  const root = (await ui.drawn()) as { props?: Record<string, unknown> };
  expect(root.props?.height).toBe(14);
  expect(root.props?.overflow).toBe("hidden");
  // The header and the tabs are drawn, and the body too long for the room says there is more below.
  expect(await ui.find({ type: "Text", text: /⠿ jev/ })).toBeDefined();
  expect(await ui.find({ type: "Button", key: "tab-configuration" } as never)).toBeDefined();
  expect(await ui.find({ type: "Text", text: /▼ 0% · scroll for more/ })).toBeDefined();
  await ui.unmount();
});

test("the live tab keeps Pingo and the run sequence above its log", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: props(30) });
  await ui.press({ key: "tab-live" });
  expect(await ui.find({ type: "Raster", key: "pingo" } as never)).toBeDefined();
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
