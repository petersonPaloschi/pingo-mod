// Chaveiro: each call the person approves at a permission prompt counts toward its kind; at the third approval Jev
// weighs a rule for it at the turn's end. A rule for calls that only read is proposed, judged by the Comandante, and
// written to the settings only with Enviar; anything else is let go, and each kind is weighed once. Off by default.
import { expect, test, type TestBody } from "claude-code/testing";
import { addAllowRule, chaveiroDecision, permissionPattern, settingsFile } from "../hooks/core/chaveiro.ts";
import { DEFAULT_FEATURES } from "../hooks/core/contracts.ts";
import type { Answer } from "../hooks/core/types.ts";
import { ASK, deckWorld, TERMINAL } from "./deck/helpers.ts";
import { comandanteJev, PANE_PROPS, pick } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const done = (turnId: string) => ({ turnId, answer: "Done.", durationMs: 10, isAborted: false, reason: "answer" }) as never;
const wait = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
async function settle(isDone: () => boolean) {
  for (let i = 0; i < 80 && !isDone(); i++) await wait();
}
const READS: Record<string, Answer> = { reads: pick("read_only", 0.95), rule: pick("Bash(git status:*)", 0.95), scope: pick("local", 0.95) };

const store = (features: Record<string, boolean> = {}) => new Map<string, unknown>([
  ["features", { ...DEFAULT_FEATURES, codeQuality: false, chaveiro: true, ...features }],
  ["credentials", { apiKey: "test-key", provider: "typesafe" }],
]);

function chaveiroWorld(on: Parameters<typeof deckWorld>[0], table: Record<string, Answer>, saved = store(), toolCall?: (...args: any[]) => unknown) {
  const writes: { path: string; text: string }[] = [];
  const jev = comandanteJev(on, table);
  const world = deckWorld(on, saved, {
    ...(toolCall ? { toolCall } : {}),
    fsWrite: async (_$: unknown, e: { path: string; content?: string; text?: string; data?: string }) => {
      // the kit hands paths over in the host's own spelling (backslashes on Windows)
      writes.push({ path: e.path.replace(/\\/g, "/"), text: String(e.text ?? e.content ?? e.data ?? "") });
      return { value: undefined };
    },
  });
  const asked = () => jev.asked.filter((request) => request.questions?.reads).length;
  return { ...world, jev, writes, asked };
}

/** One permission prompt the person answers yes to: the check asks, then the call runs. */
async function approve($: Parameters<TestBody>[0], command: string, id: string) {
  await $.tool.check({ tool: "Bash", input: { command }, tool_use_id: id } as never);
  await $.tool.call({ tool: "Bash", command, tool_use_id: id } as never);
}

async function autonomos($: Parameters<TestBody>[0]) {
  await $.command.run({ command: "jev", ...ASK, args: "autonomos" });
  return $.ui.mount({ plugin: "jev", component: "Pane", requestId: "jev", surface: TERMINAL, props: PANE_PROPS });
}

test("a call's kind and its rules, narrowest first; Jev's decision; a rule added to a settings file, nothing else touched", () => {
  expect(permissionPattern("Bash", { command: "git status --short" })).toEqual({
    key: "Bash:git status", tool: "Bash", sample: "git status --short",
    rules: ["Bash(git status --short)", "Bash(git status:*)", "Bash(git:*)"],
  });
  expect(permissionPattern("Bash", { command: "git log | head -5" })?.rules).toEqual(["Bash(git log | head -5)"]);
  expect(permissionPattern("WebFetch", { url: "https://docs.example.com/a" })?.rules).toEqual(["WebFetch(domain:docs.example.com)"]);
  expect(permissionPattern("mcp__graft__graft_find_code", {})?.rules).toEqual(["mcp__graft__graft_find_code"]);
  expect(permissionPattern("Edit", { file_path: "/a" })).toBeUndefined();
  const pattern = permissionPattern("Bash", { command: "git status --short" })!;
  expect(chaveiroDecision(READS, 0.7, pattern)).toEqual({ rule: "Bash(git status:*)", scope: "local" });
  expect(chaveiroDecision({ ...READS, reads: pick("changes", 0.95) }, 0.7, pattern)).toBeUndefined();
  expect(chaveiroDecision({ reads: pick("read_only", 0.95) }, 0.7, pattern)).toEqual({ rule: "Bash(git status --short)", scope: "local" });
  expect(settingsFile("local", "/work/", "/home/me")).toBe("/work/.claude/settings.local.json");
  expect(settingsFile("user", "/work", "/home/me")).toBe("/home/me/.claude/settings.json");
  expect(JSON.parse(addAllowRule(undefined, "Bash(git status:*)"))).toEqual({ permissions: { allow: ["Bash(git status:*)"] } });
  const kept = JSON.parse(addAllowRule(JSON.stringify({ model: "opus", permissions: { allow: ["Read"], deny: ["Bash(rm:*)"] } }), "Bash(git status:*)"));
  expect(kept).toEqual({ model: "opus", permissions: { allow: ["Read", "Bash(git status:*)"], deny: ["Bash(rm:*)"] } });
  expect(JSON.parse(addAllowRule(JSON.stringify({ permissions: { allow: ["Bash(git status:*)"] } }), "Bash(git status:*)")).permissions.allow).toHaveLength(1);
  expect(() => addAllowRule("[1, 2]", "Read")).toThrow();
  expect(() => addAllowRule("{ not json", "Read")).toThrow();
});

