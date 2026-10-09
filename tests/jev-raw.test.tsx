import { describe, expect, mock, test } from "claude-code/testing";

import { DEFAULT_FEATURES } from "../hooks/core/plan.ts";
import { PANE_PROPS as basePaneProps, mockEngineServices } from "./helpers.ts";

const PANE_PROPS = {
  ...basePaneProps,
  bodyColumns: 100,
  scroll: { ...basePaneProps.scroll, bodyRows: 120 },
};

describe("Jev's raw reply", () => {
  test("an unusable agent answer is kept in the Live request log", async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-07T12:00:00Z") });
    mockEngineServices(on);
    mock.store(on, { provider: "typesafe", features: { ...DEFAULT_FEATURES, agents: true } });
    mock.env(on, { TYPESAFE_API_KEY: "test-key" });
    on("command.register", async () => ({ value: { command: "jev" } }));
    on("session.id", async () => ({ value: "session-raw" }));
    on("session.model", async () => ({ value: "claude-opus-5-5" }));
    on("settings.read", async () => ({ value: {} }) as never);
    on("http.fetch", async () => ({
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          answers: {
            model: { type: "choice", choice: "sonnet", probabilities: { sonnet: 1 } },
            effort: { type: "choice", choice: "high", confidence: 0.9, probabilities: { high: 1 } },
          },
          usage: { output_tokens: 0 },
        }),
      },
    }));
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: "agent-raw" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.agent.spawn({
      tool_use_id: "toolu-raw",
      prompt: "Inspect the implementation",
      description: "inspect implementation",
      subagentType: "Custom",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-opus-5-5",
      background: false,
      fork: false,
    } as never);

    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-live" });
    expect(await ui.find({ type: "Text", text: /raw reply: \{"answers":\{"model"/ })).toBeDefined();
    await ui.unmount();
  });
});
