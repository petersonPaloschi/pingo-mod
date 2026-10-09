import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(await readFile(path.join(here, "cases.json"), "utf8"));
const sourceFiles = {
  "package.json": '{"type":"module"}\n',
  "README.md": "# Fixture repo\nA small dependency-free JavaScript repository for repeatable coding tasks.\n",
  "src/config.js": "export const DEFAULT_RETRIES = 3;\nexport const DEFAULT_TIMEOUT_MS = 2500;\n",
  "src/labels.js": 'export function emptyLabel() { return "??"; }\n',
  "src/format.js": 'export function formatDuration(ms) { return `${ms}ms`; }\n',
  "src/range.js": "export function sumRange(start, end) {\n  let total = 0;\n  for (let n = start; n < end; n++) total += n;\n  return total;\n}\n",
  "src/port.js": "export function parsePort(value) {\n  const port = Number(String(value).trim());\n  return Number.isInteger(port) && port >= 0 && port <= 65536 ? port : null;\n}\n",
  "src/unique.js": "export function uniqueById(items) {\n  const seen = new Set();\n  return items.filter((item) => {\n    if (seen.has(item.name)) return false;\n    seen.add(item.name);\n    return true;\n  });\n}\n",
  "src/timeouts.js": 'import { DEFAULT_TIMEOUT_MS } from "./config.js";\nexport function timeoutFor(options = {}) { return options.timeoutMs || DEFAULT_TIMEOUT_MS; }\n',
  "src/retry.js": 'import { DEFAULT_RETRIES } from "./config.js";\nexport async function withRetries(operation, retries = DEFAULT_RETRIES) {\n  let lastError;\n  for (let attempt = 0; attempt <= retries; attempt++) {\n    try { return await operation(attempt); } catch (error) { lastError = error; }\n  }\n  throw lastError;\n}\n',
  "src/query.js": 'export function parseQuery(value) { return String(value).trim().toLowerCase(); }\nexport function parseTag(value) { return String(value).replace(/^#/, ""); }\nexport function formatQuery(value) { return parseQuery(value); }\n',
  "src/index.js": "// Public exports are added by implementation tasks.\n",
};

