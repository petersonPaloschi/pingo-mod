// Portão: before Claude's own git commit or push, Jev decides whether to hold it; held, the change goes through Code
// Quality, the tests it reaches (`--only`, never the whole suite) and, when asked, a read-only security reviewer. Only
// the person lets the command through again (Enviar after a pass, Liberar at any time). Off by default.
import { expect, test, type TestBody } from "claude-code/testing";
import { DEFAULT_FEATURES } from "../hooks/core/contracts.ts";
import { changedFiles, parsePortaoReport, portaoDecision, resumedChecks, shipVerb, testFailures, testsFor, testTotals } from "../hooks/core/portao.ts";
import { qualityVerdict } from "../hooks/core/quality.ts";
import type { Answer } from "../hooks/core/types.ts";
import type { PortaoCheck } from "../types";
import { ASK, deckWorld, TERMINAL } from "./deck/helpers.ts";
import { comandanteJev, PANE_PROPS, pick } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const commit = (id: string, command = "git commit -m \"feat: x\"") => ({ tool: "Bash", command, tool_use_id: id }) as never;
const done = (turnId: string, agentId?: string, answer = "Done.") =>
  ({ turnId, ...(agentId ? { agentId } : {}), answer, durationMs: 10, isAborted: false, reason: "answer" }) as never;
const wait = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
async function settle(isDone: () => boolean) {
  for (let i = 0; i < 80 && !isDone(); i++) await wait();
}

/** A saved store with Portão on (Code Quality off unless asked), a Jev key, and anything else given. */
const store = (features: Record<string, boolean> = {}) => new Map<string, unknown>([
  ["features", { ...DEFAULT_FEATURES, codeQuality: false, portao: true, ...features }],
  ["credentials", { apiKey: "test-key", provider: "typesafe" }],
]);

/**
 * A world where git and the test runner answer from `git` and `tests`, each command kept; Jev answers from `table`;
 * prompts submitted by Pingo are kept; the reviewer's spawn and registration are kept.
 */
function portaoWorld(on: Parameters<typeof deckWorld>[0], table: Record<string, Answer>, opts: { saved?: Map<string, unknown>; tests?: { exitCode: number; stdout: string } } = {}) {
  const runs: string[][] = [];
  const submitted: { text: string; asUser?: boolean }[] = [];
  const spawns: { type?: string; prompt: string }[] = [];
  const registered: { name: string; disallowedTools?: string[]; maxTurns?: number; background?: boolean }[] = [];
  const jev = comandanteJev(on, table);
  const world = deckWorld(on, opts.saved ?? store(), {
    promptSubmit: async (_$: unknown, e: { text: string; origin?: { asUser?: boolean } }) => {
      submitted.push({ text: e.text, ...(e.origin?.asUser ? { asUser: true } : {}) });
      return { text: e.text };
    },
    spawn: async (_$: unknown, e: { subagentType?: string; subagent_type?: string; prompt: string }) => {
      spawns.push({ type: e.subagentType ?? e.subagent_type, prompt: e.prompt });
      return { model: "claude-sonnet-5-5", agentId: `r${spawns.length}` };
    },
  });
  on("agent.register", async (_$, e) => {
    registered.push(e as never);
    return { value: { agent: `jev:${e.name}` } } as never;
  });
  on("process.run", async (_$, e) => {
    runs.push([...e.argv]);
    const [cmd, ...args] = e.argv;
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } });
    if (cmd === "git" && args[0] === "status") return out(" M hooks/core/quality.ts\n");
    if (cmd === "git" && args[0] === "diff") return out(" 1 file changed, 2 insertions(+)\n");
    if (cmd === "git" && args[0] === "ls-files") return out("hooks/core/quality.ts\ntests/quality.test.tsx\ntests/deck/cast.test.ts\nscripts/test.ts\n");
    if (cmd === "node") return out(opts.tests?.stdout ?? "1 files · 7 pass · 0 fail · 1.0s\n", opts.tests?.exitCode ?? 0);
    return out("");
  });
  return { ...world, jev, runs, submitted, spawns, registered };
}

/** The Autonomous tab, mounted. */
async function autonomos($: Parameters<TestBody>[0]) {
  await $.command.run({ command: "jev", ...ASK, args: "autonomos" });
  return $.ui.mount({ plugin: "jev", component: "Pane", requestId: "jev", surface: TERMINAL, props: PANE_PROPS });
}

const HOLD = { hold: pick("hold", 0.95), tests: pick("run", 0.95), security: pick("skip", 0.95) };

