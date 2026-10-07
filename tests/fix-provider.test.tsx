// How long one Jev call may take, which key goes to which provider, where Setup's provider is
// saved, the environment fallbacks and ranges of the numeric options, and provider error bodies.
import type { RenderPropsOf } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

import { resolveSettings } from "../hooks/config.ts";
import { createAskJev, normalize, validateKey, type HttpReply, type Transport } from "../hooks/core/jev.ts";

const PANE_PROPS = {
  title: "Jev",
  isFocused: true,
  bodyColumns: 80,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
} as unknown as RenderPropsOf["Pane"];
const ASK = { origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as const;
async function status($: { command: { run: (input: never) => Promise<{ text?: string }> } }) {
  return (await $.command.run({ command: "jev", args: "status", ...ASK } as never)).text ?? "";
}

const settings = { provider: "typesafe" as const, apiKey: "k", url: "https://jev.test", timeoutMs: 4000 };
const request = { state: {}, questions: {}, model: "jev-latest" };
const GOOD = JSON.stringify({ answers: { needs_tool: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 0 } });

/** A transport whose replies come from a list (`"hang"` never settles) and whose timeout the test fires. */
function transport(replies: ({ status: number; text: string } | "hang" | "offline")[]) {
  const t = {
    posts: 0,
    budgets: [] as number[],
    expire: () => {},
    post: (): Promise<HttpReply> => {
      const reply = replies[Math.min(t.posts++, replies.length - 1)]!;
      if (reply === "hang") return new Promise(() => {});
      if (reply === "offline") return Promise.reject(new Error("connection refused"));
      return Promise.resolve({ ...reply, ok: reply.status < 300 });
    },
    sleep: async () => {},
    within: <T,>(ms: number, work: Promise<T>) => {
      t.budgets.push(ms);
      return new Promise<T>((resolve, reject) => {
        t.expire = () => reject(new Error(`timed out after ${ms} ms`));
        work.then(resolve, reject);
      });
    },
  };
  return t satisfies Transport;
}

describe("one Jev call", () => {
  test("a timeout ends the call: no second request", async () => {
    const stalled = transport(["hang"]);
    const asked = createAskJev(settings, stalled)(request);
    await Promise.resolve();
    stalled.expire();
    let message = "";
    await asked.catch((error: Error) => (message = error.message));
    expect(stalled.posts).toBe(1);
    expect(stalled.budgets).toEqual([4000]);
    expect(message).toContain("timed out after 4000 ms");
  });

  test("a fast failure is retried inside the same budget", async () => {
    const flaky = transport([{ status: 503, text: "" }, { status: 200, text: GOOD }]);
    await createAskJev(settings, flaky)(request);
    expect(flaky.posts).toBe(2);
    expect(flaky.budgets).toEqual([4000]);
    const offline = transport(["offline", { status: 200, text: GOOD }]);
    await createAskJev(settings, offline)(request);
    expect(offline.posts).toBe(2);
  });

  test("no retry is sent once the budget ran out during the pause", async () => {
    const flaky = transport([{ status: 503, text: "" }, { status: 200, text: GOOD }]);
    let wake = () => {};
    flaky.sleep = () => new Promise<void>((resolve) => (wake = resolve));
    const asked = createAskJev(settings, flaky)(request).catch((error: Error) => error.message);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flaky.expire();
    expect(await asked).toContain("timed out");
    wake();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(flaky.posts).toBe(1);
  });

  test("an unusable 200 is not retried and is reported as an invalid response", async () => {
    for (const [body, expected] of [
      ["not json", "Provider returned invalid JSON."],
      ["null", "Provider returned an invalid response shape."],
    ] as const) {
      const broken = transport([{ status: 200, text: body }, { status: 200, text: GOOD }]);
      let message = "";
      await createAskJev(settings, broken)(request).catch((error: Error) => (message = error.message));
      expect(broken.posts).toBe(1);
      expect(message).toBe(expected);
      expect(message).not.toContain("Network error");
    }
  });

  test("provider error bodies lose escape sequences and control characters", async () => {
    const body = "\u001b[31mboom\u001b[0m\u0007 \u001b]0;title\u0007bad\u009b2J\r\nend";
    let message = "";
    await createAskJev(settings, transport([{ status: 400, text: body }]))(request).catch((error: Error) => (message = error.message));
    expect(message).toContain("boom");
    expect(message).toContain("end");
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(message)).toBe(false);
    const checked = await validateKey("typesafe", "k", transport([{ status: 401, text: body }]));
    if (checked.ok) throw new Error("expected a refusal");
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(checked.message)).toBe(false);
  });
});

