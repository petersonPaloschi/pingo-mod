// Ensaio: after a change that someone using the app would see, an agent of Pingo's own builds and opens the app,
// watches what happens and closes what it opened; a problem it sees becomes a fix request the person may send to
// Claude, and a project with no way to run its app gets a run book request instead. Jev decides first: whether the
// change shows, and whether the project says how to run it. Only Portão runs tests: Ensaio never does. This module
// holds the pure parts: Jev's question, the agent's first turn, the rule its calls run under and its report.
// register.tsx holds every `$` call.
import type { ToolCheckResult } from "claude-code";
import type { EnsaioRun, QualityItem } from "../../types";
import { TAG, type Locale } from "../i18n.ts";
import { reportItem, reportValues, SHELL_TOOLS } from "./quality.ts";
import { readChoice } from "./selection.ts";
import type { Answer, Json, Questions } from "./types.ts";
import { vigiaFlat } from "./vigia.ts";

/** The agent type's short name; Pingo registers it as `<plugin>:ensaio`. */
export const ENSAIO_AGENT = "ensaio";
/** The most model turns one run takes. */
export const ENSAIO_MAX_TURNS = 40;
/** How many runs the Ensaio card keeps, newest first. */
export const ENSAIO_HISTORY = 20;

/** What Jev sees: the files that changed, Code Quality's word on them, and how the project says its app runs. */
export type EnsaioFacts = {
  files: readonly string[];
  /** Code Quality's summary of the cycle that just ended, when one ran. */
  review?: string;
  /** The project's own commands and skills, as `/name: description`. */
  commands: readonly string[];
  /** The scripts its package.json names. */
  scripts: readonly string[];
};

/** The question names in Jev's request and answer. */
export const ENSAIO_VISIBLE = "visible";
export const ENSAIO_RUNBOOK = "runbook";
const VISIBLE_OPTIONS = ["visible", "internal"] as const;
const RUNBOOK_OPTIONS = ["has_runbook", "none"] as const;

/** Jev's request: whether someone using the app would see the change, and whether the project says how to run it. */
export function ensaioRequest(facts: EnsaioFacts): { state: { [key: string]: Json }; questions: Questions } {
  return {
    state: {
      files: facts.files.slice(0, 60),
      ...(facts.review ? { review: vigiaFlat(facts.review, 400) } : {}),
      commands: facts.commands.slice(0, 40).map((line) => vigiaFlat(line, 160)),
      scripts: facts.scripts.slice(0, 40),
    },
    questions: {
      [ENSAIO_VISIBLE]: {
        type: "choice",
        instructions: "Code just changed (`files`). Decide whether someone using the app would see the change when they run it.",
        criteria: {
          visible: "The change reaches what the app shows or does when run: a screen, a command's output, an API's answer, a file it writes.",
          internal: "Only internals, tests, docs, comments or tooling changed: running the app would show nothing new.",
        },
      },
      [ENSAIO_RUNBOOK]: {
        type: "choice",
        instructions: "Decide whether the project says how to build and launch its app (`commands`, `scripts`).",
        criteria: {
          has_runbook: "A command, skill or script builds and launches the app (a run skill, `dev`, `start`, `serve`).",
          none: "Nothing says how to launch it: only tests, lint or packaging, or nothing at all.",
        },
      },
    },
  };
}

/** Jev's decision, read; undefined without a confident answer on whether the change shows (the run does not start). */
export function ensaioDecision(answers: Readonly<Record<string, Answer>>, min: number): { visible: boolean; runbook: boolean } | undefined {
  const visible = readChoice(answers[ENSAIO_VISIBLE], VISIBLE_OPTIONS, min).chosen;
  if (!visible) return undefined;
  const runbook = readChoice(answers[ENSAIO_RUNBOOK], RUNBOOK_OPTIONS, min).chosen;
  return { visible: visible.value === "visible", runbook: runbook?.value === "has_runbook" };
}

/** The agent's first turn: what changed, how the project says it runs, and the language its report is written in. */
export function ensaioRunRequest(facts: EnsaioFacts, locale: Locale): string {
  return [
    `Run the app to see this change working: ${facts.files.join(", ")}.`,
    facts.commands.length ? `The project's own commands and skills:\n${facts.commands.map((line) => `- ${line}`).join("\n")}` : "",
    facts.scripts.length ? `Its package.json scripts: ${facts.scripts.join(", ")}.` : "",
    `Write the report in the language of the locale ${TAG[locale]}.`,
  ].filter(Boolean).join("\n\n");
}

