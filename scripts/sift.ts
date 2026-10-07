#!/usr/bin/env node
// Sift: hand Claude's bulk judgment calls (which files, which log lines, which bucket) to Jev and
// print a compact shortlist. Run with Node 22.18+ (it loads the mod's TypeScript directly); the
// skill in skills/sift/SKILL.md tells Claude when and how. Provider, key and model come from the
// same places as the mod's: /jev setup's saved key, the plugin options, then the environment.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveSettings, storedApplies, type ModOptions, type StoredSettings } from "../hooks/config.ts";
import { createAskJev, PROVIDERS, resolveModel, validateKey, type Transport } from "../hooks/core/jev.ts";
import {
  batches, classifyQuestion, clip, f2, filterQuestion, findHits, findRequest, footer, groupRequest, label, num, parseArgs,
  parseLabels, rankQuestion, relevance, renderAnswer, renderClassify, renderFilter, estTokens,
  type Flags, type Item, type Labeled, type MakeQuestion, type RunStats, type Scored,
} from "../hooks/core/sift.ts";
import type { Answer, Json, SystemOneRequest, SystemOneResult } from "../hooks/core/types.ts";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "target", "vendor", "__pycache__", ".venv", "venv", "coverage", ".turbo", ".cache", ".idea", ".vscode"]);
/** Files that look like credentials are never sent, whatever the question. */
const SECRET_RE = /(^|[\/\\])(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks|crt|cer)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;
const LOCK_RE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|\.min\.(js|css)|\.map)$/i;
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

class Exit extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}
const fail = (message: string, code = 1): never => { throw new Exit(message, code); };

// --- Settings: the mod's resolver over what a process outside Claude Code can read ---

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

/** The newest Pingo store holding Setup's key: `jev_inline-<hash>.json` under --plugin-dir, `jev_<source>…` when installed. */
function pingoStore(): { credentials?: { apiKey?: unknown; provider?: unknown }; provider?: unknown } {
  const dir = path.join(configDir(), "plugins", "store");
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((name) => /^jev[_-].*\.json$/i.test(name)); } catch { return {}; }
  const stores = names
    .map((name) => ({ file: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { file } of stores) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof data?.credentials?.apiKey === "string" && data.credentials.apiKey.trim()) return data;
    } catch {}
  }
  return {};
}

function settings(flags: Flags) {
  const env: Record<string, string> = {};
  for (const name of ["JEV_PROVIDER", ...Object.values(PROVIDERS).map((info) => info.keyEnv)]) {
    const value = process.env[name]?.trim();
    if (value) env[name] = value;
  }
  // Claude Code exports plugin options to plugin subprocesses; Setup's saved pair fills in when it does not.
  const options: ModOptions = {
    provider: process.env.CLAUDE_PLUGIN_OPTION_PROVIDER,
    api_key: process.env.CLAUDE_PLUGIN_OPTION_API_KEY,
    model: process.env.CLAUDE_PLUGIN_OPTION_MODEL,
    locale: process.env.CLAUDE_PLUGIN_OPTION_LOCALE,
  };
  const store = pingoStore();
  let fromSetup = false;
  const saved = store.credentials;
  if (!options.api_key?.trim() && typeof saved?.apiKey === "string") {
    options.api_key = saved.apiKey.trim();
    if (typeof saved.provider === "string") options.provider = saved.provider;
    fromSetup = true;
  }
  const rawProvider = store.provider;
  const stored = (typeof rawProvider === "string" ? { provider: rawProvider } : rawProvider && typeof rawProvider === "object" ? rawProvider : {}) as StoredSettings;
  const resolved = resolveSettings(options, env, storedApplies(options, env, stored) ? stored : {});
  const model = typeof flags.model === "string" ? resolveModel(resolved.provider, flags.model) : resolved.jevModel;
  const source = resolved.keySource === "plugin" ? (fromSetup ? "/jev setup" : "plugin option") : resolved.keySource === "environment" ? `env ${PROVIDERS[resolved.provider].keyEnv}` : "none";
  return { ...resolved, jevModel: model, source };
}