describe("answers out of range", () => {
  test("percentages are dropped, not clamped", () => {
    const fixed = normalize({
      answers: {
        percent: { type: "choice", choice: "Read", confidence: 85, probabilities: { Read: 85 } },
        percentProbabilities: { type: "choice", choice: "Read", probabilities: { Read: 80, Bash: 20 } },
        negative: { type: "choice", choice: "Read", confidence: -0.2 },
        bigNoul: { type: "noul", noul: 1.5 },
        negativeNoul: { type: "noul", noul: -0.1 },
        fine: { type: "choice", choice: "Read", confidence: 0.9, probabilities: { Read: 1 } },
        fineNoul: { type: "noul", noul: 1 },
      },
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    expect(Object.keys(fixed.answers).sort()).toEqual(["fine", "fineNoul"]);
  });
});

describe("which key goes where", () => {
  test("an auto-detected provider gets its own environment key, never the plugin key", () => {
    expect(resolveSettings({ api_key: "typesafe-key" }, { OPENROUTER_API_KEY: "or-env" })).toMatchObject({
      provider: "openrouter",
      apiKey: "or-env",
      keySource: "environment",
    });
    expect(resolveSettings({ provider: "auto", api_key: "typesafe-key" }, { AI_GATEWAY_API_KEY: "vercel-env" })).toMatchObject({
      provider: "vercel",
      apiKey: "vercel-env",
    });
  });

  test("the plugin key goes to the provider chosen for it, or the default under auto", () => {
    expect(resolveSettings({ api_key: "mine" }, {})).toMatchObject({ provider: "typesafe", apiKey: "mine", keySource: "plugin" });
    expect(resolveSettings({ provider: "openrouter", api_key: "mine" }, { OPENROUTER_API_KEY: "or-env" })).toMatchObject({
      provider: "openrouter",
      apiKey: "mine",
      keySource: "plugin",
    });
    expect(resolveSettings({ api_key: "mine" }, { JEV_PROVIDER: "vercel", OPENROUTER_API_KEY: "or-env" })).toMatchObject({
      provider: "vercel",
      apiKey: "mine",
      keySource: "plugin",
    });
  });

  test("a stored Setup provider gives way to a later option or JEV_PROVIDER", () => {
    const stored = { provider: "opencode", basis: "auto|" };
    expect(resolveSettings({}, {}, stored).provider).toBe("opencode");
    expect(resolveSettings({ provider: "vercel" }, {}, stored).provider).toBe("vercel");
    expect(resolveSettings({}, { JEV_PROVIDER: "openrouter" }, stored).provider).toBe("openrouter");
    expect(resolveSettings({ provider: "vercel" }, {}, { provider: "opencode" }).provider).toBe("vercel");
  });
});

describe("numeric options", () => {
  test("the environment fills in an unset option, and an option set wins", () => {
    const env = { JEV_MIN_CONFIDENCE: "0.55", JEV_TIMEOUT_MS: " 2500 " };
    expect(resolveSettings({}, env)).toMatchObject({ minConfidence: 0.55, timeoutMs: 2500 });
    expect(resolveSettings({ min_confidence: 0.9, timeout_ms: 6000 }, env)).toMatchObject({ minConfidence: 0.9, timeoutMs: 6000 });
    expect(resolveSettings({}, { JEV_MIN_CONFIDENCE: "high", JEV_TIMEOUT_MS: "" })).toMatchObject({ minConfidence: 0.7, timeoutMs: 4000 });
  });

  test("out-of-range values are refused or held to range", () => {
    expect(resolveSettings({ min_confidence: 70 }, {}).minConfidence).toBe(0.7);
    expect(resolveSettings({ min_confidence: -1 }, {}).minConfidence).toBe(0.7);
    expect(resolveSettings({}, { JEV_MIN_CONFIDENCE: "85" }).minConfidence).toBe(0.7);
    expect(resolveSettings({ timeout_ms: 0 }, {}).timeoutMs).toBe(500);
    expect(resolveSettings({ timeout_ms: -20 }, {}).timeoutMs).toBe(500);
    expect(resolveSettings({ timeout_ms: 1e12 }, {}).timeoutMs).toBe(30_000);
  });
});

test("the session reads JEV_MIN_CONFIDENCE and JEV_TIMEOUT_MS", async ($, on) => {
  mock.store(on);
  mock.env(on, { JEV_MIN_CONFIDENCE: "0.55", JEV_TIMEOUT_MS: "2500" });
  const shown = await status($);
  expect(shown).toContain("minimum confidence 0.55");
  expect(shown).toContain("timeout 2,500 ms");
});

/** A /config with this plugin's rows (and any others given); what is written there is recorded. */
function configRows(on: Parameters<Parameters<typeof test>[1]>[1], written: [string, unknown][], keys = ["jev@inline.provider"]) {
  on("config.list", async () => ({ value: keys.map((key) => ({ key, label: key })) }) as never);
  on("config.set", async (_$, e) => {
    written.push([e.key, e.value]);
    return { value: e.value };
  });
  on("process.run", async (_$, e) => {
    const { api_key } = JSON.parse(e.init?.stdin ?? "{}");
    written.push([`${e.argv[5]}.api_key`, api_key]);
    return { value: { exitCode: 0, stdout: JSON.stringify({ saved: ["api_key"] }), stderr: "" } };
  });
}

describe("Setup", () => {
  test("Test connection never sends the plugin key to another provider", { options: { api_key: "typesafe-only-key" } }, async ($, on) => {
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
    await ui.select({ key: "provider", value: "openrouter" });
    await ui.press({ key: "validate" });
    expect(requests).toBe(0);
    expect(await ui.find({ type: "Text", text: /belongs to TypeSafe, so it is not sent to OpenRouter/ })).toBeDefined();
    expect(await status($)).toContain("Provider: TypeSafe");
    await ui.unmount();
  });

  test("another provider's environment key is tested without re-pairing the plugin key", { options: { api_key: "typesafe-only-key" } }, async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
    mock.store(on);
    mock.env(on, { TYPESAFE_API_KEY: "typesafe-env-key", OPENCODE_API_KEY: "opencode-env-key" });
    const written: [string, unknown][] = [];
    configRows(on, written);
    const auth: (string | undefined)[] = [];
    on("http.fetch", async (_$, e) => {
      auth.push(e.init?.headers?.authorization);
      return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
    });
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-setup" });
    await ui.select({ key: "provider", value: "opencode" });
    await ui.press({ key: "validate" });
    expect(auth).toEqual(["Bearer opencode-env-key"]);
    // Selecting OpenCode would hand it the TypeSafe key, so the selection is not saved.
    expect(written).toEqual([]);
    expect(await ui.find({ type: "Text", text: /not selected: the saved api_key belongs to TypeSafe/ })).toBeDefined();
    await ui.unmount();
  });

  test("a provider chosen with a pasted key is saved as the plugin option", async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
    mock.store(on, { provider: { provider: "opencode", basis: "auto|" } });
    mock.env(on, {});
    const written: [string, unknown][] = [];
    configRows(on, written);
    const urls: string[] = [];
    on("http.fetch", async (_$, e) => {
      urls.push(e.url);
      return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
    });
    expect(await status($)).toContain("Provider: OpenCode");
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-setup" });
    await ui.select({ key: "provider", value: "openrouter" });
    await ui.input({ key: "api-key", kind: "change", text: "or-test-9999" });
    await ui.press({ key: "validate" });
    expect(urls).toEqual(["https://openrouter.ai/api/alpha/decisions"]);
    expect(written).toEqual([
      ["jev@inline.provider", "openrouter"],
      ["jev@inline.api_key", "or-test-9999"],
    ]);
    const shown = await status($);
    expect(shown).toContain("Provider: OpenRouter");
    expect(shown).not.toContain("or-test-9999");
    await ui.unmount();
  });

  test("when Claude Code refuses the pasted key, the plugin store still keeps it and its provider", async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
    mock.store(on);
    mock.env(on, {});
    const written: [string, unknown][] = [];
    on("config.list", async () => ({ value: [{ key: "jev@inline.provider", label: "Jev provider" }] }) as never);
    on("config.set", async (_$, e) => {
      written.push([e.key, e.value]);
      return { value: e.value };
    });
    on("process.run", async (_$, e) => {
      const { api_key } = JSON.parse(e.init?.stdin ?? "{}");
      written.push([`${e.argv[5]}.api_key`, api_key]);
      return { value: { exitCode: 1, stdout: "", stderr: "keychain locked" } };
    });
    const auth: (string | undefined)[] = [];
    on("http.fetch", async (_$, e) => {
      auth.push(e.init?.headers?.authorization);
      return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
    });
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-setup" });
    await ui.select({ key: "provider", value: "openrouter" });
    await ui.input({ key: "api-key", kind: "change", text: "or-test-9999" });
    await ui.press({ key: "validate" });
    // The store copy keeps key and provider together, so nothing is rolled back.
    expect(written).toEqual([
      ["jev@inline.provider", "openrouter"],
      ["jev@inline.api_key", "or-test-9999"],
    ]);
    // This session still uses the key it just checked, with its provider.
    expect(await status($)).toContain("Provider: OpenRouter");
    await ui.unmount();
  });

  test("a stored provider does not override the provider option", { options: { provider: "vercel" } }, async ($, on) => {
    // As an older version saved it: a bare string, chosen while the option was auto.
    mock.store(on, { provider: "opencode" });
    mock.env(on, {});
    expect(await status($)).toContain("Provider: Vercel AI Gateway");
  });

  test("a CLI exit with an unconfigured key still leaves the key in the plugin store", async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
    mock.store(on);
    mock.env(on, {});
    const written: [string, unknown][] = [];
    on("config.list", async () => ({ value: [{ key: "jev@inline.provider", label: "Jev provider" }] }) as never);
    on("config.set", async (_$, e) => {
      written.push([e.key, e.value]);
      return { value: e.value };
    });
    on("process.run", async () => ({ value: { exitCode: 0, stdout: JSON.stringify({ saved: ["api_key"], unconfigured: ["api_key"] }), stderr: "" } }));
    on("http.fetch", async () => ({ value: { status: 200, ok: true, headers: {}, text: "{}" } }));
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-setup" });
    await ui.select({ key: "provider", value: "openrouter" });
    await ui.input({ key: "api-key", kind: "change", text: "unpersisted-test-0000" });
    await ui.press({ key: "validate" });
    expect(written).toEqual([["jev@inline.provider", "openrouter"]]);
    expect(await status($)).toContain("Provider: OpenRouter");
    expect(JSON.stringify(await ui.drawn())).not.toContain("unpersisted-test-0000");
    await ui.unmount();
  });

  test("the key is never saved to an ambiguous plugin configuration", async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
    mock.store(on);
    mock.env(on, {});
    const written: [string, unknown][] = [];
    configRows(on, written, ["jevtools.provider", "jev@inline.provider", "jev@other.provider"]);
    on("http.fetch", async () => ({ value: { status: 200, ok: true, headers: {}, text: "{}" } }));
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-setup" });
    await ui.input({ key: "api-key", kind: "change", text: "ambiguous-0000" });
    await ui.press({ key: "validate" });
    // Two rows named for a plugin called jev: which is this one cannot be told, so neither is written.
    expect(written).toEqual([]);
    await ui.unmount();
  });
});
