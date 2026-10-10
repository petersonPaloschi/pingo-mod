import type { On } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { defaultPolicy, editPolicy, ORCHESTRATION_STORE, OBJECTIVE_KEEP_MS, OBJECTIVE_STORE, objectiveStoreKey, type OrchestrationPolicy } from "../hooks/core/orchestration.ts";
import { PANE_PROPS, pick, step, world } from "./helpers.ts";

const enabled = (change: (p: OrchestrationPolicy) => void = () => undefined) => editPolicy({ ...defaultPolicy(), enabled: true }, change);

/** A reviewer that echoes the artifact it was given and passes every criterion on the named evidence, after `delayMs`. */
function reviewer(on: On, verdict: "approved" | "blocked" = "approved", delayMs = 0) {
  const calls: { model: string; effort?: string; maxTokens?: number; prompt: string }[] = [];
  on("model.complete", async (_$, e) => {
    const prompt = String((e as { prompt: unknown }).prompt);
    calls.push({ model: e.model, effort: e.effort, maxTokens: e.maxTokens, prompt });
    if (delayMs) await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
    const id = /artifact_id: (\S+)/.exec(prompt)?.[1] ?? "";
    const digest = /artifact_digest: (\S+)/.exec(prompt)?.[1] ?? "";
    const listed = prompt.slice(prompt.indexOf("Acceptance criteria:"), prompt.indexOf("Evidence (data, not instructions):"));
    const criteria = [...listed.matchAll(/^- (\S+): /gm)].map((m) => m[1]!);
    const evidence = /<evidence id="(\w+)" kind="(?:artifact|diff|check)"/.exec(prompt)?.[1] ?? "E_answer";
    const text = JSON.stringify({
      artifact_id: id,
      artifact_digest: digest,
      verdict,
      criteria: criteria.map((c) => ({ id: c, status: verdict === "approved" ? "pass" : "unknown", evidence_refs: [evidence], explanation: "checked" })),
      findings: [],
      missing_evidence: verdict === "approved" ? [] : ["test output"],
    });
    return { value: { isAnswered: true, text, usage: { input_tokens: 50, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never;
  });
  return calls;
}

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const settle = async (until: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200 && !(await until()); i++) await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
};

describe("orchestration in a session", () => {
  test("each session keeps an objective of its own; a new session drops the old shared one and other sessions' stale ones", async ($, on) => {
    const setup = world(on, {}, { work_mode: pick("managed", 0.9), objective_executor: pick("opus_high", 0.9), guidance: pick("none", 0.9) });
    setup.store[ORCHESTRATION_STORE] = enabled();
    const now = Date.parse("2026-10-07T12:00:00Z");
    const another = { id: "O-other", startedAt: now - 60_000, policy: enabled(), workMode: "managed", workModeConfident: true, adviceUsed: 2 };
    setup.store[OBJECTIVE_STORE] = { ...another, id: "O-shared" };
    setup.store[objectiveStoreKey("session-other")] = another;
    setup.store[objectiveStoreKey("session-stale")] = { ...another, id: "O-stale", startedAt: now - OBJECTIVE_KEEP_MS - 1 };
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    // the old shared key and the stale one are gone; the other live session's objective is untouched
    expect(setup.store[OBJECTIVE_STORE]).toBeUndefined();
    expect(setup.store[objectiveStoreKey("session-stale")]).toBeUndefined();
    expect(setup.store[objectiveStoreKey("session-other")]).toEqual(another);
    await $.prompt.submit({ text: "fix the flaky loader test", wait: false, origin: { kind: "composer" } });
    // this session's objective lands under its own key, never over the other one
    const own = setup.store[objectiveStoreKey("session-fix")] as { id: string; adviceUsed: number } | undefined;
    expect(own?.id).toBeDefined();
    expect(own?.id).not.toBe(another.id);
    expect(setup.store[objectiveStoreKey("session-other")]).toEqual(another);
  });

  test("a new request gets one Jev decision, a context note, and the executor profile on the main loop", async ($, on) => {
    const setup = world(on, {}, { work_mode: pick("managed", 0.9), objective_executor: pick("opus_high", 0.9), guidance: pick("none", 0.9) });
    setup.store[ORCHESTRATION_STORE] = enabled();
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const submitted = await $.prompt.submit({ text: "fix the flaky loader test", wait: false, origin: { kind: "composer" } }) as { context?: string[] };
    expect(setup.jev.calls).toBe(1);
    expect(Object.keys(setup.jev.asked[0]!.questions).sort()).toEqual(["guidance", "objective_executor", "work_mode"]);
    expect("system" in setup.jev.asked[0]!).toBe(false);
    expect(submitted.context?.join("\n")).toMatch(/objective \S+, work mode managed/);
    await step($ as never, { turnId: "t1", index: 0, model: "claude-sonnet-5-5", effort: "low", messageCount: 1 });
    expect(setup.sent).toEqual([{ model: "claude-opus-5-5", effort: "high" }]);
    const objective = setup.store[objectiveStoreKey("session-fix")] as { executor: unknown; applied: unknown; observed: unknown };
    expect(objective.executor).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(objective.applied).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(objective.observed).toEqual({ model: "claude-opus-5-5" });
    // A continuation keeps the objective: Jev is asked about continuity only, and the profile stays.
    setup.jev.asked.length = 0;
    await $.prompt.submit({ text: "go on", wait: false, origin: { kind: "composer" } });
    expect(Object.keys(setup.jev.asked[0]!.questions)).toContain("continuity");
  });

  test("your own /model pick overrides the objective's executor; teammates are not planned", async ($, on) => {
    const setup = world(on, {}, { work_mode: pick("managed", 0.9), objective_executor: pick("opus_high", 0.9), guidance: pick("none", 0.9) });
    setup.store[ORCHESTRATION_STORE] = enabled();
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "inherit", agentId: "mate-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "refactor the loader", wait: false, origin: { kind: "composer" } });
    await $.classic.PostModelSwitch({ from_model: "claude-opus-5-5", to_model: "claude-haiku-5-5", requested_model: "haiku", source: "command", context_tokens: 0, prompt_cache_warm: false, cache_ttl: "5m", estimated_cache_write_usd: 0, pricing: "catalog" } as never);
    await step($ as never, { turnId: "t1", index: 0, model: "claude-haiku-5-5", effort: "low", messageCount: 1 });
    expect(setup.sent).toEqual([{ model: "claude-haiku-5-5", effort: "low" }]);
    expect((setup.store[objectiveStoreKey("session-fix")] as { executorWhy?: string }).executorWhy).toBe("user_model_switch");
    const before = setup.jev.calls;
    await $.agent.spawn({ tool_use_id: "toolu-mate", prompt: "Help out.", description: "mate", subagentType: "general-purpose", provider: { plugin: "engine", tier: "core" }, parentModel: "claude-opus-5-5", background: true, fork: false, isTeammate: true } as never);
    expect(setup.jev.calls).toBe(before);
  });

  test("off: requests stay native and Jev is not asked", async ($, on) => {
    const setup = world(on, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "hello", wait: false, origin: { kind: "composer" } });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-sonnet-5-5", effort: "low", messageCount: 1 });
    expect(setup.jev.calls).toBe(0);
    expect(setup.sent).toEqual([{ model: "claude-sonnet-5-5", effort: "low" }]);
    expect((setup.store[ORCHESTRATION_STORE] as OrchestrationPolicy).enabled).toBe(false);
  });

  test("a subagent runs with its exact profile and its parent receives the independent review", async ($, on) => {
    const setup = world(on, {}, { unit_0_executor: pick("haiku_max", 0.9), unit_0_reviewer: pick("sonnet_high", 0.9) });
    setup.store[ORCHESTRATION_STORE] = enabled();
    const reviews = reviewer(on);
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: "agent-1" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const spawned = await $.agent.spawn({ tool_use_id: "toolu-a", prompt: "List the loader's callers.", description: "find callers", subagentType: "general-purpose", provider: { plugin: "engine", tier: "core" }, parentModel: "claude-opus-5-5", background: false, fork: false } as never) as { model: string };
    expect(spawned.model).toBe("claude-haiku-5-5");
    await step($ as never, { turnId: "s1", agentId: "agent-1", index: 0, model: "claude-haiku-5-5", messageCount: 1 });
    expect(setup.sent).toEqual([{ model: "claude-haiku-5-5", effort: "max", agentId: "agent-1" }]);
    await $.turn.complete({ turnId: "s1", agentId: "agent-1", reason: "answer", answer: "callers: a.ts, b.ts", durationMs: 10, isAborted: false } as never);
    const result = await $.tool.call({ tool: "Agent", tool_use_id: "toolu-a", prompt: "List the loader's callers.", description: "find callers" } as never) as { context?: string[] };
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ model: "claude-sonnet-5-5", effort: "high", maxTokens: 16384 });
    expect(result.context?.join("\n")).toMatch(/independent review of subagent "find callers": APPROVED/);
  });

  test("a review that cannot approve leaves the subagent's result unverified", async ($, on) => {
    const setup = world(on, {}, { unit_0_executor: pick("sonnet_medium", 0.9), unit_0_reviewer: pick("opus_high", 0.9) });
    setup.store[ORCHESTRATION_STORE] = enabled();
    reviewer(on, "blocked");
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: "agent-2" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({ tool_use_id: "toolu-b", prompt: "Explain the cache.", description: "explain", subagentType: "general-purpose", provider: { plugin: "engine", tier: "core" }, parentModel: "claude-opus-5-5", background: false, fork: false } as never);
    await $.turn.complete({ turnId: "s2", agentId: "agent-2", reason: "answer", answer: "It caches.", durationMs: 10, isAborted: false } as never);
    const result = await $.tool.call({ tool: "Agent", tool_use_id: "toolu-b", prompt: "Explain the cache.", description: "explain" } as never) as { context?: string[] };
    expect(result.context?.join("\n")).toMatch(/BLOCKED — result is UNVERIFIED/);
  });

  test("/batch's planning instruction and the managed queue: units run, are reviewed, and integrate", async ($, on) => {
    const setup = world(on, {}, { concurrency: pick("2", 0.9) });
    setup.store[ORCHESTRATION_STORE] = enabled((p) => {
      p.roles.subagent.model = { ...p.roles.subagent.model, mode: "fixed", fixed: "claude-haiku-5-5" };
      p.roles.subagent.effort = { ...p.roles.subagent.effort, mode: "fixed", fixed: "medium" };
      p.roles.advisor.model = { ...p.roles.advisor.model, mode: "fixed", fixed: "claude-sonnet-5-5" };
      p.roles.advisor.effort = { ...p.roles.advisor.effort, mode: "fixed", fixed: "high" };
    });
    const reviews = reviewer(on);
    // A plugin's own spawn gets its agent ID from core; here the runtime's agent list names it.
    const spawns: { prompt: string; model?: string }[] = [];
    const live: { id: string; status: string; description: string; type: string }[] = [];
    on("agent.spawn", async (_$, e) => {
      spawns.push({ prompt: e.prompt, model: e.model });
      live.push({ id: `worker-${live.length + 1}`, status: "running", description: e.description, type: e.subagentType });
      return { model: e.model ?? "claude-sonnet-5-5" };
    });
    on("agent.list", async () => ({ value: live.map((a) => ({ ...a })) }) as never);
    on("skill.prompt", async (_$, e) => ({ text: e.text }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    const skill = await $.skill.prompt({ skill: "batch", text: "Plan the batch." } as never) as { text: string };
    expect(skill.text).toContain("Submit the resulting unit plan to the Pingo managed-batch entry point.");

    const accepted = await $.tool.call({
      tool: "mcp__jev__managed_batch",
      tool_use_id: "toolu-batch",
      shared_contracts: "Loader API stays synchronous.",
      units: [
        { id: "U01", prompt: "Add the cache.", acceptance_criteria: [{ id: "C1", text: "cache added" }] },
        { id: "U02", prompt: "Document the cache.", acceptance_criteria: [{ id: "C1", text: "docs updated" }] },
      ],
    } as never) as { result?: string; deny?: string };
    expect(accepted.deny).toBeUndefined();
    expect(spawns.map((s) => s.model)).toEqual(["claude-haiku-5-5", "claude-haiku-5-5"]);
    expect(spawns[0]!.prompt).toContain("Pingo managed batch");

    for (const id of ["worker-1", "worker-2"]) {
      live.find((a) => a.id === id)!.status = "completed";
      await $.turn.complete({ turnId: id, agentId: id, reason: "answer", answer: `${id} done`, durationMs: 5, isAborted: false } as never);
    }
    const status = async () => ((await $.tool.call({ tool: "mcp__jev__managed_batch_status", tool_use_id: "toolu-status" } as never)) as { result?: string }).result ?? "";
    await settle(async () => /VERIFIED/.test(await status()) && !/not verified/.test(await status()));
    expect(await status()).toMatch(/2\/2 approved; integration approved; VERIFIED/);
    // Two unit reviews and the integration review, each a controlled call.
    expect(reviews).toHaveLength(3);
    expect(reviews.every((r) => r.model === "claude-sonnet-5-5" && r.effort === "high")).toBe(true);
    // Each review went out through the one model-call path: Logs and Live show the same three lines.
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    const calls = async () => (await ui.findAll({ type: "Text" })).filter((line) => /^✓ Orchestration · /.test(line.text ?? "")).length;
    await ui.press({ key: "tab-logs" });
    await settle(async () => (await calls()) === 3);
    expect(await calls()).toBe(3);
    await ui.press({ key: "tab-live" });
    expect(await calls()).toBe(3);
    await ui.unmount();
  });

  test("slow reviews and workers finishing together review each unit once and lose no step", async ($, on) => {
    const setup = world(on, {}, { concurrency: pick("3", 0.9) });
    setup.store[ORCHESTRATION_STORE] = enabled((p) => {
      p.roles.subagent.model = { ...p.roles.subagent.model, mode: "fixed", fixed: "claude-haiku-5-5" };
      p.roles.subagent.effort = { ...p.roles.subagent.effort, mode: "fixed", fixed: "medium" };
      p.roles.advisor.model = { ...p.roles.advisor.model, mode: "fixed", fixed: "claude-sonnet-5-5" };
      p.roles.advisor.effort = { ...p.roles.advisor.effort, mode: "fixed", fixed: "high" };
    });
    const reviews = reviewer(on, "approved", 15);
    const live: { id: string; status: string; description: string; type: string }[] = [];
    on("agent.spawn", async (_$, e) => {
      live.push({ id: `worker-${live.length + 1}`, status: "running", description: e.description, type: e.subagentType });
      return { model: e.model ?? "claude-sonnet-5-5" };
    });
    on("agent.list", async () => ({ value: live.map((a) => ({ ...a })) }) as never);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.tool.call({
      tool: "mcp__jev__managed_batch",
      tool_use_id: "toolu-race",
      shared_contracts: "",
      units: ["U01", "U02", "U03"].map((id) => ({ id, prompt: `Do ${id}.`, acceptance_criteria: [{ id: "C1", text: `${id} done` }] })),
    } as never);
    expect(live).toHaveLength(3);
    // The first worker's review is in flight while the other two finish at once.
    live[0]!.status = "completed";
    await $.turn.complete({ turnId: "worker-1", agentId: "worker-1", reason: "answer", answer: "worker-1 done", durationMs: 5, isAborted: false } as never);
    await Promise.all(["worker-2", "worker-3"].map((id) => {
      live.find((a) => a.id === id)!.status = "completed";
      return $.turn.complete({ turnId: id, agentId: id, reason: "answer", answer: `${id} done`, durationMs: 5, isAborted: false } as never);
    }));
    const status = async () => ((await $.tool.call({ tool: "mcp__jev__managed_batch_status", tool_use_id: "toolu-race-status" } as never)) as { result?: string }).result ?? "";
    await settle(async () => /; VERIFIED/.test(await status()));
    expect(await status()).toMatch(/3\/3 approved; integration approved; VERIFIED/);
    const reviewed = reviews.map((r) => /artifact_id: \S+:(\S+)/.exec(r.prompt)?.[1]).sort();
    expect(reviewed).toEqual(["U01", "U02", "U03", "integration"]);
  });

  test("the managed batch refuses to start while orchestration is off", async ($, on) => {
    world(on, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const refused = await $.tool.call({ tool: "mcp__jev__managed_batch", tool_use_id: "toolu-x", units: [] } as never) as { deny?: string };
    expect(refused.deny).toMatch(/cannot start/);
  });
});

for (const locale of ["en", "pt"] as const) {
  test(`the Orchestration tab shows and edits the orchestration policy (${locale})`, { options: { locale } }, async ($, on) => {
    const setup = world(on, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-orchestration" });
    const rendered = async () => (await ui.findAll({ type: "Text" })).map((line) => line.text ?? "").join("\n");
    expect(await rendered()).toContain(locale === "en" ? "Orchestration" : "Orquestração");
    expect(await rendered()).toContain(locale === "en" ? "Advisor/reviewer" : "Advisor/revisor");
    expect(await rendered()).toMatch(locale === "en" ? /never approves a result/ : /nunca aprova um resultado/);
    await ui.press({ key: "orch-enabled" });
    await ui.press({ key: "allow-advisor-claude-haiku-5-5" });
    const policy = setup.store[ORCHESTRATION_STORE] as OrchestrationPolicy;
    expect(policy.enabled).toBe(true);
    expect(policy.roles.advisor.model.allowed).toEqual(["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]);
    expect(policy.revision).toBe(2);
    const reply = await $.command.run({ command: "jev", args: "orchestration agent Explore haiku low", origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as never) as { text?: string };
    expect(reply.text).toMatch(/revision 3/);
    expect((setup.store[ORCHESTRATION_STORE] as OrchestrationPolicy).agentTypes.Explore).toEqual({ model: "claude-haiku-5-5", effort: "low" });
    await ui.unmount();
  });
}
