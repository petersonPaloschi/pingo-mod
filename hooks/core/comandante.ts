// The Comandante's pure parts: the one question Jev answers about an alert (a Farol assumption, a Semente idea, a
// Vigia message, a Clareza plan, a call the Code Quality agent would otherwise be refused), how its answer becomes a
// decision with a short reason, the records of the log every session of the project shares, and the filters of its tab.
// register.tsx holds every `$` call: the Jev call, the log files in the project's Vigia folder and the hooks.
import type { ComandanteDecision, ComandanteFilter, ComandanteRecord, ComandanteSource, ComandanteSources } from "../../types";
import type { Json, Questions, SystemOneResult } from "./types.ts";
import { vigiaFlat } from "./vigia.ts";

/** The question's name in Jev's request and in its answer. */
export const COMANDANTE_QUESTION = "verdict";
/** Records each session keeps in its own file. */
export const COMANDANTE_KEEP = 200;
/** Records the tab reads from every session's file together, newest first. */
export const COMANDANTE_SHOWN = 300;
/** The folder inside the project's Vigia folder: one file per session, `<sessionId>.json`. */
export const COMANDANTE_FOLDER = "comandante";
/** Every session and every decision: the tab's filters before any is picked. */
export const COMANDANTE_ALL = "all";
export const COMANDANTE_DECISIONS: readonly ComandanteDecision[] = ["approved", "rejected", "questioned"];
/** Every assistant that alerts the Comandante, in the order its tab lists their switches. */
export const COMANDANTE_SOURCES: readonly ComandanteSource[] = ["farol", "semente", "vigia", "clareza", "codeQuality"];

/** Every source switched on, or every one off: the tab's "All" button. */
export const comandanteSourcesAll = (on: boolean): ComandanteSources =>
  Object.fromEntries(COMANDANTE_SOURCES.map((source) => [source, on])) as ComandanteSources;

/** The sources the Comandante judges, as kept: only a source stored as `false` is off; anything else, or nothing, is on. */
export function normalizeComandanteSources(value: unknown): ComandanteSources {
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(COMANDANTE_SOURCES.map((source) => [source, stored[source] !== false])) as ComandanteSources;
}

/**
 * Each verdict Jev may give: the decision it stands for, and what it means, as Jev reads it (the option's criteria).
 * The verdict is the reason too: the tab and the tool's answer name it in the person's language.
 */
export const COMANDANTE_VERDICTS = {
  approve_fits: { decision: "approved", criteria: "Worth keeping: consistent with the user's request, the project and `known`." },
  approve_sound: { decision: "approved", criteria: "Not stated anywhere, but reasonable and low risk." },
  reject_duplicate: { decision: "rejected", criteria: "Repeats an item already in `known`." },
  reject_contradicts: { decision: "rejected", criteria: "Contradicts the user's request, a correction in `known`, or the project." },
  reject_risky: { decision: "rejected", criteria: "Could break things, lose data, or change behavior the user did not ask for." },
  reject_noise: { decision: "rejected", criteria: "Too trivial or too generic to be worth anyone's attention." },
  question_vague: { decision: "questioned", criteria: "Too vague to judge: what would change, and where, is unclear." },
  question_context: { decision: "questioned", criteria: "Depends on something only the user or the code can settle: needs evidence first." },
} as const satisfies Record<string, { decision: ComandanteDecision; criteria: string }>;
export type ComandanteReason = keyof typeof COMANDANTE_VERDICTS;

/**
 * What the Comandante judges: where it came from, its words, and what came with them (a context, a sender).
 * `nudge` marks a saved Semente idea about to be offered to the person, not one being saved.
 */
export type ComandanteAlert = { source: ComandanteSource; text: string; context?: string; nudge?: boolean };
/** Jev's verdict, read: the decision, the reason it stands on, and Jev's confidence in it. */
export type ComandanteVerdict = { decision: ComandanteDecision; reason: ComandanteReason; confidence: number };

const KIND: Record<ComandanteSource, string> = {
  farol: "assumption the agent made without the user saying so",
  semente: "out-of-scope idea the agent wants to save for later",
  vigia: "message another session of this project sent",
  clareza: "request to make the agent rewrite its last answer, because a reviewer found it may confuse the user (`alert` lists what may confuse)",
  codeQuality: "tool call the unattended Code Quality agent wants to make beyond the few it may run on its own",
};
const NUDGE_KIND = "idea saved earlier that matches the work just done, about to be offered to the user to pick up now (approve only if it is worth the user's attention now)";

/** The project a root names, as Sentinela shows it: its last folder. */
export const comandanteProject = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? root;

/**
 * Jev's request for one alert: the alert, what the user asked last, and the items already recorded of its kind
 * (`known`), so a repeat or a contradiction can be told. One choice question: its options are the verdicts.
 */
