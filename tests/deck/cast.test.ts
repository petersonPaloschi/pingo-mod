// The Deck's cast: nobody stands with Pingo but who is at work. Jev joins while a call of his is open, a feature while
// it is at work or has something waiting on the person, a subagent while it runs; each says what it is doing in a
// balloon, and once its task ends, well or not, it hops a goodbye and leaves. Every frame is a pure function of its
// inputs, so these checks are exact.
import { expect, test } from "claude-code/testing";

import type { AgentRun } from "../../types";
import { displayWidth } from "../../hooks/layout.ts";
import { DIM_INK } from "../../hooks/mascots/pixel.ts";
import { TERMINAL_DEFAULT } from "../../hooks/theme.ts";
import { balloonWords, CAST_HOP_MS, CAST_HOP_STEP_MS, CAST_JOIN_MS, CAST_LEAVE_MS, castKey, castLaneCells, castLaneSvg, castLayout, castOf, hopRaised, LANE_ROWS, MEMBER_BRAILLE, memberFrame, SPEAKER_IDS, type CastKind, type CastSpeaker, type CastState } from "../../hooks/deck/cast.ts";
import { createPet, PET_BRAILLE } from "../../hooks/deck/pet.ts";
import { isPlainInk, textOf, whereIs } from "./pixels.ts";

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

test("a subagent at work joins with its type as its name, saying what it does", () => {
  const cast = castOf([run(2, { type: "Plan", description: "plan the loader" }), run(1)], NOBODY, NOW);
  expect(cast.map((m) => m.label)).toEqual(["Explore", "Plan"]);
  expect(cast.map((m) => m.state)).toEqual(["idle", "idle"]);
  expect(cast.map((m) => [m.speaking, m.says])).toEqual([[true, "look"], [true, "plan the loader"]]);
  // a run with no description has nothing of its own to say: its name stands alone in the balloon
  expect(castOf([run(1, { description: "  " })], NOBODY, NOW)[0]).not.toHaveProperty("says");
});

test("Jev joins while a call of his is open, saying what it is about, and leaves after a goodbye when it ends", () => {
  const [asked] = castOf([], { open: true, says: "weighing 3 items for sift" }, NOW);
  expect(asked).toEqual({ id: "jev", kind: "jev", label: "Jev", state: "asking", since: 0, speaking: true, says: "weighing 3 items for sift" });
  // the call ended: Jev hops a quiet goodbye, happy or failed, then is gone
  const ended = (failed: boolean, at = NOW) => castOf([], { open: false, ended: { at: NOW - 200, failed } }, at);
  expect(ended(false)).toEqual([{ id: "jev", kind: "jev", label: "Jev", state: "done", since: NOW - 200 }]);
  expect(ended(true)[0]!.state).toBe("failed");
  expect(ended(false, NOW - 200 + CAST_LEAVE_MS)).toEqual([]);
  // an open call wins over the goodbye of the last one
  expect(castOf([], { open: true, ended: { at: NOW - 200, failed: true } }, NOW)[0]!.state).toBe("asking");
});

test("idle, then at work, then done: a subagent joins, works, hops a goodbye and is gone", () => {
  // before it starts there is nobody
  expect(castOf([], NOBODY, NOW)).toEqual([]);
  // it starts
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
  expect(all.map((m) => m.label)).toEqual(["Jev", "Farol", "Explore", "Plan"]);
  expect(all.every((m) => m.speaking)).toBe(true);
  const lane = names(castLaneCells(createPet(NOW), all, NOW, 200));
  for (const name of ["Jev", "Farol", "Pingo", "Explore", "Plan"]) expect(lane).toContain(name);
  // the first subagent ends: it says goodbye while the others go on, then only the others are left
  const firstDone = { ...first, state: "done" as const, endedAt: NOW };
  const after = castOf([firstDone, second], { open: true }, NOW + 100, speakers);
  expect(after.map((m) => `${m.label}:${m.state}`)).toEqual(["Jev:asking", "Farol:idle", "Explore:done", "Plan:idle"]);
  expect(castOf([firstDone, second], { open: true }, NOW + CAST_LEAVE_MS, speakers).map((m) => m.label)).toEqual(["Jev", "Farol", "Plan"]);
  // then Jev's call ends on its own, and Farol's task too
  const farolLeft: CastSpeaker[] = [{ id: "farol", since: NOW + CAST_LEAVE_MS, busy: false, ended: "done" }];
  const later = castOf([firstDone, second], { open: false, ended: { at: NOW + CAST_LEAVE_MS, failed: false } }, NOW + CAST_LEAVE_MS + 100, farolLeft);
  expect(later.map((m) => `${m.label}:${m.state}`)).toEqual(["Jev:done", "Farol:done", "Plan:idle"]);
  expect(castOf([firstDone, second], { open: false, ended: { at: NOW + CAST_LEAVE_MS, failed: false } }, NOW + 2 * CAST_LEAVE_MS, farolLeft).map((m) => m.label)).toEqual(["Plan"]);
});

