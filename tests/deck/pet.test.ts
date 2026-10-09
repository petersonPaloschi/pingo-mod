import { expect, test } from "claude-code/testing";

import { brailleBit } from "../../hooks/dots.ts";
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

type Frame = ReturnType<typeof petFrame>;

/** How many cells differ, in char or color, between two frames of the same size. */
const changed = (a: Frame, b: Frame) => {
  const right = b.flat();
  return a.flat().filter(([char, color], i) => char !== right[i]![0] || color !== right[i]![1]).length;
};
const dots = (char: string) => (char === " " ? 0 : [...Array(8).keys()].filter((bit) => (char.codePointAt(0)! - 0x2800) & (1 << bit)).length);
const pixels = (frame: Frame) => Array.from({ length: frame.length * 4 }, (_, y) =>
  Array.from({ length: frame[0]!.length * 2 }, (_, x) => {
    const [char] = frame[y >> 2]![x >> 1]!;
    return char !== " " && ((char.codePointAt(0)! - 0x2800) & brailleBit(x & 1, y & 3)) ? 1 : 0;
  }),
);
const circles = (svg: string) => (svg.match(/<circle/g) ?? []).length;
const coloredDots = (frame: Frame, color: number) => frame.flat().reduce((sum, [char, ink]) => sum + (ink === color ? dots(char) : 0), 0);

test("a still pet is a still picture: the idle sprite changes a couple of cells a tenth of a second, not a third of them", () => {
  const steps = Array.from({ length: 30 }, (_, i) => changed(petFrame("idle", i * 100, 1), petFrame("idle", i * 100 + 100, 1)));
  expect(steps.reduce((a, b) => a + b, 0) / steps.length).toBeLessThan(4);
  expect(Math.max(...steps)).toBeLessThan(10);
  // the same instant is the same cells, and a tenth of a second is one instant
  expect(changed(petFrame("walk", 700, 1), petFrame("walk", 700, 1))).toBe(0);
  expect(changed(petFrame("walk", 700, 1), petFrame("walk", 790, 1))).toBe(0);
});

test("every act is a 12 by 4 braille frame, and the eyes show in the mood's own color", () => {
  for (const act of PET_ACTS) {
    for (const ms of [0, 300, 900, 2500]) {
      const frame = petFrame(act, ms, 1);
      expect(frame).toHaveLength(PET_BRAILLE.rows);
      for (const row of frame) {
        expect(row).toHaveLength(PET_BRAILLE.columns);
        expect(displayWidth(row.map(([char]) => char).join(""))).toBe(PET_BRAILLE.columns);
        for (const [char, color] of row) {
          expect(char).toMatch(/^[⠀-⣿ ]$/);
          expect(Number.isInteger(color) && color >= 0 && color <= 0xffffff).toBe(true);
        }
      }
    }
  }
  // the moods whose color no body gray shares: their eyes are the only cells in it
  for (const act of ["idle", "walk", "run", "jump", "sleep", "celebrate", "alert"] as const satisfies readonly PetAct[]) {
    const color = MOODS[petMoodFor(act)].color;
    expect(petFrame(act, 700, 1).flat().some(([char, ink]) => ink === color && dots(char) > 0)).toBe(true);
  }
});

test("an eye keeps its cells to itself: the cells in its color hold its dots and none of the body's", () => {
  // how many dots an act's eyes are made of, both together, with the eyes open
  const eyes = { idle: 6, walk: 12, run: 12, jump: 12, sleep: 6, celebrate: 6, alert: 10 } as const;
  for (const act of Object.keys(eyes) as (keyof typeof eyes)[]) {
    const color = MOODS[petMoodFor(act)].color;
    const inColor = petFrame(act, 700, 1).flat().filter(([, ink]) => ink === color);
    expect(inColor.reduce((sum, [char]) => sum + dots(char), 0)).toBe(eyes[act]);
  }
});

test("a thinking pet's eyes turn: the desk acts' spinners move between frames", () => {
  for (const act of ["console", "read"] as const) {
    const face = (ms: number) => petFrame(act, ms, 1).slice(1, 2);
    expect(changed(face(0), face(200))).toBeGreaterThan(0);
  }
});

test("facing left is facing right, mirrored", () => {
  for (const act of PET_ACTS) {
    for (const ms of [0, 400, 1300]) {
      const right = petFrame(act, ms, 1);
      const left = petFrame(act, ms, -1);
      expect(pixels(left)).toEqual(pixels(right).map((row) => [...row].reverse()));
      right.forEach((row, r) =>
        row.forEach(([char, color], c) => {
          const [mirrored, mirroredColor] = left[r]![PET_BRAILLE.columns - 1 - c]!;
          expect(dots(mirrored)).toBe(dots(char));
          expect(mirroredColor).toBe(color);
        }),
      );
    }
  }
});

test("every hat and the sunglasses keep their exact shape when the pet turns", () => {
  for (const hat of ["none", "tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"]) {
    const right = petFrame("walk", 500, 1, hat, true);
    const left = petFrame("walk", 500, -1, hat, true);
    expect(pixels(left)).toEqual(pixels(right).map((row) => [...row].reverse()));
    right.forEach((row, r) => row.forEach(([, color], c) => {
      expect(left[r]![PET_BRAILLE.columns - 1 - c]![1]).toBe(color);
    }));
  }
});

test("hats stay above the face in every act", () => {
  for (const act of PET_ACTS) for (const ms of [0, 300, 700, 1300]) {
    const eyeColor = MOODS[petMoodFor(act)].color;
    const plain = petFrame(act, ms, 1);
    const eyes = coloredDots(plain, eyeColor);
    for (const hat of ["tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"]) {
      const frame = petFrame(act, ms, 1, hat);
      expect(changed(frame, plain)).toBeGreaterThan(0);
      expect(coloredDots(frame, eyeColor)).toBe(eyes);
    }
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
