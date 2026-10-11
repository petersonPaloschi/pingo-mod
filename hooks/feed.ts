// The live log's wording: short summaries of what can be observed (requests, tools, agents,
// visible messages, Jev's answers). Never the model's reasoning: thinking is not read here.
import type { FeatureFlags, FeatureId } from "../types";
import type { JevAsk, JevSent } from "./core/jev.ts";
import { EFFORT_KEY, MODEL_KEY } from "./core/plan.ts";
import type { Answer, SystemOneResult } from "./core/types.ts";
import { formatCompact, formatDecimal, formatNumber, localeFor, TAG, text, type Locale, type LocaleKey } from "./i18n.ts";

/** Each feature, its one-click toggle key, and a short description. */
const FEATURE_KEYS: readonly { id: FeatureId; name: LocaleKey; hotkey: string; description: LocaleKey }[] = [
  {
    id: "agents",
    name: "feature.agents.name",
    hotkey: "g",
    description: "feature.agents.description",
  },
  { id: "farol", name: "feature.farol.name", hotkey: "f", description: "feature.farol.description" },
  { id: "clareza", name: "feature.clareza.name", hotkey: "c", description: "feature.clareza.description" },
  { id: "pingoVivo", name: "feature.pingoVivo.name", hotkey: "p", description: "feature.pingoVivo.description" },
  { id: "prisma", name: "feature.prisma.name", hotkey: "r", description: "feature.prisma.description" },
  { id: "semente", name: "feature.semente.name", hotkey: "i", description: "feature.semente.description" },
  { id: "lapida", name: "feature.lapida.name", hotkey: "l", description: "feature.lapida.description" },
  { id: "sentinela", name: "feature.sentinela.name", hotkey: "s", description: "feature.sentinela.description" },
  { id: "vigia", name: "feature.vigia.name", hotkey: "v", description: "feature.vigia.description" },
  { id: "contexto", name: "feature.contexto.name", hotkey: "x", description: "feature.contexto.description" },
  { id: "codeQuality", name: "feature.codeQuality.name", hotkey: "k", description: "feature.codeQuality.description" },
  { id: "comandante", name: "feature.comandante.name", hotkey: "m", description: "feature.comandante.description" },
  { id: "portao", name: "feature.portao.name", hotkey: "t", description: "feature.portao.description" },
  { id: "rumo", name: "feature.rumo.name", hotkey: "u", description: "feature.rumo.description" },
  { id: "ensaio", name: "feature.ensaio.name", hotkey: "n", description: "feature.ensaio.description" },
  { id: "chaveiro", name: "feature.chaveiro.name", hotkey: "h", description: "feature.chaveiro.description" },
  { id: "oficina", name: "feature.oficina.name", hotkey: "w", description: "feature.oficina.description" },
];

export const features = (locale: Locale = localeFor()) => FEATURE_KEYS.map((feature) => ({
  ...feature,
  name: text(feature.name, locale),
  description: text(feature.description, locale),
}));

export const short = (text: string, max = 80) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
};

/** A tool call in a few words: the argument that tells calls apart, never all of them. */
export function toolSummary(tool: string, input: Record<string, unknown>): string {
  const pick = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined);
  const detail =
    pick("command") ??
    pick("file_path") ??
    pick("pattern") ??
    pick("description") ??
    pick("url") ??
    pick("query") ??
    pick("path") ??
    pick("skill");
  return detail ? `${tool} ${short(detail, 60)}` : tool;
}

/**
 * A tool call's finer points, for the small line under it: the whole command, the search and
 * where it looks, the range read, the size of an edit. Empty when the summary already says it all.
 */