const KINDS: CastKind[] = ["jev", ...SPEAKER_IDS, "tetra", "gem", "can", "coil", "cone"];
const picture = (kind: CastKind, state: CastState = "idle", at = NOW) => textOf(memberFrame({ kind, state, since: NOW }, at, 1, false));

test("every member draws 8 cells by 4 rows of plain 7-bit text, the same for the same inputs, with its eyes", () => {
  const states: CastState[] = ["idle", "asking", "join", "done", "failed"];
  for (const kind of KINDS) {
    for (const state of states) {
      for (const dir of [1, -1] as const) {
        const member = { kind, state, since: NOW - 300 };
        const frame = memberFrame(member, NOW, dir, false);
        expect(frame).toHaveLength(MEMBER_BRAILLE.rows);
        for (const row of frame) {
          expect(row).toHaveLength(MEMBER_BRAILLE.columns);
          expect(displayWidth(row.map(([char]) => char).join(""))).toBe(MEMBER_BRAILLE.columns);
          for (const [char] of row) expect(char).toMatch(/^[\x20-\x7e]$/);
        }
        expect(memberFrame(member, NOW, dir, false)).toEqual(frame);
        // the drawing does not turn round to face anyone
        expect(memberFrame(member, NOW, -dir as 1 | -1, true)).toEqual(frame);
        expect(isPlainInk(frame)).toBe(true);
        // and each has two eyes
        expect(whereIs(frame, "o").length + whereIs(frame, "-").length + whereIs(frame, "^").length + whereIs(frame, "x").length).toBeGreaterThanOrEqual(2);
      }
    }
  }
});

test("each mascot is the drawing of the design, its eyes the ones of its state", () => {
  expect(picture("jev")).toEqual(["  .--.  ", " /o  o\\ ", " \\ -- / ", "  `--'  "]);
  expect(picture("farol")).toEqual([" - /\\ - ", "  |o o| ", "  |===| ", " /_____\\"]);
  expect(picture("tetra")).toEqual(["   /\\   ", "  /  \\  ", " /o  o\\ ", "/______\\"]);
  expect(picture("coil")).toEqual([" (o  o) ", "  \\/\\/  ", "  /\\/\\  ", "  \\/\\/  "]);
  expect(picture("cone")).toEqual(["   ||   ", "(o    o)", " `.  .' ", "   \\/   "]);
  expect(picture("portao")).toEqual(["========", " |o  o| ", " ||  || ", " ||  || "]);
  // eyes: happy to leave well, crossed to leave having failed
  expect(picture("jev", "done")[1]).toBe(" /^  ^\\ ");
  expect(picture("jev", "failed")[1]).toBe(" /x  x\\ ");
  expect(picture("semente", "done")[2]).toBe(" ( ^ ^ )");
  expect(picture("farol", "failed")[1]).toBe("  |x x| ");
});

test("no two mascots look alike, even without color: every drawing is its own", () => {
  const seen = new Map<string, CastKind>();
  for (const kind of KINDS) {
    const shape = picture(kind).join("/");
    expect(seen.get(shape)).toBeUndefined();
    seen.set(shape, kind);
  }
  expect(seen.size).toBe(KINDS.length);
  expect(KINDS).toHaveLength(20);
});

