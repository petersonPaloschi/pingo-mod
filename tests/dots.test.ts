// Braille cells, dot meters, the constellation, the Dice mascot, and subagent mascots.
import { describe, expect, test } from "claude-code/testing";

import { brailleBit, brailleChar, constellation, DOT, meter, rail } from "../hooks/dots.ts";
import { brailleFrame, brailleText, eyeAt, MOODS, pingoSvg, scene, type Mood } from "../hooks/mascots/pingo.ts";
import { cube, DICE, diceFrame, diceSvg, faceAt } from "../hooks/mascots/dice.ts";
import { AGENT_MASCOTS, MASCOT_ORDER, mascotFrame, mascotScene, mascotSvg, pickMascot } from "../hooks/mascots/agents.ts";

const ALL_MOODS = Object.keys(MOODS) as Mood[];

describe("dots", () => {
  test("a braille cell is a 2×4 grid: dot (0,0) is ⠁, a full cell is ⣿", () => {
    expect(brailleChar(brailleBit(0, 0))).toBe("⠁");
    expect(brailleChar(brailleBit(1, 3))).toBe("⢀");
    let all = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) all |= brailleBit(x, y);
    expect(brailleChar(all)).toBe("⣿");
    expect(brailleChar(0)).toBe(" ");
  });

  test("the meter gives one full dot per 0.1, the rail one per tenth of the share", () => {
    expect(meter(0.86)).toEqual(["⣿".repeat(9), "⣀"]);
    expect(meter(undefined, 5)).toEqual(["", "⣀".repeat(5)]);
    expect(rail(7, 10)).toEqual(["●".repeat(7), "○".repeat(3)]);
    expect(rail(0, 0)).toEqual(["", "○".repeat(10)]);
  });

  test("the constellation keeps the higher-priority color and draws a ground line", () => {
    const rows = constellation(
      [
        { x: 0, y: 0, color: DOT.dim, priority: 0 },
        { x: 0, y: 0, color: DOT.fail, priority: 2 },
      ],
      4,
      2,
    );
    expect(rows).toHaveLength(2);
    const bottom = rows[1]!;
    expect(bottom[0]![1]).toBe(DOT.fail);
    expect(bottom.map(([text]) => text).join("")).toHaveLength(4);
    expect(bottom.at(-1)![0]).toContain("⠤");
  });
});

describe("Pingo", () => {
  test("every mood draws a frame with its eyes in the mood's color", () => {
    for (const mood of ALL_MOODS) {
      const frame = brailleFrame(mood, 1, 18, 8);
      expect(frame).toHaveLength(8);
      for (const row of frame) expect(row).toHaveLength(18);
      expect(frame.flat().some(([, color]) => color === MOODS[mood].color)).toBe(true);
      expect(brailleText(frame).trim().length > 0).toBe(true);
    }
  });

  test("the same moment draws the same frame", () => {
    expect(brailleText(brailleFrame("failing", 3.3, 14, 6))).toBe(brailleText(brailleFrame("failing", 3.3, 14, 6)));
  });

  test("the eyes change shape with the mood", () => {
    expect(eyeAt("pill", 0.3, 0.1, 0)).toBe(true);
    expect(eyeAt("happy", 0.3, 0.1, 0)).toBe(false);
    expect(eyeAt("x", 0.3, 0.1, 0)).toBe(true);
    expect(eyeAt("line", 0.3, 0.3, 0)).toBe(false);
  });

  test("only thinking has the orbit ring and the scene is sorted far to near", () => {
    expect(scene("thinking", 0).some((dot) => dot.kind === "ring")).toBe(true);
    expect(scene("routing", 0).some((dot) => dot.kind === "ring")).toBe(false);
    const dots = scene("idle", 2);
    expect(dots.every((dot, i) => i === 0 || dots[i - 1]!.z <= dot.z)).toBe(true);
  });

  test("the desktop gets SVG circles within the character limit", () => {
    for (const mood of ALL_MOODS) {
      const svg = pingoSvg(mood, 0);
      expect(svg).toStartWith("<svg");
      expect((svg.match(/<circle /g) ?? []).length > 500).toBe(true);
      expect(svg.length).toBeLessThanOrEqual(131_072);
    }
  });
});

