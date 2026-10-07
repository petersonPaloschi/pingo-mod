// What Jev reads: the conversation, newest turns first within a character budget.
import type { Json, RouterInput, Turn } from "./types.ts";
import { text, type Locale } from "../i18n.ts";

export interface Limits {
  maxStateChars: number;
  maxMessageChars: number;
  locale?: Locale;
}

/** Keep the head and tail of long text; the middle is what matters least for routing. */
export function truncate(value: string, max: number, locale?: Locale): string {
  if (value.length <= max) return value;
  const marker = text("routing.truncated", locale);
  // No room for the marker: a hard cut still keeps the result within max.
  if (max < marker.length) return value.slice(0, Math.max(0, max));
  const keep = Math.max(0, max - marker.length);
  const head = Math.ceil(keep * 0.6);
  return value.slice(0, head) + marker + value.slice(value.length - (keep - head));
}

/**
 * Jev state: the content the questions are asked about.
 * The newest turns are kept when the conversation exceeds the state budget.
 */
export function buildState(input: Pick<RouterInput, "system" | "turns" | "session">, limits: Limits): { [key: string]: Json } {
  const systemText = truncate(input.system, limits.maxMessageChars, limits.locale);
  const currentRequest = input.turns.findLast((turn) => turn.role === "user" && typeof turn.text === "string");
  const latestResult = input.turns.findLast((turn) => turn.role === "tool_result");
  const context: { [key: string]: Json } = {
    ...(currentRequest ? { current_request: truncate(String(currentRequest.text), limits.maxMessageChars, limits.locale) } : {}),
    ...(latestResult ? { latest_tool_result: {
      tool: String(latestResult.tool ?? "unknown"),
      content: truncate(String(latestResult.content ?? ""), limits.maxMessageChars, limits.locale),
    } } : {}),
    ...(input.session ? { session: {
      ...(input.session.currentModel ? { current_model: input.session.currentModel } : {}),
      context_tokens: input.session.contextTokens ?? 0,
      cache_read_tokens: input.session.cacheReadTokens ?? 0,
      ...(input.session.availableModels ? { available_models: [...input.session.availableModels] } : {}),
    } } : {}),
  };
  let budget = limits.maxStateChars - systemText.length - JSON.stringify(context).length;
  const conversation: Turn[] = [];
  for (let i = input.turns.length - 1; i >= 0; i--) {
    const turn = input.turns[i]!;
    budget -= JSON.stringify(turn).length;
    if (budget < 0 && conversation.length > 0) break;
    conversation.unshift(turn);
  }
  const omitted = input.turns.length - conversation.length;
  return {
    ...context,
    ...(systemText ? { assistant_instructions: systemText } : {}),
    ...(omitted ? { earlier_turns_omitted: omitted } : {}),
    conversation,
  };
}
