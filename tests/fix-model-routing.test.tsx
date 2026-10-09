import { describe, expect, test } from "claude-code/testing";

import { step, world } from "./helpers.ts";

describe("main model and effort remain user-controlled", () => {
  test("manual and provider model ids plus their effort pass through unchanged", async ($, on) => {
    const setup = world(on, {});
    let feed: { kind: string; text: string; detail?: string }[] = [];
    on("state.set", async (_$, e, next) => {
      if (e.key === "feed") feed = e.value as typeof feed;
      return next(e);
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const switchModel = {
      from_model: "claude-sonnet-5-5",
      to_model: "claude-opus-5-5[1m]",
      context_tokens: 0,
      prompt_cache_warm: false,
      cache_ttl: "5m",
      estimated_cache_write_usd: 0,
      pricing: "catalog",
      requested_model: "opus[1m]",
      source: "command",
    } as const;
    await $.classic.PostModelSwitch(switchModel as never);
    await $.prompt.submit({ text: "inspect this file", wait: false, origin: { kind: "composer" } });
    await step($ as never, { turnId: "manual", index: 0, model: "claude-opus-5-5[1m]", effort: "high", messageCount: 1 });
    await $.classic.PostModelSwitch({
      ...switchModel,
      from_model: "claude-opus-5-5[1m]",
      to_model: "us.anthropic.claude-opus-5-5-v1:0",
      requested_model: "us.anthropic.claude-opus-5-5-v1:0",
      source: "sdk",
    } as never);
    await step($ as never, { turnId: "manual", index: 1, model: "us.anthropic.claude-opus-5-5-v1:0", effort: "max", messageCount: 2 });
    await $.classic.PostModelSwitch({
      ...switchModel,
      from_model: "us.anthropic.claude-opus-5-5-v1:0",
      to_model: "claude-sonnet-5-5",
      requested_model: null,
      source: "picker",
    } as never);

    expect(setup.sent).toEqual([
      { model: "claude-opus-5-5[1m]", effort: "high" },
      { model: "us.anthropic.claude-opus-5-5-v1:0", effort: "max" },
    ]);
    expect(feed.filter((entry) => entry.kind === "feature").map((entry) => entry.detail)).toContain("source=command\nrequested_model=opus[1m]");
    expect(feed.filter((entry) => entry.kind === "feature").map((entry) => entry.detail)).toContain("source=sdk\nrequested_model=us.anthropic.claude-opus-5-5-v1:0");
    expect(feed.filter((entry) => entry.kind === "feature").map((entry) => entry.detail)).toContain("source=picker\nrequested_model=default");
    expect(setup.jev.calls).toBe(0);
  });
});
