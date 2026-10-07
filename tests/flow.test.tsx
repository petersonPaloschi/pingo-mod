// The Flow tab: the run record (trace.ts) built from the SDK's events in the orders they come, and
// the drawing of it (flow.ts), pure and in the pane.
import type { On, RenderPropsOf } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import type { TraceState } from "../types";
import { FLOW_FPS, flowLines, flowScene, flowSummary, prettyModel } from "../hooks/flow.ts";
import { displayWidth } from "../hooks/layout.ts";
import {
  advisorBlocker,
  advisorStats,
  agentStart,
  clearTrace,
  completeTurn,
  confirmedModels,
  consultEnd,
  consultStart,
  emptyTrace,
  isDone,
  KEPT_RUNS,
  planMessage,
  promptEntered,
  setAdvisorInfo,
  startTurn,
  stepEnd,
  stepStart,
  submitPrompt,
  toolEnd,
  toolStart,
  traceOf,
} from "../hooks/trace.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const drawn = (lines: ReturnType<typeof flowLines>) => lines.map((parts) => parts.map((part) => part.text).join("")).join("\n");
const draw = (trace: TraceState, width = 72, locale: "en" | "pt" = "en") => drawn(flowLines({ trace, now: NOW, width, locale }));
const runOf = (s: TraceState, id: string) => s.runs.find((run) => run.id === id)!;

/** An idle prompt the engine runs: prompt.submit, Jev, turn.start while it enters, then its `next` resolves. */
function submitIdle(s: TraceState, text: string, turnId: string, at: number): TraceState {
  let id: string;
  [s, id] = submitPrompt(s, { text, at, origin: "composer" });
  let consult: string;
  [s, consult] = consultStart(s, { messageId: id }, { origin: "prompt", model: "jev-1", questions: ["tool", "needs_tool"], startedAt: at });
  s = consultEnd(s, consult, at + 300);
  s = planMessage(s, id, { outcome: "consulted", reason: "hint", summary: "tool Read (0.90)", tool: "Read" });
  s = startTurn(s, turnId, text, at + 400);
  return promptEntered(s, id);
}

/** A run with a bit of everything: Jev, a switched model, tools, an MCP tool, subagents, advisor calls, edits. */
function busyRun(): TraceState {
  let s = submitIdle(emptyTrace(), "check the site before launch", "t1", NOW - 90e3);
  s = planMessage(s, runOf(s, "t1").message!.id, { outcome: "consulted", reason: "hint", summary: "tool Read (0.90) · advisor consultation requested", tool: "Read", advisor: true });
  s = stepStart(s, { turnId: "t1", index: 0, original: "claude-opus-5-5", sent: "claude-sonnet-5-5", effort: "high", at: NOW - 89e3 });
  s = stepEnd(s, { turnId: "t1", index: 0, at: NOW - 80e3, observed: "claude-sonnet-5-5", stop: "tool_use", serverToolUses: [{ id: "adv-1", name: "advisor", startedAt: NOW - 85e3, endedAt: NOW - 82e3 }] });
  s = toolStart(s, { id: "tu-read", name: "Read", at: NOW - 79e3 });
  s = toolEnd(s, { id: "tu-read", at: NOW - 78e3, result: "ok" });
  s = toolStart(s, { id: "tu-gh", name: "mcp__github__get_issue", at: NOW - 77e3 });
  s = toolEnd(s, { id: "tu-gh", at: NOW - 76e3, result: "error" });
  for (const [n, type] of [[1, "Explore"], [2, "Explore"], [3, "Plan"]] as const) {
    s = agentStart(s, { id: `a${n}`, toolUseId: `tu-a${n}`, type, description: `group ${n}`, model: "claude-haiku-4-5-20251001", at: NOW - 70e3 });
  }
  s = stepStart(s, { turnId: "ta2", agentId: "a2", index: 0, original: "claude-haiku-4-5-20251001", sent: "claude-haiku-4-5-20251001", at: NOW - 69e3 });
  s = stepStart(s, { turnId: "ta1", agentId: "a1", index: 0, original: "claude-haiku-4-5-20251001", sent: "claude-haiku-4-5-20251001", at: NOW - 69e3 });
  s = stepEnd(s, { turnId: "ta1", agentId: "a1", index: 0, at: NOW - 60e3, observed: "claude-haiku-4-5-20251001", stop: "end_turn" });
  s = stepEnd(s, { turnId: "ta2", agentId: "a2", index: 0, at: NOW - 58e3, observed: "claude-haiku-4-5-20251001", stop: "end_turn", serverToolUses: [{ id: "adv-2", name: "advisor", startedAt: NOW - 59e3 }] });
  s = completeTurn(s, "ta1", NOW - 55e3, "answer", "a1");
  s = completeTurn(s, "ta2", NOW - 54e3, "error", "a2");
  s = toolStart(s, { id: "tu-edit", name: "Edit", at: NOW - 40e3 });
  s = toolEnd(s, { id: "tu-edit", at: NOW - 39e3, result: "ok", edit: true, file: "src/page.tsx" });
  s = toolStart(s, { id: "tu-deny", name: "Bash", at: NOW - 38e3 });
  return toolEnd(s, { id: "tu-deny", at: NOW - 38e3, result: "denied" });
}

