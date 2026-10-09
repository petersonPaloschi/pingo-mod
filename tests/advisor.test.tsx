import { describe, expect, test } from "claude-code/testing";

import { step, world } from "./helpers.ts";

describe("advisor runtime", () => {
  test("generic turns and edited completion never trigger a Jev consultation or gate", async ($, on) => {
    const setup = world(on, { agents: true });
    on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
    on("classic.Stop", async () => ({} as never));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "edit the file", wait: false, origin: { kind: "composer" } });
    await $.turn.start({ text: "edit the file", turnId: "t1" } as never);
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    await $.tool.call({ tool: "Edit", file_path: "src/app.ts", old_string: "old", new_string: "new", tool_use_id: "toolu-edit" } as never);

    const stopped = await $.classic.Stop({ stop_hook_active: false } as never);
    expect((stopped as { block?: unknown }).block).toBeUndefined();
    expect(setup.jev.calls).toBe(0);
  });
});