const ids = new Set(cases.cases.map((entry) => entry.id));
assert.equal(ids.size, 15, "case manifest must contain 15 unique cases");
for (const category of ["simple-edit", "debugging", "repository-search", "multi-file-implementation", "native-agent-task"]) {
  assert.equal(cases.cases.filter((entry) => entry.class === category).length, 3, `${category} must have three cases`);
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const caseFor = (id) => {
  const entry = cases.cases.find((candidate) => candidate.id === id);
  assert.ok(entry, `unknown case id: ${id}`);
  return entry;
};
const workspacePath = (workspace, relative) => path.join(path.resolve(workspace), ...relative.split("/"));
const importFresh = async (workspace, relative) => import(`${pathToFileURL(workspacePath(workspace, relative)).href}?v=${Date.now()}-${Math.random()}`);

async function prepare(id, workspace) {
  caseFor(id);
  const target = path.resolve(workspace);
  try {
    await stat(target);
    throw new Error(`refusing to overwrite existing workspace: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const [relative, contents] of Object.entries(sourceFiles)) {
    const file = workspacePath(target, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, "utf8");
  }
  const hashes = Object.fromEntries(Object.entries(sourceFiles).map(([relative, contents]) => [relative, sha256(contents)]));
  await writeFile(workspacePath(target, ".baseline-hashes.json"), `${JSON.stringify(hashes, null, 2)}\n`, "utf8");
  console.log(`prepared ${id} at ${target}`);
}

async function changedFiles(workspace) {
  const target = path.resolve(workspace);
  const baseline = JSON.parse(await readFile(workspacePath(target, ".baseline-hashes.json"), "utf8"));
  const changed = [];
  async function visit(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.name === ".baseline-hashes.json") continue;
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) await visit(absolute);
      else {
        const relative = path.relative(target, absolute).replaceAll("\\", "/");
        const digest = sha256(await readFile(absolute));
        if (baseline[relative] !== digest) changed.push(relative);
        delete baseline[relative];
      }
    }
  }
  await visit(target);
  changed.push(...Object.keys(baseline));
  return changed.sort();
}

function findToolCalls(value, requiredName, calls = []) {
  if (Array.isArray(value)) for (const item of value) findToolCalls(item, requiredName, calls);
  else if (value && typeof value === "object") {
    if ((value.type === "tool_use" || value.type === "tool_call") && value.name === requiredName) {
      const input = value.input && typeof value.input === "object" ? value.input : {};
      calls.push({ name: value.name, subagentType: typeof input.subagent_type === "string" ? input.subagent_type : null });
    }
    for (const item of Object.values(value)) findToolCalls(item, requiredName, calls);
  }
  return calls;
}

async function verify(id, workspace, answerFile, traceFile) {
  const entry = caseFor(id);
  const target = path.resolve(workspace);
  if (entry.answerKey) {
    assert.ok(answerFile && answerFile !== "-", "search cases require a saved answer file");
    const answer = (await readFile(path.resolve(answerFile), "utf8")).toLowerCase();
    for (const fact of entry.answerKey) assert.ok(answer.includes(fact.toLowerCase()), `answer is missing required fact: ${fact}`);
  } else if (id === "edit-01-retry-default") {
    const { DEFAULT_RETRIES } = await importFresh(target, "src/config.js");
    assert.equal(DEFAULT_RETRIES, 4);
  } else if (id === "edit-02-empty-label") {
    const { emptyLabel } = await importFresh(target, "src/labels.js");
    assert.equal(emptyLabel(), "Unknown");
  } else if (id === "edit-03-duration-spacing") {
    const { formatDuration } = await importFresh(target, "src/format.js");
    assert.equal(formatDuration(125), "125 ms");
  } else if (id === "debug-01-inclusive-range") {
    const { sumRange } = await importFresh(target, "src/range.js");
    assert.equal(sumRange(2, 4), 9);
    assert.equal(sumRange(-2, 1), -2);
  } else if (id === "debug-02-valid-port") {
    const { parsePort } = await importFresh(target, "src/port.js");
    for (const [input, expected] of [[1, 1], [65535, 65535], [" 443 ", 443], [0, null], [65536, null], [1.5, null], ["abc", null]]) assert.equal(parsePort(input), expected);
  } else if (id === "debug-03-unique-by-id") {
    const { uniqueById } = await importFresh(target, "src/unique.js");
    const items = [{ id: 1, name: "same" }, { id: 2, name: "same" }, { id: 1, name: "later" }];
    assert.deepEqual(uniqueById(items), items.slice(0, 2));
  } else if (id === "implementation-01-duration-parser") {
    assert.match(await readFile(workspacePath(target, "src/index.js"), "utf8"), /parseDuration/);
    const { parseDuration } = await importFresh(target, "src/duration.js");
    assert.equal(parseDuration("1.5h"), 5_400_000);
    assert.equal(parseDuration("30m"), 1_800_000);
    assert.equal(parseDuration("20s"), 20_000);
    for (const input of ["-2s", "1d", "wat", "2 s"]) assert.equal(parseDuration(input), null);
  } else if (id === "implementation-02-pagination") {
    assert.match(await readFile(workspacePath(target, "src/index.js"), "utf8"), /paginate/);
    const { paginate } = await importFresh(target, "src/paginate.js");
    assert.deepEqual(paginate(["a", "b", "c", "d"], 2, 2), { items: ["c", "d"], total: 4, page: 2, pageCount: 2 });
    assert.deepEqual(paginate(["a", "b", "c"], 8, 2), { items: ["c"], total: 3, page: 2, pageCount: 2 });
    assert.deepEqual(paginate([], 8, 2), { items: [], total: 0, page: 1, pageCount: 0 });
    assert.equal(paginate(["a"], 1, 0), null);
  } else if (id === "implementation-03-email-mask") {
    assert.match(await readFile(workspacePath(target, "src/index.js"), "utf8"), /maskEmail/);
    const { maskEmail } = await importFresh(target, "src/privacy.js");
    assert.equal(maskEmail("alex@example.com"), "a***@example.com");
    assert.equal(maskEmail("a@example.com"), "a***@example.com");
    for (const input of ["", "not-an-email", "@example.com", "x@y@z"]) assert.equal(maskEmail(input), null);
  } else if (id === "agent-03-phone-implementation") {
    assert.match(await readFile(workspacePath(target, "src/index.js"), "utf8"), /maskPhone/);
    const { maskPhone } = await importFresh(target, "src/phone.js");
    assert.equal(maskPhone("(415) 555-0199"), "***-***-0199");
    assert.equal(maskPhone("12-34"), null);
  }
  if (entry.requiredTool) {
    assert.ok(traceFile, `${entry.requiredTool} cases require a saved stream-json trace`);
    const lines = (await readFile(path.resolve(traceFile), "utf8")).split(/\r?\n/).filter(Boolean);
    const events = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch { /* incomplete/non-JSON diagnostic line */ }
    }
    const calls = findToolCalls(events, entry.requiredTool);
    assert.equal(calls.length, 1, `expected exactly one native ${entry.requiredTool} tool call, found ${calls.length}`);
    assert.equal(calls[0]?.subagentType, entry.requiredSubagentType, `expected subagent type ${entry.requiredSubagentType}, found ${calls[0]?.subagentType}`);
  }
  const changed = await changedFiles(target);
  const allowed = entry.allowedChangedFiles ?? [];
  const unexpected = changed.filter((file) => !allowed.includes(file));
  assert.deepEqual(unexpected, [], `unexpected changed files: ${unexpected.join(", ")}`);
  console.log(`PASS ${id}; changed files: ${changed.join(", ") || "none"}`);
}

async function selfcheck() {
  const temp = await import("node:fs/promises");
  const root = await temp.mkdtemp(path.join(tmpdir(), "pingo-eval-") );
  try {
    const prepared = path.join(root, "prepared");
    await prepare("edit-01-retry-default", prepared);
    const { DEFAULT_RETRIES } = await importFresh(prepared, "src/config.js");
    assert.equal(DEFAULT_RETRIES, 3, "fixture starts from the preregistered baseline");
    assert.equal(cases.cases.filter((entry) => entry.answerKey).length, 5, "search and agent answer cases have frozen keys");
    console.log("PASS manifest and baseline fixture self-check");
  } finally {
    await temp.rm(root, { recursive: true, force: true });
  }
}

const [command, id, workspace, answerFile] = process.argv.slice(2);
if (command === "prepare") await prepare(id, workspace);
else if (command === "verify") await verify(id, workspace, answerFile, process.argv[6]);
else if (command === "selfcheck") await selfcheck();
else throw new Error("usage: node fixture.mjs prepare <case-id> <workspace> | verify <case-id> <workspace> [answer-file|-] [stream-json-trace] | selfcheck");
