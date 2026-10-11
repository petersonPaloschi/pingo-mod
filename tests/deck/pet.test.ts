import { expect, test } from "claude-code/testing";

import { displayWidth } from "../../hooks/layout.ts";
import { MOODS, pingoSvg } from "../../hooks/mascots/pingo.ts";
import {
  PET_ACTS,
  PET_BRAILLE,
  createPet,
  petFrame,
  petLaneCells,
  petLaneColumns,
  petLaneSvg,
  petMoodFor,
  petSvgBody,
  type PetAct,
} from "../../hooks/deck/pet.ts";
import { HUE, PET_PALETTE, TERMINAL_DEFAULT } from "../../hooks/theme.ts";
import { pictureOf, pixelsOf, whereIs } from "./pixels.ts";

type Frame = ReturnType<typeof petFrame>;

const HATS = ["tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"] as const;
const PROP = PET_PALETTE.props;
const rgb = (color: string) => Number.parseInt(color.slice(1), 16);
const HALF_BLOCK = /^[ ▀▄█]$/;

/** How many cells differ, in char, color or ground, between two frames of the same size. */
const changed = (a: Frame, b: Frame) => {
  const right = b.flat();
  return a.flat().filter(([char, color, ground], i) => char !== right[i]![0] || color !== right[i]![1] || ground !== right[i]![2]).length;
};
const circles = (svg: string) => (svg.match(/<circle/g) ?? []).length;
/** How many pixels of a frame are `color`. */
const count = (frame: Frame, color: number) => pixelsOf(frame).flat().filter((pixel) => pixel === color).length;
/** Pingo's body and underside, the floor and the mood's eyes as characters, for pictures (none for eyes in the underside's own color). */
const legend = (eye?: number) => new Map<number, string>([[PET_PALETTE.body, "B"], [HUE.neutral, "n"], [PET_PALETTE.floor, "s"], ...(eye === undefined ? [] : [[eye, "e"] as [number, string]])]);

test("a still pet is a still picture: the idle sprite changes a few cells a tenth of a second, not a third of them", () => {
  const steps = Array.from({ length: 40 }, (_, i) => changed(petFrame("idle", i * 100, 1), petFrame("idle", i * 100 + 100, 1)));
  expect(steps.reduce((a, b) => a + b, 0) / steps.length).toBeLessThan(4);
  // a bob moves the whole body a pixel, twice in 3.2 s; nothing else moves
  expect(steps.filter((n) => n > 6).length).toBeLessThanOrEqual(2);
  // the same instant is the same cells, and a tenth of a second is one instant
  expect(changed(petFrame("walk", 700, 1), petFrame("walk", 700, 1))).toBe(0);
  expect(changed(petFrame("walk", 700, 1), petFrame("walk", 790, 1))).toBe(0);
});

test("every act is a 12 by 4 frame of half blocks, in colors a Raster takes", () => {
  for (const act of PET_ACTS) {
    for (const ms of [0, 300, 900, 2500]) {
      const frame = petFrame(act, ms, 1);
      expect(frame).toHaveLength(PET_BRAILLE.rows);
      for (const row of frame) {
        expect(row).toHaveLength(PET_BRAILLE.columns);
        expect(displayWidth(row.map(([char]) => char).join(""))).toBe(PET_BRAILLE.columns);
        for (const [char, color, ground] of row) {
          expect(char).toMatch(HALF_BLOCK);
          for (const ink of [color, ground]) expect(ink === undefined || (Number.isInteger(ink) && ink >= 0 && ink <= TERMINAL_DEFAULT)).toBe(true);
        }
      }
    }
  }
});

test("Pingo at rest is a body in the terminal's own color over a shade and a shadow, two rows of room above", () => {
  const frame = petFrame("idle", 1000, 1);
  expect(pictureOf(frame, legend())).toEqual([
    "............",
    "............",
    "...BBBBBB...",
    ".BBBBBBBBBB.",
    ".BnnnBBnnnB.",
    ".BBBBBBBBBB.",
    "..nnnnnnnn..",
    "...ssssss...",
  ]);
  // an eye is a detail: the ground of its cell, so without color it is a hole in the body
  expect(frame[2]![3]).toEqual(["▄", PET_PALETTE.body, HUE.neutral]);
});