describe("the run record", () => {
  test("prompt.submit → turn.start → turn.step → turn.complete ties the message to its run", () => {
    let s = submitIdle(emptyTrace(), "fix the login bug", "t1", NOW - 10e3);
    expect(s.inbox).toEqual([]);
    expect(s.entering).toBeUndefined();
    const run = runOf(s, "t1");
    expect(run.kind).toBe("message");
    expect(run.message).toMatchObject({ text: "fix the login bug", state: "linked" });
    // The consultation made before the run started counts in it.
    expect(run.consultCount).toBe(1);
    s = stepStart(s, { turnId: "t1", index: 0, original: "claude-opus-5-5", sent: "claude-opus-5-5", at: NOW - 9e3 });
    s = stepEnd(s, { turnId: "t1", index: 0, at: NOW - 8e3, observed: "claude-opus-5-5", stop: "end_turn" });
    s = completeTurn(s, "t1", NOW - 7e3, "answer");
    expect(s.active).toBeUndefined();
    expect(runOf(s, "t1")).toMatchObject({ endedAt: NOW - 7e3, reason: "answer", main: { original: "claude-opus-5-5", observed: ["claude-opus-5-5"], requests: 1 } });
    expect(isDone(runOf(s, "t1"))).toBe(true);
  });

  test("two messages typed into a running turn show at once in it, their run left pending", () => {
    let s = submitIdle(emptyTrace(), "refactor the router", "t1", NOW - 20e3);
    let first: string;
    let second: string;
    [s, first] = submitPrompt(s, { text: "also fix the tests", at: NOW - 15e3, origin: "composer", during: "t1" });
    [s, second] = submitPrompt(s, { text: "and the docs", at: NOW - 14e3, origin: "composer", during: "t1" });
    s = promptEntered(promptEntered(s, first), second);
    // Neither is taken for the turn that is waiting: the engine may deliver either into t1.
    expect(runOf(s, "t1").received.map((one) => [one.text, one.state])).toEqual([["also fix the tests", "queued"], ["and the docs", "queued"]]);
    expect(s.entering).toBeUndefined();
    s = completeTurn(s, "t1", NOW - 10e3, "answer");
    // The next turn starts with text but no message entering: not guessed from the text.
    s = startTurn(s, "t2", "also fix the tests", NOW - 9e3);
    expect(runOf(s, "t2").kind).toBe("unlinked");
    expect(runOf(s, "t2").message).toBeUndefined();
    const picture = draw(s);
    expect(picture).toContain("“also fix the tests” · association pending");
    expect(picture).toContain("#1 ✓ “refactor the router”");
  });

  test("a continuation turn has a run of its own", () => {
    let s = submitIdle(emptyTrace(), "run the tests", "t1", NOW - 20e3);
    s = completeTurn(s, "t1", NOW - 15e3, "answer");
    s = startTurn(s, "t2", "", NOW - 10e3);
    expect(runOf(s, "t2").kind).toBe("continuation");
    expect(draw(s)).toContain("continuation · no new message");
  });

  test("a refused prompt stays out of every run and says why", () => {
    const [submitted, id] = submitPrompt(emptyTrace(), { text: "rm -rf /", at: NOW - 1000, origin: "composer" });
    const s = promptEntered(submitted, id, "blocked by policy");
    expect(s.runs).toEqual([]);
    expect(s.inbox[0]).toMatchObject({ state: "dropped", dropped: "blocked by policy" });
    expect(draw(s)).toContain("⊘ “rm -rf /” · refused: blocked by policy");
  });

  test("a turn that starts after its prompt already entered is not tied to it", () => {
    let id: string;
    let s: TraceState;
    [s, id] = submitPrompt(emptyTrace(), { text: "queued by a plugin", at: NOW - 3000, origin: "plugin" });
    s = promptEntered(s, id);
    s = startTurn(s, "t1", "queued by a plugin", NOW - 2000);
    expect(runOf(s, "t1").kind).toBe("unlinked");
    expect(s.inbox[0]?.state).toBe("waiting");
  });

  test("a subagent's turns raise no turn.start: its steps and tools join the run that spawned it", () => {
    let s = submitIdle(emptyTrace(), "map the callers", "t1", NOW - 30e3);
    s = agentStart(s, { id: "a1", type: "Explore", description: "find callers", model: "claude-sonnet-5-5", at: NOW - 29e3 });
    // A subagent of the subagent: its parent's run.
    s = agentStart(s, { id: "a1-1", parent: "a1", type: "Explore", description: "deeper", at: NOW - 28e3 });
    s = stepStart(s, { turnId: "sub-1", agentId: "a1-1", index: 0, original: "claude-haiku-4-5-20251001", sent: "claude-haiku-4-5-20251001", at: NOW - 27e3 });
    s = toolStart(s, { id: "tu-1", agentId: "a1-1", name: "Grep", at: NOW - 26e3 });
    expect(s.runs).toHaveLength(1);
    const run = runOf(s, "t1");
    expect(run.agents.map((agent) => [agent.id, agent.parent ?? "main", agent.tools, agent.requests])).toEqual([["a1", "main", 0, 0], ["a1-1", "a1", 1, 1]]);
    expect(run.steps.at(-1)).toMatchObject({ agentId: "a1-1", turnId: "sub-1" });
  });

  test("three parallel subagents, late events and a background one", () => {
    let s = submitIdle(emptyTrace(), "check three things", "t1", NOW - 60e3);
    for (const n of [1, 2, 3]) s = agentStart(s, { id: `a${n}`, type: "Explore", description: `part ${n}`, ...(n === 3 ? { background: true } : {}), at: NOW - 59e3 });
    s = completeTurn(s, "x", NOW - 50e3, "answer", "a2");
    s = completeTurn(s, "x", NOW - 49e3, "answer", "a1");
    s = completeTurn(s, "t1", NOW - 40e3, "answer");
    // The main turn ended; the background subagent still runs, so the run is not done.
    expect(isDone(runOf(s, "t1"))).toBe(false);
    // A late step of the finished turn stays with it; no new run is opened.
    s = stepEnd(s, { turnId: "t1", index: 0, at: NOW - 39e3, stop: "end_turn" });
    s = stepStart(s, { turnId: "t1", index: 5, original: "claude-opus-5-5", sent: "claude-opus-5-5", at: NOW - 39e3 });
    expect(s.runs).toHaveLength(1);
    s = completeTurn(s, "x", NOW - 30e3, "answer", "a3");
    expect(isDone(runOf(s, "t1"))).toBe(true);
    expect(runOf(s, "t1").agents.map((agent) => agent.state)).toEqual(["done", "done", "done"]);
  });

  test("tool calls: denied, failed, and a successful edit with its file", () => {
    const run = runOf(busyRun(), "t1");
    expect(run.toolCount).toBe(4);
    expect(run.toolSources).toEqual({ builtin: 3, "mcp:github": 1 });
    expect([run.denied, run.failed, run.edits, run.files]).toEqual([1, 1, 1, ["src/page.tsx"]]);
  });

  test("an advisor call with its result, one without, and the same call listed again on a resumed response", () => {
    let s = busyRun();
    let run = runOf(s, "t1");
    expect(run.advisor.map((call) => [call.id, call.agentId ?? "main", call.endedAt !== undefined])).toEqual([["adv-1", "main", true], ["adv-2", "a2", false]]);
    // The paused response comes back whole: the same id, now with its end.
    s = stepStart(s, { turnId: "ta2", agentId: "a2", index: 1, original: "claude-haiku-4-5-20251001", sent: "claude-haiku-4-5-20251001", at: NOW - 30e3 });
    s = stepEnd(s, { turnId: "ta2", agentId: "a2", index: 1, at: NOW - 29e3, stop: "end_turn", serverToolUses: [{ id: "adv-2", name: "advisor", startedAt: NOW - 59e3, endedAt: NOW - 29e3 }] });
    run = runOf(s, "t1");
    expect(run.advisor).toHaveLength(2);
    expect(run.advisor[1]?.endedAt).toBe(NOW - 29e3);
    // The advisor's model is not exposed: it is never counted as a model of the run.
    expect(confirmedModels(run)).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5-20251001"]);
  });

  test("another tool the API ran itself is a tool of the run, not an advisor call", () => {
    let s = submitIdle(emptyTrace(), "search the web", "t1", NOW - 5000);
    s = stepStart(s, { turnId: "t1", index: 0, original: "claude-opus-5-5", sent: "claude-opus-5-5", at: NOW - 4000 });
    s = stepEnd(s, { turnId: "t1", index: 0, at: NOW - 3000, stop: "end_turn", serverToolUses: [{ id: "ws-1", name: "web_search", startedAt: NOW - 3500, endedAt: NOW - 3200 }] });
    const run = runOf(s, "t1");
    expect(run.advisor).toEqual([]);
    expect(run.toolSources).toEqual({ "server:web_search": 1 });
  });

  test("the last 40 finished runs are kept, and every run still active", () => {
    let s = emptyTrace();
    for (let i = 1; i <= KEPT_RUNS + 5; i++) {
      s = startTurn(s, `t${i}`, `task ${i}`, NOW - 1e6 + i * 1000);
      s = completeTurn(s, `t${i}`, NOW - 1e6 + i * 1000 + 500, "answer");
    }
    s = startTurn(s, "live", "still going", NOW - 1000);
    expect(s.runs).toHaveLength(KEPT_RUNS + 1);
    expect(s.runs[0]?.id).toBe("t6");
    expect(s.active).toBe("live");
    expect(s.turns).toBe(KEPT_RUNS + 6);
  });

  test("/jev clear keeps what still runs; removing a subagent from the Agents tab touches nothing here", () => {
    let s = busyRun();
    s = completeTurn(s, "t1", NOW - 20e3, "answer");
    s = completeTurn(s, "x", NOW - 19e3, "answer", "a3");
    s = startTurn(s, "t2", "next", NOW - 10e3);
    s = clearTrace(s);
    expect(s.runs.map((run) => run.id)).toEqual(["t2"]);
  });

  test("a value of the old schema is not read as the new one, and the record is plain data", () => {
    expect(traceOf({ turn: 3, wave: [1], waveTurn: 2, confirmed: false, edits: 0, files: [], working: true })).toEqual(emptyTrace());
    expect(traceOf(undefined)).toEqual(emptyTrace());
    const s = busyRun();
    // What the host keeps across a reload is this, round-tripped.
    expect(traceOf(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  test("the environment's advisor blockers follow the documented semantics", () => {
    expect(advisorBlocker({})).toBeUndefined();
    // Read for being set: "0" still stops feature-flag fetching.
    expect(advisorBlocker({ DISABLE_TELEMETRY: "0" })).toEqual({ kind: "flags", variable: "DISABLE_TELEMETRY" });
    expect(advisorBlocker({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "false" })).toEqual({ kind: "flags", variable: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" });
    // A standard boolean: 0 leaves it off.
    expect(advisorBlocker({ DO_NOT_TRACK: "0" })).toBeUndefined();
    expect(advisorBlocker({ DO_NOT_TRACK: "TRUE" })).toEqual({ kind: "flags", variable: "DO_NOT_TRACK" });
    expect(advisorBlocker({ CLAUDE_CODE_USE_BEDROCK: "1" })).toEqual({ kind: "provider", variable: "CLAUDE_CODE_USE_BEDROCK" });
    expect(advisorBlocker({ CLAUDE_CODE_USE_VERTEX: "0" })).toBeUndefined();
  });
});

describe("the drawing", () => {
  test("no sample: an empty record says nothing has run yet", () => {
    const picture = draw(emptyTrace());
    expect(picture).toContain("No runs recorded yet.");
    expect(picture).not.toMatch(/PRE-SHIP|SUBAGENTS/);
    expect(flowSummary(emptyTrace(), "en")).toBe("Flow: no runs recorded yet");
  });

  test("a run from its message to its answer: Jev, models, tools by source, subagents, advisor", () => {
    const s = setAdvisorInfo(busyRun(), { configured: "claude-opus-5-5" });
    const picture = draw(s, 100);
    for (const line of [
      "FLOW · RUN 1 · RUNNING",
      "“check the site before launch”",
      "consulted · tool Read (0.90) · advisor consultation requested",
      "hint attached: tool Read · advisor",
      "1 Jev call in this run",
      "Opus 5.5 → sent Sonnet 5.5 → answered Sonnet 5.5",
      "1 request · effort high",
      "Claude Code 3 · MCP github 1",
      "1 denied · 1 failed",
      "Explore “group 1” · ✓ 15s · Haiku 4.5",
      "Explore “group 2” · × error · Haiku 4.5",
      "Plan “group 3” · running 1m 10s · model not observed yet",
      "2 calls observed",
      "result received: 1 · result not observed: 1",
      "main · request 1 · result received",
      "Explore · request 1 · result not observed",
      "configured in settings: Opus 5.5",
      "its model and tokens are not exposed",
      "1 edit · 1 file",
      "confirmed models: Sonnet 5.5, Haiku 4.5",
    ]) {
      expect(picture).toContain(line);
    }
  });

  test("branches follow the order things happened", () => {
    const picture = draw(busyRun(), 100);
    const at = (label: string) => picture.split("\n").findIndex((line) => line.includes(label));
    // The advisor was called before any tool, and the tools came before the subagents.
    expect(at("◈ advisor")).toBeLessThan(at("▸ tools"));
    expect(at("▸ tools")).toBeLessThan(at("◇ subagents"));
    expect(at("◆  main")).toBeLessThan(at("◈ advisor"));
  });

  test("every line fits at 20, 45, 60, 72 and 160 columns, in both languages", () => {
    const s = setAdvisorInfo(busyRun(), { configured: "claude-opus-5-5", blocked: { kind: "flags", variable: "DISABLE_TELEMETRY" } });
    for (const locale of ["en", "pt"] as const) {
      for (const width of [20, 45, 60, 72, 160]) {
        const lines = flowLines({ trace: s, now: NOW, width, locale });
        for (const line of lines) expect(displayWidth(line.map((part) => part.text).join(""))).toBeLessThanOrEqual(width);
        const picture = drawn(lines);
        expect(picture).toContain(locale === "pt" ? "principal" : "main");
        expect(picture).toContain(locale === "pt" ? "resposta" : "answer");
      }
    }
  });

  test("wide characters in a label stay within the pane", () => {
    let s = submitIdle(emptyTrace(), "检查网站设计和移动版本".repeat(4), "t1", NOW - 5000);
    s = agentStart(s, { id: "a1", type: "Explore", description: "检查网站设计和移动版本", at: NOW - 4000 });
    for (const width of [20, 33, 60]) {
      for (const line of flowLines({ trace: s, now: NOW, width, locale: "en" })) expect(displayWidth(line.map((part) => part.text).join(""))).toBeLessThanOrEqual(width);
    }
  });

  test("a subagent spawned twice under one id is drawn and counted once", () => {
    let s = submitIdle(emptyTrace(), "check", "t1", NOW - 5000);
    s = agentStart(s, { id: "mate", type: "teammate", description: "reviewer", at: NOW - 4000 });
    s = completeTurn(s, "w1", NOW - 3000, "answer", "mate");
    s = agentStart(s, { id: "mate", type: "teammate", description: "reviewer", at: NOW - 2000 });
    expect(runOf(s, "t1").agents).toHaveLength(1);
    expect(runOf(s, "t1").agents[0]?.state).toBe("running");
    expect(flowSummary(s, "en")).toBe("Flow: run 1 · running · 0 requests · 0 tool calls · 1 subagent · 0 advisor calls");
  });

  test("model names: old ids and date suffixes", () => {
    expect(prettyModel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(prettyModel("claude-opus-5-5")).toBe("Opus 5.5");
  });
});

// --- In the pane ---

const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 100,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 120, contentRows: 120 },
} as unknown as RenderPropsOf["Pane"];
const ORIGIN = { kind: "composer" } as const;
const DONE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** The engine beneath the mod, with no Jev key: what is recorded does not depend on Jev. */
function world(on: On, opts: { advisorModel?: string; serverToolUses?: { id: string; name: string; input: unknown; startedAt: number; endedAt?: number }[] } = {}) {
  const clock = mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-flow" }));
  on("settings.read", async () => ({ value: opts.advisorModel ? { advisorModel: opts.advisorModel } : {} }) as never);
  on("ui.close", async () => ({ value: undefined }) as never);
  // The engine starts the turn while the prompt enters: an idle prompt's `next` is held at the
  // bottom until the test has fired turn.start, as the engine does before it resolves.
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
  on("tool.call", async (_$, e) => (e.tool === "Bash" ? { deny: "not allowed" } : { result: "ok" }) as never);
  on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: e.tool_use_id.replace("toolu", "agent") }));
  on("turn.step", async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: "end_turn" as const, usage: { ...DONE, model: e.model }, ...(opts.serverToolUses && !e.agentId ? { serverToolUses: opts.serverToolUses } : {}) };
  });
  /** An idle prompt the engine runs as turn `turnId`. */
  async function enter($: Engine, text: string, turnId: string) {
    const bottom = new Promise<void>((resolve) => (reached = resolve));
    const submitted = $.prompt.submit({ text, wait: false, origin: ORIGIN });
    await bottom;
    await $.turn.start({ text, turnId });
    release();
    return submitted;
  }
  return Object.assign(enter, { clock });
}

