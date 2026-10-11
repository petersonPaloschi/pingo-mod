import { CLAUDE_MODEL, MODEL_NAMES, TIERS } from "../core/contracts.ts";
import { displayWidth } from "../layout.ts";

export type TrailSegment = { text: string; color: string; bold?: boolean; bg?: string };
export type Line = { text: string; color: string; bold?: boolean };

/** "claude-opus-5-5" → "Opus 5.5", including older IDs and date suffixes. */
export function prettyModel(id: string | undefined): string {
  if (!id) return "Claude";
  const canonical = Object.values(CLAUDE_MODEL).find((model) => model.id === id);
  if (canonical) return canonical.label;
  const capital = (family: string) => family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  const match = new RegExp(`(${MODEL_NAMES.join("|")})-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`, "i").exec(id);
  if (match) return `${capital(match[1]!)} ${match[2]}${match[3] ? `.${match[3]}` : ""}`;
  const old = new RegExp(`claude-(\\d{1,2})(?:-(\\d{1,2}))?-(${TIERS.join("|")})`, "i").exec(id);
  if (old) return `${capital(old[3]!)} ${old[1]}${old[2] ? `.${old[2]}` : ""}`;
  return id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export const fit = (value: string, width: number) => {
  const line = value.replace(/\s+/g, " ");
  if (displayWidth(line) <= width) return line;
  let out = "";
  let used = 0;
  for (const ch of line) {
    const w = displayWidth(ch);
    if (out && used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return out + "…";
};

/** Wraps at word boundaries, breaks long words, and caps details to `max` lines. */
export function wrap(value: string, width: number, max = 3): string[] {
  const room = Math.max(1, width);
  const lines: string[] = [];
  let line = "";
  for (const word of value.replace(/\s+/g, " ").trim().split(" ")) {
    const joined = line ? `${line} ${word}` : word;
    if (displayWidth(joined) <= room) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (displayWidth(line) > room) {
      let head = "";
      for (const ch of line) {
        if (head && displayWidth(head + ch) > room) break;
        head += ch;
      }
      lines.push(head);
      line = line.slice(head.length);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), fit(lines.slice(max - 1).join(" ") + " …", room)];
}

/** One thing that happened: when, its node, its sentence, and the lines under it. */
