// The pane and the band draw valid trees on both surfaces, and their controls act.
import type { RenderPropsOf } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 80,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
} as unknown as RenderPropsOf["Pane"];
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 } as unknown as RenderPropsOf["AbovePrompt"];

const ASK = { origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as const;
async function status($: { command: { run: (input: never) => Promise<{ text?: string }> } }) {
  return (await $.command.run({ command: "jev", args: "status", ...ASK } as never)).text ?? "";
}

const EVENT = {
  seq: 1,
  time: "2026-10-06T11:59:00.000Z",
  session: "s1",
  model: "claude-opus-5-5",
  tools: 30,
  mode: "hint",
  tool: "Read",
  confidence: 0.91,
  durationMs: 2100,
  usage: { input: 12000, output: 300, cached: 11000, cacheWrite: 0 },
  jev: { choice: "Read", confidence: 0.91, latencyMs: 420, inputTokens: 900 },
};

test("every tab draws on the terminal and the desktop app", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { events: [EVENT] });
  mock.env(on, {});
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev", props: PANE_PROPS });
    for (const [key, text] of [
      ["tab-overview", /Idle|Routing/],
      ["tab-reasons", /Why requests were not routed/],
      ["tab-baseline", /with Jev routing vs. baseline/],
      ["tab-log", /Newest first/],
      ["tab-setup", /paste its key/],
    ] as const) {
      await ui.press({ key });
      expect(await ui.find({ type: "Text", text })).toBeDefined();
    }
    await ui.unmount();
  }
});

test("the dashboard follows the configured Portuguese locale", { options: { locale: "pt" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { events: [EVENT] });
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-features" });
  expect(await ui.find({ type: "Text", text: "Sugestões de ferramentas" })).toBeDefined();
  await ui.press({ key: "tab-setup" });
  expect(await ui.find({ type: "Text", text: "Configuração do provedor" })).toBeDefined();
  await ui.press({ key: "tab-flow" });
  expect(await ui.find({ type: "Text", text: /VERIFICAÇÃO ANTES DO ENVIO/ })).toBeDefined();
  await ui.unmount();
});

test("the language can be changed from Jev Setup", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const saved: unknown[] = [];
  on("config.list", async () => ({ value: [{ key: "jev@inline.locale", label: "Language" }] }) as never);
  on("config.set", async (_$, e) => {
    saved.push(e.value);
    return { value: e.value };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  await ui.select({ key: "language", value: "pt" });
  expect(saved).toEqual(["pt"]);
  expect(await ui.find({ type: "Text", text: "Configuração do provedor" })).toBeDefined();
  await ui.unmount();
});

test("reason titles render in the Reasons tab and the request log", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { events: [{ ...EVENT, seq: 2, mode: "passthrough", reason: "low_confidence", tool: undefined }] });
  mock.env(on, {});
  on("command.register", async () => ({ value: {} }));
  on("session.id", async () => ({ value: "session-reasons" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-reasons" });
  expect(await ui.find({ type: "Text", text: "Low confidence" })).toBeDefined();
  await ui.press({ key: "tab-log" });
  expect(await ui.find({ type: "Text", text: /Low confidence/ })).toBeDefined();
  await ui.unmount();
});

test("the Dice mascot is drawn and blitted only while the live tab shows", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  on("command.register", async () => ({ value: {} }));
  on("session.id", async () => ({ value: "session-live" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  const blits: { key: string; columns: number; rows: number }[] = [];
  on("ui.blit", async (_$, e) => {
    blits.push({ key: e.key, columns: e.columns ?? -1, rows: e.rows ?? -1 });
    return { value: {} };
  });
  await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await clock.advance(100);
  expect(blits.some((blit) => blit.key === "dice")).toBe(false);
  await ui.press({ key: "tab-live" });
  expect(await ui.find({ type: "Text", text: /Dice, your dotted die/ })).toBeDefined();
  blits.length = 0;
  await clock.advance(100);
  expect(blits).toContainEqual({ key: "dice", columns: 14, rows: 6 });
  await ui.unmount();
});

test("Pingo stays in the dashboard header and animates in the terminal", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  on("command.register", async () => ({ value: {} }));
  on("session.id", async () => ({ value: "session-mascot" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  const blits: string[] = [];
  on("ui.blit", async (_$, e) => {
    blits.push(e.key);
    return { value: {} };
  });
  await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  expect(await ui.find({ type: "Raster", key: "pingo" } as never)).toBeDefined();
  await clock.advance(100);
  expect(blits).toContain("pingo");
  await ui.unmount();
});

test("the band shows the status line", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ plugin: "jev", surface, component: "AbovePrompt", props: BAND_PROPS });
    expect(await ui.find({ type: "Text", text: /Jev: / })).toBeDefined();
    await ui.unmount();
  }
});

test("the routing button switches to baseline", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-baseline" });
  await ui.press({ key: "routing" });
  await ui.press({ key: "tab-overview" });
  expect(await ui.find({ type: "Text", text: /Baseline — routing off/ })).toBeDefined();
  await ui.unmount();
});

test("saved routing and feature switches return after /clear", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { routing: false, features: { tools: false } });
  mock.env(on, {});
  on("classic.SessionStart", () => ({}));

  await $.classic.SessionStart({ source: "clear" });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });

  expect((await ui.find({ key: "routing" }))?.props.label).toBe("Turn Jev on (r)");
  await ui.press({ key: "tab-features" });
  expect(await ui.find({ type: "Text", text: /Routing is off/ })).toBeDefined();
  expect((await ui.find({ key: "feature-tools" }))?.props.label).toBe("○ Disabled (t)");
  await ui.unmount();
});

