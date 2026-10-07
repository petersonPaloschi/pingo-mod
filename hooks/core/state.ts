// What Jev reads: the conversation, newest turns first within a character budget.
import type { Json, RouterInput, Turn } from "./types.ts";

export interface Limits {
  maxStateChars: number;
  maxMessageChars: number;
}

/** Keep the head and tail of long text; the middle is what matters least for routing. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = " …[truncated]… ";
  const keep = Math.max(0, max - marker.length);
  const head = Math.ceil(keep * 0.6);
  return text.slice(0, head) + marker + text.slice(text.length - (keep - head));
}

/**
 * Jev state: the content the questions are asked about.
 * The newest turns are kept when the conversation exceeds the state budget.
 */
export function buildState(input: Pick<RouterInput, "system" | "turns">, limits: Limits): { [key: string]: Json } {
  const systemText = truncate(input.system, limits.maxMessageChars);
  let budget = limits.maxStateChars - systemText.length;
  const conversation: Turn[] = [];
  for (let i = input.turns.length - 1; i >= 0; i--) {
    const turn = input.turns[i]!;
    budget -= JSON.stringify(turn).length;
    if (budget < 0 && conversation.length > 0) break;
    conversation.unshift(turn);
  }
  const omitted = input.turns.length - conversation.length;
  return {
    ...(systemText ? { assistant_instructions: systemText } : {}),
    ...(omitted ? { earlier_turns_omitted: omitted } : {}),
    conversation,
  };
}