// --- Network: global fetch, with the patience a few hundred parallel calls need ---

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rate limits and outages are retried here with backoff (Retry-After first); the client adds its own single retry. */
const transport: Transport = {
  async post(url, headers, body) {
    for (let attempt = 0; ; attempt++) {
      let reply: Response;
      try {
        reply = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
      } catch (error) {
        if (attempt >= 3) throw error;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const text = await reply.text();
      if (reply.ok || !RETRYABLE.has(reply.status) || attempt >= 3) return { status: reply.status, ok: reply.ok, text };
      const after = Number(reply.headers.get("retry-after"));
      await sleep(after > 0 ? Math.min(after, 30) * 1000 : 500 * 2 ** attempt + Math.random() * 250);
    }
  },
  sleep,
  within: (ms, work) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  },
};

type Ask = (request: Omit<SystemOneRequest, "model">) => Promise<SystemOneResult>;

function asker(flags: Flags, stats: { jevTokens: number }) {
  const config = settings(flags);
  if (!config.apiKey) {
    fail(`no Jev key. Run /jev setup in Claude Code, or set ${PROVIDERS[config.provider].keyEnv}.`, 3);
  }
  const ask = createAskJev({ ...config, timeoutMs: 180_000 }, transport);
  const run: Ask = async (request) => {
    const result = await ask({ ...request, model: config.jevModel });
    stats.jevTokens += result.usage.input_tokens;
    return result;
  };
  return { ask: run, provider: config.provider };
}

/** A rejected key fails every request the same way: stop at the first instead of reporting hundreds. */
const isAuthError = (error: unknown) => [401, 403].includes((error as { status?: number })?.status ?? 0);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const authFail = (error: unknown): never => fail(`${message(error)}\nThe key was refused: run /jev setup in Claude Code with a valid key.`, 3);

async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, tasks.length)) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      out[index] = await tasks[index]!();
    }
  }));
  return out;
}

// --- Inputs ---

/** Ids are paths from the working directory, or absolute once outside it: `../../..` chains only obscure the file. */
const rel = (file: string) => {
  const relative = path.relative(process.cwd(), file);
  return (relative.startsWith("..") || path.isAbsolute(relative) ? file : relative).split(path.sep).join("/") || ".";
};
const readStdin = () => { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } };

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
    return glob!(spec, { exclude: (file: string) => IGNORE_DIRS.has(path.basename(file)) }).filter(isFile);
  }
  if (!fs.existsSync(spec)) fail(`no such file or directory: ${spec}`);
  if (fs.statSync(spec).isFile()) return [spec];
  const tracked = gitFiles(spec);
  return (tracked?.length ? tracked : walk(spec)).filter(isFile);
}

/** The text of a file, or undefined for binaries and anything over 2 MB. */
function readText(file: string): string | undefined {
  if (fs.statSync(file).size > MAX_FILE_BYTES) return undefined;
  const buffer = fs.readFileSync(file);
  return buffer.subarray(0, 8192).includes(0) ? undefined : buffer.toString("utf8");
}

function collect(pos: string[], flags: Flags): { items: Item[]; skipped: string[] } {
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
    const raw = flags.items === "-" ? readStdin() : fs.readFileSync(flags.items, "utf8");
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

function requireInputs(items: Item[], command: string) {
  if (!items.length) fail(`nothing to ${command}: pass files, directories, globs, --items FILE, or - for stdin`);
}

// --- Running and printing ---

function newStats(provider: string, items: Item[], skipped: string[]): RunStats {
  return { scanned: items.length, contentTokens: items.reduce((sum, item) => sum + estTokens(item.text), 0), jevTokens: 0, seconds: 0, provider, failed: [], skipped };
}

/** One question per item (packed only with --fast); a failed request marks its items as not judged. */
async function runPerItem(items: Item[], flags: Flags, make: MakeQuestion, extra: { [key: string]: Json } = {}) {
  const stats = { jevTokens: 0 };
  const { ask, provider } = asker(flags, stats);
  const failed: RunStats["failed"] = [];
  const groups = batches(items, flags);
  const rows = await pool(groups.map((group) => async () => {
    try {
      const result = await ask(groupRequest(group, make, extra));
      return group.map((item, j) => {
        const answer = result.answers[`q${j}`];
        if (!answer) failed.push({ id: item.id, error: result.dropped?.find((drop) => drop.name === `q${j}`)?.why ?? "no answer" });
        return { item, answer };
      });
    } catch (error) {
      if (isAuthError(error)) authFail(error);
      for (const item of group) failed.push({ id: item.id, error: message(error) });
      return [];
    }
  }), num(flags.concurrency, 16));
  return { rows: rows.flat().filter((row): row is { item: Item; answer: Answer } => Boolean(row.answer)), failed, jevTokens: stats.jevTokens, provider };
}

function emit(flags: Flags, json: unknown, lines: string[], foot: string) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
    process.stderr.write(`${foot}\n`);
    return;
  }
  process.stdout.write(`${lines.length ? `${lines.join("\n")}\n` : ""}${foot}\n`);
}

