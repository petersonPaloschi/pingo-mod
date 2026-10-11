// Oficina: a session that starts on a new Claude Code version, or with its context already very full, runs
// `claude doctor` (which only reads); when Jev finds something worth the person's time, Oficina suggests /doctor and
// Enviar puts it in the prompt box for them to send. Once per version; the first session it sees only learns the
// version. Off by default.
import { expect, test, type TestBody } from "claude-code/testing";
import { DEFAULT_FEATURES } from "../hooks/core/contracts.ts";
import { doctorFindings, oficinaDecision } from "../hooks/core/oficina.ts";
import type { Answer } from "../hooks/core/types.ts";
import { ASK, DEFAULT_USAGE, deckWorld, TERMINAL } from "./deck/helpers.ts";
import { comandanteJev, PANE_PROPS, pick } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const DOCTOR = ["Claude Code diagnostics", "✓ Install: native, auto-updates on", "✗ Settings: .claude/settings.json is not valid JSON (line 4)", "⚠ MCP server sentry failed to start", "Context at start: 12%"].join("\n");
const wait = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
async function settle(isDone: () => boolean) {
  for (let i = 0; i < 80 && !isDone(); i++) await wait();
}

const store = (version?: string, features: Record<string, boolean> = {}) => new Map<string, unknown>([
  ["features", { ...DEFAULT_FEATURES, codeQuality: false, oficina: true, ...features }],
  ["credentials", { apiKey: "test-key", provider: "typesafe" }],
  ...(version ? [["oficina:version", version] as [string, unknown]] : []),
]);

/** A world on Claude Code `version`, where `claude doctor` prints DOCTOR and the prompt box takes what is put in it. */
function oficinaWorld(on: Parameters<typeof deckWorld>[0], table: Record<string, Answer>, saved: Map<string, unknown>, version = "2.1.300", usage?: unknown) {
  const runs: string[][] = [];
  const filled: string[] = [];
  const jev = comandanteJev(on, table);
  const world = deckWorld(on, saved, usage ? { usage } : {});
  on("session.version", async () => ({ value: { version, base: version, builtAt: "2026-10-10T00:00:00Z" } }) as never);
  on("process.run", async (_$, e) => {
    runs.push([...e.argv]);
    return { value: { exitCode: 0, stdout: e.argv[1] === "doctor" ? DOCTOR : "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on("prompt.fill", async (_$, e) => {
    filled.push(e.text);
    return { isFilled: true } as never;
  });
  const doctorRuns = () => runs.filter((argv) => argv[0] === "claude" && argv[1] === "doctor").length;
  return { ...world, jev, runs, filled, doctorRuns };
}

async function autonomos($: Parameters<TestBody>[0]) {
  await $.command.run({ command: "jev", ...ASK, args: "autonomos" });
  return $.ui.mount({ plugin: "jev", component: "Pane", requestId: "jev", surface: TERMINAL, props: PANE_PROPS });
}

test("doctor's findings are the lines that name a problem; Jev's answer is read with its confidence", () => {
  expect(doctorFindings(DOCTOR)).toEqual(["✗ Settings: .claude/settings.json is not valid JSON (line 4)", "⚠ MCP server sentry failed to start"]);
  expect(doctorFindings("All good\nNo issues found\n0 errors")).toEqual([]);
  expect(oficinaDecision({ worth: pick("show", 0.9) }, 0.7)).toBe(true);
  expect(oficinaDecision({ worth: pick("skip", 0.9) }, 0.7)).toBe(false);
  expect(oficinaDecision({ worth: pick("show", 0.4) }, 0.7)).toBeUndefined();
});

test("off by default, a new version runs nothing", async ($, on) => {
  const world = oficinaWorld(on, { worth: pick("show", 0.95) }, new Map<string, unknown>([["oficina:version", "2.1.299"], ["credentials", { apiKey: "test-key", provider: "typesafe" }]]));
  await $.session.start(SESSION);
  await settle(() => false);
  expect(world.doctorRuns()).toBe(0);
});

test("the first session only learns the version; the same version again runs nothing", async ($, on) => {
  const world = oficinaWorld(on, { worth: pick("show", 0.95) }, store());
  await $.session.start(SESSION);
  await settle(() => false);
  expect(world.doctorRuns()).toBe(0);
  expect(world.saved.get("oficina:version")).toBe("2.1.300");
});

test("a new version runs claude doctor; worth it, /doctor waits for Enviar, which only fills the prompt box", async ($, on) => {
  const world = oficinaWorld(on, { worth: pick("show", 0.95) }, store("2.1.299"));
  await $.session.start(SESSION);
  await settle(() => world.jev.asked.some((request) => request.questions?.worth));
  await settle(() => false);
  expect(world.doctorRuns()).toBe(1);
  expect(String(world.jev.asked.find((request) => request.questions?.worth)?.state?.previous_version)).toBe("2.1.299");
  expect(world.filled).toHaveLength(0);
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /New Claude Code version: 2\.1\.300/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /not valid JSON/ })).toBeDefined();
  const send = (await ui.findAll({ type: "Button" })).map((one: { key?: string }) => String(one.key ?? "")).find((key) => key.startsWith("oficina-") && key.endsWith("-send"))!;
  await ui.press({ key: send });
  await settle(() => world.filled.length > 0);
  expect(world.filled).toEqual(["/doctor"]);
  await ui.unmount();
});

test("a context already very full at the start runs the checkup too; healthy, nothing is kept", async ($, on) => {
  const full = { ...DEFAULT_USAGE, context: { ...(DEFAULT_USAGE as { context: object }).context, percent: 63 } };
  const world = oficinaWorld(on, { worth: pick("skip", 0.95) }, store("2.1.300"), "2.1.300", full);
  await $.session.start(SESSION);
  await settle(() => world.jev.asked.some((request) => request.questions?.worth));
  await settle(() => false);
  expect(world.doctorRuns()).toBe(1);
  expect(world.jev.asked.find((request) => request.questions?.worth)?.state?.reason).toBe("context");
  const ui = await autonomos($);
  expect(await ui.find({ type: "Text", text: /No checkup yet/ })).toBeDefined();
  await ui.unmount();
});
