// The pane and the band draw valid trees on both surfaces, and their controls act.
import type { On, RenderPropsOf } from "claude-code";
import { expect, mock, test } from "claude-code/testing";
import { DEFAULT_FEATURES } from "../hooks/core/plan.ts";
import { en } from "../hooks/strings/en.ts";
import { pt } from "../hooks/strings/pt.ts";
import { ASK, DESKTOP, TERMINAL, TODOS, deckWorld } from "./deck/helpers.ts";
import { PANE_PROPS, PINGO_FACE, mockEngineServices, mockStore, status, successfulFetches } from "./helpers.ts";

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 } as unknown as RenderPropsOf["AbovePrompt"];

const EVENT = {
  seq: 1,
  time: "2026-10-06T11:59:00.000Z",
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

test("every tab draws on the terminal and the desktop app", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-ui-tabs" }));
  mock.store(on, { events: [EVENT, { ...EVENT, seq: 2, time: "2026-10-06T11:59:30.000Z", tool: "Edit" }] });
  mock.env(on, {});
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev", props: PANE_PROPS });
    for (const [key, text] of [
      ["tab-overview", /Idle|Routing/],
      ["tab-live", /Nothing yet/],
      ["tab-models", /Current main model/],
      ["tab-agents", /No subagents/],
      ["tab-logs", /Request log/],
      ["tab-configuration", "History"],
      ["tab-ai", /paste its key/],
      ["tab-deck", "Band above the prompt"],
      ["tab-flow", /Nothing yet: send a request/],
      ["tab-orchestration", /Advisor\/reviewer/],
    ] as const) {
      await ui.press({ key });
      expect(await ui.find({ type: "Text", text })).toBeDefined();
    }
    await ui.unmount();
  }
});

test("the AI tab holds every control that changes the model but orchestration's, which has its own tab", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-ui-ai" }));
  mock.store(on);
  mock.env(on, {});
  const ai = [
    "routing", "provider", "api-key", "validate",
    "feature-agents", "feature-clareza", "feature-lapida", "feature-farol", "feature-prisma", "feature-semente", "feature-vigia",
    "assumption-scope", "plain-level", "plainReview", "design-surface", "ideaNudges", "promptLearning", "trackerSummary",
  ];
  const rest: Record<string, string[]> = {
    "tab-configuration": ["language", "clear"],
    "tab-features": ["feature-pingoVivo", "feature-sentinela", "plainSound", "pet-hat", "petShades", "monitor-interval", "clash-window"],
    "tab-orchestration": ["orch-enabled", "orch-review", "orch-advice", "orch-batch", "native-advisor", "orch-command"],
  };
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  for (const key of ai) expect(await ui.find({ key })).toBeDefined();
  for (const keys of Object.values(rest)) for (const key of keys) expect(await ui.find({ key })).toBeUndefined();
  // The AI tab's own buttons keep r, v and f; the features sharing those keys are toggled without one.
  expect((await ui.find({ key: "routing" }))?.props.hotkey).toBe("r");
  for (const key of ["feature-farol", "feature-prisma", "feature-vigia"]) expect((await ui.find({ key }))?.props.hotkey).toBeUndefined();
  expect((await ui.find({ key: "feature-lapida" }))?.props.hotkey).toBe("l");
  for (const tab of ["tab-overview", "tab-live", "tab-models", "tab-agents", "tab-logs", "tab-configuration", "tab-deck", "tab-features", "tab-flow", "tab-orchestration"]) {
    await ui.press({ key: tab });
    for (const key of ai) expect(await ui.find({ key })).toBeUndefined();
    for (const key of rest[tab] ?? []) expect(await ui.find({ key })).toBeDefined();
  }
  await ui.unmount();
});

declare const setTimeout: (callback: () => void, ms: number) => unknown;