/** The agent's report: what it ran, its verdict, the problems it saw and the fix it asks for. */
export function parseEnsaioReport(answer: string): Pick<EnsaioRun, "summary" | "verdict" | "problems"> & { ran?: string; fix?: string } {
  const values = reportValues(answer, ["SUMMARY", "RAN", "VERDICT", "PROBLEM", "FIX"]);
  const verdict = values.VERDICT?.at(-1)?.toLowerCase().replace(/[\s-]+/g, "_");
  const summary = values.SUMMARY?.at(-1);
  const ran = values.RAN?.at(-1);
  const fix = values.FIX?.join("\n");
  return {
    ...(summary ? { summary } : {}),
    ...(verdict?.startsWith("works") ? { verdict: "works" as const } : verdict?.startsWith("broken") ? { verdict: "broken" as const } : verdict?.startsWith("not_run") ? { verdict: "not_run" as const } : {}),
    problems: (values.PROBLEM ?? []).map(reportItem),
    ...(ran ? { ran } : {}),
    ...(fix ? { fix } : {}),
  };
}

/** What Ensaio's agent may never run, alone or inside a longer line: writing to git, deleting, installing, testing. */
const ENSAIO_DENIED: readonly { pattern: RegExp; why: string }[] = [
  // options may stand between `git` and the verb (`git -C dir commit`, `git -c k=v push`)
  { pattern: /\bgit\b[^\n;&|]*?\s(?:commit|push|pull|add|reset|checkout|switch|restore|clean|stash|rebase|merge|cherry-pick|revert|rm|mv|tag|branch\s+-[dD]|apply|am)\b/, why: "it never changes git's history or working tree" },
  { pattern: /(?:^|[\s;&|(])(?:rm|rmdir|del|erase|rd|unlink|shred)\s|Remove-Item|Clear-Content|\bfind\b[^\n]*-delete/i, why: "it never deletes files" },
  { pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:i|ci|install|add|remove|rm|uninstall|update|upgrade|publish|link)\b|\bpip\d*\s+install\b|\bcargo\s+(?:install|publish)\b|\bgo\s+install\b|\bbrew\s+install\b|\bapt(?:-get)?\s+install\b|\bwinget\s+install\b|\bchoco\s+install\b/i, why: "it never installs or publishes packages" },
  { pattern: /scripts[\\/]test\.ts|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bbun\s+test\b|\b(?:pytest|jest|vitest|mocha)\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b/i, why: "only Portão runs the tests" },
  { pattern: /\bclaude\s+(?:config|mcp\s+(?:add|remove)|plugin\s+(?:install|uninstall|enable|disable))\b|settings(?:\.local)?\.json/i, why: "it never changes settings" },
];

const ENSAIO_WRITES: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * The permission of one of Ensaio's calls, which runs unattended and never waits on the person: no file is written,
 * no agent started, and no shell command that changes git, deletes, installs, tests or touches settings. Anything
 * else may build and run the app, as the person allowed when they turned Ensaio on; the session's own refusals stay,
 * and so does a rule of theirs that asks first (no one is there to answer: it is refused).
 */
export function ensaioVerdict(tool: string, input: unknown, verdict: ToolCheckResult): ToolCheckResult {
  if (verdict.decision === "deny") return verdict;
  if (ENSAIO_WRITES.has(tool)) return { decision: "deny", reason: "Ensaio runs unattended and never writes files: report what you saw instead." };
  if (tool === "Agent" || tool === "AskUserQuestion") return { decision: "deny", reason: "Ensaio runs unattended: do the run yourself and ask no one." };
  const command = (input as { command?: unknown } | undefined)?.command;
  if (SHELL_TOOLS.has(tool) && typeof command === "string") {
    const denied = ENSAIO_DENIED.find((one) => one.pattern.test(command));
    if (denied) return { decision: "deny", reason: `Ensaio refused this command: ${denied.why}. Leave it out and report what you could see.` };
  }
  if (verdict.decision === "ask" && verdict.rule) return { decision: "deny", reason: "The person's settings ask before this call, and Ensaio runs unattended: leave it out." };
  return { decision: "allow", reason: "Ensaio runs the app on its own." };
}

/** Whether a run's proposal still waits on the person (sent or rejected ones do not). */
export const ensaioWaiting = (run: EnsaioRun | undefined) => run?.proposal?.state === "waiting" || run?.proposal?.state === "blocked";