async function step($: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } }, e: object) {
  const stream = $.turn.step(e as never);
  for await (const _ of stream) void _;
  return stream.result;
}

const SPAWN = { prompt: "Look around.", description: "look around", subagentType: "Explore", provider: { plugin: "engine", tier: "core" }, parentModel: "claude-opus-5-5", background: false, fork: false };

describe("the Flow tab in the pane", () => {
  test("a whole run, recorded from the events with Jev off, on the terminal and the desktop app", async ($, on) => {
    const enter = world(on, { advisorModel: "claude-opus-5-5", serverToolUses: [{ id: "adv-1", name: "advisor", input: {}, startedAt: NOW, endedAt: NOW }] });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "ship the login fix", "t1");
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await $.tool.call({ tool: "Edit", file_path: "src/login.ts", old_string: "a", new_string: "b", tool_use_id: "toolu-edit" } as never);
    await $.tool.call({ tool: "Bash", command: "rm -rf dist", tool_use_id: "toolu-bash" } as never);
    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-a1" } as never);
    await step($ as never, { turnId: "sub", index: 0, model: "claude-sonnet-5-5", messageCount: 1, agentId: "agent-a1" });
    await $.turn.complete({ turnId: "sub", agentId: "agent-a1", answer: "ok", durationMs: 10, isAborted: false, reason: "answer" });
    await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 10, isAborted: false, reason: "answer" });
    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev", props: PANE_PROPS });
      await ui.press({ key: "tab-flow" });
      for (const line of [/FLOW · RUN 1$/, /“ship the login fix”/, /not consulted · No API key/, /Opus 5\.5 → answered Opus 5\.5/, /Claude Code 2/, /1 denied/, /Explore “look around” · ✓ 0s · Sonnet 5\.5/, /1 call observed/, /configured in settings: Opus 5\.5/, /completed · 0s/, /1 edit · 1 file/]) {
        expect(await ui.find({ type: "Text", text: line })).toBeDefined();
      }
      await ui.unmount();
    }
  });

  test("other surfaces get the run in one line", async ($, on) => {
    const enter = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "rename a variable", "t1");
    const ui = await $.ui.mount({ plugin: "jev", surface: "vscode", component: "Pane", requestId: "jev", props: PANE_PROPS });
    expect(await ui.find({ type: "Text", text: /Flow: run 1 · running · 0 requests/ })).toBeDefined();
    await ui.unmount();
  });

  test("messages typed into the running turn show in it, association pending", async ($, on) => {
    const enter = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "refactor the router", "t1");
    await $.prompt.submit({ text: "also the tests", wait: false, origin: ORIGIN, turnId: "t1" } as never);
    await $.prompt.submit({ text: "and the docs", wait: false, origin: ORIGIN, turnId: "t1" } as never);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-flow" });
    expect(await ui.find({ type: "Text", text: /↳ “also the tests” · received during this run · association pending/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /↳ “and the docs” · received during this run/ })).toBeDefined();
    await ui.unmount();
  });

  test("removing a subagent from the Agents tab keeps it in the Flow's history; a reload's session.start keeps the record", async ($, on) => {
    const enter = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "look around", "t1");
    await $.agent.spawn({ ...SPAWN, tool_use_id: "toolu-a1" } as never);
    await $.turn.complete({ turnId: "sub", agentId: "agent-a1", answer: "ok", durationMs: 10, isAborted: false, reason: "answer" });
    await $.command.run({ command: "jev", args: "agents clear", origin: ORIGIN, presentation: { isFullscreen: true, columns: 160 } } as never);
    // A reload runs register and session.start again; the state the host keeps stays.
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-agents" });
    expect(await ui.find({ type: "Text", text: "  Explore #1" })).toBeUndefined();
    await ui.press({ key: "tab-flow" });
    expect(await ui.find({ type: "Text", text: /Explore “look around” · ✓/ })).toBeDefined();
    await ui.unmount();
  });

  test("the pane draws at 20 columns: its width is no longer held at 30", async ($, on) => {
    const enter = world(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "a long message that must wrap in a narrow pane", "t1");
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: { ...PANE_PROPS, bodyColumns: 20 } as never });
    await ui.press({ key: "tab-flow" });
    // At 18 columns (the pane less its margin) the title is cut to fit: proof the drawing got 18, not 28.
    expect(await ui.find({ type: "Text", text: "FLOW · RUN 1 · RU…" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "==================" })).toBeDefined();
    await ui.unmount();
  });

  test("/jev flow opens the pane on the Flow tab", async ($, on) => {
    world(on);
    const opened: string[] = [];
    on("ui.open", async (_$, e) => {
      opened.push(e.id);
      return { value: {} } as never;
    });
    await $.command.run({ command: "jev", args: "flow", origin: ORIGIN, presentation: { isFullscreen: true, columns: 160 } } as never);
    expect(opened).toContain("jev");
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    expect(await ui.find({ type: "Text", text: /No runs recorded yet/ })).toBeDefined();
    await ui.unmount();
  });
});

