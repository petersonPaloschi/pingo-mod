// The Deck's cast: nobody stands with Pingo but who is at work. Jev joins while a call of his is open, a feature while
// it is at work or has something waiting on the person, a subagent while it runs; each says what it is doing in a
// balloon, and once its task ends, well or not, it hops a goodbye and leaves. Every frame is a pure function of its
// inputs, so these checks are exact.
import { expect, test } from "claude-code/testing";

import type { AgentRun } from "../../types";
import { displayWidth } from "../../hooks/layout.ts";
import { HUE, PET_PALETTE, shadeOf, TERMINAL_DEFAULT } from "../../hooks/theme.ts";
import { balloonWords, CAST_JOIN_MS, CAST_LEAVE_MS, castColor, castKey, castLaneCells, castLaneSvg, castLayout, castOf, LANE_ROWS, MEMBER_BRAILLE, memberFrame, SPEAKER_IDS, type CastKind, type CastSpeaker, type CastState } from "../../hooks/deck/cast.ts";
import { createPet, PET_BRAILLE } from "../../hooks/deck/pet.ts";
import { pictureOf, pixelsOf, whereIs } from "./pixels.ts";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const NOBODY = { open: false } as const;

const run = (n: number, over: Partial<AgentRun> = {}): AgentRun => ({
  id: `a${n}`, n, mascot: (["tetra", "gem", "can", "coil", "cone"] as const)[(n - 1) % 5]!, type: "Explore", description: "look", prompt: "go",
  model: "claude-haiku-4-5", startedAt: NOW - 10_000, state: "running", tools: 0, requests: 0, ...over,
});

/** The lane's name row as text. */
const names = (lane: readonly (readonly [string, number, number?])[][]) => lane[0]!.map(([char]) => char).join("");

test("with nobody at work the cast is empty: Pingo stands alone", () => {
  expect(castOf([], NOBODY, NOW)).toEqual([]);
  const { slots, hidden } = castLayout([], 80);
  expect(slots.map((slot) => slot.label)).toEqual(["Pingo"]);
  expect(hidden).toBe(0);
  const top = names(castLaneCells(createPet(NOW), [], NOW, 80));
  expect(top.trim()).toBe("Pingo");
});

test("a subagent at work joins with its mascot and its type as its name, saying what it does", () => {
  const cast = castOf([run(2, { type: "Plan", description: "plan the loader" }), run(1)], NOBODY, NOW);
  expect(cast.map((m) => m.label)).toEqual(["Tetra·Explore", "Gem·Plan"]);
  expect(cast.map((m) => m.state)).toEqual(["idle", "idle"]);
  expect(cast.map((m) => [m.speaking, m.says])).toEqual([[true, "look"], [true, "plan the loader"]]);
  // a run with no description has nothing of its own to say: its name stands alone in the balloon
  expect(castOf([run(1, { description: "  " })], NOBODY, NOW)[0]).not.toHaveProperty("says");
});

test("Jev joins while a call of his is open, saying what it is about, and leaves after a goodbye when it ends", () => {
  const [asked] = castOf([], { open: true, says: "weighing 3 items for sift" }, NOW);
  expect(asked).toEqual({ id: "jev", kind: "jev", label: "Jev", state: "asking", since: 0, speaking: true, says: "weighing 3 items for sift" });
  // the spinner turns: the asked look moves on its own, the idle one keeps still
  const asking = memberFrame(asked!, NOW, 1, false);
  expect(asking).not.toEqual(memberFrame({ kind: "jev", state: "idle", since: 0 }, NOW, 1, false));
  expect(memberFrame(asked!, NOW + 300, 1, false)).not.toEqual(asking);
  // the call ended: Jev hops a quiet goodbye, happy or failed, then is gone
  const ended = (failed: boolean, at = NOW) => castOf([], { open: false, ended: { at: NOW - 200, failed } }, at);
  expect(ended(false)).toEqual([{ id: "jev", kind: "jev", label: "Jev", state: "done", since: NOW - 200 }]);
  expect(ended(true)[0]!.state).toBe("failed");
  expect(ended(false, NOW - 200 + CAST_LEAVE_MS)).toEqual([]);
  // an open call wins over the goodbye of the last one
  expect(castOf([], { open: true, ended: { at: NOW - 200, failed: true } }, NOW)[0]!.state).toBe("asking");
});

