// The live log's wording: short summaries of what can be observed (requests, tools, agents,
// visible messages, Jev's answers). Never the model's reasoning: thinking is not read here.
import type { FeatureFlags } from "../types";
import type { FeatureId } from "./core/plan.ts";

/** Each feature, its one-click toggle key, and a short description. */
export const FEATURES: readonly { id: FeatureId; name: string; hotkey: string; description: string }[] = [
  {
    id: "tools",
    name: "Tool hints",
    hotkey: "t",
    description:
      "Before each model request, Jev selects the most relevant tool (Read, Bash, Edit…) and adds " +
      "that suggestion as context. Claude remains free to ignore it.",
  },
  {
    id: "participation",
    name: "Automatic participation",
    hotkey: "p",
    description:
      "Jev decides whether to participate in each request. For simple requests it stays out: no tool or " +
      "delegation hint is added, while the selected model and effort still apply.",
  },
  {
    id: "model",
    name: "Model per turn",
    hotkey: "m",
    description:
      "At the start of each turn, Jev selects Haiku, Sonnet, or Opus based on the request's complexity. " +
      "The whole turn uses that model. Switching models rebuilds the prompt cache for that turn.",
  },
  {
    id: "effort",
    name: "Effort per turn",
    hotkey: "e",
    description:
      "Jev selects the turn's effort level (low, medium, high, xhigh, max). This applies only to models " +
      "that support effort; other models keep their existing settings.",
  },
  {
    id: "delegation",
    name: "Subagent delegation",
    hotkey: "d",
    description:
      "Jev decides whether part of a request should go to a subagent (Explore, Plan…) and suggests it to Claude. " +
      "Claude starts the subagent with its Agent tool; this plugin never starts tasks on its own.",
  },
  {
    id: "agents",
    name: "Subagent model and effort",
    hotkey: "g",
    description:
      "When a subagent is about to start, Jev reads its task and selects a model and effort. If Claude " +
      "already requested a specific model, that choice is respected.",
  },
];

export const featureName = (id: FeatureId) => FEATURES.find((feature) => feature.id === id)?.name ?? id;

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
export function toolDetails(tool: string, input: Record<string, unknown>): string {
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined);
  const number = (key: string) => (typeof input[key] === "number" ? (input[key] as number) : undefined);
  const lines = (value: string | undefined) => (value === undefined ? 0 : value.split("\n").length);
  const parts: (string | undefined)[] = [];
  switch (tool) {
    case "Bash":
    case "PowerShell": {
      const command = text("command") ?? "";
      if (command.length > 60) parts.push(short(command, 240));
      parts.push(text("description"), input.run_in_background ? "in the background" : undefined);
      const timeout = number("timeout");
      if (timeout) parts.push(`timeout ${Math.round(timeout / 1000)}s`);
      break;
    }
    case "Read": {
      const offset = number("offset");
      const limit = number("limit");
      if (offset !== undefined || limit !== undefined) parts.push(`lines ${offset ?? 1}–${limit === undefined ? "end" : (offset ?? 1) + limit - 1}`);
      parts.push(text("pages") ? `pages ${text("pages")}` : undefined);
      break;
    }
    case "Edit":
      parts.push(`−${lines(text("old_string"))} +${lines(text("new_string"))} lines`, input.replace_all ? "every match" : undefined);
      break;
    case "Write":
      parts.push(`${lines(text("content"))} lines`);
      break;
    case "Grep":
      parts.push(text("path") ? `in ${text("path")}` : undefined, text("glob") ? `glob ${text("glob")}` : undefined, text("type") ? `type ${text("type")}` : undefined, text("output_mode"));
      break;
    case "Glob":
      parts.push(text("path") ? `in ${text("path")}` : undefined);
      break;
    case "Agent":
    case "Task":
      parts.push(text("subagent_type"), text("model") ? `model ${text("model")}` : undefined, text("prompt") ? short(text("prompt")!, 160) : undefined);
      break;
    case "WebFetch":
      parts.push(text("prompt") ? short(text("prompt")!, 160) : undefined);
      break;
    case "Skill":
      parts.push(text("args") ? short(text("args")!, 120) : undefined);
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
export function outputSize(text: string): string {
  if (!text.trim()) return "empty";
  const lines = text.split("\n").length;
  return lines > 1 ? `${compactNumber(lines)} lines` : `${compactNumber(text.length)} chars`;
}

/** "950", "12.3k", "1.2M". */
export const compactNumber = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`);

/** "claude-opus-5-5" → "opus-5-5": the part of an id that tells models apart. */
export const modelName = (id: string | undefined) => (id ? id.replace(/^claude-/, "").replace(/-\d{8}$/, "") : "?");

export const featureFlagsText = (flags: FeatureFlags) =>
  FEATURES.filter((feature) => flags[feature.id]).map((feature) => feature.name).join(", ") || "none";
