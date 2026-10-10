// The Flow tab's trail (hooks/trail.ts): built from the trace's reducers in the order a request happens,
// pure, and in the pane from the SDK's events with the controlled advisor on and off.
import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import type { TraceAdvice, TraceState } from "../types";
import { displayWidth } from "../hooks/layout.ts";
import { agentStart, completeTurn, consultEnd, consultStart, emptyTrace, noteAdvice, startTurn, stepEnd, stepStart, submitPrompt, toolEnd, toolStart } from "../hooks/trace.ts";
import { trailLines } from "../hooks/trail.ts";
import { PANE_PROPS as basePaneProps, mockEngineServices, step } from "./helpers.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const COMPLEX = "Refatore a arquitetura do fluxo de orquestração em hooks/orchestrate.ts e hooks/core/objective.ts, e investigue a causa raiz do teste flaky que ainda falha.";

const ON: Partial<TraceAdvice>[] = [
  { at: NOW + 5, on: true, why: "complex", decider: "local", score: 5, need: 4, tier: "complex", signals: ["design", "diagnosis", "files"], purpose: "plan", model: "claude-sonnet-5-5", effort: "high", source: "auto" },
  { outcome: "given", endedAt: NOW + 2005, guidance: "Check the loader contract first." },
];
const OFF: Partial<TraceAdvice>[] = [{ at: NOW + 5, on: false, why: "simple", decider: "local", score: -5, need: 4, tier: "simple", signals: ["short", "question"], purpose: "plan" }];

/** One whole request through the reducers: message, advisor, Jev, request, tool, subagent, native advisor, answer. */
function request(advice: Partial<TraceAdvice>[], text = COMPLEX): TraceState {
  let s = emptyTrace();
  let messageId = "";
  [s, messageId] = submitPrompt(s, { text, at: NOW, origin: "composer" });
  for (const change of advice) s = noteAdvice(s, messageId, change);
  let consult = "";
  [s, consult] = consultStart(s, { messageId }, { origin: "prompt", model: "jev-1", questions: ["work_mode", "guidance"], startedAt: NOW + 2100 });
  s = consultEnd(s, consult, NOW + 2300);
  s = startTurn(s, "t1", text, NOW + 2400);
  s = stepStart(s, { turnId: "t1", index: 0, original: "claude-sonnet-5-5", sent: "claude-opus-5-5", effort: "high", route: "orchestrated", at: NOW + 3000 });
  s = stepEnd(s, { turnId: "t1", index: 0, at: NOW + 4000, observed: "claude-opus-5-5", stop: "tool_use", usage: { input: 1200, output: 80 }, serverToolUses: [{ id: "adv-1", name: "advisor", startedAt: NOW + 3500, endedAt: NOW + 3900 }] });
  s = toolStart(s, { id: "toolu-read", name: "Read", at: NOW + 4100 });
  s = toolEnd(s, { id: "toolu-read", at: NOW + 4200, result: "ok" });
  s = toolStart(s, { id: "toolu-bash", name: "Bash", at: NOW + 4300 });
  s = toolEnd(s, { id: "toolu-bash", at: NOW + 4400, result: "denied" });
  s = agentStart(s, { id: "agent-1", type: "Explore", description: "look around the loader", model: "claude-sonnet-5-5", at: NOW + 5000 });
  s = stepStart(s, { turnId: "sub", agentId: "agent-1", index: 0, original: "claude-sonnet-5-5", sent: "claude-sonnet-5-5", route: "subagent", at: NOW + 5100 });
  s = stepEnd(s, { turnId: "sub", agentId: "agent-1", index: 0, at: NOW + 5800, observed: "claude-sonnet-5-5", stop: "end_turn" });
  s = completeTurn(s, "sub", NOW + 6000, "answer", "agent-1", "The loader reads the config twice.");
  return completeTurn(s, "t1", NOW + 7000, "answer", undefined, "Fixed: the loader now reads the config once.");
}