describe("Dice mascot", () => {
  test("draws a frame of the size asked, with the face in your color", () => {
    for (const [columns, rows] of [[14, 6], [10, 4]] as const) {
      for (const t of [0, 1.7, 4.2]) {
        const frame = diceFrame(t, columns, rows);
        expect(frame).toHaveLength(rows);
        for (const row of frame) expect(row).toHaveLength(columns);
        expect(frame.flat().some(([, color]) => color === DICE.color)).toBe(true);
      }
    }
  });

  test("the same moment draws the same frame", () => {
    expect(diceFrame(2.5, 14, 6)).toEqual(diceFrame(2.5, 14, 6));
  });

  test("the face has two eyes and a smile, and nothing in the middle", () => {
    expect(faceAt(-0.4, 0.25)).toBe(true);
    expect(faceAt(0.4, 0.25)).toBe(true);
    expect(faceAt(0, -0.47)).toBe(true);
    expect(faceAt(0, 0.25)).toBe(false);
    // A blink closes the eyes down to a sliver.
    expect(faceAt(-0.4, 0.4, 0)).toBe(false);
  });

  test("only the sides facing the camera are drawn, sorted far to near", () => {
    const dots = cube(1);
    expect(dots.some((dot) => dot.kind === "face")).toBe(true);
    expect(dots.every((dot, i) => i === 0 || dots[i - 1]!.z <= dot.z)).toBe(true);
    // Only the edges of sides facing the camera: nine of the twelve at most.
    expect(dots.filter((dot) => dot.kind === "edge").length <= 9 * 40).toBe(true);
  });

  test("the desktop gets SVG circles within the Svg character limit", () => {
    const svg = diceSvg(0);
    expect(svg).toStartWith("<svg");
    expect(svg.length).toBeLessThanOrEqual(131_072);
  });
});

describe("the subagents' mascots", () => {
  test("five mascots, each with its own name, face and color", () => {
    expect(MASCOT_ORDER).toHaveLength(5);
    const all = MASCOT_ORDER.map((id) => AGENT_MASCOTS[id]);
    for (const key of ["name", "face", "color"] as const) expect(new Set(all.map((mascot) => mascot[key])).size).toBe(5);
    // A face is five characters: the width the live log's gutter keeps for one.
    for (const mascot of all) expect([...mascot.face]).toHaveLength(5);
  });

  test("each draws a frame of the size asked, with its face in its color, the same at the same moment", () => {
    for (const id of MASCOT_ORDER) {
      for (const [columns, rows] of [[14, 6], [10, 4]] as const) {
        const frame = mascotFrame(id, 1.3, columns, rows);
        expect(frame).toHaveLength(rows);
        for (const row of frame) expect(row).toHaveLength(columns);
        expect(frame.flat().some(([, color]) => color === AGENT_MASCOTS[id].color)).toBe(true);
      }
      expect(mascotFrame(id, 4.2, 14, 6)).toEqual(mascotFrame(id, 4.2, 14, 6));
    }
  });

  test("only the sides facing the camera are drawn: a solid, not a see-through cage", () => {
    for (const id of MASCOT_ORDER) {
      const body = mascotScene(id, 0.7).filter((dot) => dot.kind === "body");
      expect(body.length > 0 && body.length < AGENT_MASCOTS[id].model.length).toBe(true);
    }
  });

  test("a new subagent gets the first mascot no running one wears, else the next in turn", () => {
    expect(pickMascot([], 1)).toBe("tetra");
    expect(pickMascot(["tetra"], 2)).toBe("gem");
    expect(pickMascot(["gem"], 3)).toBe("tetra");
    expect(pickMascot([...MASCOT_ORDER], 7)).toBe("gem");
  });

  test("the desktop gets SVG circles within the Svg character limit", () => {
    for (const id of MASCOT_ORDER) {
      const svg = mascotSvg(id, 0);
      expect(svg).toStartWith("<svg");
      expect(svg.length).toBeLessThanOrEqual(131_072);
    }
  });
});
