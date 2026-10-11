// Portão: the gate Pingo puts before Claude's own `git commit` and `git push`. Jev decides whether to hold the command;
// held, the change set goes through Code Quality (a cycle over the files no cycle reviewed yet), the project's tests
// run with `--only` over the areas it touched, and, when Jev asks for one, an unattended reviewer reads the change for
// security problems. Only the person lets the command through again. This module holds the pure parts: which shell
// commands it gates, what git and the test runner say, the question Jev answers and the reviewer's report.
// register.tsx holds every `$` call.
import type { PortaoCheck, PortaoRun, QualityItem } from "../../types";
import { TAG, text, type Locale } from "../i18n.ts";
import { reportItem, reportValues, SHELL_TOOLS } from "./quality.ts";
import { readChoice } from "./selection.ts";
import type { Answer, Json, Questions } from "./types.ts";

/** The security reviewer's agent type, as Pingo registers it: `<plugin>:portao`. */
export const PORTAO_AGENT = "portao";
/** The most model turns the security reviewer takes. */
export const PORTAO_MAX_TURNS = 30;
/** How many runs the Portão card keeps, newest first. */
export const PORTAO_HISTORY = 20;
/** How long one `--only` test run may take: the host's own ceiling for a process. */
export const PORTAO_TEST_TIMEOUT_MS = 600_000;
/** The project's own test runner, which takes `--only <regex>` (CONTRIBUTING.md). */
export const PORTAO_RUNNER = "scripts/test.ts";

export type PortaoVerb = PortaoRun["verb"];

/**
 * A git commit or push as a command of its own: at the start, or after `&&`, `||`, `;`, `|` or a newline, with any of
 * git's global options (`-C dir`, `-c key=value`, `--no-pager`) before the verb.
 */
const SHIP = /(?:^|&&|\|\||[;|\n])\s*git(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?))*\s+(commit|push)\b/;

/** The git verb a shell call ships with, or undefined: the commands the gate holds. */
export function shipVerb(tool: string, input: unknown): PortaoVerb | undefined {
  if (!SHELL_TOOLS.has(tool)) return undefined;
  const command = (input as { command?: unknown } | undefined)?.command;
  if (typeof command !== "string") return undefined;
  const found = SHIP.exec(command);
  return found ? (found[1] as PortaoVerb) : undefined;
}

/** The paths `git status --porcelain` lists, a rename by its new name, quotes taken off. */
export function changedFiles(porcelain: string): string[] {
  const files = new Set<string>();
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const path = line.slice(3).split(" -> ").pop()!.trim().replace(/^"|"$/g, "");
    if (path) files.add(path.replace(/\\/g, "/"));
  }
  return [...files];
}

const TEST_FILE = /\.test\.(?:ts|tsx|mts|js|mjs)$/;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A file's name without its folders and extensions: `hooks/deck/cast.ts` → `cast`. */
const stem = (path: string) => path.split("/").pop()!.replace(/\.test(?=\.)/, "").replace(/\.[^.]+$/, "");

/**
 * The tests a change set reaches, from the files git tracks: a changed test file itself, and each test file whose
 * name holds a changed file's own name (`hooks/core/quality.ts` → `tests/quality.test.tsx`). The `--only` regex runs
 * exactly those files; none matched, none run. The whole suite never runs from here.
 */
