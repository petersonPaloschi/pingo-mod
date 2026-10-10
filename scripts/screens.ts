#!/usr/bin/env node
// Screens: text captures of the band above the prompt and every /jev tab, before and after a change.
// "Before" is a git ref (HEAD by default), "after" the working tree, untracked files included. Each
// side is staged in a temp copy of the mod with only tests/screens.snap.tsx as its test (the current
// scenes and tests/textshot.ts on both sides, so only the mod's code differs), run with
// `claude plugin test`, and its screens written one file each, with a diff of what changed.
// Run with Node 22.18+ from the checkout: node scripts/screens.ts --help
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENES = "tests/screens.snap.tsx";
const SUPPORT = ["tests/textshot.ts"];
const SKIP = /\.test\.(?:ts|tsx|mjs)$|^(?:bench|docs)\//;
const WINDOWS = process.platform === "win32";

const HELP = `Usage: node scripts/screens.ts [options]

Captures every screen in ${SCENES} as text, before and after your change.

Options:
  --base <ref>     What "before" is: a commit, branch or tag (default HEAD)
  --out <dir>      Where to write before/, after/ and changes.diff (default .screens)
  --only <regex>   Capture only the screens whose name matches, e.g. "pane (ai|live)"
  --after-only     Capture the working tree only, no before and no diff
  -h, --help       Show this help

Screen names: "band expanded 100", "band collapsed rings 60", "pane overview 80", ...
Exit code 1 when a capture fails.`;

interface Flags { base: string; out: string; only?: RegExp; afterOnly: boolean }

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { base: "HEAD", out: path.join(ROOT, ".screens"), afterOnly: false };
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
    } else if (arg === "--base") flags.base = value();
    else if (arg === "--out") flags.out = path.resolve(value());
    else if (arg === "--only") flags.only = new RegExp(value());
    else if (arg === "--after-only") flags.afterOnly = true;
    else fail(`unknown option ${arg}\n\n${HELP}`, 2);
  }
  return flags;
}

function fail(message: string, code = 1): never {
  console.error(`screens: ${message}`);
  process.exit(code);
}

