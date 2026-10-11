#!/usr/bin/env node
// Tests in batches: `claude plugin test` starts one child per test file, min(files, CPUs) at once,
// which on a 32-thread machine is 32 children and ~7.5 GB at peak. This snapshots the working tree
// once (untracked files included, so later edits do not leak into a run), then runs the test files a
// few at a time: each batch in its own temp copy of the mod holding only that batch's tests, one
// batch after another, with the results added up. A lock file in the temp folder keeps two runs
// (from two sessions, say) from overlapping: the second one waits for the first.
// Run with Node 22.18+ from the checkout: node scripts/test.ts --help
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST = /\.test\.tsx?$/;
const SKIP = /^(?:bench|docs)\//;
const WINDOWS = process.platform === "win32";
// Shared by every run on this machine that sees the same temp folder (TEMP/TMP left as they are).
const LOCK = path.join(os.tmpdir(), "pingo-test.lock");
// Older than this, a lock whose PID still answers is a reused PID, not a run: a full run takes about a minute.
const LOCK_MAX_AGE_MS = 30 * 60_000;
// A lock file read empty or half-written this long after its last change was left by a crash mid-write.
const LOCK_WRITE_GRACE_MS = 5_000;
// A temp copy's removal retries a few times: Windows can still hold a file the runner just closed.
const REMOVE_DIR = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

const HELP = `Usage: node scripts/test.ts [options]

Runs the mod's tests (every *.test.ts and *.test.tsx) with \`claude plugin test\`, a few files at
a time, so at most --batch test processes run at once instead of one per CPU. Only one run at a
time: a second run waits for the first (lock file ${LOCK}).

Options:
  --batch <n>      Most test files per batch (default 8)
  --only <regex>   Run only the test files whose path matches, e.g. "deck/|review"
  --verbose        Print the runner's whole output, passing tests included
  -h, --help       Show this help

Exit code 1 when a test fails, 2 for a bad option.`;

interface Flags { batch: number; only?: RegExp; verbose: boolean }

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { batch: 8, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (next === undefined) fail(`${arg} needs a value`, 2);
      return next;
    };
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--batch") {
      const raw = value();
      flags.batch = Number(raw);
      if (!Number.isInteger(flags.batch) || flags.batch < 1) fail(`--batch needs a whole number of 1 or more, not ${raw}`, 2);
    } else if (arg === "--only") flags.only = new RegExp(value());
    else if (arg === "--verbose") flags.verbose = true;
    else fail(`unknown option ${arg}\n\n${HELP}`, 2);
  }
  return flags;
}

function fail(message: string, code = 1): never {
  console.error(`test: ${message}`);
  process.exit(code);
}

function git(args: readonly string[]): string {
  const run = spawnSync("git", args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, encoding: "utf8" });
  if (run.error) throw new Error(`could not run git (${run.error.message})`);
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout;
}

/** The working tree's files, untracked included, split into test files and the rest of the mod. */
function workingTree(): { tests: string[]; mod: string[] } {
  const files = git(["ls-files", "-co", "--exclude-standard", "-z"])
    .split("\0")
    .filter((file) => file && !SKIP.test(file) && fs.existsSync(path.join(ROOT, file)));
  return { tests: files.filter((file) => TEST.test(file)).sort(), mod: files.filter((file) => !TEST.test(file)) };
}

/** `files` in runs of at most `max`, as even as they go: 47 by 8 is 8, 8, 8, 8, 8, 7. */
function batchesOf<T>(files: readonly T[], max: number): T[][] {
  const count = Math.ceil(files.length / max);
  const batches: T[][] = [];
  for (let i = 0, start = 0; i < count; i++) {
    const size = Math.floor(files.length / count) + (i < files.length % count ? 1 : 0);
    batches.push(files.slice(start, (start += size)));
  }
  return batches;
}

function copy(files: readonly string[], from: string, to: string): void {
  for (const file of files) fs.cpSync(path.join(from, file), path.join(to, file));
}

