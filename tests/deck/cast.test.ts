// The Deck's cast: Jev always beside Pingo, each subagent at work joining with its name above it and leaving once it
// ends; every frame a pure function of its inputs, so these checks are exact.
import { expect, test } from "claude-code/testing";

import type { AgentRun } from "../../types";
import { displayWidth } from "../../hooks/layout.ts";
import { HUE, PET_PALETTE, shadeOf, TERMINAL_DEFAULT } from "../../hooks/theme.ts";
import { CAST_JOIN_MS, CAST_LEAVE_MS, castColor, castKey, castLaneCells, castLaneSvg, castLayout, castOf, LANE_ROWS, MEMBER_BRAILLE, memberFrame, SPEAKER_IDS, type CastKind, type CastSpeaker, type CastState } from "../../hooks/deck/cast.ts";
import { createPet, PET_BRAILLE } from "../../hooks/deck/pet.ts";
import { pictureOf, pixelsOf, whereIs } from "./pixels.ts";

const NOW = Date.parse("2026-10-10T12:00:00Z");

const run = (n: number, over: Partial<AgentRun> = {}): AgentRun => ({
  id: `a${n}`, n, mascot: (["tetra", "gem", "can", "coil", "cone"] as const)[(n - 1) % 5]!, type: "Explore", description: "look", prompt: "go",
  model: "claude-haiku-4-5", startedAt: NOW - 10_000, state: "running", tools: 0, requests: 0, ...over,
});

/** The lane's name row as text. */
const names = (lane: readonly (readonly [string, number, number?])[][]) => lane[0]!.map(([char]) => char).join("");

test("Jev always stands first; a subagent at work joins with its mascot and its type as its name", () => {
  expect(castOf([], false, NOW)).toEqual([{ id: "jev", kind: "jev", label: "Jev", state: "idle", since: 0 }]);
  const cast = castOf([run(2, { type: "Plan" }), run(1)], false, NOW);
  expect(cast.map((m) => m.label)).toEqual(["Jev", "Tetra·Explore", "Gem·Plan"]);
  expect(cast.map((m) => m.state)).toEqual(["idle", "idle", "idle"]);
});

test("Jev's look changes while it is asked, and back when the call ends", () => {
  const [asked] = castOf([], true, NOW);
  expect(asked).toMatchObject({ state: "asking", label: "Jev ?" });
  const idle = memberFrame({ kind: "jev", state: "idle", since: 0 }, NOW, 1, false);
  const asking = memberFrame(asked!, NOW, 1, false);
  expect(asking).not.toEqual(idle);
  // the spinner turns: the asked look moves on its own, the idle one keeps still
  expect(memberFrame(asked!, NOW + 300, 1, false)).not.toEqual(asking);
});

test("a newcomer hops in, and a subagent that ended stays a moment, then leaves", () => {
  expect(castOf([run(1, { startedAt: NOW - 100 })], false, NOW)[1]!.state).toBe("join");
  expect(castOf([run(1, { startedAt: NOW - CAST_JOIN_MS - 1 })], false, NOW)[1]!.state).toBe("idle");
  const done = run(1, { state: "done", endedAt: NOW - 200 });
  const failed = run(2, { state: "error", endedAt: NOW - 200 });
  expect(castOf([done, failed], false, NOW).map((m) => m.state)).toEqual(["idle", "done", "failed"]);
  expect(castOf([done, failed], false, NOW + CAST_LEAVE_MS)).toHaveLength(1);
  // a finished run never comes back, however long it is kept
  expect(castOf([run(3, { state: "aborted", endedAt: NOW - 60_000 })], false, NOW)).toHaveLength(1);
});