export function testsFor(changed: readonly string[], tracked: readonly string[]): { files: string[]; only?: string } {
  const tests = tracked.filter((path) => TEST_FILE.test(path));
  const stems = new Set(changed.filter((path) => !TEST_FILE.test(path)).map(stem).filter((name) => name.length >= 3));
  const files = tests.filter((test) => changed.includes(test) || stems.has(stem(test)));
  return files.length ? { files, only: files.map((file) => escape(file.replace(/^tests\//, ""))).join("|") } : { files };
}

/** Whether the project has the test runner the gate drives. */
export const hasRunner = (tracked: readonly string[]) => tracked.includes(PORTAO_RUNNER);

/** What the runner printed last: its total line (`10 files · 127 pass · 0 fail · 13.4s`), when there is one. */
export function testTotals(stdout: string): { pass: number; fail: number } | undefined {
  const found = /(\d+)\s+pass\s*·\s*(\d+)\s+fail/.exec(stdout.split(/\r?\n/).filter((line) => /\bpass\b.*\bfail\b/.test(line)).pop() ?? "");
  return found ? { pass: Number(found[1]), fail: Number(found[2]) } : undefined;
}

/** The lines worth showing from a failed test run: the ones naming a failure, else its last few lines. */
export function testFailures(output: string): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const failing = lines.filter((line) => /(?:^|\s)(?:✗|×|FAIL|fail:|Error:|expected)/.test(line) && !/\b0 fail\b/.test(line));
  return (failing.length ? failing : lines.slice(-6)).slice(0, 8).map((line) => line.slice(0, 240));
}

/** The question names in Jev's request and its answer. */
export const PORTAO_HOLD = "hold";
export const PORTAO_TESTS = "tests";
export const PORTAO_SECURITY = "security";
const HOLD_OPTIONS = ["hold", "pass"] as const;
const TEST_OPTIONS = ["run", "skip"] as const;
const SECURITY_OPTIONS = ["review", "skip"] as const;

/** What Jev sees to decide: the command, the change set, what reviewed it already, and what the tests would cover. */
export type PortaoFacts = {
  verb: PortaoVerb;
  command: string;
  changed: readonly string[];
  /** `git diff HEAD --shortstat`, or the commits a push would send. */
  size: string;
  /** Changed files no Code Quality cycle reviewed since they last changed. */
  unreviewed: readonly string[];
  /** Whether Code Quality is on to review them. */
  quality: boolean;
  tests: readonly string[];
  /** The `--only` regex that runs exactly `tests`, when some are reached. */
  only?: string;
  /** Whether the tests passed after the last edit. */
  testsGreen: boolean;
  /** Whether another live session of the project runs its tests now. */
  othersTesting: boolean;
};

/**
 * Jev's request: whether to hold the command, whether to run the tests the change reaches (asked only when some do)
 * and whether a security review is needed. Choice questions only: Jev answers with its confidence in each.
 */
export function portaoRequest(facts: PortaoFacts): { state: { [key: string]: Json }; questions: Questions } {
  const questions: Questions = {
    [PORTAO_HOLD]: {
      type: "choice",
      instructions: `Claude is about to run \`git ${facts.verb}\`. Decide whether Pingo's gate holds it until checks run and the user approves.`,
      criteria: {
        hold: "Hold it: code changed since the last green tests or review (`unreviewed` lists files, or `tests_green` is false), or the change is risky.",
        pass: "Let it run now: nothing changed since the last checks, or the change only touches docs, comments or text.",
      },
    },
    [PORTAO_SECURITY]: {
      type: "choice",
      instructions: "Decide whether the change set needs a security review before it ships.",
      criteria: {
        review: "The change touches shell commands, process spawning, file writes or deletes, network or HTTP, auth, secrets, tokens, permissions, or untrusted input.",
        skip: "Nothing security-sensitive changed.",
      },
    },
  };
  if (facts.tests.length) questions[PORTAO_TESTS] = {
    type: "choice",
    instructions: "Decide whether to run the tests the change reaches (`tests`) before it ships.",
    criteria: {
      run: "Run them: code they cover changed and they have not passed since (`tests_green` is false).",
      skip: "Skip them: they passed after the last change, or the change cannot affect them.",
    },
  };
  return {
    state: {
      command: facts.command.slice(0, 300),
      verb: facts.verb,
      changed: facts.changed.slice(0, 60),
      size: facts.size.slice(0, 300),
      unreviewed: facts.unreviewed.slice(0, 60),
      code_quality_on: facts.quality,
      tests: facts.tests.slice(0, 30),
      tests_green: facts.testsGreen,
      other_session_testing: facts.othersTesting,
    },
    questions,
  };
}

/** Jev's decision, read: held or not, then which checks; undefined when it gave no confident hold answer. */
export type PortaoDecision = { hold: boolean; tests: boolean; security: boolean; confidence: number };

/** Below the least confidence the hold answer counts for nothing: the gate does not start. */
export function portaoDecision(answers: Readonly<Record<string, Answer>>, min: number): PortaoDecision | undefined {
  const hold = readChoice(answers[PORTAO_HOLD], HOLD_OPTIONS, min).chosen;
  if (!hold) return undefined;
  const tests = readChoice(answers[PORTAO_TESTS], TEST_OPTIONS, min).chosen;
  const security = readChoice(answers[PORTAO_SECURITY], SECURITY_OPTIONS, min).chosen;
  return { hold: hold.value === "hold", tests: tests?.value === "run", security: security?.value === "review", confidence: hold.confidence };
}

/** The security reviewer's first turn: the change set, and the language its report is written in. */
export function portaoReviewRequest(changed: readonly string[], locale: Locale): string {
  return `Review these changed files for security problems before they ship: ${changed.join(", ")}. Read \`git diff HEAD\` first. Write the report in the language of the locale ${TAG[locale]}.`;
}

/** The reviewer's report: its summary, each problem it found, and its verdict (`pass` when it found none that blocks). */
export function parsePortaoReport(answer: string): { summary?: string; issues: QualityItem[]; verdict?: "pass" | "fail" } {
  const values = reportValues(answer, ["SUMMARY", "ISSUE", "VERDICT"]);
  const verdict = values.VERDICT?.at(-1)?.toLowerCase();
  const summary = values.SUMMARY?.at(-1);
  return {
    ...(summary ? { summary } : {}),
    issues: (values.ISSUE ?? []).map(reportItem),
    ...(verdict?.startsWith("pass") ? { verdict: "pass" as const } : verdict?.startsWith("fail") ? { verdict: "fail" as const } : {}),
  };
}

/** Whether a run still waits on the person: its checks ended, and nobody sent, released or rejected it. */
export const portaoWaiting = (run: PortaoRun | undefined) => run?.state === "passed" || run?.state === "failed";

/**
 * The checks of a run a reload cut short, picked up with its change set read again. A check that ended keeps its
 * result. Code Quality waits for a cycle only while some changed file is unreviewed; the tests run again, since their
 * process went with the reload; the security review goes on while its reviewer is still at work, and starts again
 * when it is gone. None is left running for work nobody waits on any more.
 */
export function resumedChecks(checks: readonly PortaoCheck[], facts: Pick<PortaoFacts, "quality" | "unreviewed" | "only">, reviewerAlive: boolean, locale?: Locale): PortaoCheck[] {
  return checks.map((check): PortaoCheck => {
    if (check.state !== "waiting" && check.state !== "running") return check;
    if (check.kind === "quality") {
      if (!facts.quality) return { kind: "quality", state: "skipped", note: text("feature.portao.note.qualityOff", locale) };
      return facts.unreviewed.length ? { kind: "quality", state: "waiting" } : { kind: "quality", state: "passed", note: text("feature.portao.note.reviewed", locale) };
    }
    if (check.kind === "tests") return facts.only ? { kind: "tests", state: "waiting" } : { kind: "tests", state: "skipped", note: text("feature.portao.note.noTests", locale) };
    return check.state === "running" && reviewerAlive ? check : { kind: "security", state: "waiting" };
  });
}
