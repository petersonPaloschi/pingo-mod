// The Vigia pane draws its own view: a draw only reads state, so the engine never skips its hook.
import { expect, test } from "claude-code/testing";
import { DESKTOP, TERMINAL, deckWorld } from "./deck/helpers.ts";
import { PANE_PROPS } from "./helpers.ts";

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

test("the Vigia pane draws its own view on both surfaces", { options: { locale: "en" } }, async ($, on) => {
  deckWorld(on);
  await $.session.start(SESSION);
  for (const surface of [TERMINAL, DESKTOP]) {
    const ui = await $.ui.mount({ plugin: "jev", component: "Pane", requestId: "vigia", surface, props: { ...PANE_PROPS, title: "Vigia" } });
    // a write while drawing is denied and the hook skipped: the engine's own "engine" text would stand here instead
    expect(await ui.find({ type: "Text", text: /No project sessions tracked yet/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^engine$/ })).toBeUndefined();
    await ui.unmount();
  }
});