function save(flags: Flags, data: unknown): string {
  if (typeof flags.save !== "string") return "";
  fs.writeFileSync(flags.save, JSON.stringify(data, null, 2));
  return `\n— full results saved to ${flags.save}`;
}

/** Every request failed: nothing above is a verdict, so the exit code says so. */
function finish(stats: RunStats) {
  if (stats.scanned && stats.failed.length >= stats.scanned) process.exitCode = 5;
}

// --- Commands ---

async function cmdFilter(pos: string[], flags: Flags) {
  const question = pos.shift();
  if (!question) fail('usage: filter "<yes/no question>" <inputs...>');
  const started = Date.now();
  const { items, skipped } = collect(pos, flags);
  requireInputs(items, "filter");
  const run = await runPerItem(items, flags, filterQuestion(question!));
  const scored: Scored[] = run.rows.flatMap((row) => (row.answer.type === "noul" ? [{ item: row.item, score: row.answer.noul }] : []));
  const { lines, matched, borderline } = renderFilter(scored, flags);
  const stats = { ...newStats(run.provider, items, skipped), jevTokens: run.jevTokens, failed: run.failed, seconds: (Date.now() - started) / 1000 };
  const saved = save(flags, scored.map((row) => ({ id: row.item.id, p: row.score })));
  const foot = footer(stats, [`${matched.length} matched`, `${borderline.length} borderline`], lines.join("\n")) + saved;
  const shown = (rows: Scored[]) => rows.map((row) => ({ id: row.item.id, p: row.score }));
  emit(flags, { matched: shown(matched), borderline: shown(borderline), failed: run.failed }, lines, foot);
  finish(stats);
}

function labelsFrom(flags: Flags): Record<string, Json> {
  if (typeof flags["labels-json"] === "string") {
    const raw = flags["labels-json"];
    return JSON.parse(raw.startsWith("@") ? fs.readFileSync(raw.slice(1), "utf8") : raw);
  }
  if (typeof flags.labels !== "string") fail('classify needs --labels "a,b,c" or --labels-json \'{"a":"description"}\'');
  return parseLabels(flags.labels as string);
}

async function cmdClassify(pos: string[], flags: Flags) {
  const criteria = labelsFrom(flags);
  const labels = Object.keys(criteria);
  if (labels.length < 2 || labels.length > 255) fail("classify needs 2–255 labels");
  const question = typeof flags.question === "string" ? flags.question : "Which label best describes this item?";
  const started = Date.now();
  const { items, skipped } = collect(pos, flags);
  requireInputs(items, "classify");
  const run = await runPerItem(items, flags, classifyQuestion(question, criteria));
  const labeled: Labeled[] = run.rows.flatMap((row) => (row.answer.type === "choice" ? [{ item: row.item, answer: row.answer }] : []));
  const { lines, low } = renderClassify(labeled, labels, flags);
  const stats = { ...newStats(run.provider, items, skipped), jevTokens: run.jevTokens, failed: run.failed, seconds: (Date.now() - started) / 1000 };
  const saved = save(flags, labeled.map((row) => ({ id: row.item.id, label: row.answer.choice, confidence: row.answer.confidence })));
  const foot = footer(stats, [`${low.length} low-confidence (?)`], lines.join("\n")) + saved;
  emit(flags, labeled.map((row) => ({ id: row.item.id, label: row.answer.choice, confidence: row.answer.confidence, probabilities: row.answer.probabilities })), lines, foot);
  finish(stats);
}

