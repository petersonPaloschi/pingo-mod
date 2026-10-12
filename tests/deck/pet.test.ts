import { expect, test } from "claude-code/testing";

import { displayWidth } from "../../hooks/layout.ts";
import { pingoSvg } from "../../hooks/mascots/pingo.ts";
import {
  PET_ACTS,
  PET_BRAILLE,
  createPet,
  petFrame,
  petLaneCells,
  petLaneColumns,
  petLaneSvg,
  petRaised,
  petSvgBody,
} from "../../hooks/deck/pet.ts";
import { isPlainInk, textOf } from "./pixels.ts";

type Frame = ReturnType<typeof petFrame>;

const HATS = ["tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"] as const;

const HAT_ROWS: Record<(typeof HATS)[number], string> = {
  tophat: "  _|####|_  ",
  party: "  .--/\\--.  ",
  crown: "  _/\\/\\/\\_  ",
  wizard: "  .-/**\\-.  ",
  cowboy: "~-.(____).-~",
  propeller: "  .-=||=-.  ",
  chef: "  .(####).  ",
  viking: " \\.------./ ",
  halo: "  .~~~~~~.  ",
  santa: "  .--==--.o ",
  nightcap: "  .-=-=-=.~ ",
};

/** How many cells differ, in char, color or ground, between two frames of the same size. */
const changed = (a: Frame, b: Frame) => {
  const right = b.flat();
  return a.flat().filter(([char, color, ground], i) => char !== right[i]![0] || color !== right[i]![1] || ground !== right[i]![2]).length;
};
const circles = (svg: string) => (svg.match(/<circle/g) ?? []).length;
const picture = (...args: Parameters<typeof petFrame>) => textOf(petFrame(...args));

test("a still pet is a still picture: the idle sprite changes nothing but a blink", () => {
  const steps = Array.from({ length: 80 }, (_, i) => changed(petFrame("idle", i * 100, 1), petFrame("idle", i * 100 + 100, 1)));
  // a blink shuts two eyes, then opens them: two cells each way, and nothing else moves
  expect(Math.max(...steps)).toBeLessThanOrEqual(2);
  expect(steps.filter((n) => n > 0).length).toBeLessThanOrEqual(6);
  // the same instant is the same cells, and a tenth of a second is one instant
  expect(changed(petFrame("walk", 700, 1), petFrame("walk", 700, 1))).toBe(0);
  expect(changed(petFrame("walk", 700, 1), petFrame("walk", 790, 1))).toBe(0);
});

test("every act is a 12 by 4 frame of plain 7-bit text in the terminal's own color", () => {
  for (const act of PET_ACTS) {
    for (const ms of [0, 300, 900, 2500]) {
      const frame = petFrame(act, ms, 1);
      expect(frame).toHaveLength(PET_BRAILLE.rows);
      expect(isPlainInk(frame)).toBe(true);
      for (const row of frame) {
        expect(row).toHaveLength(PET_BRAILLE.columns);
        expect(displayWidth(row.map(([char]) => char).join(""))).toBe(PET_BRAILLE.columns);
        for (const [char] of row) expect(char).toMatch(/^[\x20-\x7e]$/);
      }
    }
  }
});

test("Pingo at rest is the drawing of the design", () => {
  expect(picture("idle", 1000, 1)).toEqual(["  .------.  ", " /  o  o  \\ ", "|   \\__/   |", " `--------' "]);
  // blinking
  expect(picture("idle", 0, 1)[1]).toBe(" /  -  -  \\ ");
});

test("each mood says itself by its eyes and mouth", () => {
  // happy, smiling
  expect(picture("celebrate", 1000, 1)).toEqual(["  .------.  ", " /  ^  ^  \\ ", "|   \\__/   |", " `--------' "]);
  // failing: crossed eyes, a straight mouth
  expect(picture("alert", 1000, 1)).toEqual(["  .------.  ", " /  x  x  \\ ", "|    __    |", " `--------' "]);
  // asleep: closed eyes, a straight mouth, a z that comes and goes
  expect(picture("sleep", 0, 1)).toEqual(["  .------.z ", " /  -  -  \\ ", "|    __    |", " `--------' "]);
  expect(picture("sleep", 700, 1)[0]).toBe("  .------. Z");
  expect(picture("sleep", 1400, 1)[0]).toBe("  .------.z ");
  // the others have open eyes and a smile
  for (const act of ["idle", "walk", "run", "jump", "console", "read"] as const) {
    expect(picture(act, 1000, 1)[1]).toContain("o");
    expect(picture(act, 1000, 1)[2]).toBe("|   \\__/   |");
  }
});

