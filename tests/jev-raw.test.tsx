// An answer the router cannot use keeps Jev's reply as it came: the request log shows it whole,
// indented, and the live log's card names what was dropped with the reply under it.
import type { RenderPropsOf } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { noul, step, world } from "./helpers.ts";

const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 100,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 200, contentRows: 200 },
} as unknown as RenderPropsOf["Pane"];

const ASK = { origin: { kind: "user" } } as const;

describe("Jev's raw reply", () => {
  test("a failed decision shows the reply Jev sent, in the request log and the live log", async ($, on) => {
    // No answer for the tool question: the routing point cannot use the reply.
    world(on, {}, { needs_tool: noul(0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ASK.origin } as never);
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5", effort: "high", messageCount: 1 });

    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-log" });
    expect(await ui.find({ type: "Text", text: /Jev's raw reply · [\d,]+ chars:/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /"needs_tool": \{\n\s+"type": "noul"/ })).toBeDefined();

    await ui.press({ key: "tab-live" });
    expect(await ui.find({ type: "Text", text: /^→ no answer$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^raw reply: \{"answers":\{"needs_tool"/ })).toBeDefined();
    await ui.unmount();
  });
});