// --- Phase D: the motion ---

describe("the scene", () => {
  const pulseRow = (trace: TraceState, now: number) =>
    flowLines({ trace, now, width: 100, locale: "en" }).findIndex((parts) => parts.some((part) => part.text.startsWith("•")));

  test("the node at work follows what was observed, and a finished run does not move", () => {
    let s = submitIdle(emptyTrace(), "fix it", "t1", NOW - 10e3);
    const at = (state: TraceState) => {
      const scene = flowScene(state, NOW, "en");
      return scene.active === undefined ? "none" : scene.nodes[scene.active]!.id;
    };
    // Open, nothing in flight: the answer is what is awaited.
    expect(at(s)).toBe("answer");
    s = stepStart(s, { turnId: "t1", index: 0, original: "claude-opus-5-5", sent: "claude-opus-5-5", at: NOW - 9e3 });
    expect(at(s)).toBe("main");
    s = stepEnd(s, { turnId: "t1", index: 0, at: NOW - 8e3, stop: "tool_use" });
    s = toolStart(s, { id: "tu", name: "Bash", at: NOW - 7e3 });
    expect(at(s)).toBe("tools");
    let consult: string;
    [s, consult] = consultStart(s, {}, { origin: "tool", model: "jev-1", questions: ["tool"], startedAt: NOW - 6e3 });
    expect(at(s)).toBe("jev");
    s = consultEnd(toolEnd(s, { id: "tu", at: NOW - 5e3, result: "ok" }), consult, NOW - 5e3);
    s = agentStart(s, { id: "bg", type: "Explore", description: "keep looking", background: true, at: NOW - 4e3 });
    s = completeTurn(s, "t1", NOW - 3e3, "answer");
    // The main turn ended, the background subagent still runs: still moving.
    expect(at(s)).toBe("agents");
    s = completeTurn(s, "x", NOW - 2e3, "answer", "bg");
    expect(at(s)).toBe("none");
    expect(flowScene(s, NOW, "en").moving).toBe(false);
    expect(pulseRow(s, NOW)).toBe(-1);
  });

  test("the pulse moves one row per frame, the same at the same time", () => {
    let s = submitIdle(emptyTrace(), "fix it", "t1", NOW - 10e3);
    s = stepStart(s, { turnId: "t1", index: 0, original: "claude-opus-5-5", sent: "claude-opus-5-5", at: NOW - 9e3 });
    const frame = 1000 / FLOW_FPS;
    const rows = [0, 1, 2, 3].map((i) => pulseRow(s, NOW + i * frame));
    expect(rows.every((row) => row > 0)).toBe(true);
    expect(new Set(rows).size).toBeGreaterThan(1);
    expect(pulseRow(s, NOW)).toBe(rows[0]);
    expect(flowScene(s, NOW + frame, "en").frame - flowScene(s, NOW, "en").frame).toBe(1);
    // The pulse stays on the trunk, between the node before and the one at work.
    const picture = drawn(flowLines({ trace: s, now: NOW, width: 100, locale: "en" })).split("\n");
    const jev = picture.findIndex((line) => line.startsWith("◆  jev"));
    const main = picture.findIndex((line) => line.startsWith("◆  main"));
    expect(rows[0]!).toBeGreaterThan(jev);
    expect(rows[0]!).toBeLessThan(main);
  });
});

