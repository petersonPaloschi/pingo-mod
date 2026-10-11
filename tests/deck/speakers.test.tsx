// The features on the Deck lane as a session draws them: Clareza joins as a sphere of its own color when it has a
// plan for an unclear answer, its name in a balloon and its words on the line under the lane; pressing the words opens
// its pane, where the plan is shown whole and only sent to Claude when the person says so. With the Comandante on,
// a plan it rejects is never shown, and one it questions is shown with its question.
import { expect, test } from "claude-code/testing";

import type { Answer } from "../../hooks/core/types.ts";
import { LANE_ROWS } from "../../hooks/deck/cast.ts";
import { petLaneColumns } from "../../hooks/deck/pet.ts";
import { text } from "../../hooks/i18n.ts";
import { comandanteJev, comandanteStore, PANE_PROPS, pick } from "../helpers.ts";
import { TERMINAL, deckWorld } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const LOCALE = { options: { locale: "en" } } as const;
/** What Clareza's reviewer answers about an answer it finds unclear. */
const UNCLEAR = JSON.stringify({ status: "Unclear answer", pass: false, problems: ["'API' is not explained"], explained: [] });

/** The name row of a lane's cells as the host gets them: each cell's character and its ground. */
function nameRow(cells: unknown, columns: number): { text: string; grounds: number[] } {
  const bytes = Uint8Array.from(atob(String(cells)), (char) => char.charCodeAt(0));
  const numbers = new Uint32Array(bytes.buffer);
  let text = "";
  const grounds: number[] = [];
  for (let i = 0; i < columns; i++) {
    text += String.fromCodePoint(numbers[i * 3]!);
    grounds.push(numbers[i * 3 + 2]!);
  }
  return { text, grounds };
}