test("a member blinks at its own moment, and a leaver's eyes never blink", () => {
  // the left eye of each drawing, read where it sits in its row
  const eyeAt = { jev: [1, 2], tetra: [2, 2], gem: [1, 2], can: [1, 2], coil: [0, 2], cone: [1, 1] } as const;
  const kinds = Object.keys(eyeAt) as (keyof typeof eyeAt)[];
  const blinks = kinds.map((kind) => {
    const [row, col] = eyeAt[kind];
    return Array.from({ length: 80 }, (_, i) => picture(kind, "idle", NOW + i * 100)[row]![col]).join("");
  });
  // each kind closes its eyes now and then, and the kinds are not closed together
  for (const one of blinks) {
    expect(one).toContain("-");
    expect(one).toContain("o");
  }
  expect(new Set(blinks).size).toBe(blinks.length);
  // a leaver's eyes never blink: happy or crossed throughout
  for (let t = 0; t < CAST_LEAVE_MS; t += 100) {
    expect(picture("tetra", "done", NOW + t)[2]).toBe(" /^  ^\\ ");
    expect(picture("tetra", "failed", NOW + t)[2]).toBe(" /x  x\\ ");
  }
});

test("a leaver hops for a second, up a row and back every quarter second, and nobody else hops", () => {
  const member = { state: "done" as const, since: NOW };
  expect(CAST_HOP_MS).toBe(1000);
  expect(CAST_HOP_STEP_MS).toBe(250);
  const raised = [0, 100, 249, 250, 499, 500, 749, 750, 999, 1000, 1400].map((age) => hopRaised(member, NOW + age));
  expect(raised).toEqual([true, true, true, false, false, true, true, false, false, false, false]);
  expect(hopRaised({ state: "failed", since: NOW }, NOW)).toBe(true);
  for (const state of ["idle", "asking", "join"] as const) expect(hopRaised({ state, since: NOW }, NOW)).toBe(false);
  // on the lane, a raised body stands in the rows 0 to 3, over its name, which is hidden; down, in rows 1 to 4
  const pet = createPet(NOW);
  const cast = castOf([run(1, { state: "done", endedAt: NOW })], NOBODY, NOW);
  const up = castLaneCells(pet, cast, NOW, 60);
  expect(names(up)).not.toContain("Explore");
  expect(up.map((row) => row.map(([char]) => char).join("")).join("\n")).toContain(" /^  ^\\ ");
  const down = castLaneCells(pet, cast, NOW + CAST_HOP_STEP_MS, 60);
  expect(names(down)).toMatch(/(^| )Explore( |$)/);
  expect(down.map((row) => row.map(([char]) => char).join("")).join("\n")).toContain(" /^  ^\\ ");
  expect(LANE_ROWS).toBe(5);
});

