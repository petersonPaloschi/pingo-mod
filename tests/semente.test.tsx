// Semente's pane with an empty shelf says how to add an idea, the placeholder shown as typed: "<idea>", not "&lt;idea&gt;".
import { expect, test } from "claude-code/testing";
import { ASK, DESKTOP, TERMINAL, deckWorld } from "./deck/helpers.ts";
import { PANE_PROPS } from "./helpers.ts";

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

for (const [locale, hint] of [["en", /Use \/semente <idea> to add one\./], ["pt", /Use \/semente <ideia> para adicionar\./]] as const) {
  test(`an empty Semente shelf shows how to add an idea (${locale})`, { options: { locale } }, async ($, on) => {
    deckWorld(on);
    await $.session.start(SESSION);
    await $.command.run({ command: "jev", ...ASK, args: "feature semente on" });
    for (const surface of [TERMINAL, DESKTOP]) {
      const ui = await $.ui.mount({ plugin: "jev", component: "Pane", requestId: "semente", surface, props: { ...PANE_PROPS, title: "Semente" } });
      expect(await ui.find({ type: "Text", text: hint })).toBeDefined();
      expect(JSON.stringify(await ui.drawn())).not.toContain("&lt;");
      await ui.unmount();
    }
  });
}