/** Waits for Clareza's review, which runs on its own after a turn ends. */
async function settle(done: () => Promise<boolean>) {
  for (let i = 0; i < 200 && !(await done()); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
}

test("Clareza joins the lane with its plan, says it under the lane, and sends it only when the person does", LOCALE, async ($, on) => {
  const submitted: string[] = [];
  const world = deckWorld(on, undefined, { promptSubmit: async (_$: unknown, e: { text: string }) => (submitted.push(e.text), { text: e.text }) });
  on("model.complete", async () => ({ value: { isAnswered: true, text: UNCLEAR, usage: { input_tokens: 10, output_tokens: 10 } } }) as never);
  await $.session.start(SESSION);
  const columns = petLaneColumns(110);
  const band = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
    const lane = await ui.find({ type: "Raster", key: "deck-pet" } as never);
    const speech = await ui.find({ type: "Button", key: "deck-speech-clareza" } as never);
    return { ui, row: nameRow(lane?.props.cells, columns), speech, rows: lane?.props.rows };
  };

  // before any answer: Clareza stands by, quiet: no balloon, nothing said
  let drawn = await band();
  expect(drawn.row.text).not.toContain("▐");
  expect(drawn.speech).toBeUndefined();
  await drawn.ui.unmount();

  await $.turn.start({ turnId: "t1", text: "how is Jev called?" } as never);
  await $.turn.complete({ turnId: "t1", answer: "Through the API key.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);
  await settle(async () => {
    const { ui, speech } = await band();
    await ui.unmount();
    return speech !== undefined;
  });

  // the review found it unclear: a plan, and nothing sent on its own
  expect(submitted.some((text) => text.startsWith("[Clareza]"))).toBe(false);
  drawn = await band();
  expect(drawn.rows).toBe(LANE_ROWS);
  // Clareza stands on the lane left of Jev and Pingo, its name in a balloon of its color
  const at = drawn.row.text.indexOf("Clareza");
  expect(at).toBeGreaterThanOrEqual(0);
  expect(at).toBeLessThan(drawn.row.text.indexOf("Jev"));
  expect(drawn.row.text.indexOf("Jev")).toBeLessThan(drawn.row.text.indexOf("Pingo"));
  expect(drawn.row.grounds[at]).not.toBe(drawn.row.grounds[drawn.row.text.indexOf("Pingo")]);
  // what it says, under the lane, opens its pane
  expect(String(drawn.speech?.props.label)).toContain("'API' is not explained");
  await drawn.ui.press({ key: "deck-speech-clareza" });
  expect(world.panes).toContain("clareza");
  await drawn.ui.unmount();
  const pane = await $.ui.mount({ plugin: "jev", surface: TERMINAL, component: "Pane", requestId: "clareza", props: { ...PANE_PROPS, title: "Clareza" } });
  const shown = JSON.stringify(await pane.drawn());
  expect(shown).toContain("'API' is not explained");
  expect(shown).toContain("[Clareza] Your last answer may confuse the user");
  // sent when the person sends it, and then Clareza is quiet again
  await pane.press({ key: "clareza-send" });
  await pane.unmount();
  expect(submitted.filter((text) => text.startsWith("[Clareza]")).length).toBe(1);
  drawn = await band();
  expect(drawn.row.text).not.toContain("▐");
  expect(drawn.speech).toBeUndefined();
  await drawn.ui.unmount();
});

test("a rejected plan is never sent, and Clareza goes quiet", LOCALE, async ($, on) => {
  const submitted: string[] = [];
  deckWorld(on, undefined, { promptSubmit: async (_$: unknown, e: { text: string }) => (submitted.push(e.text), { text: e.text }) });
  on("model.complete", async () => ({ value: { isAnswered: true, text: UNCLEAR, usage: { input_tokens: 10, output_tokens: 10 } } }) as never);
  await $.session.start(SESSION);
  await $.turn.start({ turnId: "t1", text: "how is Jev called?" } as never);
  await $.turn.complete({ turnId: "t1", answer: "Through the API key.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);
  const pane = async () => {
    const ui = await $.ui.mount({ plugin: "jev", surface: TERMINAL, component: "Pane", requestId: "clareza", props: { ...PANE_PROPS, title: "Clareza" } });
    const drawn = JSON.stringify(await ui.drawn());
    await ui.unmount();
    return drawn;
  };
  await settle(async () => (await pane()).includes("clareza-send"));
  const ui = await $.ui.mount({ plugin: "jev", surface: TERMINAL, component: "Pane", requestId: "clareza", props: { ...PANE_PROPS, title: "Clareza" } });
  await ui.press({ key: "clareza-reject" });
  await ui.unmount();
  expect(submitted.some((text) => text.startsWith("[Clareza]"))).toBe(false);
  expect(await pane()).not.toContain("clareza-send");
  const band = await $.ui.mount({ ...BAND, surface: TERMINAL });
  expect(await band.find({ type: "Button", key: "deck-speech-clareza" } as never)).toBeUndefined();
  await band.unmount();
});

test("with the Comandante on, a plan it rejects is never shown; one it questions is shown with its question", LOCALE, async ($, on) => {
  const table: Record<string, Answer> = { verdict: pick("reject_noise", 0.8) };
  const jev = comandanteJev(on, table);
  deckWorld(on, comandanteStore());
  on("model.complete", async () => ({ value: { isAnswered: true, text: UNCLEAR, usage: { input_tokens: 10, output_tokens: 10 } } }) as never);
  await $.session.start(SESSION);
  const pane = async () => {
    const ui = await $.ui.mount({ plugin: "jev", surface: TERMINAL, component: "Pane", requestId: "clareza", props: { ...PANE_PROPS, title: "Clareza" } });
    const drawn = JSON.stringify(await ui.drawn());
    await ui.unmount();
    return drawn;
  };
  const answer = async (turnId: string) => {
    await $.turn.start({ turnId, text: "how is Jev called?" } as never);
    await $.turn.complete({ turnId, answer: "Through the API key.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);
  };

  await answer("t1");
  await settle(async () => jev.toasts.some((toast) => toast.startsWith("Comandante: rejected — Clareza")));
  expect(jev.asked.find((request) => request.questions && "verdict" in request.questions)?.state).toMatchObject({ alert: "'API' is not explained" });
  expect(await pane()).not.toContain("clareza-send");

  table.verdict = pick("question_vague", 0.6);
  await answer("t2");
  await settle(async () => (await pane()).includes("clareza-send"));
  expect(await pane()).toContain(text("feature.comandante.tool.questioned.clareza", "en", { reason: text("feature.comandante.reason.question_vague", "en"), question: text("feature.comandante.question.question_vague", "en") }));
});

test("every feature switched on stands on the lane, quiet until it has something; one switched off is gone", LOCALE, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  const wide = { ...BAND, props: { ...BAND.props, bodyColumns: 200 }, viewport: { columns: 210, rows: 40 } };
  const columns = petLaneColumns(200);
  const names = async () => {
    const ui = await $.ui.mount({ ...wide, surface: TERMINAL });
    const lane = await ui.find({ type: "Raster", key: "deck-pet" } as never);
    const speech = await ui.find({ type: "Button", key: "deck-speech-farol" } as never);
    await ui.unmount();
    return { row: nameRow(lane?.props.cells, columns).text, speech };
  };
  let drawn = await names();
  for (const name of ["Clareza", "Semente", "Farol", "Vigia", "Sentinela", "Prisma", "Lapida", "Contexto"]) expect(drawn.row).toContain(name);
  // standing by, nobody speaks
  expect(drawn.row).not.toContain("▐");
  expect(drawn.speech).toBeUndefined();
  await $.command.run({ command: "jev", args: "feature farol off", origin: { kind: "composer" } } as never);
  drawn = await names();
  expect(drawn.row).not.toContain("Farol");
  expect(drawn.row).toContain("Clareza");
});