test("idle, then at work, then done: a subagent hops in, works, hops a goodbye and is gone", () => {
  // before it starts there is nobody
  expect(castOf([], NOBODY, NOW)).toEqual([]);
  // it starts: a hop in
  expect(castOf([run(1, { startedAt: NOW - 100 })], NOBODY, NOW)[0]!.state).toBe("join");
  expect(castOf([run(1, { startedAt: NOW - CAST_JOIN_MS - 1 })], NOBODY, NOW)[0]!.state).toBe("idle");
  // it ends, well or not: a quiet goodbye, no balloon, then gone
  const done = run(1, { state: "done", endedAt: NOW - 200 });
  const failed = run(2, { state: "error", endedAt: NOW - 200 });
  const leaving = castOf([done, failed], NOBODY, NOW);
  expect(leaving.map((m) => m.state)).toEqual(["done", "failed"]);
  expect(leaving.some((m) => m.speaking || m.says)).toBe(false);
  expect(castOf([done, failed], NOBODY, NOW - 200 + CAST_LEAVE_MS)).toEqual([]);
  // a finished run never comes back, however long it is kept
  expect(castOf([run(3, { state: "aborted", endedAt: NOW - 60_000 })], NOBODY, NOW)).toEqual([]);
});

test("several at work stand together, and each leaves on its own when its task ends", () => {
  const first = run(1);
  const second = run(2, { type: "Plan" });
  const speakers: CastSpeaker[] = [{ id: "farol", since: NOW - 5_000, busy: false, says: "2 assumptions to review" }];
  const all = castOf([first, second], { open: true, says: "weighing 1 item for sift" }, NOW, speakers);
  expect(all.map((m) => m.label)).toEqual(["Jev", "Farol", "Tetra·Explore", "Gem·Plan"]);
  expect(all.every((m) => m.speaking)).toBe(true);
  const lane = names(castLaneCells(createPet(NOW), all, NOW, 200));
  for (const name of ["Jev", "Farol", "Pingo", "Tetra·Explore", "Gem·Plan"]) expect(lane).toContain(name);
  // the first subagent ends: it says goodbye while the others go on, then only the others are left
  const firstDone = { ...first, state: "done" as const, endedAt: NOW };
  const after = castOf([firstDone, second], { open: true }, NOW + 100, speakers);
  expect(after.map((m) => `${m.label}:${m.state}`)).toEqual(["Jev:asking", "Farol:idle", "Tetra·Explore:done", "Gem·Plan:idle"]);
  expect(castOf([firstDone, second], { open: true }, NOW + CAST_LEAVE_MS, speakers).map((m) => m.label)).toEqual(["Jev", "Farol", "Gem·Plan"]);
  // then Jev's call ends on its own, and Farol's task too
  const farolLeft: CastSpeaker[] = [{ id: "farol", since: NOW + CAST_LEAVE_MS, busy: false, ended: "done" }];
  const later = castOf([firstDone, second], { open: false, ended: { at: NOW + CAST_LEAVE_MS, failed: false } }, NOW + CAST_LEAVE_MS + 100, farolLeft);
  expect(later.map((m) => `${m.label}:${m.state}`)).toEqual(["Jev:done", "Farol:done", "Gem·Plan:idle"]);
  expect(castOf([firstDone, second], { open: false, ended: { at: NOW + CAST_LEAVE_MS, failed: false } }, NOW + 2 * CAST_LEAVE_MS, farolLeft).map((m) => m.label)).toEqual(["Gem·Plan"]);
});

test("every member draws 8 cells by 4 rows of half blocks, the same for the same inputs, with its eyes", () => {
  const kinds: CastKind[] = ["jev", ...SPEAKER_IDS, "tetra", "gem", "can", "coil", "cone"];
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
  // the silhouettes, the eyes filled in as body
  const shapes = {
    jev: ["........", "..####..", ".######.", "########", "########", ".######.", "..dddd..", "..ssss.."],
    tetra: ["........", "...##...", "..####..", "..####..", ".######.", ".######.", "dddddddd", "..ssss.."],
    gem: ["........", ".######.", "########", ".######.", "..####..", "...##...", "...dd...", "..ssss.."],
    can: ["........", ".######.", "########", "########", "########", "########", ".dddddd.", "..ssss.."],
    coil: ["........", ".######.", "########", "...##...", ".######.", "...##...", ".dddddd.", "..ssss.."],
    cone: ["........", "...##...", ".######.", "########", ".######.", "..####..", "...dd...", "..ssss.."],
    farol: ["........", "..dddd..", "...##...", "..####..", "..####..", "..dddd..", ".dddddd.", "..ssss.."],
    vigia: ["........", ".#....#.", ".######.", "########", "########", ".######.", "..dddd..", "..ssss.."],
  } as const;
  for (const kind of Object.keys(shapes) as (keyof typeof shapes)[]) expect(picture(kind).map((row) => row.replaceAll("e", "#"))).toEqual(shapes[kind]);
  // the underside is the body's shade, and the shadow is the floor's
  expect(pixelsOf(memberFrame({ kind: "tetra", state: "idle", since: 0 }, NOW, 1, false))[6]![0]).toBe(shadeOf(castColor("tetra")));
  expect(pixelsOf(memberFrame({ kind: "tetra", state: "idle", since: 0 }, NOW, 1, false))[7]![3]).toBe(PET_PALETTE.floor);
  // the picture is not the terminal's own color (that is Pingo's alone)
  expect(pixelsOf(memberFrame({ kind: "jev", state: "idle", since: 0 }, NOW, 1, false)).flat()).not.toContain(TERMINAL_DEFAULT);
});