test("the lane is a row of names over the bodies: Jev, Pingo, then the subagents, each name over its own", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1), run(2, { type: "Plan" })], { open: true }, NOW);
  const lane = castLaneCells(pet, cast, NOW, 100);
  expect(lane).toHaveLength(LANE_ROWS);
  expect(LANE_ROWS).toBe(PET_BRAILLE.rows + 1);
  for (const row of lane) expect(row).toHaveLength(100);
  const top = names(lane);
  const order = ["Jev", "Pingo", "Explore", "Plan"].map((name) => top.indexOf(name));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("each balloon says what its member does after its name, cut to the room the lane has", () => {
  const pet = createPet(NOW);
  const cast = castOf([], { open: true, says: "weighing 3 items for sift" }, NOW, [{ id: "farol", since: NOW - 5_000, busy: false, says: "2 suposições para revisar" }]);
  const wide = names(castLaneCells(pet, cast, NOW, 120));
  expect(wide).toContain("(Jev: weighing 3 items for sift)");
  // accented letters are kept whole
  expect(wide).toContain("(Farol: 2 suposições para revisar)");
  // a narrow lane cuts the words, never the row: the names stay and "..." marks the cut
  for (const columns of [50, 60]) {
    const lane = castLaneCells(pet, cast, NOW, columns);
    for (const row of lane) expect(row).toHaveLength(columns);
    const top = names(lane);
    expect(displayWidth(top)).toBe(columns);
    expect(top).toContain("Jev");
    expect(top).toContain("...");
  }
  // a balloon only too narrow for any word keeps the name alone
  expect(balloonWords({ label: "Farol", says: "2 assumptions" }, 6)).toBe("Farol");
  expect(balloonWords({ label: "Farol", says: "2 assumptions" }, 13)).toBe("Farol");
  expect(balloonWords({ label: "Farol", says: "2 assumptions" }, 14)).toBe("Farol: 2 as...");
  expect(balloonWords({ label: "Farol", says: "2 assumptions" }, 40)).toBe("Farol: 2 assumptions");
  // a short saying shows whole as soon as its own columns fit, even below the seven a long one needs
  expect(balloonWords({ label: "Pingo", says: "Fix CI" }, 13)).toBe("Pingo: Fix CI");
  expect(balloonWords({ label: "Portão", says: "ok" }, 10)).toBe("Portão: ok");
  expect(balloonWords({ label: "Pingo", says: "Fix CI" }, 12)).toBe("Pingo");
  // wide characters, which would break the lane's grid, are left out
  expect(balloonWords({ label: "Jev", says: "lendo 文件 😀 ok" }, 40)).toBe("Jev: lendo   ok");
  // and words made only of them leave the name alone, with no colon hanging after it
  expect(balloonWords({ label: "Jev", says: "😀 文件" }, 40)).toBe("Jev");
  // nothing but printable ASCII and letters is drawn: the middle dot and the like are left out
  expect(balloonWords({ label: "Jev", says: "a · b" }, 40)).toBe("Jev: a  b");
  expect(balloonWords({ label: "Portão", says: "ok" }, 40)).toBe("Portão: ok");
  // a long name is cut as the desktop cuts it, so the room its balloon grew to shows all it says
  expect(balloonWords({ label: "general-purpose-reviewer", says: "fix tests" }, 27)).toBe("general-purpo...: fix tests");
  const long = castOf([run(1, { type: "general-purpose-reviewer", description: "fix tests" })], NOBODY, NOW);
  expect(names(castLaneCells(pet, long, NOW, 120))).toContain("(general-purpo...: fix tests)");
});

test("Pingo says what Claude is doing in his own balloon while a turn runs", () => {
  const pet = { ...createPet(NOW), speaks: true, says: "Reading register.tsx" };
  expect(names(castLaneCells(pet, [], NOW, 80))).toContain("(Pingo: Reading register.tsx)");
});

test("a narrow lane keeps Pingo, then Jev, and counts the members left out as +N", () => {
  const cast = castOf([run(1), run(2), run(3), run(4)], { open: true }, NOW);
  const { slots, hidden, width } = castLayout(cast, 40);
  expect(slots.map((slot) => slot.label).slice(0, 2)).toEqual(["Jev", "Pingo"]);
  expect(hidden).toBe(cast.length - (slots.length - 1));
  expect(hidden).toBeGreaterThan(0);
  expect(width + `+${hidden}`.length + 1).toBeLessThanOrEqual(40);
  const lane = castLaneCells(createPet(NOW), cast, NOW, 40);
  expect(names(lane)).toContain(`+${hidden}`);
  // the +N is dim
  expect(lane[0]![names(lane).indexOf(`+${hidden}`)]).toEqual(["+", DIM_INK]);
  // the narrowest lane is Pingo's own width: Pingo alone
  expect(castLayout(cast, PET_BRAILLE.columns).slots.map((slot) => slot.label)).toEqual(["Pingo"]);
  // members saying goodbye give way first
  const crowd = castOf([run(1, { state: "done", endedAt: NOW - 100 }), run(2)], NOBODY, NOW);
  expect(castLayout(crowd, PET_BRAILLE.columns + 18).slots.map((slot) => slot.label)).toEqual(["Pingo", "Explore"]);
});

test("the desktop lane draws the same group with their names, and makes a new picture only for a new cast", () => {
  const pet = createPet(NOW);
  const cast = castOf([run(1, { type: "a<b" })], NOBODY, NOW);
  const svg = castLaneSvg(pet, cast, NOW, 640, 66);
  // the desktop keeps its own drawing: the mascot's name before the type
  for (const name of ["Pingo", "Tetra·a&lt;b"]) expect(svg).toContain(`>${name}</text>`);
  expect(castLaneSvg(pet, cast, NOW + 50, 640, 66)).toBe(svg);
  expect(castLaneSvg(pet, castOf([], { open: true }, NOW), NOW, 640, 66)).toContain(">Jev</text>");
  // an empty cast is Pingo alone
  expect(castLaneSvg(pet, [], NOW, 640, 66)).toContain(">Pingo</text>");
});