test("every member draws 8 cells by 4 rows of half blocks, the same for the same inputs, with its eyes", () => {
  const kinds: CastKind[] = ["jev", "clareza", "tetra", "gem", "can", "coil", "cone"];
  const states: CastState[] = ["idle", "asking", "join", "done", "failed"];
  for (const kind of kinds) {
    for (const state of states) {
      for (const dir of [1, -1] as const) {
        const member = { kind, state, since: NOW - 300 };
        const frame = memberFrame(member, NOW, dir, false);
        expect(frame).toHaveLength(MEMBER_BRAILLE.rows);
        for (const row of frame) {
          expect(row).toHaveLength(MEMBER_BRAILLE.columns);
          expect(displayWidth(row.map(([char]) => char).join(""))).toBe(MEMBER_BRAILLE.columns);
          for (const [char] of row) expect(char).toMatch(/^[ ▀▄█]$/);
        }
        expect(memberFrame(member, NOW, dir, false)).toEqual(frame);
        // the eyes are dark details of their own, the ground of their cell: holes in the body without color
        expect(pixelsOf(frame).flat()).toContain(PET_PALETTE.eyeInk);
      }
    }
  }
});

/** A member's pixels as text: its body "#", its underside "d", its floor "s" and its eyes "e". */
const picture = (kind: CastKind, state: CastState = "idle", at = NOW, dir: 1 | -1 = 1) =>
  pictureOf(memberFrame({ kind, state, since: NOW }, at, dir, false), new Map([[castColor(kind), "#"], [shadeOf(castColor(kind)), "d"], [PET_PALETTE.floor, "s"], [PET_PALETTE.eyeInk, "e"]]));
const eyesOf = (kind: CastKind, state: CastState, at = NOW) => whereIs(memberFrame({ kind, state, since: NOW }, at, 1, false), PET_PALETTE.eyeInk);

test("each mascot has a body of its own shape, in two tones over a shadow", () => {
  // the silhouettes, the eyes filled in as body: a sphere, a triangle, a cut gem, a can, a spring, a spinning top
  const shapes = {
    jev: ["........", "..####..", ".######.", "########", "########", ".######.", "..dddd..", "..ssss.."],
    tetra: ["........", "...##...", "..####..", "..####..", ".######.", ".######.", "dddddddd", "..ssss.."],
    gem: ["........", ".######.", "########", ".######.", "..####..", "...##...", "...dd...", "..ssss.."],
    can: ["........", ".######.", "########", "########", "########", "########", ".dddddd.", "..ssss.."],
    coil: ["........", ".######.", "########", "...##...", ".######.", "...##...", ".dddddd.", "..ssss.."],
    cone: ["........", "...##...", ".######.", "########", ".######.", "..####..", "...dd...", "..ssss.."],
  } as const;
  for (const kind of Object.keys(shapes) as (keyof typeof shapes)[]) expect(picture(kind).map((row) => row.replaceAll("e", "#"))).toEqual(shapes[kind]);
  // every feature is the sphere in its own color
  expect(picture("clareza").map((row) => row.replaceAll("e", "#"))).toEqual(shapes.jev);
  expect(memberFrame({ kind: "clareza", state: "idle", since: 0 }, NOW, 1, false)).not.toEqual(memberFrame({ kind: "jev", state: "idle", since: 0 }, NOW, 1, false));
  // the underside is the body's shade, and the shadow is the floor's
  expect(pixelsOf(memberFrame({ kind: "tetra", state: "idle", since: 0 }, NOW, 1, false))[6]![0]).toBe(shadeOf(castColor("tetra")));
  expect(pixelsOf(memberFrame({ kind: "tetra", state: "idle", since: 0 }, NOW, 1, false))[7]![3]).toBe(PET_PALETTE.floor);
  // the picture is not the terminal's own color (that is Pingo's alone)
  expect(pixelsOf(memberFrame({ kind: "jev", state: "idle", since: 0 }, NOW, 1, false)).flat()).not.toContain(TERMINAL_DEFAULT);
});

