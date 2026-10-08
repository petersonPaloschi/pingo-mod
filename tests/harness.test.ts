import { describe, expect, test } from "claude-code/testing";
import { repeatedFailure, type FailureState } from "../hooks/core/harness.ts";

describe("repeated failure harness", () => {
  test("normalizes an error and reports only its second consecutive occurrence", () => {
    const state: FailureState = new Map();
    expect(repeatedFailure(state, { tool: "Bash", target: "npm test", error: "  process\n  failed  " })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "npm test", error: "process failed" })).toBe(2);
    expect(repeatedFailure(state, { tool: "Bash", target: "npm test", error: "process failed" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "npm test", error: "process failed" })).toBeUndefined();
    expect(state.get(JSON.stringify(["Bash", "npm test"]))).toEqual({ signature: "process failed", count: 2 });
  });

  test("restarts at one when the error signature changes", () => {
    const state: FailureState = new Map();
    expect(repeatedFailure(state, { tool: "Bash", target: "npm test", error: "first failure" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "npm test", error: "different failure" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "npm test", error: "different failure" })).toBe(2);
  });

  test("tracks tools and targets independently", () => {
    const state: FailureState = new Map();
    expect(repeatedFailure(state, { tool: "Bash", target: "command A", error: "failed" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "command B", error: "failed" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Read", target: "command A", error: "failed" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "command A", error: "failed" })).toBe(2);
    expect(repeatedFailure(state, { tool: "Bash", target: "command B", error: "failed" })).toBe(2);
    expect(repeatedFailure(state, { tool: "Read", target: "command A", error: "failed" })).toBe(2);
  });

  test("success and empty errors clear only their own target", () => {
    const state: FailureState = new Map();
    expect(repeatedFailure(state, { tool: "Bash", target: "command A", error: "failed" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "command B", error: "failed" })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "command A" })).toBeUndefined();
    expect(state.has(JSON.stringify(["Bash", "command A"]))).toBe(false);
    expect(state.has(JSON.stringify(["Bash", "command B"]))).toBe(true);
    expect(repeatedFailure(state, { tool: "Bash", target: "command A", error: "   \n  " })).toBeUndefined();
    expect(repeatedFailure(state, { tool: "Bash", target: "command B", error: "failed" })).toBe(2);
    expect(repeatedFailure(state, { tool: "Bash", target: "command A", error: "failed" })).toBeUndefined();
  });

  test("denials neither count nor reset a failure", () => {
    const state: FailureState = new Map();
    const input = { tool: "Bash", target: "command", error: "failed" };
    expect(repeatedFailure(state, input)).toBeUndefined();
    expect(repeatedFailure(state, { ...input, error: "permission denied", denied: true })).toBeUndefined();
    expect(state.get(JSON.stringify([input.tool, input.target]))).toEqual({ signature: "failed", count: 1 });
    expect(repeatedFailure(state, input)).toBe(2);
  });

  test("keeps at most 40 target histories", () => {
    const state: FailureState = new Map();
    for (let i = 0; i < 41; i++) {
      expect(repeatedFailure(state, { tool: "Bash", target: `command ${i}`, error: "failed" })).toBeUndefined();
    }
    expect(state.size).toBe(40);
    expect(state.has(JSON.stringify(["Bash", "command 0"]))).toBe(false);
    expect(repeatedFailure(state, { tool: "Bash", target: "command 0", error: "failed" })).toBeUndefined();
    expect(state.size).toBe(40);
    expect(repeatedFailure(state, { tool: "Bash", target: "command 0", error: "failed" })).toBe(2);
  });
});
