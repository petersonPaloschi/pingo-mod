// Exercise the real Node CLI with an isolated config and a stubbed provider.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { channelFile, channelReader, FOLLOW_SCRIPT } from "../hooks/core/channel.ts";

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
    if (/^CLAUDE_PLUGIN_OPTION_/.test(name) || ["JEV_PROVIDER", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "OPENCODE_API_KEY", "NODE_OPTIONS", "PINGO_JEV_CHANNEL"].includes(name)) delete env[name];
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

test("removed batching flags fail before making provider requests", (t) => {
  const f = fixture(t);
  f.write("notes.txt", "public notes");
  for (const args of [
    ["filter", "Does this matter?", "notes.txt", "--fast"],
    ["filter", "Does this matter?", "--pack-items", "40", "notes.txt"],
    ["filter", "Does this matter?", "notes.txt", "--pack-tokens", "3000"],
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /has been removed; Sift judges each item independently/);
  }
  assert.equal(f.calls(), "");
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

test("each Jev call goes to the session's channel, which the follower streams back whole", async (t) => {
  const f = fixture(t);
  f.write("a.txt", "retry the request\n");
  f.write("b.txt", "unrelated notes\n");
  const name = `test-${process.pid}-${Date.now()}`;
  const file = path.join(os.tmpdir(), channelFile(name));
  t.after(() => fs.rmSync(file, { force: true }));

  const quiet = f.run(["filter", "Does it retry?", "a.txt", "b.txt"]);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert(!fs.existsSync(file), "a plain shell writes no channel");

  const result = f.run(["filter", "Does it retry?", "a.txt", "b.txt"], { PINGO_JEV_CHANNEL: name });
  assert.equal(result.status, 0, result.stderr);
  const written = fs.readFileSync(file, "utf8");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const events = channelReader()(written);
  assert.deepEqual(events.map((event) => event.phase).sort(), ["end", "end", "start", "start"]);
  for (const start of events.filter((event) => event.phase === "start")) {
    assert.equal(start.sent.role, "state");
    assert.equal(start.sent.turns, 0);
    const end = events.find((event) => event.phase === "end" && event.call === start.call);
    assert(end, `call ${start.call} ends`);
    assert.equal(end.result.usage.input_tokens, 17);
  }
  assert.match(events[0].call, /^sift-\d+-/);
  assert.equal(channelFile("../escape"), undefined);

  const follower = spawn(process.execPath, ["-e", FOLLOW_SCRIPT, channelFile(name)]);
  let out = "";
  follower.stdout.setEncoding("utf8").on("data", (piece) => (out += piece));
  const deadline = Date.now() + 5000;
  while (out.length < written.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  follower.kill();
  assert.equal(out, written);

  const recovery = events.find((event) => event.phase === "end");
  assert(recovery);
  const longName = `${name}-long`;
  const longFile = path.join(os.tmpdir(), channelFile(longName));
  t.after(() => fs.rmSync(longFile, { force: true }));
  fs.writeFileSync(longFile, `${"x".repeat((1 << 20) + 1)}\n${JSON.stringify(recovery)}\n`);
  const longFollower = spawn(process.execPath, ["-e", FOLLOW_SCRIPT, channelFile(longName)]);
  let longOut = "";
  longFollower.stdout.setEncoding("utf8").on("data", (piece) => (longOut += piece));
  const longDeadline = Date.now() + 5000;
  while (!channelReader()(longOut).length && Date.now() < longDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
  longFollower.kill();
  assert.deepEqual(channelReader()(longOut), [recovery]);

  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o644);
    const existing = f.run(["filter", "Does it retry?", "a.txt"], { PINGO_JEV_CHANNEL: name });
    assert.equal(existing.status, 0, existing.stderr);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    const linkName = `${name}-link`;
    const linkFile = path.join(os.tmpdir(), channelFile(linkName));
    const target = path.join(f.dir, "target.txt");
    fs.writeFileSync(target, "leave this file alone\n");
    fs.symlinkSync(target, linkFile);
    t.after(() => fs.rmSync(linkFile, { force: true }));
    const linkReader = spawn(process.execPath, ["-e", FOLLOW_SCRIPT, channelFile(linkName)]);
    let linkOut = "";
    linkReader.stdout.setEncoding("utf8").on("data", (piece) => (linkOut += piece));
    await new Promise((resolve) => setTimeout(resolve, 250));
    linkReader.kill();
    assert.equal(linkOut, "");
    const linked = f.run(["filter", "Does it retry?", "a.txt"], { PINGO_JEV_CHANNEL: linkName });
    assert.equal(linked.status, 0, linked.stderr);
    assert.equal(fs.readFileSync(target, "utf8"), "leave this file alone\n");
  }
});
