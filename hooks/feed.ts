// The live log's wording: short summaries of what can be observed (requests, tools, agents,
// visible messages, Jev's answers). Never the model's reasoning: thinking is not read here.
import type { FeatureFlags } from "../types";
import type { FeatureId } from "./core/plan.ts";
import type { Answer, SystemOneRequest, SystemOneResult } from "./core/types.ts";
import { formatCompact, formatDecimal, formatNumber, localeFor, text, type Locale, type LocaleKey } from "./i18n.ts";

/** Each feature, its one-click toggle key, and a short description. */
const FEATURE_KEYS: readonly { id: FeatureId; name: LocaleKey; hotkey: string; description: LocaleKey }[] = [
  {
    id: "tools",
    name: "feature.tools.name",
    hotkey: "t",
    description: "feature.tools.description",
  },
  {
    id: "participation",
    name: "feature.participation.name",
    hotkey: "p",
    description: "feature.participation.description",
  },
  {
    id: "model",
    name: "feature.model.name",
    hotkey: "m",
    description: "feature.model.description",
  },
  {
    id: "effort",
    name: "feature.effort.name",
    hotkey: "e",
    description: "feature.effort.description",
  },
  {
    id: "delegation",
    name: "feature.delegation.name",
    hotkey: "d",
    description: "feature.delegation.description",
  },
  {
    id: "agents",
    name: "feature.agents.name",
    hotkey: "g",
    description: "feature.agents.description",
  },
  {
    id: "advisor",
    name: "feature.advisor.name",
    hotkey: "a",
    description: "feature.advisor.description",
  },
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

/** Every input token a request read: fresh, from the cache and written to it. */
export const inputTokens = (usage: Usage) =>
  usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);

export const featureFlagsText = (flags: FeatureFlags, locale: Locale = localeFor()) => {
  const names = features(locale).filter((feature) => flags[feature.id]).map((feature) => feature.name);
  return names.length ? new Intl.ListFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "short", type: "conjunction" }).format(names) : text("feed.none", locale);
};

/** The most probable options of a choice, as "name 87.3%", likeliest first. */
const TOP_PROBABILITIES = 5;

function answerLine(name: string, answer: Answer, locale: Locale): string {
  const percent = (value: number) => `${formatDecimal(value * 100, locale, 1)}%`;
  if (answer.type === "noul") return text("feed.jev.answer.noul", locale, { question: name, value: percent(answer.noul) });
  const ranked = Object.entries(answer.probabilities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_PROBABILITIES)
    .map(([option, probability]) => `${short(option, 40)} ${percent(probability)}`);
  return text("feed.jev.answer.choice", locale, {
    question: name,
    choice: short(answer.choice, 60),
    confidence: percent(answer.confidence),
    odds: ranked.join(" · "),
  });
}

/** What one Jev call was asked: the newest turn it read and the questions it had to answer. */
export function jevInput(request: SystemOneRequest, locale: Locale = localeFor()): { text: string; detail: string } {
  const conversation = Array.isArray(request.state.conversation) ? request.state.conversation : [];
  const last = conversation.at(-1) as Record<string, unknown> | undefined;
  const lastText = last ? String(last.text ?? last.content ?? JSON.stringify(last.tool_calls ?? last)) : "";
  const questions = Object.keys(request.questions);
  return {
    text: text("feed.jev.input", locale, {
      turns: formatNumber(conversation.length, locale),
      questions: formatNumber(questions.length, locale),
      chars: formatCompact(JSON.stringify(request.state).length, locale),
    }),
    detail: [
      text("feed.jev.input.last", locale, { role: String(last?.role ?? "?"), text: short(lastText, 240) }),
      text("feed.jev.input.questions", locale, { list: questions.join(", "), model: request.model }),
    ].join("\n"),
  };
}

/** What one Jev call answered: every question with its choice and the odds behind it. */
export function jevOutput(result: SystemOneResult, locale: Locale = localeFor()): { text: string; detail: string } {
  return {
    text: text("feed.jev.output", locale, {
      input: formatCompact(result.usage.input_tokens, locale),
      output: formatCompact(result.usage.output_tokens, locale),
    }),
    detail: Object.entries(result.answers).map(([name, answer]) => answerLine(name, answer, locale)).join("\n"),
  };
}