export function toolDetails(tool: string, input: Record<string, unknown>, locale: Locale = localeFor()): string {
  const fieldText = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined);
  const number = (key: string) => (typeof input[key] === "number" ? (input[key] as number) : undefined);
  const lines = (value: string | undefined) => (value === undefined ? 0 : value.split("\n").length);
  const parts: (string | undefined)[] = [];
  switch (tool) {
    case "Bash":
    case "PowerShell": {
      const command = fieldText("command") ?? "";
      if (command.length > 60) parts.push(short(command, 160));
      parts.push(fieldText("description"), input.run_in_background ? text("feed.detail.background", locale) : undefined);
      const timeout = number("timeout");
      if (timeout) parts.push(text("feed.detail.timeout", locale, { seconds: formatNumber(Math.round(timeout / 1000), locale) }));
      break;
    }
    case "Read": {
      const offset = number("offset");
      const limit = number("limit");
      if (offset !== undefined || limit !== undefined) parts.push(text("feed.detail.lines", locale, { start: formatNumber(offset ?? 1, locale), end: limit === undefined ? "end" : formatNumber((offset ?? 1) + limit - 1, locale) }));
      parts.push(fieldText("pages") ? text("feed.detail.pages", locale, { pages: fieldText("pages")! }) : undefined);
      break;
    }
    case "Edit":
      parts.push(text("feed.detail.editLines", locale, { removed: formatNumber(lines(fieldText("old_string")), locale), added: formatNumber(lines(fieldText("new_string")), locale) }), input.replace_all ? text("feed.detail.everyMatch", locale) : undefined);
      break;
    case "Write":
      parts.push(text("feed.output.lines", locale, { count: formatNumber(lines(fieldText("content")), locale) }));
      break;
    case "Grep":
      parts.push(fieldText("path") ? text("feed.detail.path", locale, { path: fieldText("path")! }) : undefined, fieldText("glob") ? text("feed.detail.glob", locale, { glob: fieldText("glob")! }) : undefined, fieldText("type") ? text("feed.detail.type", locale, { type: fieldText("type")! }) : undefined, fieldText("output_mode"));
      break;
    case "Glob":
      parts.push(fieldText("path") ? text("feed.detail.path", locale, { path: fieldText("path")! }) : undefined);
      break;
    case "Agent":
    case "Task":
      parts.push(fieldText("subagent_type"), fieldText("model") ? text("feed.detail.model", locale, { model: fieldText("model")! }) : undefined, fieldText("prompt") ? short(fieldText("prompt")!, 160) : undefined);
      break;
    case "WebFetch":
      parts.push(fieldText("prompt") ? short(fieldText("prompt")!, 160) : undefined);
      break;
    case "Skill":
      parts.push(fieldText("args") ? short(fieldText("args")!, 120) : undefined);
      break;
    default: {
      // Any other tool: its short scalar arguments, by name.
      for (const [key, value] of Object.entries(input)) {
        if (["tool", "tool_use_id", "agentId", "turnId"].includes(key)) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") parts.push(`${key} ${short(String(value), 50)}`);
        if (parts.length >= 4) break;
      }
    }
  }
  return parts.filter(Boolean).join(" · ");
}

/** How big a tool's output was, in a few words: "120 lines", "3.4k chars", "empty". */
export function outputSize(value: string, locale: Locale = localeFor()): string {
  if (!value.trim()) return text("feed.output.empty", locale);
  const lines = value.split("\n").length;
  return lines > 1
    ? text("feed.output.lines", locale, { count: formatCompact(lines, locale) })
    : text("feed.output.chars", locale, { count: formatCompact(value.length, locale) });
}

/** "claude-opus-5-5" → "opus-5-5": the part of an id that tells models apart. */
export const modelName = (id: string | undefined) => (id ? id.replace(/^claude-/, "").replace(/-\d{8}$/, "") : "?");

/** A response's usage as Claude Code reports it. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export const featureFlagsText = (flags: FeatureFlags, locale: Locale = localeFor()) => {
  const names = features(locale).filter((feature) => flags[feature.id]).map((feature) => feature.name);
  return names.length ? new Intl.ListFormat(TAG[locale], { style: "short", type: "conjunction" }).format(names) : text("feed.none", locale);
};

const percent = (value: number, locale: Locale) => `${formatDecimal(value * 100, locale, 1)}%`;

/** Where a Jev call was asked from: the routing point, and what set it off (a tool, a subagent type). */
export interface JevCaller {
  origin: "agent" | "sift" | "setup" | "prompt" | "unit" | "context" | "comandante" | "portao" | "ensaio" | "rumo" | "chaveiro" | "oficina";
  trigger?: string;
}

/** The function in hooks/core that asked, so the log names exactly what ran. */
const ASKED_BY: Record<JevCaller["origin"], string> = {
  agent: "planAgent()",
  sift: "sift",
  setup: "validateKey()",
  prompt: "decideObjective()",
  unit: "offeredProfiles()",
  context: "compactContextSession()",
  comandante: "comandanteRequest()",
  portao: "portaoRequest()",
  ensaio: "ensaioRequest()",
  rumo: "rumoProposeRequest()",
  chaveiro: "chaveiroRequest()",
  oficina: "oficinaRequest()",
};

/** What each question makes Jev judge, by its name (core/questions.ts and core/plan.ts). */
const JOBS: Record<string, LocaleKey> = {
  [MODEL_KEY]: "feed.jev.job.model",
  [EFFORT_KEY]: "feed.jev.job.effort",
};