test("each mood says itself by the shape of the eyes as well as their color", () => {
  const eyes = (act: PetAct, ms: number, color: number) => whereIs(petFrame(act, ms, 1), color, 3, 5);
  // happy arcs
  expect(eyes("celebrate", 0, HUE.ok)).toEqual(["3,4", "8,4", "2,5", "4,5", "7,5", "9,5"]);
  // a spinner: three lit pixels of a ring round each eye, walking round it
  expect(eyes("console", 0, HUE.brand)).toEqual(["2,3", "3,3", "4,3", "7,3", "8,3", "9,3"]);
  expect(eyes("console", 200, HUE.brand)).not.toEqual(eyes("console", 0, HUE.brand));
  // open pills looking ahead, and a flat blink
  expect(eyes("walk", 300, HUE.warn)).toEqual(["4,3", "5,3", "8,3", "9,3", "4,4", "5,4", "8,4", "9,4", "4,5", "5,5", "8,5", "9,5"]);
  expect(eyes("walk", 0, HUE.warn)).toEqual(["4,4", "5,4", "8,4", "9,4"]);
  // crosses
  expect(eyes("alert", 0, HUE.fail)).toEqual(["2,3", "4,3", "7,3", "9,3", "3,4", "8,4", "2,5", "4,5", "7,5", "9,5"]);
  // flat lines
  expect(eyes("idle", 1000, HUE.neutral)).toEqual(["2,4", "3,4", "4,4", "7,4", "8,4", "9,4"]);
  // closed, the lid below
  expect(eyes("sleep", 2000, HUE.info)).toEqual(["2,4", "4,4", "7,4", "9,4", "3,5", "8,5"]);
  // and every act's eyes wear its mood's color
  for (const act of PET_ACTS) expect(count(petFrame(act, 300, 1), MOODS[petMoodFor(act)].color)).toBeGreaterThan(0);
});

test("a failing pet shakes a pixel, and the blink and the spinner follow the clock", () => {
  const columns = (ms: number) => whereIs(petFrame("alert", ms, 1), HUE.fail, 3, 5).map((at) => Number(at.split(",")[0]));
  expect(columns(100)).toEqual(columns(0).map((x) => x + 1));
  expect(columns(200)).toEqual(columns(0));
  expect(changed(petFrame("walk", 0, 1), petFrame("walk", 300, 1))).toBeGreaterThan(0);
  expect(changed(petFrame("console", 0, 1), petFrame("console", 200, 1))).toBeGreaterThan(0);
});