test("setup does not call a provider without a key", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  let requests = 0;
  on("http.fetch", async () => {
    requests++;
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  expect(await ui.find({ type: "Text", text: /No key yet/ })).toBeDefined();
  await ui.press({ key: "validate" });
  expect(requests).toBe(0);
  expect(await ui.find({ type: "Text", text: /No key is configured/ })).toBeDefined();
  await ui.unmount();
});

/** A /config with the plugin's sensitive api_key row; what is written there is recorded. */
function configRows(on: Parameters<Parameters<typeof test>[1]>[1], written: unknown[]) {
  on("config.list", async () => ({ value: [{ key: "jev@inline.api_key", label: "Jev API key" }] }) as never);
  on("config.set", async (_$, e) => {
    written.push(e.value);
    return { value: e.value };
  });
}

test("a pasted key is shown masked, tested, saved in secure plugin storage and used at once", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const written: unknown[] = [];
  configRows(on, written);
  const auth: (string | undefined)[] = [];
  on("http.fetch", async (_$, e) => {
    auth.push(e.init?.headers?.authorization);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  await ui.input({ key: "api-key", kind: "change", text: "dummy-test-1234" });
  // The field holds only the mask; nothing in the tree carries the key.
  const drawn = JSON.stringify(await ui.drawn());
  expect(drawn).not.toContain("dummy-test");
  expect(drawn).toContain("•••••••••••1234");
  await ui.input({ key: "api-key", kind: "submit", text: "•••••••••••1234" });
  expect(auth).toEqual(["Bearer dummy-test-1234"]);
  expect(written).toEqual(["dummy-test-1234"]);
  expect(await ui.find({ type: "Text", text: /saved in Claude Code's secure plugin storage/ })).toBeDefined();
  expect(await status($)).toContain("Key source: plugin settings");
  expect(await status($)).not.toContain("dummy-test-1234");
  await ui.unmount();
});

test("a refused key is neither saved nor used", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const written: unknown[] = [];
  configRows(on, written);
  on("http.fetch", async () => ({ value: { status: 401, ok: false, headers: {}, text: '{"error":"bad key"}' } }));
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  await ui.input({ key: "api-key", kind: "change", text: "sk-wrong-0000" });
  await ui.press({ key: "validate" });
  expect(written).toEqual([]);
  expect(await ui.find({ type: "Text", text: /refused this key/ })).toBeDefined();
  expect(await status($)).toContain("Key source: none");
  await ui.unmount();
});

test("a saved key can be replaced, and removed", { options: { api_key: "old-key-aaaa" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const written: unknown[] = [];
  configRows(on, written);
  on("http.fetch", async () => ({ value: { status: 200, ok: true, headers: {}, text: "{}" } }));
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  expect(await ui.find({ type: "Text", text: /••••aaaa/ })).toBeDefined();
  await ui.input({ key: "api-key", kind: "change", text: "new-key-bbbb" });
  await ui.press({ key: "validate" });
  expect(written).toEqual(["new-key-bbbb"]);
  expect(await ui.find({ type: "Text", text: /••••bbbb/ })).toBeDefined();
  await ui.press({ key: "forget" });
  expect(written).toEqual(["new-key-bbbb", ""]);
  expect(await ui.find({ type: "Text", text: /Saved key removed/ })).toBeDefined();
  await ui.unmount();
});

test("a configured key is never written to plugin state", { options: { api_key: "configured-test-key" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const posted: (string | undefined)[] = [];
  on("http.fetch", async (_$, e) => {
    posted.push(e.init?.headers?.authorization);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  await ui.press({ key: "validate" });
  expect(posted).toEqual(["Bearer configured-test-key"]);
  expect(await status($)).toContain("Key source: plugin settings");
  expect(await status($)).not.toContain("configured-test-key");
  await ui.unmount();
});

test("the selected provider is used to validate a configured key", { options: { api_key: "provider-test-key" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const urls: string[] = [];
  on("http.fetch", async (_$, e) => {
    urls.push(e.url);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  await ui.select({ key: "provider", value: "opencode" });
  await ui.press({ key: "validate" });

  expect(urls).toEqual(["https://opencode.ai/zen/v1/systemone"]);
  expect(await status($)).toContain("Provider: OpenCode");
  expect(await status($)).not.toContain("provider-test-key");
  await ui.unmount();
});

test("connection checks use the configured paid OpenCode model", { options: { model: "jev-1.13", api_key: "model-test-key" } }, async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, {});
  const models: string[] = [];
  on("http.fetch", async (_$, e) => {
    models.push(JSON.parse(String(e.init?.body ?? "{}")).model);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: "tab-setup" });
  await ui.select({ key: "provider", value: "opencode" });
  await ui.press({ key: "validate" });
  expect(models).toEqual(["jev-1.13"]);
  await ui.unmount();
});

test("legacy plain-text credentials are ignored", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on, { apiKey: "legacy-test-key", provider: "typesafe" });
  mock.env(on, {});
  expect(await status($)).toContain("Key source: none");
  expect(await status($)).not.toContain("legacy-test-key");
});
