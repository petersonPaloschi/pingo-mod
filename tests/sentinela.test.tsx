// Sentinela lists the Claude sessions of every project from their files, and keeps only those whose process still
// runs. That process check is the costly part of a refresh: it runs again only when the sessions change, or every 30 s.
import type { On } from "claude-code";
import { expect, test } from "claude-code/testing";
import { deckWorld } from "./deck/helpers.ts";
import { plain } from "./helpers.ts";

const LOCALE = { options: { locale: "en" } } as const;
const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
// No HOME in the test's environment: the folder is /.claude/sessions, which Windows reads as C:\.claude\sessions.
const DIR = "/.claude/sessions";

const sessionFile = (pid: number, id: string) => JSON.stringify({ pid, sessionId: id, status: "busy", cwd: `/projects/${id}`, statusUpdatedAt: pid });

/** Session files on disk, the processes that run, and what Sentinela shows. */
function sessions(on: On, files: Record<string, string>, running: Set<number>) {
  const seen = { checks: 0, shown: [] as string[] };
  on("fs.list", async (_$, e, next) => (plain(e.path) === DIR ? { value: Object.keys(files).map((name) => ({ name, kind: "file" as const, size: 1 })) } : next(e)) as never);
  on("fs.read", async (_$, e, next) => {
    const path = plain(e.path);
    const name = path.startsWith(`${DIR}/`) ? path.slice(DIR.length + 1) : "";
    return (name && name in files ? { value: files[name] } : next(e)) as never;
  });
  // No OS in the test's environment: Sentinela asks `ps` which of the session PIDs still run.
  on("process.run", async (_$, e, next) => {
    if (e.argv[0] !== "ps") return next(e);
    seen.checks++;
    const asked = String(e.argv[4] ?? "").split(",").map(Number);
    const stdout = asked.filter((pid) => running.has(pid)).map((pid) => `  ${pid}`).join("\n");
    return { value: { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on("state.set", async (_$, e, next) => {
    if (e.key === "sentinelaSessions") seen.shown = (e.value as { id: string }[]).map((row) => row.id);
    return next(e);
  });
  return seen;
}

/** Moves the clock on in Sentinela's own 2 s steps, so each step is one refresh. */
async function wait(clock: { advance: (ms: number) => Promise<unknown> }, ms: number) {
  for (let left = ms; left > 0; left -= 2000) await clock.advance(Math.min(2000, left));
}

test("the process check runs again only when the sessions change, or every 30 s", { ...LOCALE, timeoutMs: 20_000 }, async ($, on) => {
  const files: Record<string, string> = { "a.json": sessionFile(101, "s-a"), "b.json": sessionFile(102, "s-b") };
  const seen = sessions(on, files, new Set([101, 102, 103]));
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  expect(seen.shown.sort()).toEqual(["s-a", "s-b"]);
  const first = seen.checks;
  expect(first).toBeGreaterThan(0);
  // the same two sessions for 26 s: 13 refreshes read the files, none asks for the processes again
  await wait(clock, 26_000);
  expect(seen.checks).toBe(first);
  // 30 s after the last check, it runs again
  await wait(clock, 6_000);
  expect(seen.checks).toBe(first + 1);
  // a new session is checked at the next refresh, and so is a session whose file went away
  files["c.json"] = sessionFile(103, "s-c");
  await wait(clock, 2_000);
  expect(seen.checks).toBe(first + 2);
  expect(seen.shown.sort()).toEqual(["s-a", "s-b", "s-c"]);
  delete files["a.json"];
  await wait(clock, 2_000);
  expect(seen.checks).toBe(first + 3);
  expect(seen.shown.sort()).toEqual(["s-b", "s-c"]);
});

test("a session that crashed, its file left behind, leaves the list at the next process check", { ...LOCALE, timeoutMs: 20_000 }, async ($, on) => {
  const files: Record<string, string> = { "a.json": sessionFile(101, "s-a"), "b.json": sessionFile(102, "s-b") };
  const running = new Set([101, 102]);
  const seen = sessions(on, files, running);
  const { clock } = deckWorld(on);
  await $.session.start(SESSION);
  expect(seen.shown.sort()).toEqual(["s-a", "s-b"]);
  running.delete(102);
  // until the next check, the crashed session is still shown
  await wait(clock, 26_000);
  expect(seen.shown.sort()).toEqual(["s-a", "s-b"]);
  await wait(clock, 6_000);
  expect(seen.shown).toEqual(["s-a"]);
});
