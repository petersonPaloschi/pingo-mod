import fs from "node:fs";
import path from "node:path";
import { addRun, estTokens, groupRequest, num, type Flags, type Item, type MakeQuestion, type RunStats } from "../../hooks/core/sift.ts";
import type { Answer, Json } from "../../hooks/core/types.ts";
import { asker, authFail, configDir, isAuthError, message, newUsageStats, pool, usageFields, type UsageStats } from "./runtime.ts";
function newStats(provider: string, items: Item[], skipped: string[]): RunStats {
  return { scanned: items.length, contentTokens: items.reduce((sum, item) => sum + estTokens(item.text), 0), ...usageFields(newUsageStats()), seconds: 0, provider, failed: [], skipped };
}

export function runStats(provider: string, usage: UsageStats, failed: RunStats["failed"], items: Item[], skipped: string[], started: number): RunStats {
  return { ...newStats(provider, items, skipped), ...usageFields(usage), failed, seconds: (Date.now() - started) / 1000 };
}

/** One independent question per item; a failed request marks its item as not judged. */
export async function runPerItem(items: Item[], flags: Flags, make: MakeQuestion, extra: { [key: string]: Json } = {}) {
  const stats = newUsageStats();
  const { ask, provider } = asker(flags, stats);
  const failed: RunStats["failed"] = [];
  const rows = await pool(items.map((item) => async () => {
    try {
      const result = await ask(groupRequest(item, make, extra));
      const answer = result.answers.q0;
      if (!answer) {
        failed.push({ id: item.id, error: result.dropped?.find((drop) => drop.name === "q0")?.why ?? "no answer" });
        return undefined;
      }
      return { item, answer };
    } catch (error) {
      if (isAuthError(error)) authFail(error);
      failed.push({ id: item.id, error: message(error) });
      return undefined;
    }
  }), num(flags.concurrency, 16));
  return { rows: rows.filter((row): row is { item: Item; answer: Answer } => Boolean(row)), failed, ...usageFields(stats), provider };
}

export function emit(flags: Flags, json: unknown, lines: string[], foot: string) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
    process.stderr.write(`${foot}\n`);
    return;
  }
  process.stdout.write(`${lines.length ? `${lines.join("\n")}\n` : ""}${foot}\n`);
}

export function save(flags: Flags, data: unknown): string {
  if (typeof flags.save !== "string") return "";
  fs.writeFileSync(flags.save, JSON.stringify(data, null, 2));
  return `\n— full results saved to ${flags.save}`;
}

/**
 * Lifetime totals live beside Claude Code's plugin data, in a folder of their own: Claude Code names
 * the plugin's folder after how it was installed, and sift also runs from plain shells without that path.
 * SIFT_STATS moves it, so the benchmark measures its own runs without touching the user's totals.
 */
const tallyFile = () => process.env.SIFT_STATS || path.join(configDir(), "plugins", "data", "jev-sift", "stats.json");

export function readTally(): unknown {
  try { return JSON.parse(fs.readFileSync(tallyFile(), "utf8")); } catch { return undefined; }
}

/** Failed runs still record reported usage, but add no judged items or potential context reduction. */
export function finish(stats: RunStats, output: string, allFailed = stats.scanned > 0 && stats.failed.length >= stats.scanned) {
  if (allFailed) process.exitCode = 5;
  try {
    const file = tallyFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(addRun(readTally(), stats, output, new Date().toISOString(), allFailed), null, 2)}\n`);
  } catch {}
}