async function cmdRank(pos: string[], flags: Flags) {
  const query = pos.shift();
  if (!query) fail('usage: rank "<query>" <inputs...> [--top 10 | --all]');
  const started = Date.now();
  const { items, skipped } = collect(pos, flags);
  requireInputs(items, "rank");
  const run = await runPerItem(items, flags, rankQuestion, { query: query! });
  const scored = run.rows.flatMap((row) => (row.answer.type === "choice" ? [{ item: row.item, score: relevance(row.answer), confidence: row.answer.confidence }] : []));
  scored.sort((a, b) => b.score - a.score);
  const shown = flags.all ? scored : scored.slice(0, num(flags.top, 10));
  const lines = shown.map((row) => `${f2(row.score)}  ${label(row.item, flags)}`);
  const stats = { ...newStats(run.provider, items, skipped), jevTokens: run.jevTokens, failed: run.failed, seconds: (Date.now() - started) / 1000 };
  const foot = footer(stats, [`top ${shown.length}`], lines.join("\n"));
  emit(flags, shown.map((row) => ({ id: row.item.id, relevance: row.score, confidence: row.confidence })), lines, foot);
  finish(stats);
}

async function cmdFind(pos: string[], flags: Flags) {
  const query = pos.shift();
  if (!query || !pos.length) fail('usage: find "<what you are looking for>" <files...> [--top 5]');
  const started = Date.now();
  const chunkLines = Math.max(10, Math.min(num(flags.chunk, 150), 250));
  const { items: files, skipped } = collect(pos, { ...flags, lines: false, "max-chars": String(Number.MAX_SAFE_INTEGER) } as Flags);
  requireInputs(files, "find");
  const chunks: { file: string; lines: [string, string][] }[] = [];
  for (const file of files) {
    const all = file.text.split(/\r?\n/).map((text, i): [string, string] => [String(i + 1), text]).filter(([, text]) => text.trim());
    for (let i = 0; i < all.length; i += chunkLines) chunks.push({ file: file.id, lines: all.slice(i, i + chunkLines) });
  }
  const counter = { jevTokens: 0 };
  const { ask, provider } = asker(flags, counter);
  const failed: RunStats["failed"] = [];
  const perChunk = await pool(chunks.map((chunk) => async () => {
    try {
      return findHits(chunk.file, chunk.lines, (await ask(findRequest(query!, chunk.lines))).answers);
    } catch (error) {
      if (isAuthError(error)) authFail(error);
      failed.push({ id: `${chunk.file}:${chunk.lines[0]![0]}-${chunk.lines.at(-1)![0]}`, error: message(error) });
      return [];
    }
  }), num(flags.concurrency, 16));
  const minScore = num(flags["min-score"], 0.05);
  const hits = perChunk.flat().filter((hit) => hit.score >= minScore).sort((a, b) => b.score - a.score).slice(0, num(flags.top, 5));
  const lines = hits.map((hit) => `${f2(hit.score)}  ${hit.file}:${hit.line}  ${clip(hit.text.trim(), num(flags.width, 160))}`);
  if (!lines.length) lines.push("(no matching lines)");
  const stats = { ...newStats(provider, files, skipped), jevTokens: counter.jevTokens, failed, seconds: (Date.now() - started) / 1000 };
  const foot = footer(stats, [`${chunks.length} chunks`], lines.join("\n"));
  emit(flags, hits, lines, foot);
  if (chunks.length && failed.length >= chunks.length) process.exitCode = 5;
}

function stateArg(value: string | true | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "-") return readStdin();
  return value.startsWith("@") ? fs.readFileSync(value.slice(1), "utf8") : value;
}