test("the gate knows a commit or a push as a command of its own, and reads git and the test runner", () => {
  expect(shipVerb("Bash", { command: "git commit -m \"x\"" })).toBe("commit");
  expect(shipVerb("PowerShell", { command: "git add -A; git commit -m x" })).toBe("commit");
  expect(shipVerb("Bash", { command: "npm test && git -C repo push origin main" })).toBe("push");
  expect(shipVerb("Bash", { command: "echo git commit" })).toBeUndefined();
  expect(shipVerb("Bash", { command: "git status" })).toBeUndefined();
  expect(shipVerb("Read", { command: "git commit" })).toBeUndefined();
  expect(changedFiles(" M hooks/a.ts\n?? tests/new.test.ts\nR  old.ts -> hooks/b.ts\n")).toEqual(["hooks/a.ts", "tests/new.test.ts", "hooks/b.ts"]);
  const reach = testsFor(["hooks/core/quality.ts", "tests/deck/cast.test.ts"], ["tests/quality.test.tsx", "tests/deck/cast.test.ts", "tests/vigia.test.tsx", "scripts/test.ts"]);
  expect(reach.files).toEqual(["tests/quality.test.tsx", "tests/deck/cast.test.ts"]);
  expect(new RegExp(reach.only!).test("tests/quality.test.tsx")).toBe(true);
  expect(new RegExp(reach.only!).test("tests/vigia.test.tsx")).toBe(false);
  expect(testsFor(["README.md"], ["tests/quality.test.tsx"])).toEqual({ files: [] });
  expect(testTotals("batch 1/1 · 2 files · 3 pass · 1 fail · 2s\n\n2 files · 3 pass · 1 fail · 2.1s")).toEqual({ pass: 3, fail: 1 });
  expect(testFailures("ok\n✗ the gate holds a push\nexpected true\n2 files · 3 pass · 1 fail")).toEqual(["✗ the gate holds a push", "expected true"]);
  expect(parsePortaoReport("SUMMARY: One unsafe path.\nISSUE: hooks/a.ts:3 — path from input escapes the project\nVERDICT: fail")).toEqual({
    summary: "One unsafe path.",
    issues: [{ where: "hooks/a.ts:3", text: "path from input escapes the project" }],
    verdict: "fail",
  });
  expect(portaoDecision({ hold: pick("hold", 0.4) }, 0.7)).toBeUndefined();
  expect(portaoDecision({ hold: pick("pass", 0.9) }, 0.7)).toEqual({ hold: false, tests: false, security: false, confidence: 0.9 });
});

test("the security reviewer only reads: an edit is refused, a read inside the project runs", () => {
  const ask = { decision: "ask" } as const;
  expect(qualityVerdict("Edit", { file_path: "/work/hooks/a.ts" }, ask, "/work", "reader").decision).toBe("deny");
  expect(qualityVerdict("Read", { file_path: "/work/hooks/a.ts" }, ask, "/work", "reader").decision).toBe("allow");
  expect(qualityVerdict("Bash", { command: "git diff HEAD" }, ask, "/work", "reader").decision).toBe("allow");
  expect(qualityVerdict("Bash", { command: "rm -rf hooks" }, ask, "/work", "reader").decision).toBe("deny");
  expect(qualityVerdict("Agent", {}, ask, "/work", "reader").decision).toBe("deny");
});

test("off by default, a commit runs and Jev is not asked", async ($, on) => {
  const world = portaoWorld(on, HOLD, { saved: new Map<string, unknown>([["credentials", { apiKey: "test-key", provider: "typesafe" }]]) });
  await $.session.start(SESSION);
  const result = await $.tool.call(commit("toolu-c1")) as { deny?: string };
  expect(result.deny).toBeUndefined();
  expect(world.jev.asked.filter((request) => request.questions?.hold)).toHaveLength(0);
});

test("Jev lets a commit through: it runs, and the same change set asks nothing again", async ($, on) => {
  const world = portaoWorld(on, { hold: pick("pass", 0.95), security: pick("skip", 0.95) });
  await $.session.start(SESSION);
  expect((await $.tool.call(commit("toolu-c1")) as { deny?: string }).deny).toBeUndefined();
  expect((await $.tool.call(commit("toolu-c2", "git push")) as { deny?: string }).deny).toBeUndefined();
  expect(world.jev.asked.filter((request) => request.questions?.hold)).toHaveLength(1);
});