test("off by default, approvals ask Jev nothing", async ($, on) => {
  const world = chaveiroWorld(on, READS, new Map<string, unknown>([["credentials", { apiKey: "test-key", provider: "typesafe" }]]));
  await $.session.start(SESSION);
  for (const i of [1, 2, 3]) await approve($, "git status --short", `toolu-${i}`);
  await $.turn.complete(done("t1"));
  await settle(() => false);
  expect(world.asked()).toBe(0);
});

test("the third approval brings a rule at the turn's end; Enviar writes it to the settings, never before", async ($, on) => {
  const world = chaveiroWorld(on, READS);
  await $.session.start(SESSION);
  await approve($, "git status --short", "toolu-1");
  await approve($, "git status", "toolu-2");
  await $.turn.complete(done("t1"));
  await settle(() => false);
  // two approvals are not enough
  expect(world.asked()).toBe(0);
  await approve($, "git status -sb", "toolu-3");
  await $.turn.complete(done("t2"));
  await settle(() => world.asked() > 0);
  await settle(() => false);
  expect(world.writes.filter((one) => one.path.includes("settings"))).toHaveLength(0);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: "Bash(git status:*)" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^Goes to \.claude\/settings\.local\.json/ })).toBeDefined();
  await ui.press({ key: "chaveiro-Bash:git status-send" });
  await settle(() => world.writes.some((one) => one.path.endsWith(".claude/settings.local.json")));
  const written = world.writes.find((one) => one.path.endsWith(".claude/settings.local.json"))!;
  expect(JSON.parse(written.text)).toEqual({ permissions: { allow: ["Bash(git status:*)"] } });
  expect(await ui.find({ type: "Text", text: /written to the settings/ })).toBeDefined();
  // the same kind is never weighed again
  await approve($, "git status", "toolu-4");
  await $.turn.complete(done("t3"));
  await settle(() => false);
  expect(world.asked()).toBe(1);
  await ui.unmount();
});

test("a call the person refused does not count, and Jev judging it not read-only proposes nothing", async ($, on) => {
  // the person says no at the prompt for `rm`: the call is refused
  const world = chaveiroWorld(on, { ...READS, reads: pick("changes", 0.95) }, store(), async (_$: unknown, e: { command?: string }) => (String(e.command).startsWith("rm") ? { deny: "the person said no" } : { result: "ok" }));
  await $.session.start(SESSION);
  for (const i of [1, 2, 3]) {
    await $.tool.check({ tool: "Bash", input: { command: "rm build.log" }, tool_use_id: `toolu-r${i}` } as never);
    await $.tool.call({ tool: "Bash", command: "rm build.log", tool_use_id: `toolu-r${i}` } as never);
  }
  for (const i of [1, 2, 3]) await approve($, "npm run build", `toolu-b${i}`);
  await $.turn.complete(done("t1"));
  await settle(() => world.asked() > 0);
  await settle(() => false);
  // only the approved kind was weighed, and Jev let it go
  expect(world.jev.asked.filter((request) => request.questions?.reads).map((request) => request.state?.tool)).toEqual(["Bash"]);
  expect(String(world.jev.asked.find((request) => request.questions?.reads)?.state?.calls)).toContain("npm run build");
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /No rule yet/ })).toBeDefined();
  await ui.unmount();
});

test("with the Comandante on, a rule it rejects is blocked: no Enviar", async ($, on) => {
  const world = chaveiroWorld(on, { ...READS, verdict: pick("reject_risky", 0.9) }, store({ comandante: true }));
  await $.session.start(SESSION);
  for (const i of [1, 2, 3]) await approve($, "git status --short", `toolu-${i}`);
  await $.turn.complete(done("t1"));
  await settle(() => world.jev.asked.some((request) => request.questions?.verdict));
  await settle(() => false);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /^blocked by the Comandante$/ })).toBeDefined();
  expect(await ui.find({ key: "chaveiro-Bash:git status-send" } as never)).toBeUndefined();
  await ui.unmount();
});
