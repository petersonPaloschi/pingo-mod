// Every Jev call takes one path, whoever asks: observeAskJev reports it, and the mod's reporter puts it
// in the live log and the Flow tab. Sift's calls, made in a shell the Bash tool starts, come back
// through the session's channel and land there the same way.
import { describe, expect, test, type Engine } from "claude-code/testing";

import { channelFile, channelLine, channelReader, toJevEvent } from "../hooks/core/channel.ts";
import { jevSent, observeAskJev, type JevEvent } from "../hooks/core/jev.ts";
import type { SystemOneRequest, SystemOneResult } from "../hooks/core/types.ts";
import { uniqueSiftAgent } from "../hooks/register.tsx";
import { PANE_PROPS as basePaneProps, world } from "./helpers.ts";

const PANE_PROPS = {
  ...basePaneProps,
  bodyColumns: 100,
  scroll: { ...basePaneProps.scroll, bodyRows: 60 },
};

const REQUEST = {
  model: "jev-1",
  state: { item: "retry the request" },
  questions: { match: { type: "noul", instructions: "Does it retry?" } },
} as unknown as SystemOneRequest;
const RESULT: SystemOneResult = { answers: { match: { type: "noul", noul: 0.95 } }, usage: { input_tokens: 120, output_tokens: 0 } };

describe("observeAskJev", () => {
  test("reports each call's start and end, and a failure before it rethrows", async () => {
    const heard: JevEvent[] = [];
    let at = 1000;
    let fail = false;
    const ask = observeAskJev(async () => {
      if (fail) throw new Error("timed out");
      return RESULT;
    }, (event) => void heard.push(event), () => (at += 5), "p-");
    expect(await ask(REQUEST)).toBe(RESULT);
    fail = true;
    await expect(ask(REQUEST)).rejects.toThrow("timed out");
    expect(heard.map((event) => [event.phase, event.call])).toEqual([["start", "p-1"], ["end", "p-1"], ["start", "p-2"], ["fail", "p-2"]]);
    expect(heard[0]).toMatchObject({ at: 1005, sent: { model: "jev-1", questions: ["match"], turns: 0, role: "state" } });
  });

  test("a reporter that throws never fails the call", async () => {
    const ask = observeAskJev(async () => RESULT, () => {
      throw new Error("log down");
    }, () => 0);
    expect(await ask(REQUEST)).toBe(RESULT);
  });

  test("a routing point's record names its newest turn", () => {
    const sent = jevSent({ ...REQUEST, state: { conversation: [{ role: "user", text: "fix the login" }] } } as unknown as SystemOneRequest);
    expect(sent).toMatchObject({ turns: 1, role: "user", last: "fix the login" });
  });
});

describe("the channel", () => {
  test("lines split across pieces come back whole; a malformed one is dropped", () => {
    const read = channelReader();
    const start: JevEvent = { phase: "start", call: "s-1", at: 1, sent: jevSent(REQUEST) };
    const end: JevEvent = { phase: "end", call: "s-1", at: 2, result: RESULT };
    const wire = channelLine(start) + "{not json}\n" + JSON.stringify({ phase: "end", call: "s-2", at: 3 }) + "\n" + channelLine(end);
    const cut = Math.floor(wire.length / 2);
    expect([...read(wire.slice(0, cut)), ...read(wire.slice(cut))]).toEqual([start, end]);
    expect(toJevEvent({ phase: "fail", call: "s-3", at: 4, error: 5 })).toBeUndefined();
  });

  test("a channel's name stays a plain file name", () => {
    expect(channelFile("abc-123")).toBe("pingo-jev-abc-123.jsonl");
    for (const bad of [undefined, "", "../x", "a/b", "a\\b"]) expect(channelFile(bad)).toBeUndefined();
  });

  test("keeps a valid end result intact and drops malformed nested answers, dropped rows, or usage", () => {
    const result = {
      answers: { match: { type: "noul", noul: 0.95 } },
      usage: { input_tokens: 120, output_tokens: 0 },
      model: "jev-1",
      raw: '{"answers":{"match":{"type":"noul","noul":0.95}},"usage":{"input_tokens":120,"output_tokens":0}}',
      dropped: [{ name: "other", why: "not asked" }],
    };
    const end = (value: unknown) => toJevEvent({ phase: "end", call: "s-4", at: 4, result: value });

    expect(end(result)).toEqual({ phase: "end", call: "s-4", at: 4, result });
    for (const malformed of [
      { ...result, answers: { match: { type: "noul" } } },
      { ...result, dropped: [{ name: 4, why: "bad name" }] },
      { ...result, raw: { answers: {} } },
      { ...result, usage: { input_tokens: -1, output_tokens: 0 } },
    ]) {
      expect(() => end(malformed)).not.toThrow();
      expect(end(malformed)).toBeUndefined();
    }
  });
});