test("held, the tests the change reaches run with --only; passed, Enviar sends the command back and lets it through", async ($, on) => {
  const world = portaoWorld(on, HOLD);
  await $.session.start(SESSION);
  const held = await $.tool.call(commit("toolu-c1")) as { deny?: string };
  expect(held.deny).toContain("Portão");
  await settle(() => world.runs.some((argv) => argv[0] === "node"));
  const testRun = world.runs.find((argv) => argv[0] === "node")!;
  expect(testRun.slice(0, 3)).toEqual(["node", "scripts/test.ts", "--only"]);
  expect(new RegExp(testRun[3]!).test("tests/quality.test.tsx")).toBe(true);
  expect(new RegExp(testRun[3]!).test("tests/vigia.test.tsx")).toBe(false);
  // Claude trying again before the person decides is held again, and no new run starts
  const ui = await autonomos($);
  await settle(() => false);
  expect(await ui.find({ type: "Text", text: /^checks passed$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /7 passed/ })).toBeDefined();
  expect((await $.tool.call(commit("toolu-c2")) as { deny?: string }).deny).toContain("not approved");
  await ui.press({ key: "portao-1-send" });
  expect(world.submitted.at(-1)).toEqual({ text: expect.stringContaining("Run it again: git commit"), asUser: true });
  expect((await $.tool.call(commit("toolu-c3")) as { deny?: string }).deny).toBeUndefined();
  expect(world.jev.asked.filter((request) => request.questions?.hold)).toHaveLength(1);
  await ui.unmount();
});

test("failing tests hold the command: the failures go to Claude only with Enviar, and an edit starts a new run", async ($, on) => {
  const world = portaoWorld(on, HOLD, { tests: { exitCode: 1, stdout: "✗ the cast keeps its shape\n1 files · 4 pass · 1 fail · 1.0s\n" } });
  await $.session.start(SESSION);
  await $.tool.call(commit("toolu-c1"));
  await settle(() => world.runs.some((argv) => argv[0] === "node"));
  const ui = await autonomos($);
  await settle(() => false);
  expect(await ui.find({ type: "Text", text: /^checks failed$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /the cast keeps its shape/ })).toBeDefined();
  expect(world.submitted).toHaveLength(0);
  expect((await $.tool.call(commit("toolu-c2")) as { deny?: string }).deny).toContain("checks failed");
  await ui.press({ key: "portao-1-send" });
  expect(world.submitted.at(-1)?.text).toContain("the cast keeps its shape");
  // Claude fixes the code: the next commit is a new change set, checked again
  await $.tool.call({ tool: "Edit", file_path: "/work/hooks/core/quality.ts", old_string: "a", new_string: "b", tool_use_id: "toolu-e1" } as never);
  expect((await $.tool.call(commit("toolu-c3")) as { deny?: string }).deny).toContain("Portão");
  expect(world.jev.asked.filter((request) => request.questions?.hold)).toHaveLength(2);
  await ui.unmount();
});

test("Liberar lets the command through as it is, while it is still being checked", async ($, on) => {
  const world = portaoWorld(on, { ...HOLD, tests: pick("skip", 0.95), security: pick("review", 0.95) });
  await $.session.start(SESSION);
  await $.tool.call(commit("toolu-c1"));
  await settle(() => world.spawns.length > 0);
  // the security reviewer: Pingo's own read-only agent, in the background, a few turns, hidden from Claude
  const reviewer = world.registered.find((one) => one.name === "portao")!;
  expect(reviewer.disallowedTools).toEqual(expect.arrayContaining(["Edit", "Write", "Agent", "AskUserQuestion"]));
  expect(reviewer.maxTurns).toBe(30);
  expect(reviewer.background).toBe(true);
  expect(world.spawns[0]!.type).toBe("jev:portao");
  const ui = await autonomos($);
  await ui.press({ key: "portao-1-release" });
  expect(world.submitted.at(-1)).toEqual({ text: expect.stringContaining("I let it through"), asUser: true });
  expect((await $.tool.call(commit("toolu-c2")) as { deny?: string }).deny).toBeUndefined();
  await ui.unmount();
});