test("Lapida's model calls show in Live and in Logs, as the same lines", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-ui-lapida" }));
  mock.store(on);
  mock.env(on, {});
  on("model.fork", async () => ({ value: { isAnswered: false, reason: "nothing-to-fork" } }) as never);
  on("model.complete", async () => ({ value: { isAnswered: true, text: "Fix the loader.\n<<<CHANGES>>>\n- named the file", usage: { input_tokens: 40, output_tokens: 12 } } }) as never);
  on("prompt.fill", async () => ({ isFilled: true }) as never);
  on("fs.ancestors", async () => ({ value: [] }) as never);
  on("command.list", async () => ({ value: [] }) as never);
  await $.command.run({ command: "lapida", args: "fix loader", origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as never);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  const lines = async () => (await ui.findAll({ type: "Text" })).map((line) => line.text ?? "").filter((line) => /^(✓ )?Lapida · /.test(line));
  await ui.press({ key: "tab-live" });
  for (let i = 0; i < 200 && !(await lines()).some((line) => line.startsWith("✓")); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
  const live = await lines();
  // Live draws its newest line on top.
  expect(live).toEqual(["✓ Lapida · opus-5-5", "Lapida · this conversation — no conversation to fork yet"]);
  await ui.press({ key: "tab-logs" });
  expect(await ui.find({ type: "Text", text: "AI calls" })).toBeDefined();
  expect((await lines()).sort()).toEqual([...live].sort());
  await ui.unmount();
});

/** Lapida's world with the fork and the prompt box the test's own, so a step can hang or fail. */
function lapidaWorld(on: On, session: string) {
  const clock = mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: session }));
  mock.store(on);
  mock.env(on, {});
  on("fs.ancestors", async () => ({ value: [] }) as never);
  on("command.list", async () => ({ value: [] }) as never);
  return clock;
}
const LAPIDA_RUN = { command: "lapida", args: "fix loader", origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as never;

test("Lapida gives up on a fork that never answers and says so", async ($, on) => {
  const clock = lapidaWorld(on, "session-lapida-hang");
  on("model.fork", () => new Promise(() => {}) as never);
  let settled = false;
  const run = $.command.run(LAPIDA_RUN).then((reply) => ((settled = true), reply as { text?: string }));
  await clock.advance(60_000);
  expect(settled).toBe(false);
  await clock.advance(60_000);
  for (let i = 0; i < 200 && !settled; i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
  expect(settled).toBe(true);
  expect((await run).text).toBe("Lapida failed: timed out after 120,000 ms");
});

test("a Lapida fork that times out closes its Live line as failed, not left asking", async ($, on) => {
  const clock = lapidaWorld(on, "session-lapida-live-timeout");
  on("model.fork", () => new Promise(() => {}) as never);
  let settled = false;
  void $.command.run(LAPIDA_RUN).then(() => { settled = true; });
  await clock.advance(120_000);
  for (let i = 0; i < 200 && !settled; i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-live" });
  const lines = async () => (await ui.findAll({ type: "Text" })).map((line) => line.text ?? "").filter((line) => line.includes("Lapida · "));
  for (let i = 0; i < 200 && !(await lines()).some((line) => line.includes("timed out")); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
  const live = await lines();
  // the same deadline the caller had: the line says it failed, while the abandoned fork still hangs
  expect(live.some((line) => /failed: timed out after 120,000 ms/.test(line))).toBe(true);
  expect(live.some((line) => line.startsWith("⟳"))).toBe(false);
  await ui.unmount();
});

test("Lapida ends with its note when a step throws, instead of staying busy", async ($, on) => {
  lapidaWorld(on, "session-lapida-throw");
  on("model.fork", async () => ({ value: { isAnswered: true, text: "Fix the loader.\n<<<CHANGES>>>\n- named the file", usage: { input_tokens: 40, output_tokens: 12 } } }) as never);
  on("prompt.fill", async () => { throw new Error("boom"); });
  // The command answers with Lapida's own note rather than rejecting with the step's error.
  const reply = await $.command.run(LAPIDA_RUN) as { text?: string };
  expect(reply.text).toMatch(/^Lapida failed:/);
});

test("Lapida leaves its busy state once the rewrite is in the box, and runs again from the band and the command", async ($, on) => {
  lapidaWorld(on, "session-lapida-again");
  let forks = 0;
  let box = "fix loader";
  on("model.fork", async () => ({ value: { isAnswered: true, text: `Fix the loader, take ${++forks}.\n<<<CHANGES>>>\n- named the file`, usage: { input_tokens: 40, output_tokens: 12 } } }) as never);
  on("prompt.read", async () => ({ value: { text: box, cursor: 0 } }) as never);
  on("prompt.fill", async (_$, e) => ((box = e.text), { isFilled: true }) as never);
  const band = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "AbovePrompt", props: BAND_PROPS });
  const ready = async (take: number) => {
    for (let i = 0; i < 200 && !(forks === take && await band.find({ type: "Text", text: "Lapida · review the rewrite" })); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
    expect(box).toBe(`Fix the loader, take ${take}.`);
    expect(await band.find({ type: "Text", text: "Lapida · review the rewrite" })).toBeDefined();
    expect(await band.find({ type: "Text", text: "Lapida…" })).toBeUndefined();
    expect(await band.find({ key: "lapida-enhance" })).toBeDefined();
  };
  expect((await $.command.run(LAPIDA_RUN) as { text?: string }).text).toBe("Enhanced prompt is in the prompt box. Review it, then send when ready.");
  await ready(1);
  await band.press({ key: "lapida-enhance" });
  await ready(2);
  expect((await $.command.run(LAPIDA_RUN) as { text?: string }).text).toBe("Enhanced prompt is in the prompt box. Review it, then send when ready.");
  await ready(3);
  await band.unmount();
});

test("the dashboard follows the configured Portuguese locale", { options: { locale: "pt" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-ui-pt" }));
  mock.store(on, { events: [EVENT] });
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  expect(await ui.find({ type: "Text", text: "Provedor do Jev" })).toBeDefined();
  await ui.press({ key: "tab-features" });
  expect(await ui.find({ key: "feature-pingoVivo" })).toBeDefined();
  await ui.press({ key: "tab-flow" });
  expect(await ui.find({ type: "Text", text: /Nada ainda: envie um pedido/ })).toBeDefined();
  await ui.press({ key: "tab-orchestration" });
  expect(await ui.find({ type: "Text", text: /Advisor\/revisor/ })).toBeDefined();
  await ui.press({ key: "tab-deck" });
  expect(await ui.find({ type: "Text", text: "O que a faixa mostra" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "Faixa acima do prompt" })).toBeDefined();
  await ui.unmount();
});

test("Flow and Orchestration are tabs of their own, keys 0 and o, on both surfaces; Live keeps only its feed", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-ui-flow" }));
  mock.store(on);
  mock.env(on, {});
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev", props: PANE_PROPS });
    expect((await ui.find({ key: "tab-flow" }))?.props.hotkey).toBe("0");
    expect((await ui.find({ key: "tab-orchestration" }))?.props.hotkey).toBe("o");
    await ui.press({ key: "tab-live" });
    expect(await ui.find({ key: "flow-details" })).toBeUndefined();
    expect(await ui.find({ key: "orch-enabled" })).toBeUndefined();
    await ui.press({ key: "tab-flow" });
    expect(await ui.find({ type: "Text", text: "Flow" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /what Pingo did for each request/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Nothing yet: send a request/ })).toBeDefined();
    await ui.press({ key: "tab-orchestration" });
    expect(await ui.find({ type: "Text", text: "Orchestration" })).toBeDefined();
    expect(await ui.find({ key: "orch-enabled" })).toBeDefined();
    await ui.press({ key: "tab-ai" });
    expect(await ui.find({ key: "orch-enabled" })).toBeUndefined();
    expect(await ui.find({ key: "routing" })).toBeDefined();
    await ui.unmount();
  }
});

test("the language can be changed from Jev Setup", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  const store: Record<string, unknown> = { events: [EVENT, { ...EVENT, seq: 2, mode: "passthrough", reason: "low_confidence", tool: undefined }] };
  mockStore(on, store);
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.id", async () => ({ value: "session-language" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-configuration" });
  await ui.select({ key: "language", value: "pt" });
  expect(store.locale).toBe("pt");
  expect(await ui.find({ type: "Text", text: "Histórico" })).toBeDefined();
  await ui.press({ key: "tab-logs" });
  expect(await ui.find({ type: "Text", text: "Confiança baixa" })).toBeDefined();
  for (const tab of ["tab-overview", "tab-live", "tab-models", "tab-agents", "tab-logs", "tab-configuration", "tab-ai"]) {
    await ui.press({ key: tab });
  }
  await ui.unmount();
});