describe("the motion in the pane", () => {
  test("frames only while the Flow tab shows a run at work, one at a time", async ($, on) => {
    const enter = world(on);
    let frames = 0;
    on("ui.invalidate", async () => {
      frames++;
      return { value: undefined } as never;
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await enter($, "fix it", "t1");
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    // Another tab: nothing to animate.
    await ui.press({ key: "tab-live" });
    await enter.clock.advance(100);
    expect(frames).toBe(0);
    await ui.press({ key: "tab-flow" });
    await enter.clock.advance(100);
    expect(frames).toBe(1);
    // The frame asked for has not been drawn (this test's invalidate draws nothing): no second one.
    await enter.clock.advance(100);
    expect(frames).toBe(1);
    // A draw lets the next frame through.
    await ui.press({ key: "tab-flow" });
    await enter.clock.advance(100);
    expect(frames).toBe(2);
    // The run ends: drawn still, nothing moves.
    await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 10, isAborted: false, reason: "answer" });
    await ui.press({ key: "tab-flow" });
    await enter.clock.advance(100);
    expect(frames).toBe(2);
    await ui.unmount();
    const status = await $.command.run({ command: "jev", args: "status", origin: ORIGIN, presentation: { isFullscreen: true, columns: 160 } } as never);
    expect(status.text).toMatch(/Flow redraws: \d+ · [\d.]+ ms on average · slowest \d+ ms/);
  });
});

