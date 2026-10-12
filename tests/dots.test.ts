// Braille cells, the constellation, the Pingo, and lightweight agent identities.
import { describe, expect, test } from "claude-code/testing";

import { brailleBit, brailleChar, constellation, DOT } from "../hooks/dots.ts";
import { eyeAt, MOODS, pingoSvg, type Mood } from "../hooks/mascots/pingo.ts";
import { AGENT_MASCOTS, MASCOT_ORDER, pickMascot } from "../hooks/mascots/agents.ts";

const ALL_MOODS = Object.keys(MOODS) as Mood[];

describe("dots", () => {
  test("a dot cell is a 2x4 grid drawn by its dots: one is '.', all eight '@', none blank", () => {
    expect(brailleChar(brailleBit(0, 0))).toBe(".");
    expect(brailleChar(brailleBit(1, 3))).toBe(".");
    expect(brailleChar(brailleBit(0, 0) | brailleBit(1, 3))).toBe(":");
    let all = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) all |= brailleBit(x, y);
    expect(brailleChar(all)).toBe("@");
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
    expect(bottom.at(-1)![0]).toContain("_");
  });
});

describe("Pingo", () => {
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