test("no two mascots look alike, even without color: every silhouette is its own", () => {
  const kinds: CastKind[] = ["jev", ...SPEAKER_IDS, "tetra", "gem", "can", "coil", "cone"];
  // without color a terminal draws every pixel alike and the eyes as holes: what is left is the silhouette
  const silhouette = (kind: CastKind) => pixelsOf(memberFrame({ kind, state: "idle", since: 0 }, NOW, 1, false)).map((row) => row.map((pixel) => (pixel === undefined ? "." : pixel === PET_PALETTE.eyeInk ? "o" : "#")).join("")).join("/");
  const seen = new Map<string, CastKind>();
  for (const kind of kinds) {
    const shape = silhouette(kind);
    expect(seen.get(shape)).toBeUndefined();
    seen.set(shape, kind);
  }
  // and every one has a color of its own, apart from each other's
  expect(new Set(kinds.map(castColor)).size).toBe(kinds.length);
  // the eyes always sit on the body, whatever the state: where an eye is, the body at rest is, or one row lower for
  // a body lifted in a hop
  for (const kind of kinds) {
    const rest = picture(kind).map((row) => row.replaceAll("e", "#"));
    const body = (x: number, y: number) => rest[y]?.[x] === "#";
    for (const state of ["idle", "asking", "join", "failed"] as const) {
      for (let t = 0; t < 1000; t += 100) {
        for (const at of whereIs(memberFrame({ kind, state, since: NOW }, NOW + t, 1, false), PET_PALETTE.eyeInk)) {
          const [x, y] = at.split(",").map(Number) as [number, number];
          expect(`${kind} ${state} ${at}: ${body(x, y) || body(x, y + 1)}`).toBe(`${kind} ${state} ${at}: true`);
        }
      }
    }
  }
});

test("a member's state is in its eyes: they look ahead, turn round while asked, lean in to join, and lean out when it failed", () => {
  expect(eyesOf("jev", "idle")).toEqual(["2,3", "6,3", "2,4", "6,4"]);
  expect(eyesOf("jev", "asking")).toEqual(["1,3", "5,3"]);
  expect(eyesOf("jev", "asking", NOW + 300)).not.toEqual(eyesOf("jev", "asking"));
  expect(eyesOf("jev", "join")).toEqual(["2,3", "5,3", "1,4", "6,4"]);
  expect(eyesOf("jev", "done")).toEqual(eyesOf("jev", "join"));
  expect(eyesOf("jev", "failed")).toEqual(["1,3", "6,3", "2,4", "5,4"]);
  // a narrow body has its eyes closer together, on its body
  expect(eyesOf("farol", "idle")).toEqual(["3,3", "5,3", "3,4", "5,4"]);
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
  // every shape keeps its top row free, so a hop never cuts its top off: lifted, its top row is the one under it at rest
  for (const kind of SPEAKER_IDS) {
    expect(picture(kind)[0]).toBe("........");
    expect(picture(kind, "join", NOW + 300)[0]!.replaceAll("e", "#")).toBe(picture(kind)[1]!.replaceAll("e", "#"));
  }
  for (const state of ["idle", "asking", "join", "failed"] as const) {
    for (const kind of ["jev", "coil", "cone", "farol", "lapida"] as const) {
      expect(picture(kind, state, NOW + 300, -1)).toEqual(picture(kind, state, NOW + 300, 1).map((row) => [...row].reverse().join("")));
    }
  }
});

