// Exercise the real Node CLI with an isolated config and a stubbed provider.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../scripts/sift.ts", import.meta.url));

function fixture(t) {
  const prefix = path.join(os.tmpdir(), "pingo-sift-test-");
  const dir = fs.mkdtempSync(prefix);
  t.after(() => {
    assert(path.resolve(dir).startsWith(prefix));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  const calls = path.join(dir, "calls.jsonl");
  const stub = write("provider.mjs", `
    import fs from 'node:fs';
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      fs.appendFileSync(process.env.SIFT_TEST_CALLS, JSON.stringify(request.state) + '\\n');
      const answers = process.env.SIFT_TEST_EMPTY ? {} : Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => {
          const choice = Object.keys(question.criteria ?? {})[0];
          return [id, question.type === 'noul' ? {type: 'noul', noul: 0.95} :
            {type: 'choice', choice, confidence: 0.95, probabilities: {[choice]: 1}}];
        }));
      return new Response(JSON.stringify({answers, usage: {input_tokens: 17, output_tokens: 0}}));
    };
  `);
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^CLAUDE_PLUGIN_OPTION_/.test(name) || ["JEV_PROVIDER", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "OPENCODE_API_KEY", "NODE_OPTIONS"].includes(name)) delete env[name];
  }
  Object.assign(env, { CLAUDE_CONFIG_DIR: path.join(dir, "config"), CLAUDE_PLUGIN_OPTION_PROVIDER: "typesafe", CLAUDE_PLUGIN_OPTION_API_KEY: "test-key", SIFT_TEST_CALLS: calls });
  const run = (args, extra = {}) => spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, cli, ...args], {
    cwd: dir, env: { ...env, ...extra }, encoding: "utf8", timeout: 10_000,
  });
  return { dir, write, run, calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "" };
}

test("ignored directories and glob matches never reach the provider", (t) => {
  const f = fixture(t);
  f.write(".gitignore", "data/\n");
  f.write("data/private.txt", "content excluded by git");
  f.write("notes.txt", "public notes");
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: f.dir }).status, 0);
  const empty = f.run(["filter", "Does it matter?", "data"]);
  assert.equal(empty.status, 1, empty.stderr);
  assert.equal(f.calls(), "");
  const glob = f.run(["filter", "Does it matter?", "**/*.txt", "--json"]);
  assert.equal(glob.status, 0, glob.stderr);
  assert.deepEqual(JSON.parse(glob.stdout).matched.map((row) => row.id), ["notes.txt"]);
  assert(!f.calls().includes("content excluded by git"));
});

test("auxiliary file inputs apply the credential guard before any request", (t) => {
  const f = fixture(t);
  f.write(".env", "synthetic content");
  f.write("credentials.json", JSON.stringify({ state: { content: "synthetic content" }, questions: { q: { type: "noul", instructions: "Is it present?" } } }));
  for (const args of [
    ["ask", "Is it present?", "--state", "@.env"],
    ["filter", "Is it present?", "--items", "credentials.json"],
    ["ask", "credentials.json"],
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /secret-like/);
  }
  assert.equal(f.calls(), "");
});

test("rank, find and ask write results when --save is supplied", (t) => {
  const f = fixture(t);
  f.write("notes.txt", "retry the request\nwait before retrying\n");
  for (const args of [
    ["rank", "retry", "notes.txt"],
    ["find", "retry", "notes.txt"],
    ["ask", "Does it retry?", "--state", "@notes.txt"],
  ]) {
    const result = f.run([...args, "--save", `${args[0]}.json`]);
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(f.dir, `${args[0]}.json`), "utf8"));
    assert(Array.isArray(saved) ? saved.length > 0 : Object.keys(saved.answers).length > 0);
  }
});

test("find and ask report unusable provider answers as failures", (t) => {
  const f = fixture(t);
  f.write("notes.txt", "retry the request\n");
  for (const args of [["find", "retry", "notes.txt"], ["ask", "Does it retry?", "--state", "@notes.txt"]]) {
    const result = f.run(args, { SIFT_TEST_EMPTY: "1" });
    assert.equal(result.status, 5, result.stderr);
    assert.match(result.stdout, /not judged|no usable answer/);
  }
});
