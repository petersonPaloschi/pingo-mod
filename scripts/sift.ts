#!/usr/bin/env node
// Sift: hand Claude's bulk judgment calls (which files, which log lines, which bucket) to Jev and
// print a compact shortlist. Run with Node 22.18+ (it loads the mod's TypeScript directly); the
// skill in skills/sift/SKILL.md tells Claude when and how. Provider, key and model come from the
// same places as the mod's: /jev setup's saved key, the plugin options, then the environment.
import { parseArgs } from "../hooks/core/sift.ts";
import { cmdAsk, cmdClassify, cmdFilter, cmdFind, cmdRank, cmdStatus } from "./sift/commands.ts";
import { Exit, fail } from "./sift/errors.ts";
const HELP = `sift — hand bulk judgment calls to Jev, read back a shortlist

  status                               check the provider, key and model; show lifetime usage estimates
  filter "<yes/no question>" <inputs>  keep only items where the answer is yes
  classify --labels "a,b,c" <inputs>   put each item in one bucket
  rank "<query>" <inputs> [--top N]    order items by relevance
  find "<what>" <files> [--top N]      locate the lines in large files that match
  ask "<question>" --state @file       one yes/no (or --choice "a,b") over a document
  ask spec.json                        raw {state, questions} request (noul/choice)

inputs: files, directories (respects .gitignore), globs, - (stdin), --items FILE.jsonl
common: --lines --ext ts,tsx --json --save FILE --model M --concurrency 16
        --max-chars 60000 --limit 5000
filter: --threshold 0.5 --band 0.15 --no-collapse     classify: --question --only a,b
        --min-confidence 0.6 --verbose --labels-json '{...}'|@file
find:   --chunk 150 --min-score 0.05                  rank: --all
key:    /jev setup in Claude Code, or TYPESAFE_API_KEY / OPENROUTER_API_KEY /
        AI_GATEWAY_API_KEY / OPENCODE_API_KEY (JEV_PROVIDER picks between them)`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") return console.log(HELP);
  const { pos, flags } = parseArgs(rest);
  const removedBatchFlag = ["fast", "pack-items", "pack-tokens"].find((name) => Object.hasOwn(flags, name));
  if (removedBatchFlag) fail(`--${removedBatchFlag} has been removed; Sift judges each item independently`);
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
