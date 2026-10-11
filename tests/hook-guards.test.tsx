// Hooks that keep working past a failure or a race of their own: a feature that cannot start leaves the others
// started, subagents that end together compact the session once, and a subagent's end reads the same everywhere.
import type { On } from "claude-code";
import { expect, test } from "claude-code/testing";
import { DEFAULT_USAGE, deckWorld, spawn } from "./deck/helpers.ts";

const LOCALE = { options: { locale: "en" } } as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

type Entry = { kind: string; tone: string; text: string; detail?: string };

/** The live log, the subagent list and the live status, as the mod last wrote them. */
function watch(on: On) {
  const seen = { feed: [] as Entry[], agents: [] as { id: string; state: string }[], live: {} as { model?: string } };
  on("state.set", async (_$, e, next) => {
    if (e.key === "feed") seen.feed = e.value as Entry[];
    if (e.key === "agents") seen.agents = e.value as typeof seen.agents;
    if (e.key === "now") seen.live = e.value as typeof seen.live;
    return next(e);
  });
  return seen;
}

test("a feature that cannot start is logged, and the start goes on", LOCALE, async ($, on) => {
  const seen = watch(on);
  // a disk that refuses every write: Vigia cannot save its session file
  deckWorld(on, undefined, { fsWrite: async () => ({ deny: "disk full" }) });
  await $.session.start(SESSION);
  expect(seen.feed.some((entry) => entry.tone === "bad" && /^Vigia did not start: /.test(entry.text))).toBe(true);
  // set after the features start: a failing one used to end the session's start there
  expect(seen.live.model).toBe("claude-opus-5-5");
});

test("subagents that end together compact the session once", LOCALE, async ($, on) => {
  let compactions = 0;
  const world = deckWorld(on, undefined, {
    spawn: (_$: unknown, e: { description: string }) => ({ model: "claude-sonnet-5-5", agentId: e.description }),
  });
  on("session.compact", async () => {
    compactions++;
    // a compaction frees the context: a turn that ends after it finds nothing to compact
    world.state.usage = DEFAULT_USAGE;
    return { skip: "counted" };
  });
  await $.session.start(SESSION);
  await $.agent.spawn(spawn("a1"));
  await $.agent.spawn(spawn("a2"));
  world.state.usage = { ...DEFAULT_USAGE, context: { tokens: 900_000, window: 1_000_000, percent: 90 } };
  // the usage is read only once both ends could be reading it: the window where both used to start a compaction
  let release = () => {};
  world.state.usageHold = new Promise<void>((resolve) => { release = resolve; });
  const bothReading = new Promise<void>((resolve) => { world.state.usageWaiting = (waiting) => { if (waiting === 2) resolve(); }; });
  const end = (agentId: string) => $.turn.complete({ turnId: agentId, agentId, answer: "ok", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });
  const first = end("a1");
  const second = end("a2");
  // one end reads the usage and the other, finding a compaction under way, is done without it
  await Promise.race([bothReading, second]);
  release();
  world.state.usageHold = undefined;
  await Promise.all([first, second]);
  expect(compactions).toBe(1);
});

test("a subagent that refuses ends as a failure in its log line and its record", LOCALE, async ($, on) => {
  const seen = watch(on);
  deckWorld(on, undefined, { spawn: () => ({ model: "claude-sonnet-5-5", agentId: "a1" }) });
  await $.session.start(SESSION);
  await $.agent.spawn(spawn("scan the repo"));
  await $.turn.complete({ turnId: "x", agentId: "a1", answer: "", durationMs: 5, isAborted: false, reason: "refusal", refusal: { category: null, explanation: null }, usage: undefined });
  const ended = seen.feed.filter((entry) => entry.kind === "agent").at(-1);
  expect(ended?.text).toMatch(/refused/);
  expect(ended?.tone).toBe("bad");
  expect(seen.agents.find((run) => run.id === "a1")?.state).toBe("error");
});

test("a subagent that answers ends as done everywhere", LOCALE, async ($, on) => {
  const seen = watch(on);
  deckWorld(on, undefined, { spawn: () => ({ model: "claude-sonnet-5-5", agentId: "a1" }) });
  await $.session.start(SESSION);
  await $.agent.spawn(spawn("scan the repo"));
  await $.turn.complete({ turnId: "x", agentId: "a1", answer: "Found it.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined });
  const ended = seen.feed.filter((entry) => entry.kind === "agent").at(-1);
  expect(ended?.text).toMatch(/done/);
  expect(ended?.tone).toBe("good");
  expect(seen.agents.find((run) => run.id === "a1")?.state).toBe("done");
});
