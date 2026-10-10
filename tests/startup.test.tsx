// session.start registers the slash commands before it reads anything: an unreadable store (a file left
// zero-filled by a crash) must never leave the session without /jev.
import { expect, test } from "claude-code/testing";

import { mockEngineServices } from "./helpers.ts";

test("an unreadable store still leaves /jev, /deck and /pingo registered", async ($, on) => {
  mockEngineServices(on);
  const registered: string[] = [];
  on("command.register", async (_$, e) => {
    registered.push(e.name);
    return { value: { command: e.name } };
  });
  on("store.get", async () => {
    throw new Error("store file is malformed (JSON Parse error)");
  });
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-broken-store" }));
  await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
  expect(registered).toEqual(expect.arrayContaining(["jev", "deck", "pingo"]));
});