describe("sift run attribution", () => {
  test("attributes a Jev call only when one sift command is eligible", () => {
    expect(uniqueSiftAgent(["agent-a"])).toBe("agent-a");
    expect(uniqueSiftAgent([undefined])).toBeUndefined();
    expect(uniqueSiftAgent(["agent-a", "agent-b"])).toBeUndefined();
    expect(uniqueSiftAgent([undefined, "agent-a"])).toBeUndefined();
  });
});

/** The follower's stream drains in the background: wait until the pane shows what it sent. */
async function shown($: Engine, tab: string, texts: RegExp[]): Promise<void> {
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
  await ui.press({ key: tab });
  try {
    for (const text of texts) {
      let found;
      for (let i = 0; i < 200 && !found; i++) {
        found = await ui.find({ type: "Text", text });
        if (!found) await Promise.resolve();
      }
      if (!found) {
        const rendered = (await ui.findAll({ type: "Text" })).map((line) => line.text ?? "").join("\n");
        expect(rendered).toMatch(text);
      }
    }
  } finally {
    await ui.unmount();
  }
}

describe("sift's calls in the mod", () => {
  test("a sift command names the channel for its shell, and each of its Jev calls shows in Live", async ($, on) => {
    world(on, { agents: false });
    const set: [string, string | undefined][] = [];
    on("env.set", async (_$, e) => {
      set.push([e.name, e.value]);
      return { value: undefined } as never;
    });
    const spawned: string[][] = [];
    on("process.spawn", async function* (_$, e) {
      spawned.push([...e.argv]);
      const start = channelLine({ phase: "start", call: "sift-9-1", at: Date.parse("2026-10-07T12:00:00Z"), sent: jevSent(REQUEST) });
      yield { stream: "stdout" as const, text: start.slice(0, 20) };
      yield { stream: "stdout" as const, text: start.slice(20) + channelLine({ phase: "end", call: "sift-9-1", at: Date.parse("2026-10-07T12:00:00Z") + 340, result: RESULT }) };
      return { value: { code: 0, signal: null } } as never;
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    await $.tool.call({ tool: "Bash", command: "ls src", tool_use_id: "toolu-ls" } as never);
    expect(set).toEqual([]);
    expect(spawned).toEqual([]);

    await $.tool.call({ tool: "Bash", command: 'node "/plugins/pingo/scripts/sift.ts" filter "Does it retry?" src', tool_use_id: "toolu-sift" } as never);
    expect(set.length).toBe(1);
    expect(set[0]![0]).toBe("PINGO_JEV_CHANNEL");
    expect(spawned[0]![0]).toBe("node");
    expect(spawned[0]!.at(-1)).toBe(channelFile(set[0]![1]));

    await shown($, "tab-live", [/\+ sift - sift command - match/, /Usage: 120 input tokens - 0 output tokens/, /jev-1 - read 0 turns/, /^\? match - score 0-100%: "Does it retry\?"/, /^-> 95\.0%/]);
    await shown($, "tab-live", [/recorded Jev calls: 1/]);

    // A second sift command keeps the channel; its follower (this one ended) reads the file again from
    // its start, and a call already reported is not reported twice.
    await $.tool.call({ tool: "Bash", command: 'node "/plugins/pingo/scripts/sift.ts" status', tool_use_id: "toolu-sift-2" } as never);
    expect(set.length).toBe(1);
    await shown($, "tab-live", [/recorded Jev calls: 1/]);
  });

  test("the band says Jev is asking while any call is open, not only a subagent's plan, and keeps the call in view after", async ($, on) => {
    const { clock } = world(on, { agents: false });
    on("env.set", async () => ({ value: undefined }) as never);
    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const at = Date.parse("2026-10-07T12:00:00Z");
    on("process.spawn", async function* () {
      yield { stream: "stdout" as const, text: channelLine({ phase: "start", call: "sift-7-1", at, sent: jevSent(REQUEST) }) };
      await finished;
      yield { stream: "stdout" as const, text: channelLine({ phase: "end", call: "sift-7-1", at: at + 340, result: RESULT }) };
      return { value: { code: 0, signal: null } } as never;
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const band = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "AbovePrompt", props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as never });
    const seen = async (text: RegExp) => {
      let found;
      for (let i = 0; i < 200 && !found; i++) {
        found = await band.find({ type: "Text", text });
        if (!found) await Promise.resolve();
      }
      expect(found).toBeDefined();
    };
    const jevStatus = async () => (await band.find({ type: "Text", text: /^Jev: / }))?.text ?? "";
    try {
      await seen(/No Jev call yet/);
      const call = $.tool.call({ tool: "Bash", command: 'node "/plugins/pingo/scripts/sift.ts" filter "Does it retry?" src', tool_use_id: "toolu-sift" } as never);
      await seen(/Jev: Asking Jev.../);
      await seen(/Last Jev call \S+ ago: \* sift - sift command/);
      finish();
      await seen(/Last Jev call \S+ ago: \+ sift - sift command - match/);
      expect(await jevStatus()).not.toContain("Asking Jev...");
      await call;
    } finally {
      finish();
      await band.unmount();
    }
  });

  test("concurrent sift commands share one channel export and follower", async ($, on) => {
    world(on, { agents: false });
    const set: [string, string | undefined][] = [];
    let releaseSet: () => void = () => {};
    let markSet: () => void = () => {};
    const setGate = new Promise<void>((resolve) => (releaseSet = resolve));
    const setEntered = new Promise<void>((resolve) => (markSet = resolve));
    on("env.set", async (_$, e) => {
      set.push([e.name, e.value]);
      markSet();
      await setGate;
      return { value: undefined } as never;
    });

    const spawned: string[][] = [];
    let releaseFollower: () => void = () => {};
    let markFollower: () => void = () => {};
    let markFollowerFinished: () => void = () => {};
    const followerGate = new Promise<void>((resolve) => (releaseFollower = resolve));
    const followerStarted = new Promise<void>((resolve) => (markFollower = resolve));
    const followerFinished = new Promise<void>((resolve) => (markFollowerFinished = resolve));
    on("process.spawn", async function* (_$, e) {
      spawned.push([...e.argv]);
      markFollower();
      await followerGate;
      markFollowerFinished();
      return { value: { code: 0, signal: null } } as never;
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    const command = (id: string) => $.tool.call({
      tool: "Bash",
      command: 'node "/plugins/pingo/scripts/sift.ts" status',
      tool_use_id: id,
    } as never);
    const first = command("toolu-sift-a");
    await setEntered;
    const second = command("toolu-sift-b");
    // Let the second tool reach followSift while the first env export is still unresolved.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(set).toHaveLength(1);

    releaseSet();
    await Promise.all([first, second]);
    await followerStarted;
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.at(-1)).toBe(channelFile(set[0]![1]));
    releaseFollower();
    await followerFinished;
  });
});