test("reason groups and titles appear in Logs", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  mock.store(on, { events: [
    { ...EVENT, seq: 2, mode: "passthrough", reason: "low_confidence", tool: undefined },
    { ...EVENT, seq: 3, mode: "passthrough", reason: "participation_unavailable", tool: undefined },
  ] });
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.id", async () => ({ value: "session-logs-reasons" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-logs" });
  const rendered = (await ui.findAll({ type: "Text" })).map((line) => line.text ?? "").join("\n");
  expect(rendered).toContain("Reason groups");
  expect(rendered).toContain("Low confidence");
  expect(rendered).toContain("Legacy reason: participation unavailable");
  expect(rendered).toContain("(participation_unavailable)");
  await ui.unmount();
});

test("Pingo remains in the header without a frame timer", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  mock.store(on);
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.id", async () => ({ value: "session-mascot" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  const blits: string[] = [];
  on("ui.blit", async (_$, e) => {
    blits.push(e.key);
    return { value: {} };
  });
  await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
  // the terminal draws Pingo as a still pixel sprite two cells tall; the desktop, which has no Raster, as its face
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  const mark = await ui.find({ type: "Raster", key: "pingo-mark" } as never);
  expect(mark?.props.rows).toBe(2);
  await clock.advance(100);
  expect(blits).toEqual([]);
  await ui.unmount();
  const desk = await $.ui.mount({ plugin: "jev", surface: "desktop", component: "Pane", requestId: "jev", props: PANE_PROPS });
  expect(await desk.find({ type: "Text", text: PINGO_FACE })).toBeDefined();
  await desk.unmount();
});

