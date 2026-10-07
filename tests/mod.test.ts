// The mod end to end against the engine's own host: Jev answers through a stubbed $.http.fetch.
import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

const ROSTER = [
  { name: "Read", description: "Read a file", mcp: false },
  { name: "Bash", description: "Run a command", mcp: false },
];
const COMPOSER = { kind: "composer" } as const;
const PRESENTATION = { isFullscreen: true, columns: 160 };

const jevReply = (choice: string, confidence: number, needs: number) =>
  JSON.stringify({
    answers: {
      tool: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } },
      needs_tool: { type: "noul", noul: needs },
    },
    usage: { input_tokens: 500, output_tokens: 0 },
  });

/** The session the mod reads: two tools, no transcript yet, an empty store. */
function world(on: On, env: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
  mock.store(on);
  mock.env(on, env);
  on("tool.list", async () => ({ value: ROSTER }));
  on("session.messages", async () => ({ value: [] }));
  on("prompt.compose", async () => ({ sections: [{ id: "intro", text: "You are Claude Code.", scope: "shared" as const }] }));
  return clock;
}

/** Records what reaches the engine at the bottom of prompt.submit. */
function promptSink(on: On) {
  const seen: { context?: readonly string[] }[] = [];
  on("prompt.submit", async (_$, e) => {
    seen.push({ context: e.context });
    return { text: e.text };
  });
  return seen;
}