function git(args: readonly string[], options: { encoding?: "buffer" } = {}): string | Buffer {
  const run = spawnSync("git", args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, ...(options.encoding ? {} : { encoding: "utf8" }) });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(run.stderr).trim()}`);
  return run.stdout;
}

/** The scenes and their renderer, from the working tree, as the staged mod's only test. */
function addScenes(dir: string): void {
  for (const file of SUPPORT) fs.cpSync(path.join(ROOT, file), path.join(dir, file));
  fs.cpSync(path.join(ROOT, SCENES), path.join(dir, "tests/screens.test.tsx"));
}

/** Every test file out, so the run is only the scenes. */
function dropTests(dir: string, rel = ""): void {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const file = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) {
      if (/^(?:bench|docs|\.git)$/.test(file)) fs.rmSync(path.join(dir, file), { recursive: true, force: true });
      else dropTests(dir, file);
    } else if (SKIP.test(file)) fs.rmSync(path.join(dir, file));
  }
}

function stageWorkingTree(dir: string): void {
  const files = String(git(["ls-files", "-co", "--exclude-standard", "-z"])).split("\0").filter((file) => file && !SKIP.test(file));
  for (const file of files) {
    const from = path.join(ROOT, file);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, file));
  }
  addScenes(dir);
}

function stageRef(dir: string, ref: string): void {
  const sha = String(git(["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  const archive = `${path.basename(dir)}.tar`;
  fs.writeFileSync(path.join(dir, "..", archive), git(["archive", "--format=tar", sha], { encoding: "buffer" }) as Buffer);
  fs.mkdirSync(dir, { recursive: true });
  // A relative archive path: GNU tar reads "C:\..." as a remote host.
  const untar = spawnSync("tar", ["-xf", `../${archive}`], { cwd: dir, encoding: "utf8" });
  if (untar.status !== 0) throw new Error(`could not unpack ${ref}: ${untar.stderr.trim()}`);
  fs.rmSync(path.join(dir, "..", archive));
  dropTests(dir);
  addScenes(dir);
}

/** Runs the staged mod's tests and returns the screens it printed, by name. */
function capture(dir: string, label: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    // Windows finds claude.cmd only through the shell: one quoted command line, not shell-joined args.
    const child = WINDOWS ? spawn(`claude plugin test "${dir}"`, { cwd: dir, shell: true }) : spawn("claude", ["plugin", "test", dir], { cwd: dir });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => reject(new Error(`${label}: could not run claude (${error.message})`)));
    child.on("close", (code) => {
      const text = output.replace(/\r\n/g, "\n");
      const tail = (lines: number) => text.split("\n").slice(-lines).join("\n");
      if (code !== 0) return reject(new Error(`${label}: the capture failed (exit ${code}). Its output, last lines:\n${tail(40)}`));
      const screens = new Map<string, string>();
      for (const match of text.matchAll(/^===== (.+)\n([\s\S]*?)\n===== END$/gm)) screens.set(match[1]!.trim(), match[2]!);
      if (!screens.size) return reject(new Error(`${label}: no screens in the output. Last lines:\n${tail(20)}`));
      resolve(screens);
    });
  });
}

const fileOf = (name: string) => `${name.replace(/[^\w.-]+/g, "-")}.txt`;

function write(dir: string, screens: Map<string, string>, only: RegExp | undefined): string[] {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const names = [...screens.keys()].filter((name) => !only || only.test(name));
  for (const name of names) fs.writeFileSync(path.join(dir, fileOf(name)), `${screens.get(name)!}\n`);
  return names;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (!fs.existsSync(path.join(ROOT, SCENES))) fail(`${SCENES} is missing`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pingo-screens-"));
  try {
    // Both sides are staged before either run starts: a bad ref then stops with nothing left running.
    const afterDir = path.join(temp, "after");
    const beforeDir = path.join(temp, "before");
    if (!flags.afterOnly) stageRef(beforeDir, flags.base);
    stageWorkingTree(afterDir);
    const runs = [capture(afterDir, "after (working tree)"), ...(flags.afterOnly ? [] : [capture(beforeDir, `before (${flags.base})`)])];
    // Both runs end before anything is read or removed: a failed one leaves the other running otherwise.
    const settled = await Promise.allSettled(runs);
    const failed = settled.find((run) => run.status === "rejected");
    if (failed) throw failed.reason;
    const [after, before] = settled.map((run) => (run as PromiseFulfilledResult<Map<string, string>>).value);
    fs.mkdirSync(flags.out, { recursive: true });
    const afterNames = write(path.join(flags.out, "after"), after!, flags.only);
    const rel = path.relative(process.cwd(), flags.out) || ".";
    if (!before) {
      console.log(`${afterNames.length} screens → ${path.join(rel, "after")}`);
      return;
    }
    const beforeNames = write(path.join(flags.out, "before"), before, flags.only);
    const all = [...new Set([...beforeNames, ...afterNames])];
    const changed = all.filter((name) => before.get(name) !== after!.get(name));
    const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "--", "before", "after"], { cwd: flags.out, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(flags.out, "changes.diff"), diff.stdout ?? "");
    console.log(`${all.length} screens · ${changed.length} changed (before: ${flags.base}, after: working tree)`);
    for (const name of changed) {
      const mark = !before.has(name) ? "+" : !after!.has(name) ? "-" : "~";
      console.log(`  ${mark} ${name}  ${path.join(rel, "after", fileOf(name))}`);
    }
    console.log(`Files: ${path.join(rel, "before")}, ${path.join(rel, "after")}, diff: ${path.join(rel, "changes.diff")}`);
  } finally {
    // A cleanup failure (a file still held open on Windows) must not hide the run's own error.
    try {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.error(`screens: could not remove ${temp}; delete it by hand`);
    }
  }
}

await main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
