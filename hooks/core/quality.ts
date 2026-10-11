// Code Quality: the agent Pingo starts after Claude changes code, which reviews the pending changes against the
// project's own patterns, fixes what it can and reports back, asking the person nothing. Its system prompt is
// QUALITY_SYSTEM in prompts.ts; this module holds the request each cycle sends, the permission rule its calls and
// its helpers' calls run under, the brief and limits of those helpers, and the reading of the report it ends with.
import type { ToolCheckResult } from "claude-code";
import type { QualityCycle, QualityItem } from "../../types";
import { TAG, type Locale } from "../i18n.ts";
import { QUALITY_HELPER_RULES } from "./prompts.ts";
import { vigiaRelative } from "./vigia.ts";

/** The agent type's short name; Pingo registers it as `<plugin>:code-quality`. */
export const QUALITY_AGENT = "code-quality";
/** The most model turns one cycle may take before it stops; each helper it waits for takes one. */
export const QUALITY_MAX_TURNS = 100;
/** The most helpers (subagents) one cycle may start. */
export const QUALITY_HELPERS = 6;
/** How many cycles the Code Quality tab keeps, newest first. */
export const QUALITY_HISTORY = 20;

/** Who a call of a running cycle comes from: the cycle's own agent, or a helper it started. */
export type QualityRole = "cycle" | "helper";

/** The first user turn of one cycle: what changed since the last one, how many helpers it may start, and the language the report is written in. */
export function qualityRequest(files: readonly string[], locale: Locale): string {
  const scope = files.length
    ? `Files changed since the last cycle, review these first: ${files.join(", ")}.`
    : "Review everything pending in git status.";
  return `Run one Code Quality cycle now. ${scope} You may start up to ${QUALITY_HELPERS} helpers. Write the report in the language of the locale ${TAG[locale]}.`;
}

/** Why a helper's own Agent call is refused: helpers run one level deep. */
const HELPER_STARTS_NONE = "A Code Quality helper cannot start agents of its own: do the job yourself.";

/** What a helper runs with: the cycle's limits, then the job the cycle agent gave it. */
export function qualityHelperBrief(job: string): string {
  return QUALITY_HELPER_RULES + job;
}

/**
 * Why a helper may not start, or nothing: only the cycle's own agent starts helpers, at most QUALITY_HELPERS a cycle,
 * each a plain subagent in the project itself (a teammate would outlive the cycle, another folder is not the review's).
 */
export function qualityHelperRefusal(started: number, parent: QualityRole, spawn: { isTeammate?: boolean; cwd?: string }): string | undefined {
  if (parent === "helper") return HELPER_STARTS_NONE;
  if (spawn.isTeammate) return "Code Quality's helpers are plain subagents: start one without a team.";
  if (spawn.cwd !== undefined) return "A Code Quality helper works in the project itself: start it without cwd or isolation.";
  if (started >= QUALITY_HELPERS) return `This cycle already started ${QUALITY_HELPERS} helpers, the most it may: do the rest yourself.`;
  return undefined;
}

const SHELLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);
/** The commands a cycle needs, each run alone: no pipe, redirect, chain or substitution may follow them. */
const QUALITY_COMMAND = /^\s*(?:git\s+(?:status|diff|log|show|ls-files|blame)|graft\s+(?:ask|grep|callers|skeleton|map))\b[^;&|<>`$\r\n]*$/;
/** The tools a cycle reads and edits the project with, each by the field that names its path. */
const QUALITY_PATH_FIELD: Readonly<Record<string, string>> = { Read: "file_path", Edit: "file_path", MultiEdit: "file_path", Grep: "path", Glob: "path" };
/** The code index's own tools, which only read it, and the search that loads them when they are deferred. */
const QUALITY_INDEX_TOOL = /^(?:mcp__graft__\w+|ToolSearch)$/;

const ABSOLUTE = /^(?:[a-zA-Z]:|\/)/;
/** Whether a path (absolute, or relative to the project) stays inside the project's root. */
function insideRoot(root: string, path: string): boolean {
  const candidate = path.replace(/\\/g, "/");
  const relative = ABSOLUTE.test(candidate) ? vigiaRelative(root, candidate) : candidate;
  return !ABSOLUTE.test(relative) && !relative.split("/").includes("..");
}

/**
 * Whether a call is one of the few a cycle makes: reading, searching and editing the project, its index, git's and
 * graft's read-only commands, and, for the cycle's own agent only, starting helpers.
 */
function qualityAllows(tool: string, input: unknown, root: string, role: QualityRole): boolean {
  const fields = (input ?? {}) as Record<string, unknown>;
  if (tool === "Agent") return role === "cycle";
  if (SHELLS.has(tool)) return typeof fields.command === "string" && QUALITY_COMMAND.test(fields.command);
  if (QUALITY_INDEX_TOOL.test(tool)) return true;
  const field = QUALITY_PATH_FIELD[tool];
  if (!field) return false;
  const path = fields[field];
  return path === undefined || (typeof path === "string" && insideRoot(root, path));
}

/**
 * The permission of one of the agent's or its helpers' calls, which never waits on the person and does not depend on
 * the session's mode: one of the cycle's own calls runs, anything else is refused, so text in the reviewed code cannot
 * lead it anywhere else (no commit, reset, install, download or write outside the project). A refusal by the
 * session's own rules stays.
 */
export function qualityVerdict(tool: string, input: unknown, verdict: ToolCheckResult, root: string, role: QualityRole = "cycle"): ToolCheckResult {
  if (verdict.decision === "deny") return verdict;
  if (qualityAllows(tool, input, root, role)) return { decision: "allow", reason: "Code Quality runs on its own." };
  if (tool === "Agent") return { decision: "deny", reason: HELPER_STARTS_NONE };
  return { decision: "deny", reason: `Code Quality runs unattended: it may only read, search and edit files inside the project, query graft, ${role === "cycle" ? "start helpers, " : ""}and run git status, diff, log, show, ls-files or blame and graft ask, grep, callers, skeleton or map, each alone. Leave everything else as it is.` };
}

/** Whether a call would have asked the person and is not one of the cycle's own: the one kind the Comandante may judge. */
export function qualityAsks(tool: string, input: unknown, verdict: ToolCheckResult, root: string, role: QualityRole = "cycle"): boolean {
  return verdict.decision === "ask" && !qualityAllows(tool, input, root, role);
}

/** One call in a line, as the Comandante reads it: the tool, then its command, its path or its input. */
export function qualityCall(tool: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  const named = [fields.command, fields.file_path, fields.path, fields.url].find((value) => typeof value === "string" && value);
  return `${tool}: ${typeof named === "string" ? named : JSON.stringify(input ?? {})}`.slice(0, 600);
}

const REPORT_LINE = /^[\s>*-]*\**(SUMMARY|REVIEWED|FIXED|SKIPPED)\**:\**\s*(.*)$/i;
const LOCATED = /^`?([^\s`]+:\d+(?:[-–]\d+)?)`?\s*[—–:-]\s*(.+)$/;

const itemOf = (value: string): QualityItem => {
  const found = LOCATED.exec(value);
  return found ? { where: found[1]!, text: found[2]!.trim() } : { text: value };
};

/** The report lines of the agent's answer; lines it did not write, or wrote as "none", leave their part empty. */
export function parseQualityReport(answer: string): Pick<QualityCycle, "reviewed" | "fixed" | "skipped" | "summary"> {
  const report: Pick<QualityCycle, "reviewed" | "fixed" | "skipped" | "summary"> = { reviewed: [], fixed: [], skipped: [] };
  for (const line of answer.split(/\r?\n/)) {
    const found = REPORT_LINE.exec(line);
    const value = found?.[2]!.trim() ?? "";
    if (!found || !value || /^none\.?$/i.test(value)) continue;
    const kind = found[1]!.toUpperCase();
    if (kind === "SUMMARY") report.summary = value;
    else if (kind === "REVIEWED") report.reviewed.push(...value.split(",").map((file) => file.trim().replace(/^`|`$/g, "")).filter(Boolean));
    else (kind === "FIXED" ? report.fixed : report.skipped).push(itemOf(value));
  }
  return report;
}