test("the band shows the status line", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ plugin: "jev", surface, component: "AbovePrompt", props: BAND_PROPS });
    expect(await ui.find({ type: "Text", text: /Jev: / })).toBeDefined();
    await ui.unmount();
  }
});

test("Overview groups its figures under headings and flags failed Jev calls on both surfaces", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  const failure = { ...EVENT, seq: 2, mode: "passthrough", reason: "jev_error: timeout", tool: undefined, jev: undefined };
  mock.store(on, { events: [EVENT, failure] });
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.id", async () => ({ value: "session-overview" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("classic.SessionStart", () => ({}));
  await $.classic.SessionStart({ source: "clear" });
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-overview" });
    for (const heading of [/^Routing$/, /^Jev's answers$/, /^Token usage$/, /^Timeline$/]) {
      expect(await ui.find({ type: "Text", text: heading })).toBeDefined();
    }
    expect(await ui.find({ type: "Text", text: "2 requests in this range" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^1 failed\s*$/ })).toBeDefined();
    await ui.unmount();
  }
});

test("an Overview range with no requests shows one line instead of empty figures", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { events: [{ ...EVENT, time: "2026-10-06T09:00:00.000Z" }] });
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.id", async () => ({ value: "session-overview-empty" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("classic.SessionStart", () => ({}));
  await $.classic.SessionStart({ source: "clear" });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-overview" });
  expect(await ui.find({ type: "Text", text: /No Claude requests or Jev calls in this range yet/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /the last one was/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^LLM input tokens/ })).toBeUndefined();
  await ui.select({ key: "range", value: "0" });
  expect(await ui.find({ type: "Text", text: /^LLM input tokens/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "1 request in this range" })).toBeDefined();
  await ui.unmount();
});

test("the routing button pauses Jev consultation without opening a comparison", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  await ui.press({ key: "routing" });
  expect((await ui.find({ key: "routing" }))?.props.label).toBe("Turn Jev on");
  await ui.press({ key: "tab-logs" });
  expect(await ui.find({ type: "Text", text: /Request log/ })).toBeDefined();
  await ui.unmount();
});

test("saved routing and agent planning switch return after /clear", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mockEngineServices(on);
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-ui-routing" }));
  mock.store(on, { routing: false, features: { agents: false } });
  mock.env(on, {});
  on("classic.SessionStart", () => ({}));

  await $.classic.SessionStart({ source: "clear" });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });

  await ui.press({ key: "tab-ai" });
  expect((await ui.find({ key: "routing" }))?.props.label).toBe("Turn Jev on");
  expect(await ui.find({ type: "Text", text: /Jev consultation is off/ })).toBeDefined();
  expect((await ui.find({ key: "feature-agents" }))?.props.dimColor).toBe(true);
  await ui.unmount();
});

test("setup does not call a provider without a key", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const fetches = successfulFetches(on);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  expect(await ui.find({ type: "Text", text: /No key yet/ })).toBeDefined();
  await ui.press({ key: "validate" });
  expect(fetches.length).toBe(0);
  expect(await ui.find({ type: "Text", text: /No key is configured/ })).toBeDefined();
  await ui.unmount();
});