test("a reload picks a run's checks up: ended ones stay, lost work starts again, a reviewer at work is waited for", () => {
  const facts = { quality: true, unreviewed: ["hooks/a.ts"], only: "quality\\.test\\.tsx" };
  const checks: PortaoCheck[] = [{ kind: "quality", state: "running" }, { kind: "tests", state: "running" }, { kind: "security", state: "running" }];
  expect(resumedChecks(checks, facts, false, "en")).toEqual([{ kind: "quality", state: "waiting" }, { kind: "tests", state: "waiting" }, { kind: "security", state: "waiting" }]);
  expect(resumedChecks(checks, facts, true, "en")[2]).toEqual({ kind: "security", state: "running" });
  // nothing left to review, no test reached, Code Quality off: each check ends instead of waiting on nothing
  expect(resumedChecks(checks, { quality: true, unreviewed: [] }, false, "en").slice(0, 2)).toEqual([
    { kind: "quality", state: "passed", note: "every changed file was reviewed" },
    { kind: "tests", state: "skipped", note: "no test reaches this change" },
  ]);
  expect(resumedChecks(checks, { ...facts, quality: false }, false, "en")[0]).toEqual({ kind: "quality", state: "skipped", note: "Code Quality is off" });
  const ended: PortaoCheck[] = [{ kind: "quality", state: "passed" }, { kind: "tests", state: "failed", note: "1 failed" }, { kind: "security", state: "skipped" }];
  expect(resumedChecks(ended, facts, false, "en")).toEqual(ended);
});

/**
 * A run the plugin was still checking when it reloaded: the kept runs answer with it until the mod writes its own,
 * as the record a reload leaves behind.
 */
function cutShort(on: Parameters<typeof deckWorld>[0], checks: PortaoCheck[]) {
  const run = { n: 1, at: 0, command: "git commit -m \"feat: x\"", verb: "commit", generation: 0, state: "checking", checks, findings: [] };
  on("state.get", async (_$, e, next) => {
    const kept = await next(e) as { value?: { value?: unknown; version: number } };
    const stored = kept.value?.value;
    const empty = stored === undefined || (Array.isArray(stored) && stored.length === 0);
    return (e.key === "portaoRuns" && kept.value && empty ? { value: { ...kept.value, value: [run] } } : kept) as never;
  });
}

test("a run cut short by a reload goes on: its tests run again, it passes, and Claude's next try waits for Enviar", async ($, on) => {
  const world = portaoWorld(on, HOLD);
  cutShort(on, [{ kind: "quality", state: "skipped" }, { kind: "tests", state: "running" }, { kind: "security", state: "skipped" }]);
  await $.session.start(SESSION);
  await settle(() => world.runs.some((argv) => argv[0] === "node"));
  expect(world.runs.find((argv) => argv[0] === "node")!.slice(0, 3)).toEqual(["node", "scripts/test.ts", "--only"]);
  const ui = await autonomos($);
  await settle(() => false);
  expect(await ui.find({ type: "Text", text: /^checks passed$/ })).toBeDefined();
  // the same run holds Claude's next try: Jev is not asked again and no new run starts
  expect((await $.tool.call(commit("toolu-c1")) as { deny?: string }).deny).toContain("not approved");
  expect(world.jev.asked.filter((request) => request.questions?.hold)).toHaveLength(0);
  await ui.press({ key: "portao-1-send" });
  expect((await $.tool.call(commit("toolu-c2")) as { deny?: string }).deny).toBeUndefined();
  await ui.unmount();
});

test("with Portão switched off before the reload, the run is not picked up: it ends as interrupted", async ($, on) => {
  const world = portaoWorld(on, HOLD, { saved: store({ portao: false }) });
  const seen: { runs?: { state: string; checks: { note?: string }[] }[] } = {};
  on("state.set", async (_$, e, next) => {
    if (e.key === "portaoRuns") seen.runs = e.value as typeof seen.runs;
    return next(e);
  });
  cutShort(on, [{ kind: "quality", state: "skipped" }, { kind: "tests", state: "running" }, { kind: "security", state: "skipped" }]);
  await $.session.start(SESSION);
  await settle(() => false);
  expect(world.runs.some((argv) => argv[0] === "node")).toBe(false);
  expect(seen.runs?.[0]?.state).toBe("failed");
  expect(seen.runs?.[0]?.checks[1]?.note).toBe("interrupted when the session restarted");
});

test("after a reload the security reviewer starts again when it is gone, and is waited for while it works", async ($, on) => {
  const security = [{ kind: "quality", state: "skipped" }, { kind: "tests", state: "skipped" }, { kind: "security", state: "running" }] as PortaoCheck[];
  const world = portaoWorld(on, HOLD);
  cutShort(on, security);
  await $.session.start(SESSION);
  await settle(() => world.spawns.length > 0);
  expect(world.spawns.map((spawn) => spawn.type)).toEqual(["jev:portao"]);
});

