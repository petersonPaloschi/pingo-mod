// The lane says who is at work: Pingo speaks for Claude's own turn (what it is doing now) and sleeps once Claude has
// been idle a while; a feature at work says so too, and goes quiet when it is done.
import { expect, test, type Engine } from "claude-code/testing";

import { DEFAULT_FEATURES } from "../../hooks/core/plan.ts";
import { petLaneColumns } from "../../hooks/deck/pet.ts";
import { DESKTOP, TERMINAL, deckWorld } from "./helpers.ts";

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const LOCALE = { options: { locale: "en" } } as const;
const COLUMNS = petLaneColumns(110);
const PINGO_ONLY = { ...DEFAULT_FEATURES, farol: false, clareza: false, prisma: false, semente: false, lapida: false, sentinela: false, vigia: false, contexto: false, codeQuality: false };
const LAPIDA_ONLY = { ...PINGO_ONLY, lapida: true };

/** The name row of a lane's cells: each cell's character and its ground (a balloon's color, else none). */
function nameRow(cells: unknown): { text: string; grounds: number[] } {
  const bytes = Uint8Array.from(atob(String(cells)), (char) => char.charCodeAt(0));
  const numbers = new Uint32Array(bytes.buffer);
  let text = "";
  const grounds: number[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    text += String.fromCodePoint(numbers[i * 3]!);
    grounds.push(numbers[i * 3 + 2]!);
  }
  return { text, grounds };
}

/**
 * A fresh terminal band: its lane's name row, what its speech line says, and whether a name sits in a balloon. A
 * mounted lane is repainted by the Deck's clock, which the kit does not answer, so each look mounts the band anew.
 */
async function band($: Engine, requestId: string = BAND.requestId) {
  const ui = await $.ui.mount({ ...BAND, requestId, surface: TERMINAL });
  const row = nameRow((await ui.find({ type: "Raster", key: "deck-pet" } as never))?.props.cells);
  const speech = async (id: string) => (await ui.find({ type: "Button", key: `deck-speech-${id}` } as never))?.props.label as string | undefined;
  const blank = row.grounds[0];
  const inBalloon = (name: string) => row.text.includes(name) && row.grounds[row.text.indexOf(name)] !== blank;
  return { ui, row, speech, inBalloon };
}

declare const setTimeout: (callback: () => void, ms: number) => unknown;

async function settle(done: () => Promise<boolean>) {
  for (let i = 0; i < 200 && !(await done()); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
}

test("with Claude idle, Pingo says nothing and falls asleep", { ...LOCALE, timeoutMs: 30_000 }, async ($, on) => {
  const world = deckWorld(on, new Map([["features", PINGO_ONLY]]));
  await $.session.start(SESSION);
  let drawn = await band($);
  expect(await drawn.speech("pingo")).toBeUndefined();
  expect(drawn.inBalloon("Pingo")).toBe(false);
  await drawn.ui.unmount();
  // three idle minutes make Pingo sleepy; the next scene is a sleep
  for (let i = 0; i < 20; i++) await world.clock.advance(10_000);
  const desktop = await $.ui.mount({ ...BAND, surface: DESKTOP });
  const alt = String((await desktop.find({ type: "Svg" } as never))?.props.alt);
  expect(alt).toMatch(/^Pingo, sleep\b/);
  await desktop.unmount();
  drawn = await band($);
  expect(await drawn.speech("pingo")).toBeUndefined();
  await drawn.ui.unmount();
});

test("while Claude works, Pingo says what it is doing, in a balloon, and stops when the turn ends", LOCALE, async ($, on) => {
  deckWorld(on, new Map([["features", PINGO_ONLY]]));
  await $.session.start(SESSION);
  await $.turn.start({ turnId: "t1", text: "fix the loader" } as never);
  let drawn = await band($);
  expect(await drawn.speech("pingo")).toContain("Thinking");
  expect(drawn.inBalloon("Pingo")).toBe(true);
  // Pingo's body is the terminal's own color; its name on the speech line takes the theme's text color, never black
  expect((await drawn.ui.find({ type: "Text", text: /Pingo:$/ }))?.props.color).toBe("text");
  await drawn.ui.unmount();

  await $.tool.call({ tool: "Read", file_path: "/work/hooks/register.tsx" } as never);
  drawn = await band($);
  expect(await drawn.speech("pingo")).toContain("Reading register.tsx");
  await drawn.ui.unmount();

  await $.turn.complete({ turnId: "t1", answer: "Fixed.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);
  drawn = await band($);
  expect(await drawn.speech("pingo")).toBeUndefined();
  expect(drawn.row.text).toContain("Pingo");
  expect(drawn.inBalloon("Pingo")).toBe(false);
  await drawn.ui.unmount();
});

test("a feature at work stands on the lane and says so, then goes quiet when it is done", LOCALE, async ($, on) => {
  deckWorld(on, new Map([["features", LAPIDA_ONLY]]));
  let answer: (value: unknown) => void = () => {};
  let box = "fix loader";
  on("model.fork", () => new Promise((resolve) => (answer = resolve)) as never);
  on("prompt.read", async () => ({ value: { text: box, cursor: 0 } }) as never);
  on("prompt.fill", async (_$, e) => ((box = e.text), { isFilled: true }) as never);
  on("fs.ancestors", async () => ({ value: [] }) as never);
  on("command.list", async () => ({ value: [] }) as never);
  await $.session.start(SESSION);

  const pressed = await band($);
  expect(await pressed.speech("lapida")).toBeUndefined();
  // the press resolves when the rewrite does, so it is kept, and the looks below mount a band of their own
  const press = pressed.ui.press({ key: "lapida-enhance" });

  // rewriting: Lapida on the lane, in the balloon, and its words under the lane
  await settle(async () => {
    const { ui, speech } = await band($, "probe");
    const said = await speech("lapida");
    await ui.unmount();
    return said !== undefined;
  });
  let drawn = await band($, "probe");
  expect(await drawn.speech("lapida")).toContain("rewriting the draft");
  expect(drawn.inBalloon("Lapida")).toBe(true);
  await drawn.ui.unmount();

  answer({ value: { isAnswered: true, text: "Fix the loader.\n<<<CHANGES>>>\n- named the file", usage: { input_tokens: 40, output_tokens: 12 } } });
  await press;
  await pressed.ui.unmount();
  drawn = await band($);
  expect(box).toBe("Fix the loader.");
  expect(await drawn.speech("lapida")).toBeUndefined();
  expect(drawn.inBalloon("Lapida")).toBe(false);
  expect(drawn.row.text).toContain("Lapida");
  expect(await drawn.ui.find({ type: "Text", text: "Lapida · review the rewrite" })).toBeDefined();
  await drawn.ui.unmount();
});
