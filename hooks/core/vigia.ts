// Vigia's pure parts: how a session reads to the others, the envelope a message travels in from one
// session of a project to another, whom `/vigia msg` addresses, the digest of the other sessions'
// work the model reads, and whether an edit waits until the file is read again.
// register.tsx holds every `$` call: the records on disk, `$.session.send` and the hooks.
import type { VigiaMail, VigiaSession } from "../../types";

/** A record whose last beat is older than this belongs to a session that ended or hung. */
export const VIGIA_ALIVE_MS = 60000;
/** Holds of one edit before Vigia lets it through anyway, so a model that never reads the file is not stuck. */
export const VIGIA_MAX_HOLDS = 3;
/** The longest message `/vigia msg` sends. */
export const VIGIA_MESSAGE_MAX = 2000;
/** Messages the pane keeps, and letters waiting for the model at most. */
export const VIGIA_MAIL_KEEP = 20;

/**
 * A message the pane's "Clear done" takes away: it reached where it went (sent and delivered, or received and read by
 * Claude). One the Comandante held stays until the person releases it, and a send that failed stays to be seen.
 */
export const vigiaMailDone = (item: VigiaMail) => item.isDelivered !== false && !(item.comandante?.decision === "rejected" && !item.isReleased);

export const vigiaFlat = (value: string, max: number) => { const text = value.replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
/** The conversation's words as a tagged block for an agent's request: flattened, cut to `max`, its own closing tag defused; "" when empty. */
export const vigiaQuoted = (value: string | undefined, tag: string, max: number) => {
  const flat = vigiaFlat(value ?? "", max).replace(new RegExp(`</${tag}>`, "gi"), `</ ${tag}>`);
  return flat ? `<${tag}>${flat}</${tag}>` : "";
};
export const vigiaAlive = (record: VigiaSession, now: number) => record.endedAt === undefined && now - record.beatAt < VIGIA_ALIVE_MS;
export const vigiaAgo = (ms: number) => { const minutes = Math.round(ms / 60000); return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`; };
/** How long ago, as the model reads it in a note. */
export const vigiaSince = (ms: number) => { const ago = vigiaAgo(ms); return ago === "now" ? "just now" : `${ago} ago`; };
export const vigiaName = (record: VigiaSession) => record.title ?? (record.lastPrompt ? vigiaFlat(record.lastPrompt, 40) : record.id.slice(0, 8));
export const vigiaDoing = (record: VigiaSession) => record.tasks.find((task) => task.status === "in_progress")?.text ?? record.doing;
export const vigiaNext = (record: VigiaSession) => record.tasks.find((task) => task.status === "pending")?.text ?? record.next;
export const vigiaShared = (a: VigiaSession, b: VigiaSession) => (a.files ?? []).filter((file) => (b.files ?? []).includes(file));

/** The project a root belongs to: also the name of the folder its sessions' records share, so one folder is one project. */
export const vigiaProject = (root: string) => root.replace(/[^a-zA-Z0-9]/g, "-");

/** A file as Vigia keys it: relative to the project root when it is inside it, with forward slashes. */
export function vigiaRelative(root: string, path: string): string {
  const base = root.replace(/\\/g, "/").replace(/\/$/, "");
  const candidate = path.replace(/\\/g, "/");
  return candidate.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? candidate.slice(base.length + 1) : candidate;
}

/** What one session tells another: a message the person typed there, or a notice that it is about to edit a file the receiver edited. */
export type VigiaLetter =
  | { project: string; from: string; name: string; kind: "message"; text: string }
  | { project: string; from: string; name: string; kind: "clash"; file: string; at: number };

const MARK = /⟦vigia:1:([^⟧\s]+)⟧/;

/**
 * The text `$.session.send` carries: a readable line for a session without Vigia, then the letter
 * itself on its own line, URI-encoded so no framing the engine adds around the text can split it.
 */
export function writeVigiaLetter(letter: VigiaLetter): string {
  const who = `"${vigiaFlat(letter.name, 60)}", ${letter.from.slice(0, 8)}`;
  const readable = letter.kind === "message"
    ? `[Vigia] Message from another Claude Code session in this project (${who}):\n${letter.text}`
    : `[Vigia] Another Claude Code session in this project (${who}) is about to edit ${letter.file}, which this session edited.`;
  return `${readable}\n⟦vigia:1:${encodeURIComponent(JSON.stringify(letter))}⟧`;
}

/** The letter inside a delivery, or undefined for any other text (a Sentinela reply, a peer's own message). */
export function readVigiaLetter(text: string): VigiaLetter | undefined {
  const match = MARK.exec(text);
  if (!match) return;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(decodeURIComponent(match[1]!)) as Record<string, unknown>; } catch { return; }
  if (!raw || typeof raw !== "object" || typeof raw.project !== "string" || typeof raw.from !== "string" || typeof raw.name !== "string") return;
  const base = { project: raw.project, from: raw.from, name: raw.name };
  if (raw.kind === "message" && typeof raw.text === "string" && raw.text.trim()) return { ...base, kind: "message", text: raw.text.slice(0, VIGIA_MESSAGE_MAX) };
  if (raw.kind === "clash" && typeof raw.file === "string" && raw.file && typeof raw.at === "number" && Number.isFinite(raw.at)) return { ...base, kind: "clash", file: raw.file, at: raw.at };
  return;
}

/** `/vigia` alone opens the pane; `/vigia msg <session|all> <text>` sends. */
export type VigiaCommand = { verb: "open" } | { verb: "send"; target: string; text: string } | { verb: "usage" };
export function vigiaCommand(args: string): VigiaCommand {
  const trimmed = args.trim();
  if (!trimmed) return { verb: "open" };
  const match = /^(?:msg|send)\s+(\S+)\s+([\s\S]+)$/i.exec(trimmed);
  return match ? { verb: "send", target: match[1]!, text: match[2]!.trim().slice(0, VIGIA_MESSAGE_MAX) } : { verb: "usage" };
}

const EVERYONE = new Set(["all", "todas", "todos", "*"]);

/**
 * The live sessions of this project a target names: everyone for `all`/`todas`, else the one whose id
 * starts with it (4+ characters, as the pane shows 8) or whose name holds it. Several or none is an error
 * that lists the candidates.
 */
export type VigiaTargets = { sessions: VigiaSession[] } | { error: "none" } | { error: "noMatch" | "ambiguous"; options: VigiaSession[] };
export function vigiaTargets(peers: readonly VigiaSession[], ownId: string, now: number, target: string): VigiaTargets {
  const live = peers.filter((peer) => peer.id !== ownId && vigiaAlive(peer, now));
  if (!live.length) return { error: "none" };
  const key = target.trim().toLowerCase();
  if (EVERYONE.has(key)) return { sessions: live };
  const byId = key.length >= 4 ? live.filter((peer) => peer.id.toLowerCase().startsWith(key)) : [];
  const exact = live.filter((peer) => vigiaName(peer).toLowerCase() === key);
  const hits = byId.length ? byId : exact.length ? exact : live.filter((peer) => vigiaName(peer).toLowerCase().includes(key));
  if (hits.length === 1) return { sessions: hits };
  return hits.length ? { error: "ambiguous", options: hits } : { error: "noMatch", options: live };
}

/** A session as a reply lists it: its id's first 8 characters, then its name. */
export const vigiaLabel = (record: VigiaSession) => `${record.id.slice(0, 8)} "${vigiaFlat(vigiaName(record), 40)}"`;

/** Text without its markup: a prompt that was a peer's delivery keeps the message, not its envelope (cut tags too). */
const untagged = (value: string, max: number) => vigiaFlat(value.replace(/<[^>]*(?:>|$)/g, " "), max);

/**
 * What the model reads about the other live sessions of this project: name, task, next step and recent
 * project files. Busy or waiting is left out, and the sessions keep the order they started in, so the
 * digest changes only when their work does, not with every beat.
 */
export function vigiaDigest(sessions: readonly VigiaSession[], ownId: string, now: number): string {
  const others = sessions.filter((record) => record.id !== ownId && vigiaAlive(record, now))
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).slice(0, 5);
  if (!others.length) return "";
  const lines = others.map((record) => {
    const doing = vigiaDoing(record);
    const next = vigiaNext(record);
    const asked = record.lastPrompt ? untagged(record.lastPrompt, 120) : "";
    // a path outside the project (a scratch file) says nothing about overlapping work here
    const files = (record.files ?? []).filter((file) => !/^(?:[A-Za-z]:)?[\\/]/.test(file)).slice(0, 5);
    const parts = [
      doing ? `doing: ${vigiaFlat(doing, 120)}` : asked ? `last request: ${asked}` : undefined,
      next ? `next: ${vigiaFlat(next, 100)}` : undefined,
      files.length ? `recent files: ${files.join(", ")}` : undefined,
    ].filter(Boolean);
    return `- "${untagged(vigiaName(record), 60) || record.id.slice(0, 8)}" (${record.id.slice(0, 8)})${parts.length ? `: ${parts.join("; ")}` : ""}`;
  });
  return `Vigia: other live Claude Code sessions are working in this same project right now. Avoid redoing their work, and re-read a file they touched before you edit it.\n${lines.join("\n")}`;
}

/** The note that hands the model what arrived from other sessions since it last read: nothing when nothing did. */
export function vigiaInboxNote(mail: readonly VigiaMail[], now: number): string | undefined {
  if (!mail.length) return;
  const lines = mail.map((item) => {
    const who = `"${vigiaFlat(item.peer, 60)}" (${item.peerId.slice(0, 8)}, ${vigiaSince(now - item.at)})`;
    return item.kind === "clash"
      ? `- Notice from ${who}: it is about to edit ${item.file}, which this session edited; Vigia held that edit until it re-reads the file. Re-read ${item.file} before you edit it again.`
      : `- Message from ${who}: ${item.text}`;
  });
  return `Vigia: delivered from other Claude Code sessions in this same project. A message was typed by the user in that session; a notice was sent by Vigia there.\n${lines.join("\n")}`;
}

/**
 * The live session whose edit of `file` this session has not seen: one made inside the clash window,
 * after this session last read or edited the file. The newest such edit wins.
 */
export type VigiaHold = { other: VigiaSession; at: number };
export function vigiaHold(peers: readonly VigiaSession[], ownId: string, now: number, file: string, seenAt: number, windowMs: number): VigiaHold | undefined {
  let found: VigiaHold | undefined;
  for (const peer of peers) {
    if (peer.id === ownId || !vigiaAlive(peer, now)) continue;
    const at = peer.edits?.[file] ?? 0;
    if (at > seenAt && now - at < windowMs && (!found || at > found.at)) found = { other: peer, at };
  }
  return found;
}

/** Why an edit waits: the model reads this as the tool's refusal. */
export function vigiaHoldReason(hold: VigiaHold, file: string, now: number): string {
  const task = vigiaDoing(hold.other) ?? hold.other.lastPrompt;
  return `Vigia: another live Claude Code session in this project ("${vigiaFlat(vigiaName(hold.other), 60)}"${task ? `, working on: ${vigiaFlat(task, 120)}` : ""}) edited ${file} ${vigiaSince(now - hold.at)}, after this session last read it. This edit was held so its changes are not overwritten: read ${file} again, keep its changes, then make the edit.`;
}
