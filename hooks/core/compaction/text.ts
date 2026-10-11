import { type ContextToolCall } from "./types.ts";

export const CONTEXT_STATE_DESCRIPTION =
  'A coding assistant conversation is being compacted to free context. `history` is the whole conversation so far, oldest first; tool outputs are replaced by a short `result` note and long texts may be abridged. Each question asks whether one tool call, or the full output of that call, still needs to stay in the history verbatim. Whatever is not kept is deleted permanently, but the assistant can always re-run a tool or re-read a file.';

/** Successive caps on the serialised tool input included per call. */
export const CONTEXT_INPUT_CHARS = [1000, 200, 60] as const;
/** Cap on each input value in a call's one-line form, before the line itself is cut. */
const CONTEXT_CALL_VALUE_CHARS = 200;
export const CONTEXT_TEXT_HEAD = 400;
export const CONTEXT_TEXT_TAIL = 150;

const CONTEXT_TOKEN_PIECES = /[A-Za-z]+|\d+|[^\sA-Za-z\d]/g;

/**
 * Estimates tokens without a tokenizer: a word costs one token per six
 * letters, a digit half a token, any other symbol nine tenths. Calibrated
 * against the usage Jev reports for real transcripts, where it lands 2–18%
 * above the true count; a plain characters-per-token ratio undercounts the
 * JSON-heavy states by up to 40%.
 */
export function estimateContextTokens(text: string): number {
  let tokens = 0;
  for (const [piece] of text.matchAll(CONTEXT_TOKEN_PIECES)) {
    const first = piece.charCodeAt(0);
    if (first >= 48 && first <= 57) tokens += piece.length / 2;
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      tokens += 1 + Math.floor((piece.length - 1) / 6);
    } else tokens += 0.9;
  }
  return Math.ceil(tokens);
}

export function truncateContextText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function abridgeContextText(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + 40) return text;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[… ${omitted} chars omitted …]\n${text.slice(-tail)}`;
}



export function contextInputText(input: Record<string, unknown>, limit: number): string {
  let json = '';
  try {
    json = JSON.stringify(input);
  } catch {
    json = '[unserializable input]';
  }
  return truncateContextText(json, limit);
}

export function contextResultNote(call: ContextToolCall): string {
  return `${call.isError ? 'error' : 'ok'}, ${call.resultChars} chars (omitted)`;
}

/** One call as a single line, for when the structured form is too costly. */
export function compactContextCall(call: ContextToolCall): string {
  const input = Object.entries(call.input)
    .map(([key, value]) => {
      // cut before the whitespace pass: a file's whole content would be scanned for a one-line summary
      const text = typeof value === 'string'
        ? value.slice(0, CONTEXT_CALL_VALUE_CHARS)
        : contextInputText({ [key]: value }, CONTEXT_CALL_VALUE_CHARS);
      return `${key}=${text.replace(/\s+/g, ' ')}`;
    })
    .join(' ');
  return `${call.id} ${call.tool} ${truncateContextText(input, CONTEXT_INPUT_CHARS[2])} → ${
    call.isError ? 'error' : 'ok'
  } ${call.resultChars}ch`;
}


export function truncatedContextResultText(text: string, isError: boolean, headChars: number): string {
  if (text.length <= headChars + 120) return text;
  const head = headChars > 0 ? `${text.slice(0, headChars)}\n` : '';
  return `${head}[context compaction removed ${text.length - headChars} chars of this tool result${
    isError ? ' (error)' : ''
  }; re-run the tool if needed]`;
}