const speaker = (id: CastSpeaker["id"], over: Partial<CastSpeaker> = {}): CastSpeaker => ({ id, since: NOW - 10_000, busy: false, ...over });

test("a feature joins while it waits on the person or is at work, newcomers join, and one that ended says goodbye", () => {
  const cast = castOf([run(1)], NOBODY, NOW, [speaker("clareza", { says: "a plan" }), speaker("farol", { busy: true, says: "x" }), speaker("semente", { since: NOW - 100 }), speaker("lapida", { since: NOW - 100, ended: "failed" })]);
  expect(cast.map((m) => m.label)).toEqual(["Clareza", "Farol", "Semente", "Lapida", "Explore"]);
  expect(cast.map((m) => m.state)).toEqual(["idle", "asking", "join", "failed", "idle"]);
  expect(cast.filter((m) => m.speaking).map((m) => m.label)).toEqual(["Clareza", "Farol", "Semente", "Explore"]);
  expect(castOf([], NOBODY, NOW - 100 + CAST_LEAVE_MS, [speaker("lapida", { since: NOW - 100, ended: "done" })])).toEqual([]);
  // speaking is part of the desktop's picture, what is said is not: the desktop's balloon holds the name alone
  expect(castKey(castOf([], NOBODY, NOW, [speaker("farol", { says: "1" })]))).toBe(castKey(castOf([], NOBODY, NOW, [speaker("farol", { says: "2" })])));
  expect(castKey(castOf([], NOBODY, NOW, [speaker("farol")]))).not.toBe(castKey(castOf([], NOBODY, NOW, [speaker("farol", { ended: "done" })])));
});

test("the features stand left of Jev and Pingo, each name in a balloon, all in the terminal's own color", () => {
  const pet = createPet(NOW);
  // (Farol ended 300 ms ago: its hop is down, so its name shows)
  const cast = castOf([run(1)], { open: true }, NOW, [speaker("clareza"), speaker("farol", { ended: "done", since: NOW - 300 })]);
  const { slots } = castLayout(cast, 120);
  expect(slots.map((slot) => slot.label)).toEqual(["Clareza", "Farol", "Jev", "Pingo", "Explore"]);
  expect(slots.map((slot) => slot.dir)).toEqual([1, 1, 1, 1, -1]);
  const lane = castLaneCells(pet, cast, NOW, 120);
  const row = names(lane);
  const at = row.indexOf("Clareza");
  // the balloon: its parentheses around the name
  expect(row[at - 1]).toBe("(");
  expect(row[at + "Clareza".length]).toBe(")");
  for (let i = at - 1; i <= at + "Clareza".length; i++) expect(lane[0]![i]).toEqual([row[i], TERMINAL_DEFAULT]);
  // a feature saying goodbye keeps a plain name, with no balloon
  const farol = row.indexOf("Farol");
  expect(row[farol - 1]).toBe(" ");
  expect(lane[0]![farol]).toEqual(["F", TERMINAL_DEFAULT]);
  // no cell of the lane has a ground of its own, and the bodies are Clareza's, Jev's and the others'
  for (const cells of lane) for (const cell of cells) expect(cell[2]).toBeUndefined();
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

test("Pingo's name is dim between turns and plain in its balloon when it speaks", () => {
  const pet = createPet(NOW);
  const plain = castLaneCells(pet, [], NOW, 60);
  const at = names(plain).indexOf("Pingo");
  expect(plain[0]![at]).toEqual(["P", DIM_INK]);
  expect(names(plain)[at - 1]).toBe(" ");
  const spoken = castLaneCells({ ...pet, speaks: true }, [], NOW, 60);
  const from = names(spoken).indexOf("Pingo");
  expect(spoken[0]![from - 1]).toEqual(["(", TERMINAL_DEFAULT]);
  expect(spoken[0]![from]).toEqual(["P", TERMINAL_DEFAULT]);
  expect(spoken[0]![from + "Pingo".length]).toEqual([")", TERMINAL_DEFAULT]);
  // the body in the lane under it is Pingo's own, in the terminal's color
  expect(isPlainInk(spoken.slice(1).map((row) => row.filter(([char]) => char !== " ")))).toBe(true);
});