export function comandanteRequest(alert: ComandanteAlert, request: string, known: readonly string[]): { state: { [key: string]: Json }; questions: Questions } {
  const criteria: Record<string, Json> = Object.fromEntries(Object.entries(COMANDANTE_VERDICTS).map(([id, verdict]) => [id, verdict.criteria]));
  const kind = alert.nudge ? NUDGE_KIND : KIND[alert.source];
  return {
    state: {
      kind,
      alert: vigiaFlat(alert.text, 600),
      context: vigiaFlat(alert.context ?? "", 400),
      request: vigiaFlat(request, 600),
      known: known.slice(-20).map((item) => vigiaFlat(item, 200)),
    },
    questions: {
      [COMANDANTE_QUESTION]: {
        type: "choice",
        instructions: `Judge this ${kind} (\`alert\`, with \`context\`), given the user's latest request (\`request\`). Approve what holds, reject what should not stand, and question what the agent must clarify first.`,
        criteria,
      },
    },
  };
}

/** The verdict in Jev's answer, or undefined when it gave none that was offered. */
export function comandanteVerdict(result: Pick<SystemOneResult, "answers">): ComandanteVerdict | undefined {
  const answer = result.answers[COMANDANTE_QUESTION];
  if (answer?.type !== "choice" || !Object.hasOwn(COMANDANTE_VERDICTS, answer.choice)) return;
  const reason = answer.choice as ComandanteReason;
  return { decision: COMANDANTE_VERDICTS[reason].decision, reason, confidence: answer.confidence };
}

const isReason = (value: unknown): value is ComandanteReason => typeof value === "string" && Object.hasOwn(COMANDANTE_VERDICTS, value);

/** The records in a session's file, as another session wrote it: anything that is not a whole record is left out. */
export function comandanteRecords(raw: unknown): ComandanteRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): ComandanteRecord[] => {
    if (!value || typeof value !== "object") return [];
    const one = value as Record<string, unknown>;
    if (typeof one.id !== "string" || typeof one.at !== "number" || !Number.isFinite(one.at) || typeof one.session !== "string" || typeof one.summary !== "string") return [];
    if (!COMANDANTE_SOURCES.includes(one.source as ComandanteSource) || !COMANDANTE_DECISIONS.includes(one.decision as ComandanteDecision) || !isReason(one.reason)) return [];
    return [{
      id: one.id,
      at: one.at,
      session: one.session,
      sessionName: typeof one.sessionName === "string" && one.sessionName ? one.sessionName : one.session.slice(0, 8),
      project: typeof one.project === "string" ? one.project : "",
      source: one.source as ComandanteSource,
      ...(typeof one.agent === "string" && one.agent ? { agent: one.agent } : {}),
      summary: one.summary,
      decision: one.decision as ComandanteDecision,
      reason: one.reason,
      confidence: typeof one.confidence === "number" && Number.isFinite(one.confidence) ? one.confidence : 0,
      ...(typeof one.releasedAt === "number" && Number.isFinite(one.releasedAt) ? { releasedAt: one.releasedAt } : {}),
    }];
  });
}

/** Every session's records as one log: each once, newest first, at most COMANDANTE_SHOWN. */
export function mergeComandante(lists: readonly (readonly ComandanteRecord[])[]): ComandanteRecord[] {
  const byId = new Map<string, ComandanteRecord>();
  for (const list of lists) for (const record of list) if (!byId.has(record.id)) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, COMANDANTE_SHOWN);
}

/** The records a filter keeps: one session or all, one decision or all. */
export function filterComandante(list: readonly ComandanteRecord[], filter: ComandanteFilter): ComandanteRecord[] {
  return list.filter((record) =>
    (filter.session === COMANDANTE_ALL || record.session === filter.session) && (filter.decision === COMANDANTE_ALL || record.decision === filter.decision));
}

/** The sessions a log names, the latest to decide first, each with its name and project as last recorded. */
export function comandanteSessions(list: readonly ComandanteRecord[]): { id: string; name: string; project: string }[] {
  const seen = new Map<string, { id: string; name: string; project: string }>();
  for (const record of [...list].sort((a, b) => b.at - a.at)) if (!seen.has(record.session)) seen.set(record.session, { id: record.session, name: record.sessionName, project: record.project });
  return [...seen.values()];
}

/** How many records of each decision a log holds. */
export function comandanteCounts(list: readonly ComandanteRecord[]): Record<ComandanteDecision, number> {
  const counts: Record<ComandanteDecision, number> = { approved: 0, rejected: 0, questioned: 0 };
  for (const record of list) counts[record.decision]++;
  return counts;
}

/** A filter as kept: a session id or all, a decision or all. */
export function normalizeComandanteFilter(value: unknown): ComandanteFilter {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    session: typeof stored.session === "string" && stored.session ? stored.session : COMANDANTE_ALL,
    decision: COMANDANTE_DECISIONS.includes(stored.decision as ComandanteDecision) ? stored.decision as ComandanteDecision : COMANDANTE_ALL,
  };
}