test("the lane is a row of names over the bodies: Jev, Pingo, then the subagents, each name over its own", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1), run(2, { type: "Plan" })], { open: true }, NOW);
  const lane = castLaneCells(pet, cast, NOW, 100);
  expect(lane).toHaveLength(LANE_ROWS);
  expect(LANE_ROWS).toBe(PET_BRAILLE.rows + 1);
  for (const row of lane) expect(row).toHaveLength(100);
  const top = names(lane);
  const order = ["Jev", "Pingo", "Tetra·Explore", "Gem·Plan"].map((name) => top.indexOf(name));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("each balloon says what its member does after its name, cut to the room the lane has", () => {
  const pet = createPet(NOW);
  const cast = castOf([], { open: true, says: "weighing 3 items for sift" }, NOW, [{ id: "farol", since: NOW - 5_000, busy: false, says: "2 suposições para revisar" }]);
  const wide = names(castLaneCells(pet, cast, NOW, 120));
  expect(wide).toContain("▐Jev: weighing 3 items for sift▌");
  // accented letters are kept whole
  expect(wide).toContain("▐Farol: 2 suposições para revisar▌");
  // a narrow lane cuts the words, never the row: the names stay and an ellipsis marks the cut
  for (const columns of [40, 60]) {
    const lane = castLaneCells(pet, cast, NOW, columns);
    for (const row of lane) expect(row).toHaveLength(columns);
    const top = names(lane);
    expect(displayWidth(top)).toBe(columns);
    expect(top).toContain("Jev");
    expect(top).toContain("…");
  }
  // a balloon only too narrow for any word keeps the name alone
  expect(balloonWords({ label: "Farol", says: "2 assumptions" }, 6)).toBe("Farol");
  expect(balloonWords({ label: "Farol", says: "2 assumptions" }, 10)).toBe("Farol: 2 …");
  expect(balloonWords({ label: "Farol", says: "2 assumptions" }, 40)).toBe("Farol: 2 assumptions");
  // wide characters, which would break the lane's grid, are left out
  expect(balloonWords({ label: "Jev", says: "lendo 文件 😀 ok" }, 40)).toBe("Jev: lendo   ok");
  // and words made only of them leave the name alone, with no colon hanging after it
  expect(balloonWords({ label: "Jev", says: "😀 文件" }, 40)).toBe("Jev");
  // a long name is cut as the desktop cuts it, so the room its balloon grew to shows all it says
  expect(balloonWords({ label: "Tetra·general-purpose", says: "fix tests" }, 27)).toBe("Tetra·general-p…: fix tests");
  const long = castOf([run(1, { type: "general-purpose", description: "fix tests" })], NOBODY, NOW);
  expect(names(castLaneCells(pet, long, NOW, 120))).toContain("▐Tetra·general-p…: fix tests▌");
});

test("Pingo says what Claude is doing in his own balloon while a turn runs", () => {
  const pet = { ...createPet(NOW), speaks: true, says: "Reading register.tsx" };
  expect(names(castLaneCells(pet, [], NOW, 80))).toContain("▐Pingo: Reading register.tsx▌");
});

test("a narrow lane keeps Pingo, then Jev, and counts the members left out as +N", () => {
  const cast = castOf([run(1), run(2), run(3), run(4)], { open: true }, NOW);
  const { slots, hidden, width } = castLayout(cast, 40);
  expect(slots.map((slot) => slot.label).slice(0, 2)).toEqual(["Jev", "Pingo"]);
  expect(hidden).toBe(cast.length - (slots.length - 1));
  expect(hidden).toBeGreaterThan(0);
  expect(width + `+${hidden}`.length + 1).toBeLessThanOrEqual(40);
  expect(names(castLaneCells(createPet(NOW), cast, NOW, 40))).toContain(`+${hidden}`);
  // the narrowest lane is Pingo's own width: Pingo alone
  expect(castLayout(cast, PET_BRAILLE.columns).slots.map((slot) => slot.label)).toEqual(["Pingo"]);
  // members saying goodbye give way first
  const crowd = castOf([run(1, { state: "done", endedAt: NOW - 100 }), run(2)], NOBODY, NOW);
  expect(castLayout(crowd, PET_BRAILLE.columns + 18).slots.map((slot) => slot.label)).toEqual(["Pingo", "Gem·Explore"]);
});