test("each act draws its own scene", () => {
  const at = (act: PetAct, ms: number, x: number, y: number) => pixelsOf(petFrame(act, ms, 1))[y]![x];
  // the laptop in front: a dark base under a screen that flickers between two glows
  const laptop = pixelsOf(petFrame("console", 0, 1));
  expect(laptop[7]!.slice(1, 11)).toEqual(Array(10).fill(PROP.dark));
  for (const screen of laptop[6]!.slice(3, 9)) expect([PROP.screen, PROP.glow]).toContain(screen);
  expect(changed(petFrame("console", 0, 1), petFrame("console", 200, 1))).toBeGreaterThan(0);
  // the book: a blue cover under a left page and a right page
  const book = pixelsOf(petFrame("read", 0, 1));
  expect(book[7]!.slice(1, 11)).toEqual(Array(10).fill(PROP.blue));
  expect(book[6]!.slice(2, 10)).toEqual([...Array(4).fill(PROP.paper), ...Array(4).fill(PROP.page)]);
  // z's rise from the sleeper
  expect(at("sleep", 0, 10, 2)).toBe(HUE.info);
  expect(at("sleep", 0, 11, 1)).toBe(HUE.info);
  // the alert badge, amber with the "!" cut in it, and the confetti
  expect(whereIs(petFrame("alert", 0, 1), PROP.amber)).toEqual(["9,0", "8,1", "10,1", "9,2"]);
  expect(at("alert", 0, 9, 1)).toBe(PROP.mark);
  const confetti = pixelsOf(petFrame("celebrate", 0, 1)).flat();
  for (const color of [HUE.warn, HUE.plum, HUE.you]) expect(confetti).toContain(color);
  // a runner kicks up dust behind it, against the way it faces
  expect(at("run", 0, 0, 6)).toBe(PROP.gray);
  expect(pixelsOf(petFrame("run", 0, -1))[6]![11]).toBe(PROP.gray);
  expect(whereIs(petFrame("walk", 0, 1), PROP.gray)).toEqual([]);
  // a jump rises two rows into the room above, and its shadow narrows
  expect(pictureOf(petFrame("jump", 500, 1), legend(MOODS.passthrough.color)).filter((row, y) => y === 0 || y === 7)).toEqual(["...BBBBBB...", "....ssss...."]);
  expect(pictureOf(petFrame("walk", 0, 1), legend(MOODS.passthrough.color))[7]).toBe("...ssssss...");
});

test("facing left is facing right, turned round", () => {
  for (const act of PET_ACTS) {
    for (const ms of [0, 400, 1300]) {
      const right = pixelsOf(petFrame(act, ms, 1));
      const left = pixelsOf(petFrame(act, ms, -1));
      expect(left).toEqual(right.map((row) => [...row].reverse()));
    }
  }
});

test("a detail is a hole without color: the ground of its cell, never its glyph, and the terminal's own color is never a ground", () => {
  for (const act of PET_ACTS) {
    for (const ground of petFrame(act, 700, 1).flat().map(([, , back]) => back)) expect(ground).not.toBe(TERMINAL_DEFAULT);
  }
  // two details in one cell cut it clean through: an open eye's two lower pixels
  expect(petFrame("walk", 300, 1)[2]![4]).toEqual([" ", TERMINAL_DEFAULT, HUE.warn]);
});

test("every hat sits on the top three rows in its own colors, and the sunglasses keep the eyes lit", () => {
  const plain = petFrame("idle", 1000, 1);
  const shapes = new Set<string>();
  for (const hat of HATS) {
    const frame = petFrame("idle", 1000, 1, hat);
    const hats: Readonly<Record<string, string>> = PET_PALETTE.hats;
    const trims: Readonly<Record<string, string>> = PET_PALETTE.hatTrim;
    expect(count(frame, rgb(hats[hat]!))).toBeGreaterThan(2);
    expect(count(frame, rgb(trims[hat]!))).toBeGreaterThan(0);
    // nothing is drawn on the face: from the fourth row down it is the plain pet
    expect(pixelsOf(frame).slice(3)).toEqual(pixelsOf(plain).slice(3));
    expect(pixelsOf(frame).slice(0, 3)).not.toEqual(pixelsOf(plain).slice(0, 3));
    shapes.add(JSON.stringify(pixelsOf(frame)));
  }
  expect(shapes.size).toBe(HATS.length);
  const shaded = petFrame("idle", 1000, 1, "none", true);
  expect(count(shaded, rgb(PET_PALETTE.accents.glasses))).toBeGreaterThan(8);
  expect(count(shaded, rgb(PET_PALETTE.accents.glassesEdge))).toBe(2);
  // the eyes show through the lenses, in the mood's color
  expect(whereIs(shaded, HUE.neutral, 3, 5)).toEqual(whereIs(plain, HUE.neutral, 3, 5));
});

