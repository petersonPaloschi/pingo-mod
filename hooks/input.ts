// What Jev is asked about, built from what the session holds: its transcript and its tool roster.
import type { SessionMessage, ToolInfo } from "claude-code";

import { truncate } from "./core/state.ts";
import type { RouterInput, RouterTool, Turn } from "./core/types.ts";
import type { Locale } from "./i18n.ts";

/** A tool result the transcript does not hold yet: the call a `tool.call` hook just ran. */
export interface PendingResult {
  toolUseId: string;
  tool: string;
  text: string;
}

export function toTools(roster: readonly ToolInfo[]): RouterTool[] {
  return roster.map((tool) => ({ kind: "function", name: tool.name, description: tool.description }));
}

export function toTurns(
  messages: readonly SessionMessage[],
  maxMessageChars: number,
  extra: { userText?: string; pending?: PendingResult } = {},
  locale?: Locale,
): Turn[] {
  const clip = (value: string) => truncate(value, maxMessageChars, locale);
  const toolNameById = new Map<string, string>();
  const answered = new Set<string>();
  const turns: Turn[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      if (message.text) turns.push({ role: "assistant", text: clip(message.text) });
      for (const use of message.toolUses ?? []) {
        toolNameById.set(use.tool_use_id, use.tool);
        turns.push({
          role: "assistant",
          tool_calls: [{ tool: use.tool, arguments: clip(JSON.stringify(use.input ?? {})) }],
        });
      }
      continue;
    }
    for (const result of message.toolResults ?? []) {
      answered.add(result.tool_use_id);
      turns.push({
        role: "tool_result",
        tool: toolNameById.get(result.tool_use_id) ?? "unknown",
        content: clip(result.text),
      });
    }
    if (message.text) turns.push({ role: "user", text: clip(message.text) });
  }

  const pending = extra.pending;
  if (pending && !answered.has(pending.toolUseId)) {
    turns.push({ role: "tool_result", tool: pending.tool, content: clip(pending.text) });
  }
  if (extra.userText) turns.push({ role: "user", text: clip(extra.userText) });
  return turns;
}

export function toInput(
  system: string,
  messages: readonly SessionMessage[],
  roster: readonly ToolInfo[],
  maxMessageChars: number,
  extra: { userText?: string; pending?: PendingResult } = {},
  locale?: Locale,
): RouterInput {
  return { system, turns: toTurns(messages, maxMessageChars, extra, locale), tools: toTools(roster) };
}

/** A tool's record as the model will roughly read it, for a result the transcript lacks. */
export function resultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