/** /config excludes sensitive options; the CLI's secure writes are recorded instead. */
function configRows(on: On, written: unknown[]) {
  on("config.list", async () => ({ value: [{ key: "jev@inline.provider", label: "Jev provider" }] }) as never);
  on("config.set", async (_$, e) => ({ value: e.value }));
  on("process.run", async (_$, e) => {
    expect(e.argv.slice(0, 2)).toEqual(["claude", "--plugin-dir"]);
    expect(e.argv.slice(3)).toEqual(["plugin", "configure", "jev@inline", "--values-stdin", "--json"]);
    const { api_key } = JSON.parse(e.init?.stdin ?? "{}");
    expect(e.argv.join(" ")).not.toContain(api_key || "dummy-test");
    written.push(api_key);
    // The CLI ignores empty inputs; it does not delete an existing sensitive option.
    return { value: { exitCode: 0, stdout: JSON.stringify({ saved: api_key ? ["api_key"] : [], unconfigured: [] }), stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
}

test("a pasted key is shown masked, tested, saved in secure plugin storage and used at once", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const written: unknown[] = [];
  configRows(on, written);
  const auth = successfulFetches(on);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  await ui.input({ key: "api-key", kind: "change", text: "dummy-test-1234" });
  // The field holds only the mask; nothing in the tree carries the key.
  const drawn = JSON.stringify(await ui.drawn());
  expect(drawn).not.toContain("dummy-test");
  expect(drawn).toContain("•••••••••••1234");
  await ui.input({ key: "api-key", kind: "submit", text: "•••••••••••1234" });
  expect(auth).toEqual(["Bearer dummy-test-1234"]);
  expect(written).toEqual(["dummy-test-1234"]);
  expect(await ui.find({ type: "Text", text: /saved in Claude Code's secure plugin storage/ })).toBeDefined();
  expect(await status($)).toContain("Key source: plugin settings");
  expect(await status($)).not.toContain("dummy-test-1234");
  await ui.unmount();
});

test("a refused key is neither saved nor used", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const written: unknown[] = [];
  configRows(on, written);
  on("http.fetch", async () => ({ value: { status: 401, ok: false, headers: {}, text: '{"error":"bad key"}' } }));
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  await ui.input({ key: "api-key", kind: "change", text: "sk-wrong-0000" });
  await ui.press({ key: "validate" });
  expect(written).toEqual([]);
  expect(await ui.find({ type: "Text", text: /refused this key/ })).toBeDefined();
  expect(await status($)).toContain("Key source: none");
  await ui.unmount();
});

test("a saved key can be replaced, and an unsupported removal keeps it in use", { options: { api_key: "old-key-aaaa" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const written: unknown[] = [];
  configRows(on, written);
  on("http.fetch", async () => ({ value: { status: 200, ok: true, headers: {}, text: "{}" } }));
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  expect(await ui.find({ type: "Text", text: /••••aaaa/ })).toBeDefined();
  await ui.input({ key: "api-key", kind: "change", text: "new-key-bbbb" });
  await ui.press({ key: "validate" });
  expect(written).toEqual(["new-key-bbbb"]);
  expect(await ui.find({ type: "Text", text: /••••bbbb/ })).toBeDefined();
  await ui.press({ key: "forget" });
  expect(written).toEqual(["new-key-bbbb", ""]);
  expect(await ui.find({ type: "Text", text: /could not be removed/ })).toBeDefined();
  expect(await status($)).toContain("Key source: plugin settings");
  expect(await ui.find({ type: "Text", text: /••••bbbb/ })).toBeDefined();
  await ui.unmount();
});

test("a restarted session uses the saved key without testing it again", { options: { provider: "openrouter", api_key: "saved-restart-1234" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  on("http.fetch", async () => { throw new Error("opening Setup must not revalidate a saved key"); });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  expect(await ui.find({ type: "Text", text: /••••1234/ })).toBeDefined();
  const shown = await status($);
  expect(shown).toContain("Provider: OpenRouter");
  expect(shown).toContain("Key source: plugin settings");
  expect(shown).not.toContain("saved-restart-1234");
  expect(JSON.stringify(await ui.drawn())).not.toContain("saved-restart-1234");
  await ui.unmount();
});

test("a configured key is never written to plugin state", { options: { api_key: "configured-test-key" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const posted: (string | undefined)[] = [];
  on("http.fetch", async (_$, e) => {
    posted.push(e.init?.headers?.authorization);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  await ui.press({ key: "validate" });
  expect(posted).toEqual(["Bearer configured-test-key"]);
  expect(await status($)).toContain("Key source: plugin settings");
  expect(await status($)).not.toContain("configured-test-key");
  await ui.unmount();
});

test("the selected provider is validated with its own key", { options: { api_key: "provider-test-key" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, { OPENCODE_API_KEY: "opencode-env-key" });
  const urls: string[] = [];
  const auth: (string | undefined)[] = [];
  on("http.fetch", async (_$, e) => {
    urls.push(e.url);
    auth.push(e.init?.headers?.authorization);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  await ui.select({ key: "provider", value: "opencode" });
  await ui.press({ key: "validate" });

  // The plugin key is TypeSafe's under auto: OpenCode gets the key from its own variable.
  expect(urls).toEqual(["https://opencode.ai/zen/v1/systemone"]);
  expect(auth).toEqual(["Bearer opencode-env-key"]);
  expect(await status($)).toContain("Provider: OpenCode");
  expect(await status($)).not.toContain("provider-test-key");
  await ui.unmount();
});

test("connection checks use the configured paid OpenCode model", { options: { provider: "opencode", model: "jev-1.13", api_key: "model-test-key" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const models: string[] = [];
  on("http.fetch", async (_$, e) => {
    models.push(JSON.parse(String(e.init?.body ?? "{}")).model);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-ai" });
  await ui.select({ key: "provider", value: "opencode" });
  await ui.press({ key: "validate" });
  expect(models).toEqual(["jev-1.13"]);
  await ui.unmount();
});

test("legacy plain-text credentials are ignored", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { apiKey: "legacy-test-key", provider: "typesafe" });
  mock.env(on, {});
  expect(await status($)).toContain("Key source: none");
  expect(await status($)).not.toContain("legacy-test-key");
});

test("a key accepted in Setup comes back after a restart from the plugin store", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { credentials: { apiKey: "stored-key-7777", provider: "openrouter" } });
  mock.env(on, {});
  expect(await status($)).toContain("Provider: OpenRouter");
  expect(await status($)).not.toContain("Key source: none");
  expect(await status($)).not.toContain("stored-key-7777");
});

for (const [locale, strings] of [["en", en], ["pt", pt]] as const) {
  test(`every feature's description shows under its switch on the dashboard (${locale})`, { options: { locale } }, async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
    mockEngineServices(on);
    mock.store(on);
    mock.env(on, {});
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    const shown = new Set<string>();
    for (const tab of ["tab-ai", "tab-features"]) {
      await ui.press({ key: tab });
      for (const id of Object.keys(DEFAULT_FEATURES)) {
        if (!(await ui.find({ key: `feature-${id}` }))) continue;
        const description = strings[`feature.${id}.description` as keyof typeof en];
        expect((await ui.find({ type: "Text", text: description }))?.text).toBe(description);
        shown.add(id);
      }
    }
    expect([...shown].sort()).toEqual(Object.keys(DEFAULT_FEATURES).sort());
    await ui.unmount();
  });
}

const DECK_BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;

test("a feature switched in the Deck is switched on the dashboard, and the reverse, on both surfaces", { options: { locale: "en" } }, async ($, on) => {
  deckWorld(on);
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  await $.tool.call({ tool: "TodoWrite", todos: TODOS } as never);
  await $.command.run({ command: "deck", ...ASK, args: "expand" });
  const pane = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await pane.press({ key: "tab-ai" });
  for (const surface of [TERMINAL, DESKTOP]) {
    const band = await $.ui.mount({ ...DECK_BAND, surface });
    // every feature has its switch in the expanded band, named and showing its state
    for (const id of Object.keys(DEFAULT_FEATURES)) expect((await band.find({ key: `deck-feature-${id}` }))?.props.label).toMatch(/^[▣□] \S/);
    expect((await band.find({ key: "deck-feature-clareza" }))?.props.label).toBe("▣ Clareza");
    await band.press({ key: "deck-feature-clareza" });
    expect((await band.find({ key: "deck-feature-clareza" }))?.props.label).toBe("□ Clareza");
    expect((await band.find({ key: "deck-feature-clareza" }))?.props.dimColor).toBe(true);
    expect((await pane.find({ key: "feature-clareza" }))?.props.dimColor).toBe(true);
    await pane.press({ key: "feature-clareza" });
    expect((await pane.find({ key: "feature-clareza" }))?.props.dimColor).toBe(false);
    expect((await band.find({ key: "deck-feature-clareza" }))?.props.label).toBe("▣ Clareza");
    await band.unmount();
  }
  await pane.unmount();
});
