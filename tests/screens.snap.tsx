// The scenes scripts/screens.ts captures: the band above the prompt and every /jev tab, at a few
// widths, drawn to text by textshot.ts. Named .snap.tsx so `claude plugin test .` skips it; the
// script copies it in as a test file. Each screen prints between "===== <name>" and "===== END".
import { test } from "claude-code/testing";

import { TABS } from "../hooks/ui.tsx";
import { ASK, TODOS, deckWorld, spawn } from "./deck/helpers.ts";
import { step } from "./helpers.ts";
import { shot } from "./textshot.ts";

// The pet's frames are drawn at random (Math.random is read-only in tests): rasters keep only their size.
const MASK = { rasters: "mask" } as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const LOCALE = { options: { locale: "pt" }, timeoutMs: 60000 } as const;
const BAND_WIDTHS = [100, 60, 40];
const PANE_WIDTHS = [40, 80, 130];
const DECK_PANE_WIDTHS = [40, 80];

const EVENT = {
  seq: 1,
  time: "2026-10-07T11:59:00.000Z",
  session: "s1",
  model: "claude-opus-5-5",
  tools: 30,
  mode: "hint",
  tool: "Read",
  confidence: 0.91,
  durationMs: 2100,
  usage: { input: 12000, output: 300, cached: 11000, cacheWrite: 0 },
  jev: { choice: "Read", confidence: 0.91, latencyMs: 420, inputTokens: 900 },
};

const band = (cols: number) => ({
  plugin: "jev",
  surface: "terminal" as const,
  component: "AbovePrompt" as const,
  requestId: "above-prompt",
  viewport: { columns: cols, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: cols, scroll: { offset: 0, bodyRows: 20 }, view: {} },
});

const pane = (cols: number) => ({
  plugin: "jev",
  surface: "terminal" as const,
  component: "Pane" as const,
  requestId: "jev",
  viewport: { columns: cols, rows: 50 },
  props: { title: "Jev", isFocused: true, bodyColumns: cols, placement: "dock" as const, scroll: { offset: 0, bodyRows: 200 }, view: {} },
});

declare const console: { log: (...args: unknown[]) => void };

const deckPane = (cols: number) => ({
  ...pane(cols),
  requestId: "deck-panel",
  props: { ...pane(cols).props, title: "Deck" },
});

const screen = (name: string, body: string) => console.log(`\n===== ${name}\n${body}\n===== END\n`);

test("screens: band", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.agent.spawn(spawn("Explore auth module") as never).catch(() => undefined);
  for (const cols of BAND_WIDTHS) {
    await $.command.run({ command: "deck", ...ASK, args: "expand" });
    let ui = await $.ui.mount(band(cols));
    await clock.advance(2000);
    screen(`band expanded ${cols}`, shot(await ui.drawn(), cols, MASK));
    await ui.unmount();
    for (const look of ["chips", "text", "rings"]) {
      await $.command.run({ command: "deck", ...ASK, args: `collapsed ${look}` });
      ui = await $.ui.mount(band(cols));
      await clock.advance(1000);
      screen(`band collapsed ${look} ${cols}`, shot(await ui.drawn(), cols, MASK));
      await ui.unmount();
    }
  }
  // The Deck pane: the expanded band with every feature's switch, one feature off.
  await $.command.run({ command: "jev", ...ASK, args: "feature lapida off" });
  for (const cols of DECK_PANE_WIDTHS) {
    const ui = await $.ui.mount(deckPane(cols));
    await clock.advance(1000);
    screen(`deck pane ${cols}`, shot(await ui.drawn(), cols, MASK));
    await ui.unmount();
  }
});

const LONG = "a resposta cita o loader, o canal e o roteador sem dizer o que cada um faz, e o leitor iniciante se perde no meio ".repeat(3);
const NOTES = Array.from({ length: 8 }, (_, i) => `- mudança ${i + 1}: ${LONG.slice(0, 60)}`).join("\n");

