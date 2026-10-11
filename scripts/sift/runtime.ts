import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSettings, storedApplies, type ModOptions, type StoredSettings } from "../../hooks/config.ts";
import { CHANNEL_ENV, channelFile, channelLine } from "../../hooks/core/channel.ts";
import { createAskJev, observeAskJev, PROVIDERS, resolveModel, type JevEvent, type Transport } from "../../hooks/core/jev.ts";
import { num, type Flags } from "../../hooks/core/sift.ts";
import type { SystemOneRequest, SystemOneResult } from "../../hooks/core/types.ts";
import { fail } from "./errors.ts";
export { PROVIDERS };
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

/** The newest Pingo store holding Setup's key: `jev_inline-<hash>.json` under --plugin-dir, `jev_<source>…` when installed. */
function pingoStore(): { credentials?: { apiKey?: unknown; provider?: unknown }; provider?: unknown; locale?: unknown } {
  const dir = path.join(configDir(), "plugins", "store");
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((name) => /^jev[_-].*\.json$/i.test(name)); } catch { return {}; }
  const stores = names
    .map((name) => ({ file: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const saved: { credentials?: { apiKey?: unknown; provider?: unknown }; provider?: unknown; locale?: unknown } = {};
  for (const { file } of stores) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!saved.credentials && typeof data?.credentials?.apiKey === "string" && data.credentials.apiKey.trim()) saved.credentials = data.credentials;
      if (saved.provider === undefined && data?.provider !== undefined) saved.provider = data.provider;
      if (saved.locale === undefined && (data?.locale === "auto" || data?.locale === "en" || data?.locale === "pt")) saved.locale = data.locale;
    } catch {}
  }
  return saved;
}

export function settings(flags: Flags) {
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
  if (store.locale === "auto" || store.locale === "en" || store.locale === "pt") options.locale = store.locale;
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
export const transport: Transport = {
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

export interface UsageStats {
  jevTokens?: number;
  jevUsageReportedCalls: number;
  jevUsageMissingCalls: number;
}

export const newUsageStats = (): UsageStats => ({ jevUsageReportedCalls: 0, jevUsageMissingCalls: 0 });
export const usageFields = (stats: UsageStats) => ({
  ...(stats.jevTokens === undefined ? {} : { jevTokens: stats.jevTokens }),
  jevUsageReportedCalls: stats.jevUsageReportedCalls,
  jevUsageMissingCalls: stats.jevUsageMissingCalls,
});

/**
 * Where each Jev call is reported: the channel file the mod named for this session, which it
 * follows into the live log and the Flow tab. From a plain shell there is none, and nothing is written.
 */
export function channel(): (event: JevEvent) => void {
  const name = channelFile(process.env[CHANNEL_ENV]);
  if (!name) return () => undefined;
  const file = path.join(os.tmpdir(), name);
  return (event) => {
    // POSIX refuses symlinks; on Windows the temp directory ACL is per-user.
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
    const fd = fs.openSync(file, flags, 0o600);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
        throw new Error("unsafe Jev channel file");
      }
      if (process.platform !== "win32") fs.fchmodSync(fd, 0o600);
      fs.writeSync(fd, channelLine(event), undefined, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  };
}

export function asker(flags: Flags, stats: UsageStats) {
  const config = settings(flags);
  if (!config.apiKey) {
    fail(`no Jev key. Run /jev setup in Claude Code, or set ${PROVIDERS[config.provider].keyEnv}.`, 3);
  }
  const ask = observeAskJev(createAskJev({ ...config, timeoutMs: 180_000 }, transport), channel(), Date.now, `sift-${process.pid}-`);
  const run: Ask = async (request) => {
    let result: SystemOneResult;
    try {
      result = await ask({ ...request, model: config.jevModel });
    } catch (error) {
      stats.jevUsageMissingCalls++;
      throw error;
    }
    const inputTokens = result.usage?.input_tokens;
    if (typeof inputTokens === "number" && Number.isFinite(inputTokens) && inputTokens >= 0) {
      stats.jevTokens = (stats.jevTokens ?? 0) + inputTokens;
      stats.jevUsageReportedCalls++;
    } else {
      stats.jevUsageMissingCalls++;
    }
    return result;
  };
  return { ask: run, provider: config.provider };
}

/** A rejected key fails every request the same way: stop at the first instead of reporting hundreds. */
export const isAuthError = (error: unknown) => [401, 403].includes((error as { status?: number })?.status ?? 0);
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const authFail = (error: unknown): never => fail(`${message(error)}\nThe key was refused: run /jev setup in Claude Code with a valid key.`, 3);

export async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
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