/** The function and the routing point of one call: "decide() › shortlist" "after Bash". */
function jevHead(caller: JevCaller, questions: readonly string[], locale: Locale): { fn: string; from: string; jobs: string } {
  const fn = ASKED_BY[caller.origin];
  const trigger = caller.trigger ? short(caller.trigger, 40) : undefined;
  const from =
    caller.origin === "agent"
      ? trigger ? text("feed.jev.from.agent", locale, { trigger }) : text("feed.jev.from.agentAny", locale)
      : text(`feed.jev.from.${caller.origin}`, locale);
  const jobs = [...new Set(questions.map((name) => JOBS[name] ? text(JOBS[name]!, locale) : name))];
  return { fn, from, jobs: jobs.join(", ") };
}

/** One question as Jev was asked it: its name, its kind, and the prompt itself. */
function askLine(ask: JevAsk, locale: Locale): string {
  const prompt = short(ask.prompt, 400);
  if (!prompt) return text("feed.jev.ask.bare", locale, { name: ask.name });
  return ask.type === "choice"
    ? text("feed.jev.ask.choice", locale, { name: ask.name, count: formatNumber(ask.optionCount, locale), prompt })
    : text("feed.jev.ask.noul", locale, { name: ask.name, prompt });
}

function answerLine(answer: Answer | undefined, locale: Locale): string {
  if (!answer) return text("feed.jev.answer.missing", locale);
  if (answer.type === "noul") return text("feed.jev.answer.noul", locale, { value: percent(answer.noul, locale) });
  const probabilities = Object.entries(answer.probabilities)
    .sort(([, a], [, b]) => b - a)
    .map(([option, probability]) => `${short(option, 32)} ${percent(probability, locale)}`);
  return text("feed.jev.answer.choice", locale, {
    choice: short(answer.choice, 60),
    confidence: percent(answer.confidence, locale),
    odds: probabilities.length ? text("feed.jev.answer.odds", locale, { odds: probabilities.join(" · ") }) : "",
  });
}

/** A Jev call as the live log shows it: one line that starts asking and turns into its answer. */
export interface JevCard {
  text: string;
  detail: string;
}

/** What it reads and the questions with their prompts, one row each: the call while it runs. */
function sentRows(sent: JevSent, locale: Locale): string[] {
  const asks = sent.asks ?? sent.questions.map((name) => ({ name, type: "noul" as const, prompt: "", options: [], optionCount: 0 }));
  return [
    text("feed.jev.sent", locale, { model: sent.model, turns: formatNumber(sent.turns, locale), chars: formatCompact(sent.chars, locale), role: sent.role, text: short(sent.last, 200) }),
    ...asks.map((ask) => askLine(ask, locale)),
  ];
}

/** A call just sent: which function asked, from where, for what, and each question's prompt. */
export function jevAsked(sent: JevSent, caller: JevCaller, locale: Locale = localeFor()): JevCard {
  return { text: text("feed.jev.call.running", locale, jevHead(caller, sent.questions, locale)), detail: sentRows(sent, locale).join("\n") };
}

/** The same call answered: each question's prompt with Jev's answer and the odds right under it. */
export function jevAnswered(sent: JevSent, caller: JevCaller, result: SystemOneResult, locale: Locale = localeFor()): JevCard {
  const [first, ...asked] = sentRows(sent, locale);
  const names = sent.asks?.map((ask) => ask.name) ?? sent.questions;
  const usage = [
    result.usage.input_tokens === undefined ? "" : text("feed.jev.usage.input", locale, { value: formatCompact(result.usage.input_tokens, locale) }),
    result.usage.output_tokens === undefined ? "" : text("feed.jev.usage.output", locale, { value: formatCompact(result.usage.output_tokens, locale) }),
  ].filter(Boolean).join(" · ");
  const rows = [
    ...(usage ? [text("feed.jev.usage", locale, { usage })] : []),
    first,
    ...asked.flatMap((row, i) => {
      const name = names[i]!;
      const dropped = result.dropped?.find((one) => one.name === name);
      return [row, !result.answers[name] && dropped ? text("feed.jev.answer.dropped", locale, { why: dropped.why }) : answerLine(result.answers[name], locale)];
    }),
  ];
  // Something unusable came back: the reply as Jev sent it, for debugging (the request log shows it whole).
  const unusable = (result.dropped?.length ?? 0) > 0 || names.some((name) => !result.answers[name]);
  if (unusable && result.raw) rows.push(text("feed.jev.raw", locale, { raw: result.raw }));
  return { text: text("feed.jev.call.done", locale, jevHead(caller, sent.questions, locale)), detail: rows.join("\n") };
}

/** The same call failed: the cause, then what it had asked. */
export function jevFailed(sent: JevSent, caller: JevCaller, error: string, hint: string, locale: Locale = localeFor()): JevCard {
  const head = jevHead(caller, sent.questions, locale);
  return { text: text("feed.jev.call.failed", locale, { ...head, message: short(error, 120) }), detail: [error.slice(0, 240), hint, ...sentRows(sent, locale)].filter(Boolean).join("\n") };
}