test("a member's state is in its eyes: they look ahead, turn round while asked, lean in to join, and lean out when it failed", () => {
  expect(eyesOf("jev", "idle")).toEqual(["2,3", "6,3", "2,4", "6,4"]);
  expect(eyesOf("jev", "asking")).toEqual(["1,3", "5,3"]);
  expect(eyesOf("jev", "asking", NOW + 300)).not.toEqual(eyesOf("jev", "asking"));
  expect(eyesOf("jev", "join")).toEqual(["2,3", "5,3", "1,4", "6,4"]);
  expect(eyesOf("jev", "done")).toEqual(eyesOf("jev", "join"));
  expect(eyesOf("jev", "failed")).toEqual(["1,3", "6,3", "2,4", "5,4"]);
  // the eyes are the ground of their cell, so without color they are holes in the body
  expect(memberFrame({ kind: "jev", state: "idle", since: 0 }, NOW, 1, false)[1]![2]).toEqual(["▀", castColor("jev"), PET_PALETTE.eyeInk]);
  // each kind blinks at its own moment: when they are closed, the kinds are not closed together
  const blinks = (["jev", "tetra", "gem", "can", "coil", "cone"] as const).map((kind) =>
    Array.from({ length: 80 }, (_, i) => eyesOf(kind, "idle", NOW + i * 100).length === 2).join(""),
  );
  expect(blinks.every((one) => one.includes("true"))).toBe(true);
  expect(new Set(blinks).size).toBe(blinks.length);
});

test("a newcomer hops a pixel, a subagent that failed jumps about, and facing left is facing right turned round", () => {
  const rows = (state: CastState, at: number) => picture("jev", state, at);
  expect(rows("join", NOW)[1]).toBe("..####..");
  expect(rows("join", NOW + 300)[0]).toBe("..####..");
  expect(rows("failed", NOW)[1]).toBe("..####..");
  expect(rows("failed", NOW + 100)[0]).toBe("..####..");
  for (const state of ["idle", "asking", "join", "failed"] as const) {
    for (const kind of ["jev", "coil", "cone"] as const) {
      expect(picture(kind, state, NOW + 300, -1)).toEqual(picture(kind, state, NOW + 300, 1).map((row) => [...row].reverse().join("")));
    }
  }
});

test("the lane is a row of names over the bodies: Jev, Pingo, then the subagents, each name over its own", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1), run(2, { type: "Plan" })], false, NOW);
  const lane = castLaneCells(pet, cast, NOW, 100);
  expect(lane).toHaveLength(LANE_ROWS);
  expect(LANE_ROWS).toBe(PET_BRAILLE.rows + 1);
  for (const row of lane) expect(row).toHaveLength(100);
  const top = names(lane);
  const order = ["Jev", "Pingo", "Tetra·Explore", "Gem·Plan"].map((name) => top.indexOf(name));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("a narrow lane keeps Pingo, then Jev, and counts the subagents left out as +N", () => {
  const cast = castOf([run(1), run(2), run(3), run(4)], false, NOW);
  const { slots, hidden, width } = castLayout(cast, 40);
  expect(slots.map((slot) => slot.label)).toEqual(["Jev", "Pingo", "Tetra·Explore"]);
  expect(hidden).toBe(3);
  expect(width + `+${hidden}`.length + 1).toBeLessThanOrEqual(40);
  expect(names(castLaneCells(createPet(NOW), cast, NOW, 40))).toContain("+3");
  // the narrowest lane is Pingo's own width: Pingo alone
  expect(castLayout(cast, PET_BRAILLE.columns).slots.map((slot) => slot.label)).toEqual(["Pingo"]);
});

test("the desktop lane draws the same group with their names, and makes a new picture only for a new cast", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1, { type: "a<b" })], false, NOW);
  const svg = castLaneSvg(pet, cast, NOW, 640, 66);
  for (const name of ["Jev", "Pingo", "Tetra·a&lt;b"]) expect(svg).toContain(`>${name}</text>`);
  expect(castLaneSvg(pet, cast, NOW + 50, 640, 66)).toBe(svg);
  expect(castLaneSvg(pet, castOf([], true, NOW), NOW, 640, 66)).toContain(">Jev ?</text>");
});

const speaker = (id: CastSpeaker["id"], over: Partial<CastSpeaker> = {}): CastSpeaker => ({ id, since: NOW - 10_000, busy: false, speaking: false, ...over });