const drawn = (s: TraceState, width: number, locale: "en" | "pt" = "en") =>
  trailLines({ trace: s, now: NOW + 8000, width, locale }).map((parts) => parts.map((part) => part.text).join(""));
const at = (lines: readonly string[], pattern: RegExp) => {
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) throw new Error(`no line matches ${pattern}:\n${lines.join("\n")}`);
  return index;
};

describe("the trail of one request", () => {
  test("with the advisor on: its branch, highlighted, between the message and the work, everything in the order it happened", () => {
    const lines = drawn(request(ON), 100);
    const order = [
      /Request 1 · /,
      /● You: “Refatore a arquitetura/,
      /◆ Advisor on · Sonnet 5\.5 · high/,
      /┃ why: complex request \(score 5, turns on from 4\)/,
      /┃ decided by local heuristic, no extra call/,
      /┃ Signals: architecture decision, hard diagnosis, several files named/,
      /✓ Guidance received in 2s/,
      /┃ “Check the loader contract first\.”/,
      /● Jev · orchestration decision · 0s/,
      /● Model call 1 · Opus 5\.5 · high/,
      /│ model and effort chosen by orchestration/,
      /│ switched from Sonnet 5\.5 to Opus 5\.5/,
      /◆ Native \/advisor consulted on model call 1 · result received/,
      /✓ Read · ok/,
      /! Bash · denied/,
      /● Subagent Explore: look around the loader/,
      /● Explore › Model call 1 · Sonnet 5\.5/,
      /✓ Explore finished in 1s · 1 model calls · 0 tools/,
      /“The loader reads the config twice\.”/,
      /✓ Answer · completed · 5s/,
      /“Fixed: the loader now reads the config once\.”/,
    ];
    const positions = order.map((pattern) => at(lines, pattern));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Each event carries its time on the line.
    expect(lines[positions[1]!]).toMatch(/^\d\d.\d\d.\d\d/);
  });

  test("with the advisor off: the real path with no branch, and one line saying why", () => {
    const lines = drawn(request(OFF, "qual é a versão do node?"), 100);
    expect(lines.some((line) => line.includes("◆ Advisor"))).toBe(false);
    expect(lines.some((line) => line.includes("┃"))).toBe(false);
    const off = at(lines, /○ Advisor off · simple request \(score -5, turns on from 4\)/);
    expect(lines[off + 1]).toMatch(/│ decided by local heuristic, no extra call/);
    expect(off).toBeGreaterThan(at(lines, /You: “qual é a versão do node\?”/));
    expect(off).toBeLessThan(at(lines, /Model call 1 · Opus 5\.5/));
    expect(at(lines, /Answer · completed/)).toBeGreaterThan(at(lines, /Explore finished/));
  });

  test("a request the advisor never saw says so; a message still entering shows its decision already", () => {
    expect(drawn(request([]), 100).some((line) => /○ Advisor not evaluated for this request/.test(line))).toBe(true);
    let s = emptyTrace();
    let id = "";
    [s, id] = submitPrompt(s, { text: COMPLEX, at: NOW, origin: "composer" });
    s = noteAdvice(s, id, ON[0]!);
    const lines = drawn(s, 80);
    expect(lines[0]).toMatch(/Request entering/);
    expect(lines.some((line) => /◆ Advisor on · Sonnet 5\.5 · high/.test(line))).toBe(true);
    expect(lines.some((line) => /waiting for the guidance/.test(line))).toBe(true);
    // One that entered without its run tied to it is not shown as entering once a later run began.
    s = startTurn({ ...s, entering: undefined }, "t9", "something else", NOW + 1000);
    expect(drawn(s, 80).some((line) => /Request entering/.test(line))).toBe(false);
  });

  test("every line fits 40, 80 and 130 columns, in English and Portuguese", () => {
    for (const locale of ["en", "pt"] as const) {
      for (const width of [40, 80, 130]) {
        for (const line of drawn(request(ON), width, locale)) expect(displayWidth(line)).toBeLessThanOrEqual(width);
      }
    }
    const pt = drawn(request(ON), 80, "pt");
    expect(pt.some((line) => /◆ Advisor ligado · Sonnet 5\.5 · high/.test(line))).toBe(true);
    expect(pt.some((line) => /Resposta · concluída/.test(line))).toBe(true);
  });
});