describe("routing", () => {
  test("a confident pick reaches Claude as a hint", { options: { api_key: "test-key" } }, async ($, on) => {
    world(on);
    const posted: { url: string; auth?: string; body: string }[] = [];
    on("http.fetch", async (_$, e) => {
      posted.push({ url: e.url, auth: e.init?.headers?.authorization, body: String(e.init?.body ?? "") });
      return { value: { status: 200, ok: true, headers: {}, text: jevReply("Read", 0.93, 0.9) } };
    });
    const seen = promptSink(on);

    await $.prompt.submit({ text: "show me package.json", wait: false, origin: COMPOSER });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ url: "https://api.typesafe.ai/v1/systemone", auth: "Bearer test-key" });
    const request = JSON.parse(posted[0]!.body);
    expect(request.state.assistant_instructions).toBe("You are Claude Code.");
    expect(request.state.conversation).toEqual([{ role: "user", text: "show me package.json" }]);
    expect(request.questions.tool.criteria.Read).toBe("Read a file");
    expect(JSON.stringify(request)).not.toContain("test-key");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.context?.[0]).toStartWith("<system-reminder>");
    expect(seen[0]?.context?.[0]).toContain('suggests the "Read" tool');
  });

  test("an unsure Jev leaves the prompt alone", { options: { api_key: "test-key" } }, async ($, on) => {
    world(on);
    let fetched = 0;
    on("http.fetch", async () => {
      fetched++;
      return { value: { status: 200, ok: true, headers: {}, text: jevReply("Read", 0.4, 0.9) } };
    });
    const seen = promptSink(on);

    await $.prompt.submit({ text: "hello", wait: false, origin: COMPOSER });

    expect(fetched).toBe(1);
    expect(seen[0]?.context).toBeUndefined();
  });

  test("Jev failing never blocks the prompt", { options: { api_key: "test-key" } }, async ($, on) => {
    const clock = world(on);
    let fetched = 0;
    on("http.fetch", async () => {
      fetched++;
      return { value: { status: 500, ok: false, headers: {}, text: "down" } };
    });
    const seen = promptSink(on);

    const done = $.prompt.submit({ text: "hello", wait: false, origin: COMPOSER });
    // One retry after a 100 ms pause, on the mocked clock.
    for (let i = 0; i < 5 && fetched < 2; i++) await clock.advance(100);
    await done;

    expect(fetched).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.context).toBeUndefined();
  });

  test("the key from the environment is used when the settings have none", async ($, on) => {
    world(on, { OPENROUTER_API_KEY: "or-key" });
    const posted: { url: string; auth?: string }[] = [];
    on("http.fetch", async (_$, e) => {
      posted.push({ url: e.url, auth: e.init?.headers?.authorization });
      return { value: { status: 200, ok: true, headers: {}, text: jevReply("Bash", 0.9, 0.9) } };
    });
    promptSink(on);

    await $.prompt.submit({ text: "run the tests", wait: false, origin: COMPOSER });

    expect(posted).toEqual([{ url: "https://openrouter.ai/api/alpha/decisions", auth: "Bearer or-key" }]);
  });

  test("without a key, Jev is never called", async ($, on) => {
    world(on);
    let fetched = 0;
    on("http.fetch", async () => {
      fetched++;
      return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
    });
    const seen = promptSink(on);

    await $.prompt.submit({ text: "hello", wait: false, origin: COMPOSER });

    expect(fetched).toBe(0);
    expect(seen).toHaveLength(1);
  });

  test("routing off: baseline, Jev never asked", { options: { api_key: "test-key" } }, async ($, on) => {
    world(on);
    let fetched = 0;
    on("http.fetch", async () => {
      fetched++;
      return { value: { status: 200, ok: true, headers: {}, text: jevReply("Read", 0.99, 0.99) } };
    });
    promptSink(on);

    await $.command.run({ command: "jev", args: "routing off", origin: COMPOSER, presentation: PRESENTATION });
    await $.prompt.submit({ text: "show me package.json", wait: false, origin: COMPOSER });

    expect(fetched).toBe(0);
  });

  test("the dashboard button turns Jev off before the next prompt", { options: { api_key: "test-key" } }, async ($, on) => {
    world(on);
    let fetched = 0;
    on("http.fetch", async () => {
      fetched++;
      return { value: { status: 200, ok: true, headers: {}, text: jevReply("Read", 0.99, 0.99) } };
    });
    promptSink(on);

    const ui = await $.ui.mount({
      plugin: "jev",
      surface: "terminal",
      component: "Pane",
      requestId: "jev",
      props: { title: "Jev", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 40, contentRows: 40 } },
    });
    await ui.press({ key: "routing" });
    await $.prompt.submit({ text: "show me package.json", wait: false, origin: COMPOSER });

    expect(fetched).toBe(0);
    await ui.unmount();
  });

  test("routing off is restored after /clear before the next prompt", { options: { api_key: "test-key" } }, async ($, on) => {
    mock.clock(on, { now: Date.parse("2026-10-06T12:00:00Z") });
    mock.store(on, { routing: false });
    mock.env(on, {});
    on("tool.list", async () => ({ value: ROSTER }));
    on("session.messages", async () => ({ value: [] }));
    on("prompt.compose", async () => ({ sections: [{ id: "intro", text: "You are Claude Code.", scope: "shared" as const }] }));
    on("classic.SessionStart", () => ({}));
    let fetched = 0;
    on("http.fetch", async () => {
      fetched++;
      return { value: { status: 200, ok: true, headers: {}, text: jevReply("Read", 0.99, 0.99) } };
    });
    promptSink(on);

    await $.classic.SessionStart({ source: "clear" });
    await $.prompt.submit({ text: "show me package.json", wait: false, origin: COMPOSER });

    expect(fetched).toBe(0);
  });
});

describe("commands", () => {
  test("/jev status reports routing and the credential source without showing the key", { options: { api_key: "test-key" } }, async ($, on) => {
    world(on);
    const off = await $.command.run({ command: "jev", args: "routing off", origin: COMPOSER, presentation: PRESENTATION });
    expect(off.text).toBe("Jev routing is off: baseline mode, tokens still metered.");
    const status = await $.command.run({ command: "jev", args: "status", origin: COMPOSER, presentation: PRESENTATION });
    expect(status.text).toContain("Routing: off (baseline)");
    expect(status.text).toContain("Key source: plugin settings");
    expect(status.text).not.toContain("test-key");
  });

  test("an unknown verb prints the usage", async ($, on) => {
    world(on);
    const reply = await $.command.run({ command: "jev", args: "fly", origin: COMPOSER, presentation: PRESENTATION });
    expect(reply.text).toStartWith("Usage: /jev");
  });
});