test("a reviewer still at work through a reload ends the run with its report", async ($, on) => {
  const security = [{ kind: "quality", state: "skipped" }, { kind: "tests", state: "skipped" }, { kind: "security", state: "running" }] as PortaoCheck[];
  const world = portaoWorld(on, HOLD);
  world.state.agents = [{ id: "r-old", type: "jev:portao", status: "running" } as never];
  cutShort(on, security);
  await $.session.start(SESSION);
  await settle(() => false);
  expect(world.spawns).toHaveLength(0);
  await $.turn.complete(done("r", "r-old", "SUMMARY: Nothing unsafe.\nVERDICT: pass"));
  const ui = await autonomos($);
  await settle(() => false);
  expect(await ui.find({ type: "Text", text: /^checks passed$/ })).toBeDefined();
  await ui.unmount();
});

test("the reviewer's report fails the run; with the Comandante on, rejecting the request blocks it from Claude", async ($, on) => {
  const saved = store({ comandante: true });
  const world = portaoWorld(on, { ...HOLD, tests: pick("skip", 0.95), security: pick("review", 0.95), verdict: pick("reject_noise", 0.9) }, { saved });
  await $.session.start(SESSION);
  await $.tool.call(commit("toolu-c1"));
  await settle(() => world.spawns.length > 0);
  world.state.agents = [{ id: "r1", type: "jev:portao", status: "completed" } as never];
  await $.turn.complete(done("r", "r1", "SUMMARY: One unsafe path.\nISSUE: hooks/a.ts:3 — path escapes the project\nVERDICT: fail"));
  await settle(() => world.jev.asked.some((request) => request.state?.kind !== undefined && String(request.state.kind).includes("gate")));
  const ui = await autonomos($);
  await settle(() => false);
  expect(await ui.find({ type: "Text", text: /path escapes the project/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Blocked by the Comandante/ })).toBeDefined();
  // blocked: no Enviar, only Rejeitar and Liberar
  expect(await ui.find({ key: "portao-1-send" })).toBeUndefined();
  expect(await ui.find({ key: "portao-1-release" })).toBeDefined();
  await ui.unmount();
});

/** The band above the prompt, where the Deck lane and the line under it are drawn. */
const BAND = {
  plugin: "jev",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const;

test("on the Deck lane Portão says it checks, its words open the Autonomous tab, and it leaves once let through", { options: { locale: "en" } }, async ($, on) => {
  const world = portaoWorld(on, { ...HOLD, tests: pick("skip", 0.95), security: pick("review", 0.95) });
  await $.session.start(SESSION);
  const speech = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: TERMINAL });
    const line = await ui.find({ type: "Button", key: "deck-speech-portao" } as never);
    return { ui, label: String(line?.props.label ?? "") };
  };
  await $.tool.call(commit("toolu-c1"));
  await settle(() => world.spawns.length > 0);
  let drawn = await speech();
  expect(drawn.label).toContain("checking before git commit");
  await drawn.ui.press({ key: "deck-speech-portao" });
  expect(world.panes).toContain("jev");
  await drawn.ui.unmount();
  const ui = await autonomos($);
  await ui.press({ key: "portao-1-release" });
  await ui.unmount();
  drawn = await speech();
  expect(drawn.label).not.toContain("Portão");
  await drawn.ui.unmount();
});

test("with the Comandante on, failures it approves go to Claude at once; Limpar feitos hides the run, and the commit stays held", async ($, on) => {
  const world = portaoWorld(on, { ...HOLD, tests: pick("skip", 0.95), security: pick("review", 0.95), verdict: pick("approve_fits", 0.9) }, { saved: store({ comandante: true }) });
  await $.session.start(SESSION);
  await $.tool.call(commit("toolu-c1"));
  await settle(() => world.spawns.length > 0);
  world.state.agents = [{ id: "r1", type: "jev:portao", status: "completed" } as never];
  await $.turn.complete(done("r", "r1", "SUMMARY: One unsafe path.\nISSUE: hooks/a.ts:3 — path escapes the project\nVERDICT: fail"));
  await settle(() => world.submitted.length > 0);
  expect(world.submitted).toEqual([{ text: expect.stringContaining("path escapes the project"), asUser: true }]);
  // sent in the person's place: done, with no Enviar left
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /Comandante approved it and sent the failures to Claude/ })).toBeDefined();
  expect(await ui.find({ key: "portao-1-send" })).toBeUndefined();
  // the tab's buttons run apart: the press is back before the run is hidden
  await ui.press({ key: "portao-clear" });
  await settle(() => false);
  await ui.unmount();
  const cleared = await autonomos($);
  expect(await cleared.find({ type: "Text", text: /path escapes the project/ })).toBeUndefined();
  expect(await cleared.find({ type: "Text", text: /No run yet/ })).toBeDefined();
  await cleared.unmount();
  // hidden, not forgotten: the same change set is still held
  expect((await $.tool.call(commit("toolu-c2")) as { deny?: string }).deny).toBeDefined();
});