describe("measuring the advisor hint", () => {
  test("finished runs that asked the question, split by whether the hint was attached", () => {
    let s = emptyTrace();
    const run = (n: number, hint: boolean, calls: number, tokens: number) => {
      let id: string;
      [s, id] = submitPrompt(s, { text: `task ${n}`, at: NOW - 100e3 + n * 1000, origin: "composer" });
      s = planMessage(s, id, { outcome: "consulted", reason: "hint", summary: "", advisorAsked: true, ...(hint ? { advisor: true } : {}) });
      s = startTurn(s, `t${n}`, `task ${n}`, NOW - 100e3 + n * 1000);
      s = promptEntered(s, id);
      s = stepStart(s, { turnId: `t${n}`, index: 0, original: "claude-opus-5-5", sent: "claude-opus-5-5", at: NOW - 100e3 + n * 1000 });
      s = stepEnd(s, {
        turnId: `t${n}`,
        index: 0,
        at: NOW - 100e3 + n * 1000 + 400,
        stop: "end_turn",
        tokens: { input: tokens, output: 0 },
        serverToolUses: Array.from({ length: calls }, (_, i) => ({ id: `adv-${n}-${i}`, name: "advisor", startedAt: NOW, endedAt: NOW })),
      });
      s = completeTurn(s, `t${n}`, NOW - 100e3 + n * 1000 + 500, "answer");
    };
    run(1, true, 2, 1000);
    run(2, true, 0, 3000);
    run(3, false, 0, 500);
    // A run whose prompt never asked the question is in neither group.
    s = completeTurn(startTurn(s, "t4", "", NOW - 1000), "t4", NOW - 500, "answer");
    const { hinted, plain } = advisorStats(s);
    expect(hinted).toEqual({ runs: 2, withCall: 1, calls: 2, durationMs: 1000, tokens: 4000, completed: 2 });
    expect(plain).toEqual({ runs: 1, withCall: 0, calls: 0, durationMs: 500, tokens: 500, completed: 1 });
  });
});