// --- In the pane, from the SDK's events ---

const PANE_PROPS = { ...basePaneProps, bodyColumns: 100, scroll: { ...basePaneProps.scroll, bodyRows: 200 } };
const ORIGIN = { kind: "composer" } as const;
const DONE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** The engine with no Jev key (orchestration off: the advisor decides locally), the prompt held until turn.start. */
function world(on: On, guidance: "answers" | "fails") {
  mock.clock(on, { now: NOW });
  mockEngineServices(on);
  mock.store(on);
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-trail" }));
  on("settings.read", async () => ({ value: {} }) as never);
  on("model.complete", async () => (guidance === "answers"
    ? { value: { isAnswered: true, text: "Check the loader contract first.", usage: DONE } }
    : { value: { isAnswered: false, reason: "timeout" } }) as never);
  let reached = () => {};
  let release = () => {};
  on("prompt.submit", async (_$, e) => {
    if (!e.turnId) {
      const held = new Promise<void>((resolve) => (release = resolve));
      reached();
      await held;
    }
    return { text: e.text };
  });
  on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", async (_$, e) => ({ text: e.answer }));
  on("tool.call", async () => ({ result: "ok" }) as never);
  on("turn.step", async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model } };
  });
  return async function enter($: Engine, text: string) {
    const bottom = new Promise<void>((resolve) => (reached = resolve));
    const submitted = $.prompt.submit({ text, wait: false, origin: ORIGIN });
    await bottom;
    await $.turn.start({ text, turnId: "t1" });
    release();
    await submitted;
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await $.tool.call({ tool: "Read", file_path: "src/loader.ts", tool_use_id: "toolu-read" } as never);
    await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 10, isAborted: false, reason: "answer" });
  };
}

async function flowTab($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-flow" });
  // Each trail line is one Text holding its parts; the outer ones are the lines as drawn.
  const lines = (await ui.findAll({ type: "Text" })).map((line) => line.text ?? "");
  await ui.unmount();
  return lines;
}

describe("the Flow tab, from a real request", () => {
  test("advisor on: the branch shows its model, why, and the guidance it gave, before the request it shaped", async ($, on) => {
    const enter = world(on, "answers");
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, COMPLEX);
    const lines = await flowTab($);
    const order = [/You: “Refatore/, /◆ Advisor on · Sonnet 5\.5 · high/, /why: complex request/, /Guidance received in/, /Model call 1 · Opus 5\.5/, /Read · ok/, /Answer · completed/, /“Done\.”/];
    const positions = order.map((pattern) => at(lines, pattern));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("advisor off: no branch, the reason the feed gives, and the rest of the path", async ($, on) => {
    const enter = world(on, "answers");
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "qual é a versão do node?");
    const lines = await flowTab($);
    expect(lines.some((line) => line.includes("◆ Advisor"))).toBe(false);
    const order = [/You: “qual é a versão do node\?”/, /○ Advisor off · simple request \(score -?\d+, turns on from 4\)/, /Model call 1 · Opus 5\.5/, /Read · ok/, /Answer · completed/];
    const positions = order.map((pattern) => at(lines, pattern));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("a failed consult shows on the branch as a failure", async ($, on) => {
    const enter = world(on, "fails");
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, COMPLEX);
    const lines = await flowTab($);
    at(lines, /◆ Advisor on · Sonnet 5\.5 · high/);
    at(lines, /× Advisor failed: timeout; not counted as guidance/);
  });
});