test("a feature with something to say joins as a sphere of its own color, at work it thinks, and newcomers hop", () => {
  const cast = castOf([run(1)], false, NOW, [speaker("clareza", { speaking: true }), speaker("farol", { busy: true }), speaker("semente", { since: NOW - 100 })]);
  expect(cast.map((m) => m.label)).toEqual(["Jev", "Clareza", "Farol", "Semente", "Tetra·Explore"]);
  expect(cast.map((m) => m.state)).toEqual(["idle", "idle", "asking", "join", "idle"]);
  expect(cast.filter((m) => m.speaking).map((m) => m.label)).toEqual(["Clareza"]);
  // every feature has a color of its own, apart from Jev's and from each other's
  const colors = SPEAKER_IDS.map(castColor);
  expect(new Set(colors).size).toBe(SPEAKER_IDS.length);
  expect(colors).not.toContain(castColor("jev"));
  // speaking or not is part of what a cast draws, so the desktop picture changes with it
  expect(castKey(castOf([], false, NOW, [speaker("farol", { speaking: true })]))).not.toBe(castKey(castOf([], false, NOW, [speaker("farol")])));
});

test("the features stand left of Jev and Pingo, facing them; the speaker's name sits in a balloon of its color", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1)], false, NOW, [speaker("clareza", { speaking: true }), speaker("farol")]);
  const { slots } = castLayout(cast, 120);
  expect(slots.map((slot) => slot.label)).toEqual(["Clareza", "Farol", "Jev", "Pingo", "Tetra·Explore"]);
  expect(slots.map((slot) => slot.dir)).toEqual([1, 1, 1, 1, -1]);
  const lane = castLaneCells(pet, cast, NOW, 120);
  const row = names(lane);
  const at = row.indexOf("Clareza");
  // the balloon: a rounded end, the name dark on the speaker's color, the other end
  expect(row[at - 1]).toBe("▐");
  expect(row[at + "Clareza".length]).toBe("▌");
  for (let i = at; i < at + "Clareza".length; i++) {
    expect(lane[0]![i]![2]).toBe(castColor("clareza"));
    expect(lane[0]![i]![1]).toBe(PET_PALETTE.eyeInk);
  }
  // a feature that is not speaking keeps a plain name
  const farol = row.indexOf("Farol");
  expect(lane[0]![farol]![2]).toBeUndefined();
  expect(lane[0]![farol]![1]).toBe(castColor("farol"));
  // and the desktop draws the balloon too
  expect(castLaneSvg(pet, cast, NOW, 900, 80)).toContain(`<rect x=`);
});

test("on a narrow lane the features give way before Jev and Pingo, counted in the +N", () => {
  const cast = castOf([run(1)], false, NOW, SPEAKER_IDS.map((id, i) => speaker(id, { speaking: i === 0 })));
  const { slots, hidden, width } = castLayout(cast, 50);
  expect(slots.some((slot) => slot.label === "Pingo")).toBe(true);
  expect(slots.some((slot) => slot.label === "Jev")).toBe(true);
  expect(hidden).toBe(cast.length - 1 - slots.filter((slot) => slot.member && slot.member.kind !== "jev").length);
  expect(hidden).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(50);
  expect(names(castLaneCells(createPet(NOW), cast, NOW, 50))).toContain(`+${hidden}`);
});

test("Pingo's name takes the terminal's own color, in a stone balloon when it speaks", () => {
  const cast = castOf([], false, NOW);
  const pet = createPet(NOW);
  const plain = castLaneCells(pet, cast, NOW, 60);
  const at = names(plain).indexOf("Pingo");
  expect(plain[0]![at]).toEqual(["P", TERMINAL_DEFAULT]);
  const spoken = castLaneCells({ ...pet, speaks: true }, cast, NOW, 60);
  const from = names(spoken).indexOf("Pingo");
  expect(spoken[0]![from - 1]).toEqual(["▐", HUE.neutral]);
  expect(spoken[0]![from]).toEqual(["P", PET_PALETTE.eyeInk, HUE.neutral]);
  expect(names(spoken)[from + "Pingo".length]).toBe("▌");
  // the body in the lane under it is Pingo's own, in the terminal's color
  expect(pixelsOf(spoken.slice(1)).flat()).toContain(TERMINAL_DEFAULT);
});
