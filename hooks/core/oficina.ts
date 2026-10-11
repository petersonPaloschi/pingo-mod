// Oficina: when a session starts on a new Claude Code version, or with its context already very full, it runs
// `claude doctor` (which only reads) and Jev decides whether what it found is worth the person's time; when it is,
// Oficina suggests running /doctor, which Enviar puts in the prompt box for the person to send. Once per version. It
// is no Comandante source: its suggestion changes nothing by itself. This module holds the pure parts: what counts as
// a finding in doctor's output, Jev's question and its answer. register.tsx holds every `$` call.
import type { OficinaCheck } from "../../types";
import { readChoice } from "./selection.ts";
import type { Answer, Json, Questions } from "./types.ts";
import { vigiaFlat } from "./vigia.ts";

/** The share of the context window, at the session's start, from which Oficina looks: CLAUDE.md, skills and tools too heavy. */
export const OFICINA_CONTEXT_PERCENT = 40;
/** How long `claude doctor` may take. */
export const OFICINA_TIMEOUT_MS = 60_000;
/** How many checks the Oficina card keeps, newest first. */
export const OFICINA_HISTORY = 10;
/** What Enviar puts in the prompt box. */
export const OFICINA_COMMAND = "/doctor";

/** A line of doctor's output that says something is wrong or worth a look. */
const FINDING = /(?:✗|×|⚠|!\s|\bwarn(?:ing)?\b|\berror\b|\bfail(?:ed|s)?\b|\binvalid\b|\bmissing\b|\bnot found\b|\boutdated\b|\bunable\b|\bdeprecated\b)/i;
/** A line that only says nothing is wrong. */
const ALL_CLEAR = /\b(?:no (?:issues|errors|warnings|problems)|0 (?:errors|warnings|issues))\b/i;

/** The lines of `claude doctor`'s output that name a problem, each clipped, at most a dozen. */
export function doctorFindings(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && FINDING.test(line) && !ALL_CLEAR.test(line)).slice(0, 12).map((line) => line.slice(0, 200));
}

/** What set a check off: a new version (named with the one before it), or the context full at the start. */
export type OficinaFacts = { version: string; previous?: string; reason: OficinaCheck["reason"]; contextPercent?: number; findings: readonly string[]; output: string };

/** The question's name in Jev's request and answer. */
export const OFICINA_WORTH = "worth";
const WORTH_OPTIONS = ["show", "skip"] as const;

/** Jev's request: whether doctor's findings are worth suggesting the person run /doctor now. */
export function oficinaRequest(facts: OficinaFacts): { state: { [key: string]: Json }; questions: Questions } {
  return {
    state: {
      reason: facts.reason,
      version: facts.version,
      ...(facts.previous ? { previous_version: facts.previous } : {}),
      ...(facts.contextPercent !== undefined ? { context_percent_at_start: Math.round(facts.contextPercent) } : {}),
      findings: facts.findings.map((line) => vigiaFlat(line, 200)),
      output_tail: vigiaFlat(facts.output.split(/\r?\n/).slice(-30).join("\n"), 1500),
    },
    questions: {
      [OFICINA_WORTH]: {
        type: "choice",
        instructions: "A Claude Code session just started (`reason`). `claude doctor` checked the install and settings (`findings`, `output_tail`). Decide whether to suggest the user run /doctor now, which can fix what it finds.",
        criteria: {
          show: "Something needs the user: an error, a broken or invalid setting, a failing MCP server or hook, an outdated install, or a context too full at start.",
          skip: "All is healthy, or the lines are only informational.",
        },
      },
    },
  };
}

/** Jev's answer: whether to suggest /doctor; undefined below the least confidence (Oficina then says nothing). */
export function oficinaDecision(answers: Readonly<Record<string, Answer>>, min: number): boolean | undefined {
  const worth = readChoice(answers[OFICINA_WORTH], WORTH_OPTIONS, min).chosen;
  return worth ? worth.value === "show" : undefined;
}
