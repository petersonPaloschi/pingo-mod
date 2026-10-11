// Ensaio: after a change someone using the app would see (a Code Quality cycle done, or Claude's turn with edits when
// Code Quality is off), Jev decides whether to run the app; Pingo's own agent builds, opens, watches and closes it,
// writing nothing, changing no git, installing and testing nothing. What it sees becomes a request that goes to Claude
// only with Enviar; a project with no way to run gets a run book request instead. Off by default.
import { expect, test, type TestBody } from "claude-code/testing";
import { DEFAULT_FEATURES } from "../hooks/core/contracts.ts";
import { ensaioDecision, ensaioVerdict, parseEnsaioReport } from "../hooks/core/ensaio.ts";
import type { Answer } from "../hooks/core/types.ts";
import { ASK, deckWorld, TERMINAL } from "./deck/helpers.ts";
import { comandanteJev, PANE_PROPS, pick } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const edit = (file: string, id: string) => ({ tool: "Edit", file_path: file, old_string: "a", new_string: "b", tool_use_id: id }) as never;
const done = (turnId: string, agentId?: string, answer = "Done.") =>
  ({ turnId, ...(agentId ? { agentId } : {}), answer, durationMs: 10, isAborted: false, reason: "answer" }) as never;
const wait = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
async function settle(isDone: () => boolean) {
  for (let i = 0; i < 80 && !isDone(); i++) await wait();
}
const REPORT = [
  "Done.",
  "SUMMARY: The settings screen opens, but its save button does nothing.",
  "RAN: npm run dev",
  "VERDICT: broken",
  "PROBLEM: src/settings.tsx:40 — the save button's handler is never attached",
  "FIX: Attach onSave to the save button in src/settings.tsx.",
].join("\n");

const store = (features: Record<string, boolean> = {}) => new Map<string, unknown>([
  ["features", { ...DEFAULT_FEATURES, codeQuality: false, ensaio: true, ...features }],
  ["credentials", { apiKey: "test-key", provider: "typesafe" }],
]);

function ensaioWorld(on: Parameters<typeof deckWorld>[0], table: Record<string, Answer>, saved = store()) {
  const submitted: { text: string; asUser?: boolean }[] = [];
  const spawns: { type?: string; prompt: string }[] = [];
  const registered: { name: string; disallowedTools?: string[]; maxTurns?: number; background?: boolean }[] = [];
  const jev = comandanteJev(on, table);
  const world = deckWorld(on, saved, {
    promptSubmit: async (_$: unknown, e: { text: string; origin?: { asUser?: boolean } }) => {
      submitted.push({ text: e.text, ...(e.origin?.asUser ? { asUser: true } : {}) });
      return { text: e.text };
    },
    spawn: async (_$: unknown, e: { subagentType?: string; subagent_type?: string; prompt: string }) => {
      spawns.push({ type: e.subagentType ?? e.subagent_type, prompt: e.prompt });
      return { model: "claude-sonnet-5-5", agentId: `s${spawns.length}` };
    },
  });
  on("agent.register", async (_$, e) => {
    registered.push(e as never);
    return { value: { agent: `jev:${e.name}` } } as never;
  });
  const asked = (name: string) => jev.asked.filter((request) => request.questions?.[name]).length;
  return { ...world, jev, submitted, spawns, registered, asked };
}

async function autonomos($: Parameters<TestBody>[0]) {
  await $.command.run({ command: "jev", ...ASK, args: "autonomos" });
  return $.ui.mount({ plugin: "jev", component: "Pane", requestId: "jev", surface: TERMINAL, props: PANE_PROPS });
}

const RUN = { visible: pick("visible", 0.95), runbook: pick("has_runbook", 0.95) };

test("Jev's decision and the agent's report are read; its calls never write, change git, install or test", () => {
  expect(ensaioDecision(RUN, 0.7)).toEqual({ visible: true, runbook: true });
  expect(ensaioDecision({ visible: pick("internal", 0.9) }, 0.7)).toEqual({ visible: false, runbook: false });
  expect(ensaioDecision({ visible: pick("visible", 0.4) }, 0.7)).toBeUndefined();
  expect(parseEnsaioReport(REPORT)).toEqual({
    summary: "The settings screen opens, but its save button does nothing.",
    verdict: "broken",
    problems: [{ where: "src/settings.tsx:40", text: "the save button's handler is never attached" }],
    ran: "npm run dev",
    fix: "Attach onSave to the save button in src/settings.tsx.",
  });
  const allow = { decision: "allow" } as const;
  const ask = { decision: "ask" } as const;
  for (const command of ["git commit -m x", "git checkout main", "rm -rf dist", "Remove-Item build -Recurse", "npm install left-pad", "node scripts/test.ts --only deck", "npm test", "claude mcp add x"]) {
    expect({ command, decision: ensaioVerdict("Bash", { command }, allow).decision }).toEqual({ command, decision: "deny" });
  }
  for (const command of ["npm run dev", "node server.js", "curl http://localhost:3000", "git diff"]) {
    expect({ command, decision: ensaioVerdict("Bash", { command }, ask).decision }).toEqual({ command, decision: "allow" });
  }
  expect(ensaioVerdict("Write", { file_path: "/work/a.ts" }, allow).decision).toBe("deny");
  expect(ensaioVerdict("Agent", {}, allow).decision).toBe("deny");
  // a rule of the person's that asks first is refused: no one is there to answer
  expect(ensaioVerdict("Bash", { command: "npm run dev" }, { decision: "ask", rule: "Bash(npm run:*)" }).decision).toBe("deny");
});