/** Runs the staged mod's tests; with `echo`, its output also goes straight to the terminal. */
function runTests(dir: string, echo: boolean): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // Windows finds claude.cmd only through the shell: one quoted command line, not shell-joined args.
    const child = WINDOWS ? spawn(`claude plugin test "${dir}"`, { cwd: dir, shell: true }) : spawn("claude", ["plugin", "test", dir], { cwd: dir });
    let output = "";
    const take = (chunk: Buffer) => {
      output += chunk;
      if (echo) process.stdout.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => reject(new Error(`could not run claude (${error.message})`)));
    child.on("close", (code) => resolve({ code, output: output.replace(/\r\n/g, "\n") }));
  });
}

interface Tally { pass: number; fail: number; files: number }

/** The runner's closing lines: " 11 pass", " 1 fail", "Ran 12 tests across 3 files. [0.22s]". */
function tallyOf(output: string): Tally | undefined {
  const pass = /^\s*(\d+) pass$/m.exec(output);
  const failed = /^\s*(\d+) fail$/m.exec(output);
  const ran = /^Ran \d+ tests? across (\d+) files?\./m.exec(output);
  if (!pass || !ran) return undefined;
  return { pass: Number(pass[1]), fail: failed ? Number(failed[1]) : 0, files: Number(ran[1]) };
}

const FILE_HEADER = /^(\S.*\.test\.tsx?):$/;
const CLOSING = /^\s*\d+ (?:pass|fail)$|^Ran \d+ tests? across /;

/** The runner's output without its passing tests, the files left empty by that, and its closing tally. */
function problemsOf(output: string): { text: string; files: string[] } {
  const kept: string[] = [];
  const files: string[] = [];
  let pending: string | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("(pass) ") || CLOSING.test(line)) continue;
    const header = FILE_HEADER.exec(line);
    if (header) {
      pending = line;
      continue;
    }
    // The gap before a file's first problem, or after a file that had none.
    if (!line.trim() && (pending !== undefined || !kept.length)) continue;
    if (pending !== undefined) {
      files.push(FILE_HEADER.exec(pending)![1]!.replace(/\\/g, "/"));
      kept.push(pending);
      pending = undefined;
    }
    kept.push(line);
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(), files };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Holder { pid: number; startedAt: number; root: string }

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process is there, it only belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The lock's holder, or undefined while it is being written (or was left half-written). */
function readHolder(): Holder | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK, "utf8")) as Partial<Holder>;
    return typeof raw.pid === "number" && typeof raw.startedAt === "number" ? { pid: raw.pid, startedAt: raw.startedAt, root: String(raw.root ?? "") } : undefined;
  } catch {
    return undefined;
  }
}

/** Why the lock can be taken over, or undefined while its holder may still be running. */
function staleReason(holder: Holder | undefined): string | undefined {
  if (!holder) {
    const changed = fs.statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs;
    return changed !== undefined && Date.now() - changed > LOCK_WRITE_GRACE_MS ? "an unreadable lock file" : undefined;
  }
  if (!isRunning(holder.pid)) return `a lock left by PID ${holder.pid}, which is gone`;
  if (Date.now() - holder.startedAt > LOCK_MAX_AGE_MS) return `a lock from PID ${holder.pid} older than ${LOCK_MAX_AGE_MS / 60_000} min`;
  return undefined;
}

/** Waits until no other run holds the lock, then takes it. */
async function acquireLock(): Promise<Holder> {
  const asked = Date.now();
  let told = false;
  for (;;) {
    const me: Holder = { pid: process.pid, startedAt: Date.now(), root: ROOT };
    try {
      // "wx" creates the file only if it is not there: of two runs taking it at once, one wins.
      fs.writeFileSync(LOCK, JSON.stringify(me), { flag: "wx" });
      if (told) console.log(`test: the other run is done (waited ${seconds(Date.now() - asked)})`);
      return me;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error(`could not create the lock ${LOCK} (${(error as Error).message})`);
    }
    const holder = readHolder();
    const stale = staleReason(holder);
    if (stale) {
      // Only the lock just judged stale: another waiter may have replaced it with its own meanwhile.
      if (JSON.stringify(readHolder()) === JSON.stringify(holder)) fs.rmSync(LOCK, { force: true });
      console.log(`test: removed ${stale}`);
      continue;
    }
    if (!told && holder) {
      console.log(`test: another test run is going (PID ${holder.pid}, since ${new Date(holder.startedAt).toLocaleTimeString()}, ${holder.root}); waiting for it to end`);
      told = true;
    }
    await pause(1000);
  }
}

