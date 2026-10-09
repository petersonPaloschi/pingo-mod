// Braille cells, the constellation, the Pingo, and lightweight agent identities.
import { describe, expect, test } from "claude-code/testing";

import { brailleBit, brailleChar, constellation, DOT } from "../hooks/dots.ts";
import { displayWidth } from "../hooks/layout.ts";
import { brailleFrame, brailleText, eyeAt, MOODS, pingoLiveSvg, pingoSvg, type Mood } from "../hooks/mascots/pingo.ts";
import { AGENT_MASCOTS, MASCOT_ORDER, pickMascot } from "../hooks/mascots/agents.ts";

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
      for (const line of brailleText(frame).split("\n")) expect(displayWidth(line)).toBe(18);
      expect(frame.flat().some(([, color]) => color === MOODS[mood].color)).toBe(true);
      expect(brailleText(frame).trim().length > 0).toBe(true);
    }
  });

  test("terminal frames stay still within each tenth and reuse their raster cells", () => {
    const frame = brailleFrame("thinking", 1, 18, 8);
    expect(brailleFrame("thinking", 1.05, 18, 8)).toBe(frame);
    expect(brailleFrame("thinking", 1.1, 18, 8)).not.toBe(frame);
  });

  test("the eyes change shape with the mood", () => {
    expect(eyeAt("pill", 0.3, 0.1, 0)).toBe(true);
    expect(eyeAt("happy", 0.3, 0.1, 0)).toBe(false);
    expect(eyeAt("x", 0.3, 0.1, 0)).toBe(true);
    expect(eyeAt("line", 0.3, 0.3, 0)).toBe(false);
  });

  test("the desktop gets SVG circles within the character limit", () => {
    for (const mood of ALL_MOODS) {
      const svg = pingoSvg(mood, 0);
      expect(svg).toStartWith("<svg");
      expect((svg.match(/<circle /g) ?? []).length > 500).toBe(true);
      expect(svg.length).toBeLessThanOrEqual(131_072);
    }
  });

  // An eye is a few dots. A cell that holds body dots as well as the eye's color is a blob: the old sphere had up to
  // eight dots in one eye cell, and its eye-colored cells spread over the face.
  test("braille eyes take only their own few cells, without the body's dots", () => {
    const dotsIn = (char: string) => (char === " " ? 0 : [...((char.codePointAt(0)! - 0x2800).toString(2))].filter((bit) => bit === "1").length);
    for (const mood of ["routing", "failing", "idle"] as const) {
      let most = 0;
      for (let i = 0; i < 100; i++) {
        for (const [char, color] of brailleFrame(mood, i * 0.07, 18, 8).flat()) {
          if (color === MOODS[mood].color) most = Math.max(most, dotsIn(char));
        }
      }
      expect(most).toBeLessThanOrEqual(5);
    }
  });

  test("the desktop Pingo is one still source per mood, so its CSS animation is not restarted", () => {
    for (const mood of ALL_MOODS) {
      const svg = pingoLiveSvg(mood);
      expect(svg).toBe(pingoLiveSvg(mood));
      expect(svg).toContain("animation:pl-breathe");
      expect((svg.match(/<circle /g) ?? []).length > 500).toBe(true);
    }
  });
});

describe("agent identities", () => {
  test("five stable identifiers keep distinct names and colors", () => {
    expect(MASCOT_ORDER).toHaveLength(5);
    const all = MASCOT_ORDER.map((id) => AGENT_MASCOTS[id]);
    expect(new Set(all.map((agent) => agent.name)).size).toBe(5);
    expect(new Set(all.map((agent) => agent.color)).size).toBe(5);
  });

  test("a new subagent gets the first unused identifier, then cycles when full", () => {
    expect(pickMascot([], 1)).toBe("tetra");
    expect(pickMascot(["tetra"], 2)).toBe("gem");
    expect(pickMascot(["gem"], 3)).toBe("tetra");
    expect(pickMascot([...MASCOT_ORDER], 7)).toBe("gem");
  });
});
