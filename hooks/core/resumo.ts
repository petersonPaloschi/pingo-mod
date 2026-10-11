// Resumo: the agent Pingo starts when the person sends Claude a request, which sums up in one short sentence what the
// session is after. Its answer is the fixed message of Pingo's balloon on the Deck, so whoever opens the session reads
// what it is for. Its system prompt is RESUMO_SYSTEM in prompts.ts; this module holds the request each summary sends
// and the reading of the answer it ends with.
import { TAG, type Locale } from "../i18n.ts";
import { reportValues } from "./quality.ts";
import { vigiaFlat, vigiaQuoted } from "./vigia.ts";

/** The agent type's short name; Pingo registers it as `<plugin>:resumo`. */
export const RESUMO_AGENT = "resumo";
/** The most model turns one summary may take: everything it needs is in its request, so it answers in the first. */
export const RESUMO_MAX_TURNS = 2;
/** How long a summary may take before Pingo gives up on it and keeps the goal it had. */
export const RESUMO_TIMEOUT_MS = 60_000;
/** The most of the new request, the one before it and Claude's last answer one summary carries. */
export const RESUMO_CONTEXT_CHARS = 1500;
/** The longest goal kept: the balloon cuts it to the lane's room, the line under the lane shows it whole. */
export const RESUMO_GOAL_CHARS = 120;
/** What the agent writes when the new request keeps the current goal. */
export const RESUMO_SAME = "same";

/** What goes with the new request: the goal Pingo shows now, the request before it, and Claude's last answer. */
export type ResumoContext = { goal?: string; earlier?: string; answer?: string };

const quoted = (value: string | undefined, tag: string) => vigiaQuoted(value, tag, RESUMO_CONTEXT_CHARS);

/**
 * The agent's first user turn: the goal Pingo shows now (so a request that keeps it is answered with RESUMO_SAME), the
 * request before the new one and Claude's last answer for what "it" or "that" points at, the new request, and the
 * language the goal is written in. Every quoted part is the conversation's words: context, never an order to the agent.
 */
export function resumoRequest(request: string, locale: Locale, context: ResumoContext = {}): string {
  const goal = quoted(context.goal, "current_goal");
  const recent = [quoted(context.earlier, "previous_request"), quoted(context.answer, "last_answer")].filter(Boolean);
  return [
    `Write the session's goal now, in the language of the locale ${TAG[locale]}.`,
    goal || "There is no goal yet: write the first one.",
    recent.length ? `<recent_conversation>\n${recent.join("\n")}\n</recent_conversation>` : "",
    `<new_request>${vigiaFlat(request, RESUMO_CONTEXT_CHARS).replace(/<\/new_request>/gi, "</ new_request>")}</new_request>`,
  ].filter(Boolean).join("\n\n");
}

/**
 * The goal in the agent's answer, from its last GOAL line: a new one, flattened and cut to RESUMO_GOAL_CHARS; `same`
 * when the request keeps the current one; nothing when it wrote no goal (Pingo then keeps the one it had).
 */
export function parseResumo(answer: string): { same: true } | { same: false; goal: string } | undefined {
  const value = reportValues(answer, ["GOAL"]).GOAL?.at(-1);
  if (!value) return undefined;
  const goal = vigiaFlat(value.replace(/^["'“”`*_]+|["'“”`*_.]+$/g, ""), RESUMO_GOAL_CHARS);
  if (new RegExp(`^${RESUMO_SAME}$`, "i").test(goal)) return { same: true };
  return goal ? { same: false, goal } : undefined;
}