async function cmdAsk(pos: string[], flags: Flags) {
  const started = Date.now();
  const first = pos[0];
  let request: Omit<SystemOneRequest, "model">;
  if (first && (first === "-" || first.endsWith(".json")) && flags.state === undefined) {
    const spec = JSON.parse(first === "-" ? readStdin() : fs.readFileSync(first, "utf8"));
    if (!spec?.state || !spec?.questions) fail('a spec needs "state" and "questions"');
    request = { state: typeof spec.state === "string" ? { content: spec.state } : spec.state, questions: spec.questions };
  } else {
    const question = pos.join(" ");
    if (!question) fail('usage: ask "<question>" --state @file|text|- [--choice "a,b"]  or  ask spec.json');
    const state = stateArg(flags.state);
    if (state === undefined) fail("ask needs --state (@file, literal text, or - for stdin)");
    const instructions = `${question} (about \`content\`)`;
    request = {
      state: { content: state! },
      questions: { answer: typeof flags.choice === "string" ? { type: "choice", instructions, criteria: parseLabels(flags.choice) } : { type: "noul", instructions } },
    };
  }
  const counter = { jevTokens: 0 };
  const { ask, provider } = asker(flags, counter);
  let result: SystemOneResult;
  try {
    result = await ask(request);
  } catch (error) {
    return isAuthError(error) ? authFail(error) : fail(message(error), 5);
  }
  const lines = Object.entries(result.answers).map(([id, answer]) => renderAnswer(id, answer));
  for (const drop of result.dropped ?? []) lines.push(`${drop.name}  unusable (${drop.why})`);
  const stateText = JSON.stringify(request.state);
  const stats: RunStats = { scanned: 1, contentTokens: estTokens(stateText), jevTokens: counter.jevTokens, seconds: (Date.now() - started) / 1000, provider, failed: [], skipped: [] };
  emit(flags, result, lines, footer(stats, [], lines.join("\n"), false));
}

async function cmdStatus(flags: Flags) {
  const config = settings(flags);
  const info = PROVIDERS[config.provider];
  if (!config.apiKey) fail(`not configured: run /jev setup in Claude Code, or set ${info.keyEnv} (key from ${info.keyUrl})`, 3);
  const check = await validateKey(config.provider, config.apiKey, transport, config.jevModel, config.locale);
  if (!check.ok) fail(`${info.label} · key from ${config.source} · ${check.message}`, check.refused ? 3 : 5);
  console.log(`ready · ${info.label} · key from ${config.source} · model ${config.jevModel} · ${check.ms} ms`);
}

const HELP = `sift — hand bulk judgment calls to Jev, read back a shortlist

  status                               check the provider, key and model
  filter "<yes/no question>" <inputs>  keep only items where the answer is yes
  classify --labels "a,b,c" <inputs>   put each item in one bucket
  rank "<query>" <inputs> [--top N]    order items by relevance
  find "<what>" <files> [--top N]      locate the lines in large files that match
  ask "<question>" --state @file       one yes/no (or --choice "a,b") over a document
  ask spec.json                        raw {state, questions} request (noul/choice)

inputs: files, directories (respects .gitignore), globs, - (stdin), --items FILE.jsonl
common: --lines --ext ts,tsx --json --save FILE --model M --concurrency 16
        --max-chars 60000 --limit 5000 --fast (pack small items: faster, less accurate)
filter: --threshold 0.5 --band 0.15 --no-collapse     classify: --question --only a,b
        --min-confidence 0.6 --verbose --labels-json '{...}'|@file
find:   --chunk 150 --min-score 0.05                  rank: --all
key:    /jev setup in Claude Code, or TYPESAFE_API_KEY / OPENROUTER_API_KEY /
        AI_GATEWAY_API_KEY / OPENCODE_API_KEY (JEV_PROVIDER picks between them)`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") return console.log(HELP);
  const { pos, flags } = parseArgs(rest);
  if (command === "status") return cmdStatus(flags);
  if (command === "filter") return cmdFilter(pos, flags);
  if (command === "classify") return cmdClassify(pos, flags);
  if (command === "rank") return cmdRank(pos, flags);
  if (command === "find") return cmdFind(pos, flags);
  if (command === "ask") return cmdAsk(pos, flags);
  fail(`unknown command "${command}"\n\n${HELP}`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`sift: ${error instanceof Exit ? error.message : `unexpected error: ${error instanceof Error ? error.stack : error}`}\n`);
  process.exit(error instanceof Exit ? error.code : 5);
}