// What the features and agents say above the prompt: one short message, then a long one, then many at once.
test("screens: messages", LOCALE, async ($, on) => {
  const { clock } = deckWorld(on);
  on("model.fork", async () => ({ value: { isAnswered: true, text: `Corrija o loader.\n<<<CHANGES>>>\n${NOTES}`, usage: { input_tokens: 40, output_tokens: 12 } } }) as never);
  on("prompt.read", async () => ({ value: { text: "corrija o loader", cursor: 0 } }) as never);
  on("prompt.fill", async () => ({ isFilled: true }) as never);
  await $.session.start(SESSION);
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  const capture = async (name: string) => {
    for (const cols of BAND_WIDTHS) {
      const ui = await $.ui.mount(band(cols));
      await clock.advance(2000);
      screen(`messages ${name} ${cols}`, shot(await ui.drawn(), cols, MASK));
      await ui.unmount();
    }
  };
  await $.tool.call({ tool: "mcp__jev__farol_assumption", tool_use_id: "toolu-farol-1", assumption: "A configuração fica em src/config.ts" } as never);
  await capture("short");
  await $.command.run({ command: "lapida", args: "corrija o loader", origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as never);
  await $.tool.call({ tool: "mcp__jev__farol_assumption", tool_use_id: "toolu-farol-2", assumption: LONG } as never);
  await capture("long");
  for (const name of ["Explore o módulo de autenticação", "Mapeie as rotas", LONG]) await $.agent.spawn(spawn(name) as never).catch(() => undefined);
  await $.command.run({ command: "deck", ...ASK, args: "pet off" });
  await capture("many");
});

const REQUEST = "Refatore a arquitetura do fluxo de orquestração em hooks/orchestrate.ts e hooks/core/objective.ts, e investigue a causa raiz do teste flaky que ainda falha.";
const DONE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

test("screens: pane", LOCALE, async ($, on) => {
  // This world starts the turn while an idle prompt enters, its `next` held until turn.start; the real engine
  // settles `next` first. The message is tied to its run either way.
  let reached = () => {};
  let release = () => {};
  const promptSubmit = async (_$: unknown, e: { text: string; turnId?: string }) => {
    if (!e.turnId) {
      const held = new Promise<void>((resolve) => (release = resolve));
      reached();
      await held;
    }
    return { text: e.text };
  };
  deckWorld(on, new Map<string, unknown>([["events", [EVENT, { ...EVENT, seq: 2, time: "2026-10-07T11:59:30.000Z", tool: "Edit" }, { ...EVENT, seq: 3, mode: "passthrough", time: "2026-10-07T11:58:00.000Z" }]]]), { promptSubmit });
  on("turn.step", async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model } };
  });
  on("model.complete", async () => ({ value: { isAnswered: true, text: "Leia o contrato do loader antes de mudar a orquestração.", usage: DONE } }) as never);
  await $.session.start(SESSION);
  // One whole request: a complex message (the advisor turns on), a model call, a tool, a subagent, the answer.
  const bottom = new Promise<void>((resolve) => (reached = resolve));
  const submitted = $.prompt.submit({ text: REQUEST, wait: false, origin: { kind: "composer" } });
  // An older checkout's world cannot hold the prompt: it then enters at once, before turn.start.
  await Promise.race([bottom, submitted]);
  await $.turn.start({ text: REQUEST, turnId: "t1" });
  release();
  await submitted;
  await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
  await $.tool.call({ tool: "Read", file_path: "hooks/orchestrate.ts", tool_use_id: "toolu-read" } as never);
  await $.agent.spawn(spawn("Explore auth module") as never).catch(() => undefined);
  await $.turn.complete({ turnId: "t1", answer: "Pronto: o fluxo lê a política uma vez por pedido.", durationMs: 10, isAborted: false, reason: "answer" });
  for (const cols of PANE_WIDTHS) {
    const ui = await $.ui.mount(pane(cols));
    for (const [tab] of TABS.flat()) {
      await ui.press({ key: `tab-${tab}` });
      screen(`pane ${tab} ${cols}`, shot(await ui.drawn(), cols, MASK));
    }
    await ui.unmount();
  }
});