test("off by default, an edit asks Jev nothing", async ($, on) => {
  const world = ensaioWorld(on, RUN, new Map<string, unknown>([["features", { ...DEFAULT_FEATURES, codeQuality: false }], ["credentials", { apiKey: "test-key", provider: "typesafe" }]]));
  await $.session.start(SESSION);
  await $.tool.call(edit("/work/src/settings.tsx", "toolu-e1"));
  await $.turn.complete(done("t1"));
  await settle(() => false);
  expect(world.asked("visible")).toBe(0);
});

test("with Code Quality off, an edited turn runs the app; a problem it saw goes to Claude only with Enviar", async ($, on) => {
  const world = ensaioWorld(on, RUN);
  await $.session.start(SESSION);
  await $.tool.call(edit("/work/src/settings.tsx", "toolu-e1"));
  await $.turn.complete(done("t1"));
  await settle(() => world.spawns.length > 0);
  const agent = world.registered.find((one) => one.name === "ensaio")!;
  expect(agent.maxTurns).toBe(40);
  expect(agent.background).toBe(true);
  expect(agent.disallowedTools).toEqual(expect.arrayContaining(["Write", "Edit", "Agent", "AskUserQuestion"]));
  expect(world.spawns[0]!.type).toBe("jev:ensaio");
  expect(world.spawns[0]!.prompt).toContain("src/settings.tsx");
  // while it runs, the lane says so
  const band = await $.ui.mount({ plugin: "jev", component: "AbovePrompt", requestId: "above-prompt", surface: TERMINAL, viewport: { columns: 120, rows: 40 }, props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as never);
  expect(String((await band.find({ type: "Button", key: "deck-speech-ensaio" } as never))?.props.label ?? "")).toContain("running the app");
  await band.unmount();
  world.state.agents = [{ id: "s1", type: "jev:ensaio", status: "completed" } as never];
  await $.turn.complete(done("s", "s1", REPORT));
  await settle(() => false);
  expect(world.submitted).toHaveLength(0);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /^broken$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /save button's handler is never attached/ })).toBeDefined();
  await ui.press({ key: "ensaio-1-send" });
  expect(world.submitted.at(-1)).toEqual({ text: expect.stringContaining("Attach onSave"), asUser: true });
  await ui.unmount();
});

test("a project that does not say how to run its app gets a run book request, and no agent starts", async ($, on) => {
  const world = ensaioWorld(on, { visible: pick("visible", 0.95), runbook: pick("none", 0.95) });
  await $.session.start(SESSION);
  await $.tool.call(edit("/work/src/settings.tsx", "toolu-e1"));
  await $.turn.complete(done("t1"));
  await settle(() => world.asked("visible") > 0);
  await settle(() => false);
  expect(world.spawns).toHaveLength(0);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /Ask Claude to write how to run the app/ })).toBeDefined();
  await ui.press({ key: "ensaio-1-send" });
  expect(world.submitted.at(-1)?.text).toContain(".claude/skills/run/SKILL.md");
  await ui.unmount();
});

test("a change nobody using the app would see starts nothing", async ($, on) => {
  const world = ensaioWorld(on, { visible: pick("internal", 0.95), runbook: pick("has_runbook", 0.95) });
  await $.session.start(SESSION);
  await $.tool.call(edit("/work/tests/a.test.ts", "toolu-e1"));
  await $.turn.complete(done("t1"));
  await settle(() => world.asked("visible") > 0);
  await settle(() => false);
  expect(world.spawns).toHaveLength(0);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /No run yet\. One starts after a change/ })).toBeDefined();
  await ui.unmount();
});

test("with Code Quality on, Ensaio waits for its cycle to end done, then looks at the cycle's files", async ($, on) => {
  const world = ensaioWorld(on, RUN, store({ codeQuality: true }));
  await $.session.start(SESSION);
  await $.tool.call(edit("/work/src/settings.tsx", "toolu-e1"));
  await $.turn.complete(done("t1"));
  await settle(() => world.spawns.length > 0);
  // the cycle runs first; Jev is not asked about running the app yet
  expect(world.spawns[0]!.type).toBe("jev:code-quality");
  expect(world.asked("visible")).toBe(0);
  world.state.agents = [{ id: "s1", type: "jev:code-quality", status: "completed" } as never];
  await $.turn.complete(done("q", "s1", "SUMMARY: Nothing to fix.\nREVIEWED: src/settings.tsx\nFIXED: none\nSKIPPED: none"));
  await settle(() => world.spawns.length > 1);
  expect(world.asked("visible")).toBe(1);
  expect(world.spawns[1]!.type).toBe("jev:ensaio");
  expect(world.spawns[1]!.prompt).toContain("src/settings.tsx");
});

test("with the Comandante on, a request it approves goes to Claude at once, in the person's place", async ($, on) => {
  const world = ensaioWorld(on, { ...RUN, verdict: pick("approve_fits", 0.9) }, store({ comandante: true }));
  await $.session.start(SESSION);
  await $.tool.call(edit("/work/src/settings.tsx", "toolu-e1"));
  await $.turn.complete(done("t1"));
  await settle(() => world.spawns.length > 0);
  world.state.agents = [{ id: "s1", type: "jev:ensaio", status: "completed" } as never];
  await $.turn.complete(done("s", "s1", REPORT));
  await settle(() => world.submitted.length > 0);
  expect(world.submitted.at(-1)).toEqual({ text: expect.stringContaining("Attach onSave"), asUser: true });
});
