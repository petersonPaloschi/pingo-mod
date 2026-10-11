// Lapida: the person's draft prompt goes to an agent of Pingo's own, which rewrites it; its answer replaces the draft
// in the prompt box for the person to review and send. Its system prompt is LAPIDA_SYSTEM in prompts.ts; this module
// holds the request each rewrite sends and the reading of the answer it ends with.
import { vigiaFlat, vigiaQuoted } from "./vigia.ts";

/** The agent type's short name; Pingo registers it as `<plugin>:lapida`. */
export const LAPIDA_AGENT = "lapida";
/** The most model turns one rewrite may take: a few lookups and the answer. */
export const LAPIDA_MAX_TURNS = 6;
/** How long a rewrite may take before Lapida gives up on it and frees the band. */
export const LAPIDA_TIMEOUT_MS = 90_000;
/** The line between the rewrite and the notes on what it added. */
export const LAPIDA_MARK = "<<<CHANGES>>>";
/** The most of the person's last request, and of Claude's last answer, one rewrite carries. */
export const LAPIDA_CONTEXT_CHARS = 1500;
/** The most commands one rewrite names, each cut to a line. */
export const LAPIDA_COMMANDS = 40;

/** What goes with the draft: the person's taste, the conversation so far, the commands they can name. */
export type LapidaContext = { taste?: string; asked?: string; answer?: string; commands?: readonly string[] };

const quoted = (value: string | undefined, tag: string) => vigiaQuoted(value, tag, LAPIDA_CONTEXT_CHARS);

/**
 * The agent's first user turn: the rewrite rules in the person's language (`instructions`, which name LAPIDA_MARK),
 * what they taught Lapida by editing its rewrites, the last request and answer of the conversation (so "that file"
 * resolves without the conversation itself), the installed commands, and the draft.
 */
export function lapidaRequest(instructions: string, draft: string, context: LapidaContext = {}): string {
  const recent = [quoted(context.asked, "last_request"), quoted(context.answer, "last_answer")].filter(Boolean);
  return [
    instructions,
    context.taste ?? "",
    recent.length ? `<recent_conversation>\n${recent.join("\n")}\n</recent_conversation>` : "",
    context.commands?.length ? `<commands>\n${context.commands.slice(0, LAPIDA_COMMANDS).map((line) => vigiaFlat(line, 120)).join("\n")}\n</commands>` : "",
    `<rough_prompt>\n${draft}\n</rough_prompt>`,
  ].filter(Boolean).join("\n\n");
}

/**
 * The rewrite, and up to three short notes on what it added, from the agent's answer. An answer without the mark is
 * no rewrite (an agent stopped at its turn limit mid-lookup ends with its last words): it gives no text.
 */
export function splitLapidaReply(raw: string): { text: string; notes: string[] } {
  const at = raw.lastIndexOf(LAPIDA_MARK);
  if (at < 0) return { text: "", notes: [] };
  return {
    text: raw.slice(0, at).trim(),
    notes: raw.slice(at + LAPIDA_MARK.length).split("\n").map((line) => line.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 3).map((line) => (line.length > 80 ? `${line.slice(0, 79)}…` : line)),
  };
}
