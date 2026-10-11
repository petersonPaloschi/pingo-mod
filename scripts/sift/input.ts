import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { num, type Flags, type Item } from "../../hooks/core/sift.ts";
import { fail } from "./errors.ts";
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "target", "vendor", "__pycache__", ".venv", "venv", "coverage", ".turbo", ".cache", ".idea", ".vscode"]);
/** Files that look like credentials are never sent, whatever the question. */
const SECRET_RE = /(^|[\/\\])(\.env[^\/\\]*|.*\.(pem|key|p12|pfx|p8|der|asc|keystore|jks|crt|cer)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|\.?credentials[^\/\\]*|service-account[^\/\\]*\.json|\.?secrets?(\.(json|ya?ml|toml))?)$/i;
const LOCK_RE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|\.min\.(js|css)|\.map)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const rel = (file: string) => {
  const relative = path.relative(process.cwd(), file);
  return (relative.startsWith("..") || path.isAbsolute(relative) ? file : relative).split(path.sep).join("/") || ".";
};
export const readStdin = () => { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } };

function gitFiles(dir: string): string[] | undefined {
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "."], {
      cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean).map((file) => path.join(dir, file));
  } catch {
    return undefined;
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(path.join(dir, entry.name), acc);
    } else if (entry.isFile()) acc.push(path.join(dir, entry.name));
  }
  return acc;
}

const isFile = (file: string) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** A file, a directory (git-tracked plus untracked, minus ignored), or a glob. */
function expand(spec: string): string[] {
  if (/[*?[\]{}]/.test(spec)) {
    const glob = (fs as { globSync?: (pattern: string, options: object) => string[] }).globSync;
    if (!glob) fail("glob patterns need Node 22+; pass a directory instead");
    const prefix = spec.slice(0, spec.search(/[*?[\]{}]/));
    const dir = /[\/\\]$/.test(prefix) ? prefix : path.dirname(prefix || ".");
    const tracked = gitFiles(dir);
    const allowed = tracked ? new Set(tracked.map((file) => path.resolve(file))) : undefined;
    return glob!(spec, { exclude: (file: string) => IGNORE_DIRS.has(path.basename(file)) })
      .filter((file) => isFile(file) && (!allowed || allowed.has(path.resolve(file))));
  }
  if (!fs.existsSync(spec)) fail(`no such file or directory: ${spec}`);
  if (fs.statSync(spec).isFile()) return [spec];
  const tracked = gitFiles(spec);
  return (tracked ?? walk(spec)).filter(isFile);
}

/** The text of a file, or undefined for binaries and anything over 2 MB. */
function readText(file: string): string | undefined {
  if (fs.statSync(file).size > MAX_FILE_BYTES) return undefined;
  const buffer = fs.readFileSync(file);
  return buffer.subarray(0, 8192).includes(0) ? undefined : buffer.toString("utf8");
}

/** Explicit auxiliary inputs use the same guard and size limit as collected files. */
export function readInput(file: string, flags: Flags): string {
  const id = rel(path.resolve(file));
  if (!flags["no-secrets-guard"] && SECRET_RE.test(id)) fail(`${id} (secret-like, never sent)`);
  const text = readText(file);
  if (text === undefined) fail(`${id} (binary or >2MB)`);
  return text;
}

export function collect(pos: string[], flags: Flags): { items: Item[]; skipped: string[] } {
  const maxChars = num(flags["max-chars"], 60_000);
  const exts = typeof flags.ext === "string" ? flags.ext.split(",").map((ext) => `.${ext.trim().replace(/^\./, "").toLowerCase()}`) : undefined;
  const items: Item[] = [];
  const skipped: string[] = [];
  const push = (id: string, text: string) => {
    const truncated = text.length > maxChars;
    items.push({ id, text: truncated ? text.slice(0, maxChars) : text, ...(truncated ? { truncated } : {}) });
  };
  const pushLines = (name: string, text: string) => text.split(/\r?\n/).forEach((line, i) => { if (line.trim()) push(`${name}:${i + 1}`, line); });

  if (typeof flags.items === "string") {
    const raw = flags.items === "-" ? readStdin() : readInput(flags.items, flags);
    raw.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const { id, text, content, ...rest } = parsed;
          const body = text ?? content ?? rest;
          return push(String(id ?? i + 1), typeof body === "string" ? body : JSON.stringify(body));
        }
      } catch {}
      push(String(i + 1), line);
    });
  }

  const files: string[] = [];
  for (const spec of pos) {
    if (spec === "-") {
      const text = readStdin();
      if (flags.lines) pushLines("stdin", text);
      else push("stdin", text);
      continue;
    }
    files.push(...expand(spec));
  }
  const seen = new Set<string>();
  for (const file of files) {
    const abs = path.resolve(file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const id = rel(abs);
    if (id.split("/").some((part) => IGNORE_DIRS.has(part))) continue;
    if (exts && !exts.includes(path.extname(file).toLowerCase())) continue;
    if (!flags["no-secrets-guard"] && SECRET_RE.test(id)) { skipped.push(`${id} (secret-like, never sent)`); continue; }
    if (LOCK_RE.test(id)) continue;
    const text = readText(abs);
    if (text === undefined) { skipped.push(`${id} (binary or >2MB)`); continue; }
    if (!text.trim()) continue;
    if (flags.lines) pushLines(id, text);
    else push(id, text);
  }
  const limit = num(flags.limit, 5000);
  if (items.length > limit) fail(`${items.length} items exceeds --limit ${limit}. Narrow the input or raise --limit.`);
  return { items, skipped };
}

export function requireInputs(items: Item[], command: string) {
  if (!items.length) fail(`nothing to ${command}: pass files, directories, globs, --items FILE, or - for stdin`);
}