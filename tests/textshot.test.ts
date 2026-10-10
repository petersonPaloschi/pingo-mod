import { expect, test } from "claude-code/testing";

import { shot } from "./textshot.ts";

const el = (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children });

test("textshot lays out rows, columns and borders on a monospace grid", () => {
  const tree = el("Box", { flexDirection: "column", borderStyle: "round", width: 20 },
    el("Box", { flexDirection: "row", justifyContent: "space-between" }, el("Text", {}, "Jev"), el("Text", {}, "● on")),
    el("Text", { wrap: "truncate" }, "a line far too long to fit"),
    el("Button", { label: "Save", hotkey: "s" }));
  expect(shot(tree, 40)).toBe([
    "╭──────────────────╮",
    "│Jev           ● on│",
    "│a line far too lo…│",
    "│[ Save ] ‹s›      │",
    "╰──────────────────╯",
  ].join("\n"));
});

test("textshot wraps text by words and can mask rasters to their size", () => {
  expect(shot(el("Text", {}, "one two three four"), 9)).toBe("one two\nthree\nfour");
  const raster = el("Raster", { columns: 14, rows: 2, cells: "" });
  expect(shot(raster, 20, { rasters: "mask" })).toBe("[raster 14×2]░\n░░░░░░░░░░░░░░");
});