test("the desktop lane draws the same group with their names, and makes a new picture only for a new cast", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1, { type: "a<b" })], NOBODY, NOW);
  const svg = castLaneSvg(pet, cast, NOW, 640, 66);
  for (const name of ["Pingo", "Tetra·a&lt;b"]) expect(svg).toContain(`>${name}</text>`);
  expect(castLaneSvg(pet, cast, NOW + 50, 640, 66)).toBe(svg);
  expect(castLaneSvg(pet, castOf([], { open: true }, NOW), NOW, 640, 66)).toContain(">Jev</text>");
  // an empty cast is Pingo alone
  expect(castLaneSvg(pet, [], NOW, 640, 66)).toContain(">Pingo</text>");
});

const speaker = (id: CastSpeaker["id"], over: Partial<CastSpeaker> = {}): CastSpeaker => ({ id, since: NOW - 10_000, busy: false, ...over });

test("a feature joins while it waits on the person or is at work, newcomers hop, and one that ended says goodbye", () => {
  const cast = castOf([run(1)], NOBODY, NOW, [speaker("clareza", { says: "a plan" }), speaker("farol", { busy: true, says: "x" }), speaker("semente", { since: NOW - 100 }), speaker("lapida", { since: NOW - 100, ended: "failed" })]);
  expect(cast.map((m) => m.label)).toEqual(["Clareza", "Farol", "Semente", "Lapida", "Tetra·Explore"]);
  expect(cast.map((m) => m.state)).toEqual(["idle", "asking", "join", "failed", "idle"]);
  expect(cast.filter((m) => m.speaking).map((m) => m.label)).toEqual(["Clareza", "Farol", "Semente", "Tetra·Explore"]);
  expect(castOf([], NOBODY, NOW - 100 + CAST_LEAVE_MS, [speaker("lapida", { since: NOW - 100, ended: "done" })])).toEqual([]);
  // speaking is part of the desktop's picture, what is said is not: the desktop's balloon holds the name alone
  expect(castKey(castOf([], NOBODY, NOW, [speaker("farol", { says: "1" })]))).toBe(castKey(castOf([], NOBODY, NOW, [speaker("farol", { says: "2" })])));
  expect(castKey(castOf([], NOBODY, NOW, [speaker("farol")]))).not.toBe(castKey(castOf([], NOBODY, NOW, [speaker("farol", { ended: "done" })])));
});

test("the features stand left of Jev and Pingo, facing them, each name in a balloon of its color", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1)], { open: true }, NOW, [speaker("clareza"), speaker("farol", { ended: "done", since: NOW - 100 })]);
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
  // a feature saying goodbye keeps a plain name
  const farol = row.indexOf("Farol");
  expect(lane[0]![farol]![2]).toBeUndefined();
  expect(lane[0]![farol]![1]).toBe(castColor("farol"));
  // and the desktop draws the balloons too
  expect(castLaneSvg(pet, cast, NOW, 900, 80)).toContain(`<rect x=`);
});

test("on a narrow lane the features give way before Jev and Pingo, counted in the +N", () => {
  const cast = castOf([run(1)], { open: true }, NOW, SPEAKER_IDS.map((id) => speaker(id, { says: "busy" })));
  const { slots, hidden, width } = castLayout(cast, 50);
  expect(slots.some((slot) => slot.label === "Pingo")).toBe(true);
  expect(slots.some((slot) => slot.label === "Jev")).toBe(true);
  expect(hidden).toBe(cast.length - 1 - slots.filter((slot) => slot.member && slot.member.kind !== "jev").length);
  expect(hidden).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(50);
  expect(names(castLaneCells(createPet(NOW), cast, NOW, 50))).toContain(`+${hidden}`);
});

test("Pingo's name takes the terminal's own color, in a stone balloon when it speaks", () => {
  const pet = createPet(NOW);
  const plain = castLaneCells(pet, [], NOW, 60);
  const at = names(plain).indexOf("Pingo");
  expect(plain[0]![at]).toEqual(["P", TERMINAL_DEFAULT]);
  const spoken = castLaneCells({ ...pet, speaks: true }, [], NOW, 60);
  const from = names(spoken).indexOf("Pingo");
  expect(spoken[0]![from - 1]).toEqual(["▐", HUE.neutral]);
  expect(spoken[0]![from]).toEqual(["P", PET_PALETTE.eyeInk, HUE.neutral]);
  expect(names(spoken)[from + "Pingo".length]).toBe("▌");
  // the body in the lane under it is Pingo's own, in the terminal's color
  expect(pixelsOf(spoken.slice(1)).flat()).toContain(TERMINAL_DEFAULT);
});
