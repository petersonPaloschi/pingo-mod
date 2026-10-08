// Sift runs outside the mod, in a shell Claude's Bash tool starts, so its Jev calls reach the mod
// through a file: sift appends one JevEvent per line, and the mod follows the file with a small
// Node child and reports each event through the same reporter as its own calls. Pure: sift.ts
// does the writing, register.tsx the following.
import { normalize, type JevAsk, type JevEvent } from "./jev.ts";

/** Set by the mod for every shell the session starts: the channel's name, one per session. */
export const CHANNEL_ENV = "PINGO_JEV_CHANNEL";

/** The channel's file name in the temp folder. A name of anything but plain characters has none, so nothing climbs out. */
export const channelFile = (name: string | undefined): string | undefined =>
  name && /^[A-Za-z0-9_-]{1,64}$/.test(name) ? `pingo-jev-${name}.jsonl` : undefined;

export const channelLine = (event: JevEvent): string => `${JSON.stringify(event)}\n`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** One question as sift recorded it; an older sift sends none, and the line still counts. */
function isAsk(value: unknown): value is JevAsk {
  return isObject(value) && isText(value.name) && (value.type === "choice" || value.type === "noul") && isText(value.prompt)
    && Array.isArray(value.options) && value.options.every(isText) && isNumber(value.optionCount);
}

/** A line read back is another process's word: only a whole, well-formed event counts. */
export function toJevEvent(value: unknown): JevEvent | undefined {
  if (!isObject(value) || !isText(value.call) || !isNumber(value.at)) return undefined;
  const { call, at } = value;
  if (value.phase === "start") {
    const sent = value.sent;
    if (!isObject(sent) || !isText(sent.model) || !Array.isArray(sent.questions) || !sent.questions.every(isText)) return undefined;
    if (!isNumber(sent.turns) || !isNumber(sent.chars) || !isText(sent.role) || !isText(sent.last)) return undefined;
    const asks = Array.isArray(sent.asks) ? sent.asks.filter(isAsk) : [];
    return { phase: "start", call, at, sent: { model: sent.model, questions: sent.questions, turns: sent.turns, chars: sent.chars, role: sent.role, last: sent.last, ...(asks.length ? { asks } : {}) } };
  }
  if (value.phase === "fail") return isText(value.error) ? { phase: "fail", call, at, error: value.error } : undefined;
  if (value.phase === "end") {
    const result = value.result;
    if (!isObject(result) || !isObject(result.answers) || !isObject(result.usage)) return undefined;
    if (!isNumber(result.usage.input_tokens) || result.usage.input_tokens < 0 || !isNumber(result.usage.output_tokens) || result.usage.output_tokens < 0) return undefined;
    if (result.model !== undefined && !isText(result.model)) return undefined;
    if (result.raw !== undefined && !isText(result.raw)) return undefined;
    if (result.dropped !== undefined && (!Array.isArray(result.dropped) || !result.dropped.every((one) => isObject(one) && isText(one.name) && isText(one.why)))) return undefined;
    try {
      // Reuse the provider boundary's Answer validation, but retain the original result metadata.
      if (normalize(result).dropped?.length) return undefined;
    } catch {
      return undefined;
    }
    return { phase: "end", call, at, result: result as unknown as Extract<JevEvent, { phase: "end" }>["result"] };
  }
  return undefined;
}

/** Turns the pieces a stream hands over (text as it came, not lines) into events; a partial line waits for the next piece. */
export function channelReader(): (piece: string) => JevEvent[] {
  let rest = "";
  return (piece) => {
    const lines = (rest + piece).split("\n");
    rest = lines.pop() ?? "";
    const events: JevEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = toJevEvent(JSON.parse(line));
        if (event) events.push(event);
      } catch {}
    }
    return events;
  };
}

/**
 * The follower, run as `node -e FOLLOW_SCRIPT <file name>`: prints the channel file from its start
 * as it grows, whole lines only, so a character split across reads never reaches the mod.
 */
export const FOLLOW_SCRIPT = [
  `const fs = require("fs"), path = require("path"), os = require("os");`,
  `const file = path.join(os.tmpdir(), process.argv[1]);`,
  `let at = 0, skipping = false;`,
  `setInterval(() => {`,
  `  let fd;`,
  `  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)); } catch { return; }`,
  `  try {`,
  `    const stat = fs.fstatSync(fd);`,
  `    if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid())) return;`,
  `    const size = stat.size;`,
  `    if (size < at) { at = 0; skipping = false; }`,
  `    if (size <= at) return;`,
  `    const buffer = Buffer.alloc(Math.min(size - at, 1 << 20));`,
  `    const read = fs.readSync(fd, buffer, 0, buffer.length, at);`,
  `    let data = buffer.subarray(0, read);`,
  `    if (skipping) {`,
  `      const first = data.indexOf(10);`,
  `      if (first < 0) { at += read; return; }`,
  `      at += first + 1; data = data.subarray(first + 1); skipping = false;`,
  `    }`,
  `    const end = data.lastIndexOf(10) + 1;`,
  `    if (end > 0) { process.stdout.write(data.subarray(0, end)); at += end; }`,
  `    else if (size - at >= (1 << 20)) { at += data.length; skipping = true; }`,
  `  } catch {} finally { fs.closeSync(fd); }`,
  `}, 100);`,
].join("\n");