test("Pingo looks the way it walks, and around while it thinks", () => {
  expect(picture("walk", 1000, 1)[1]).toBe(" /   o  o \\ ");
  expect(picture("walk", 1000, -1)[1]).toBe(" / o  o   \\ ");
  expect(picture("run", 1000, 1)[1]).toBe(" /   o  o \\ ");
  expect(picture("run", 1000, -1)[1]).toBe(" / o  o   \\ ");
  // thinking: left, ahead, right, ahead, 900 ms each
  const eyes = (act: "console" | "read", ms: number) => picture(act, ms, 1)[1];
  expect([300, 1200, 2100, 3000, 3900].map((ms) => eyes("console", ms))).toEqual([
    " / o  o   \\ ",
    " /  o  o  \\ ",
    " /   o  o \\ ",
    " /  o  o  \\ ",
    " / o  o   \\ ",
  ]);
  expect(eyes("read", 2100)).toBe(" /   o  o \\ ");
  // resting and jumping look ahead
  expect(picture("idle", 1000, -1)[1]).toBe(" /  o  o  \\ ");
  expect(picture("jump", 1000, 1)[1]).toBe(" /  o  o  \\ ");
});

test("a pet that turns round keeps its drawing, apart from where it looks", () => {
  for (const act of PET_ACTS) {
    if (act === "walk" || act === "run") continue;
    for (const ms of [0, 400, 1300]) expect(picture(act, ms, 1)).toEqual(picture(act, ms, -1));
  }
});

test("the scene's props have no drawing in this look, and a hop is a row up", () => {
  // the laptop, the book, the confetti, the dust and the alert badge are not drawn: the body is all there is
  for (const act of ["console", "read", "celebrate", "run", "alert"] as const) expect(picture(act, 1000, 1)).toHaveLength(4);
  // a jump and a celebration start with a hop, up a row and back every quarter second for a second (the lane draws the
  // body one row up, over its name)
  expect(PET_ACTS.filter((act) => petRaised(act, 100))).toEqual(["jump", "celebrate"]);
  expect([0, 100, 249, 250, 499, 500, 749, 750, 999, 1000, 1500].map((ms) => petRaised("celebrate", ms))).toEqual([true, true, true, false, false, true, true, false, false, false, false]);
  expect(petRaised("idle", 500)).toBe(false);
});

test("every hat is a top row on the crown, and the sunglasses cover the eyes", () => {
  const plain = picture("idle", 1000, 1);
  expect(new Set(Object.values(HAT_ROWS)).size).toBe(HATS.length);
  for (const hat of HATS) {
    const frame = picture("idle", 1000, 1, hat);
    // the hat's row replaces the crown; the face and the base are the plain pet's
    expect(frame[0]).toBe(HAT_ROWS[hat]);
    expect(frame[0]).toHaveLength(12);
    expect(frame.slice(1)).toEqual(plain.slice(1));
  }
  // an unknown hat is none
  expect(picture("idle", 1000, 1, "none")).toEqual(plain);
  expect(picture("idle", 1000, 1, "bowler")).toEqual(plain);
  // sunglasses cover the eyes whatever the look
  expect(picture("idle", 1000, 1, "none", true)).toEqual(["  .------.  ", " /[=]-[=] \\ ", "|   \\__/   |", " `--------' "]);
  expect(picture("walk", 1000, -1, "none", true)[1]).toBe(" /[=]-[=] \\ ");
  // a hat on a sleeper takes the crown from the z
  expect(picture("sleep", 0, 1, "tophat")[0]).toBe("  _|####|_  ");
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
