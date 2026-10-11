// Chaveiro: when the person approves the same kind of call for the third time, Jev weighs a permission rule for it:
// whether the call only reads, the narrowest rule that covers it, and the settings file to keep it in. The rule is
// written only with the person's Enviar, after the Comandante judged it. This module holds the pure parts: the
// pattern a call belongs to, its candidate rules, Jev's request and the change to a settings file. register.tsx holds
// every `$` call.
import type { ChaveiroRule } from "../../types";
import { SHELL_TOOLS } from "./quality.ts";
import { readChoice } from "./selection.ts";
import type { Answer, Json, Questions } from "./types.ts";
import { vigiaFlat } from "./vigia.ts";

/** Approvals of one kind of call before Chaveiro weighs a rule for it. */
export const CHAVEIRO_THRESHOLD = 3;
/** How many rules the Chaveiro card keeps, newest first. */
export const CHAVEIRO_HISTORY = 20;

/** The kind of call an approval counts toward, the call itself as a sample, and the rules that would cover it, narrowest first. */
export type ChaveiroPattern = { key: string; tool: string; sample: string; rules: string[] };

/** A shell line that runs more than one command: only its exact rule may cover it. */
const CHAINED = /[&;|`\n]|\$\(|>|</;
/** Programs that run or reach whatever their arguments say: only the exact call may be allowed, never a prefix. */
const OPEN_ENDED = /^(?:bash|sh|zsh|dash|fish|env|sudo|doas|xargs|eval|exec|nohup|timeout|watch|node|nodejs|deno|bun|python[\d.]*|py|ruby|perl|php|powershell|pwsh|cmd|npx|bunx|pnpx|uvx|find|awk|sed|curl|wget|ssh|scp)(?:\.exe)?$/i;

/**
 * The pattern a call belongs to, or undefined for a call Chaveiro leaves alone. A shell command is known by its first
 * two words (`git status`), with its exact rule, the rule for those words, and the rule for its program; a chained
 * line only by itself. A fetch is known by its domain, an MCP tool by its name.
 */
export function permissionPattern(tool: string, input: unknown): ChaveiroPattern | undefined {
  const fields = (input ?? {}) as Record<string, unknown>;
  if (SHELL_TOOLS.has(tool) && typeof fields.command === "string") {
    const command = fields.command.trim().replace(/[^\S\n]+/g, " ");
    if (!command || command.length > 300) return undefined;
    // a newline separates commands like `;` does, so it is tested before whitespace would hide it
    if (CHAINED.test(command)) return { key: `${tool}:${command}`, tool, sample: command, rules: [`${tool}(${command})`] };
    const words = command.split(" ");
    if (OPEN_ENDED.test(words[0]!.replace(/^.*[\\/]/, ""))) return { key: `${tool}:${command}`, tool, sample: command, rules: [`${tool}(${command})`] };
    const head = words.slice(0, 2).join(" ");
    const rules = [`${tool}(${command})`, ...(words.length > 2 ? [`${tool}(${head}:*)`] : []), ...(words.length > 1 ? [`${tool}(${words[0]}:*)`] : [])];
    return { key: `${tool}:${head}`, tool, sample: command, rules: [...new Set(rules)] };
  }
  if (tool === "WebFetch" && typeof fields.url === "string") {
    try {
      const host = new URL(fields.url).hostname;
      return host ? { key: `WebFetch:${host}`, tool, sample: fields.url, rules: [`WebFetch(domain:${host})`] } : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^mcp__\w+__\w+$/.test(tool)) return { key: tool, tool, sample: tool, rules: [tool] };
  return undefined;
}

/** The question names in Jev's request and answer. */
export const CHAVEIRO_READS = "reads";
export const CHAVEIRO_RULE = "rule";
export const CHAVEIRO_SCOPE = "scope";
const READ_OPTIONS = ["read_only", "changes", "unsure"] as const;
const SCOPES = ["local", "project", "user"] as const;

/**
 * Jev's request: whether the calls of the pattern only read, which candidate rule is the narrowest that still covers
 * what the person keeps approving, and where to keep it (this machine and project, the team's project file, or every
 * project of this person).
 */
export function chaveiroRequest(pattern: ChaveiroPattern, approved: number, samples: readonly string[]): { state: { [key: string]: Json }; questions: Questions } {
  return {
    state: {
      tool: pattern.tool,
      approved_times: approved,
      calls: samples.slice(-5).map((one) => vigiaFlat(one, 300)),
      rules: pattern.rules,
    },
    questions: {
      [CHAVEIRO_READS]: {
        type: "choice",
        instructions: "The user approved these calls (`calls`) again and again. Decide whether every call the rule would allow only reads.",
        criteria: {
          read_only: "They only read or inspect: no file written or deleted, nothing installed, pushed, sent over the network or run from the input.",
          changes: "Some change something: write or delete files, change git, install, push, post, or run arbitrary code.",
          unsure: "It depends on arguments not seen here.",
        },
      },
      [CHAVEIRO_RULE]: {
        type: "choice",
        instructions: "Pick the narrowest rule (`rules`, narrowest first) that still covers what the user keeps approving.",
        criteria: Object.fromEntries(pattern.rules.map((rule, i) => [rule, i === 0 ? "Exactly this call, nothing else." : `This rule, which allows more than the ones before it.`])),
      },
      [CHAVEIRO_SCOPE]: {
        type: "choice",
        instructions: "Pick where to keep the rule.",
        criteria: {
          local: "This project on this machine only (.claude/settings.local.json, not shared).",
          project: "This project for the whole team (.claude/settings.json, checked in).",
          user: "Every project of this user (~/.claude/settings.json).",
        },
      },
    },
  };
}

/** Jev's decision: a rule and a place, only when it judged with confidence that the calls only read. */
export function chaveiroDecision(answers: Readonly<Record<string, Answer>>, min: number, pattern: ChaveiroPattern): { rule: string; scope: ChaveiroRule["scope"] } | undefined {
  const reads = readChoice(answers[CHAVEIRO_READS], READ_OPTIONS, min).chosen;
  if (reads?.value !== "read_only") return undefined;
  const rule = readChoice(answers[CHAVEIRO_RULE], pattern.rules, min).chosen;
  const scope = readChoice(answers[CHAVEIRO_SCOPE], SCOPES, min).chosen;
  // without a confident pick, the narrowest rule, kept on this machine only
  return { rule: rule?.value ?? pattern.rules[0]!, scope: scope?.value ?? "local" };
}

/** The settings file a scope names. */
export function settingsFile(scope: ChaveiroRule["scope"], root: string, home: string): string {
  const base = scope === "user" ? home : root;
  return `${base.replace(/[\\/]$/, "")}/.claude/${scope === "local" ? "settings.local.json" : "settings.json"}`;
}

/**
 * A settings file's text with `rule` added to `permissions.allow`, every other key kept; a rule already there is not
 * added twice. A file that is not a JSON object throws: Chaveiro never overwrites settings it cannot read.
 */
export function addAllowRule(current: string | undefined, rule: string): string {
  const parsed: unknown = current?.trim() ? JSON.parse(current) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("the settings file is not a JSON object");
  const settings = parsed as { permissions?: { allow?: unknown } };
  const permissions = settings.permissions && typeof settings.permissions === "object" ? settings.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter((one): one is string => typeof one === "string") : [];
  return `${JSON.stringify({ ...settings, permissions: { ...permissions, allow: allow.includes(rule) ? allow : [...allow, rule] } }, null, 2)}\n`;
}