test("a hat keeps every pixel while the pet moves: it bobs down, and only a hop takes a row off its top", () => {
  for (const hat of HATS) {
    const hats: Readonly<Record<string, string>> = PET_PALETTE.hats;
    const color = rgb(hats[hat]!);
    const rest = count(petFrame("idle", 1000, 1, hat), color);
    for (const act of ["idle", "walk", "run", "console", "read"] as const) {
      for (let ms = 0; ms < 4000; ms += 100) expect(count(petFrame(act, ms, 1, hat), color)).toBe(rest);
    }
    // the badge and the z's are drawn over the hat's right side
    for (const act of ["sleep", "alert", "jump", "celebrate"] as const) {
      for (let ms = 0; ms < 2000; ms += 100) expect(count(petFrame(act, ms, 1, hat), color)).toBeGreaterThan(rest - 8);
    }
  }
});

test("every hat and the sunglasses keep their exact shape when the pet turns", () => {
  for (const hat of ["none", ...HATS]) {
    const right = pixelsOf(petFrame("walk", 500, 1, hat, true));
    const left = pixelsOf(petFrame("walk", 500, -1, hat, true));
    expect(left).toEqual(right.map((row) => [...row].reverse()));
  }
});

test("terminal frames reuse cells inside the same tenth and separate acts, hats, and directions", () => {
  const first = petFrame("walk", 700, 1);
  expect(petFrame("walk", 799, 1)).toBe(first);
  expect(petFrame("walk", 800, 1)).not.toBe(first);
  expect(petFrame("walk", 700, 1, "tophat")).not.toBe(first);
  expect(petFrame("walk", 700, -1)).not.toBe(first);
});

test("the terminal lane is as wide as the band less a margin, and the sprite stands where the pet has walked to", () => {
  expect(petLaneColumns(110)).toBe(108);
  expect(petLaneColumns(10)).toBe(PET_BRAILLE.columns);
  expect(petLaneColumns(900)).toBe(512);
  const pet = { ...createPet(0), act: "idle" as const, x0: 0, x1: 1, dur: 1000, start: 0 };
  const sprite = petFrame("idle", 0, 1);
  const start = petLaneCells(pet, 0, 40);
  expect(start).toHaveLength(PET_BRAILLE.rows);
  for (const row of start) expect(row).toHaveLength(40);
  expect(changed(start.map((row) => row.slice(0, 12)), sprite)).toBe(0);
  expect(start.every((row) => row.slice(12).every(([char]) => char === " "))).toBe(true);
  const end = petLaneCells(pet, 1000, 40);
  expect(changed(end.map((row) => row.slice(28)), petFrame("idle", 1000, 1))).toBe(0);
  expect(end.every((row) => row.slice(0, 28).every(([char]) => char === " "))).toBe(true);
});

test("the desktop pet is a few score of dots, and its scene is one picture for as long as it runs", () => {
  for (const act of PET_ACTS) expect(circles(petSvgBody(act))).toBeLessThan(320);
  const pet = { ...createPet(0), act: "walk" as const, x0: 0.1, x1: 0.8, dur: 20_000, id: 5, dir: 1 as const };
  const first = petLaneSvg(pet, 1000, 880, 44);
  // redraws inside the scene hand back the very same source, so the app keeps its animation going
  expect(petLaneSvg(pet, 1150, 880, 44)).toBe(first);
  expect(petLaneSvg(pet, 9000, 880, 44)).toBe(first);
  // another size, or another scene, is another picture
  expect(petLaneSvg(pet, 1150, 640, 44)).not.toBe(first);
  expect(petLaneSvg({ ...pet, id: 6, start: 9000, x0: 0.8, x1: 0.2 }, 9100, 880, 44)).not.toBe(first);
  expect(first.length).toBeLessThan(40_000);
});

test("the small sphere is made for a few dozen pixels; the dashboard's sphere is still the large one", () => {
  const small = pingoSvg("idle", 0, 34, true);
  const large = pingoSvg("idle", 0, 34);
  expect(circles(small)).toBeLessThan(400);
  expect(circles(large)).toBeGreaterThan(900);
  // a frame asked twice is the same frame
  expect(pingoSvg("thinking", 3, 96)).toBe(pingoSvg("thinking", 3, 96));
});