/** Removes the lock if it is still this run's. */
function releaseLock(me: Holder | undefined): void {
  if (!me) return;
  const holder = readHolder();
  if (holder?.pid === me.pid && holder.startedAt === me.startedAt) fs.rmSync(LOCK, { force: true });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { tests: all, mod } = workingTree();
  const tests = flags.only ? all.filter((file) => flags.only!.test(file)) : all;
  if (!tests.length) fail(flags.only ? `no test file matches ${flags.only}` : "no test files found");
  const batches = batchesOf(tests, flags.batch);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pingo-test-"));
  let lock: Holder | undefined;
  const cleanUp = () => {
    releaseLock(lock);
    // A cleanup failure (a file still held open on Windows) must not hide the run's own result.
    try {
      fs.rmSync(temp, REMOVE_DIR);
    } catch {
      console.error(`test: could not remove ${temp}; delete it by hand`);
    }
  };
  // Ctrl+C reaches the runner on its own; this only frees the lock and keeps the temp copies from piling up.
  process.once("SIGINT", () => {
    cleanUp();
    process.exit(130);
  });
  try {
    const modDir = path.join(temp, "mod");
    const testsDir = path.join(temp, "tests");
    // The snapshot comes before the wait: what runs is the tree as it was when the run was asked for.
    copy(mod, ROOT, modDir);
    copy(tests, ROOT, testsDir);
    lock = await acquireLock();
    console.log(`${count(tests.length, "test file")} in ${count(batches.length, "batch", "batches")} of up to ${flags.batch}, one batch at a time`);
    const total: Tally = { pass: 0, fail: 0, files: 0 };
    const failedFiles: string[] = [];
    let broken = false;
    const started = Date.now();
    for (const [index, batch] of batches.entries()) {
      const label = `batch ${index + 1}/${batches.length}`;
      const dir = path.join(temp, `batch-${index + 1}`);
      fs.cpSync(modDir, dir, { recursive: true });
      copy(batch, testsDir, dir);
      const began = Date.now();
      const { code, output } = await runTests(dir, flags.verbose);
      const tally = tallyOf(output);
      if (tally) {
        total.pass += tally.pass;
        total.fail += tally.fail;
        total.files += tally.files;
      }
      const ok = code === 0 && tally !== undefined && tally.fail === 0 && tally.files === batch.length;
      const counts = tally ? `${tally.pass} pass · ${tally.fail} fail` : `exit ${code}, no tally`;
      console.log(`${label} · ${count(batch.length, "file")} · ${counts} · ${seconds(Date.now() - began)}`);
      if (tally && tally.files !== batch.length) console.log(`  the runner reported ${tally.files} of the batch's ${batch.length} files`);
      if (!ok) {
        broken = true;
        const problems = problemsOf(output);
        failedFiles.push(...problems.files);
        if (!flags.verbose) console.log(problems.text || output.trimEnd().split("\n").slice(-40).join("\n"));
        if (!problems.files.length) failedFiles.push(...batch.map((file) => `${file} (${label})`));
      }
      // A file still held open is left for the final clean-up instead of stopping the run.
      try {
        fs.rmSync(dir, REMOVE_DIR);
      } catch {}
    }
    console.log(`\n${count(total.files, "file")} · ${total.pass} pass · ${total.fail} fail · ${seconds(Date.now() - started)}`);
    if (broken) {
      console.log(`Failed: ${[...new Set(failedFiles)].join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    cleanUp();
  }
}

await main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
