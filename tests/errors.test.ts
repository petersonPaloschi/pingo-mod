// A failed Jev call names its cause, and the cause names the next step.
import { expect, test } from "claude-code/testing";

import { failureCause, failureKind, unusableAnswer } from "../hooks/errors.ts";

test("a failure is sorted by what the provider layer wrote", () => {
  expect(failureKind("401 from TypeSafe: bad key")).toBe("auth");
  expect(failureKind("402 from OpenCode: pay")).toBe("paid");
  expect(failureKind("404 from OpenRouter: no model")).toBe("model");
  expect(failureKind("410 de OpenCode: modelo removido")).toBe("model");
  expect(failureKind("401 de TypeSafe: chave inválida")).toBe("auth");
  expect(failureKind("402 de OpenCode: pagamento necessário")).toBe("paid");
  expect(failureKind("429 de Vercel: limite de requisições")).toBe("rate");
  expect(failureKind("429 from Vercel: slow down")).toBe("rate");
  expect(failureKind("503 from TypeSafe: down")).toBe("server");
  expect(failureKind("tempo limite após 4000 ms")).toBe("timeout");
  expect(failureKind("Network error: fetch failed")).toBe("network");
  expect(failureKind("Provider returned invalid JSON.")).toBe("reply");
  expect(failureKind("something odd")).toBe("unknown");
  expect(failureKind("", "jev_unexpected_answer")).toBe("answer");
});

test("the cause is the message after the reason, and nothing for a reason that is no failure", () => {
  expect(failureCause("jev_error: 401 from TypeSafe: bad key")).toBe("401 from TypeSafe: bad key");
  expect(failureCause("jev_unexpected_answer", "missing \"tool\"; got needs_tool")).toBe("missing \"tool\"; got needs_tool");
  expect(failureCause("low_confidence")).toBeUndefined();
  expect(failureCause("jev_error: " + "x".repeat(1000))!.length).toBe(240);
});

test("an answer the router cannot use says what it lacked and what was dropped", () => {
  expect(unusableAnswer(["tool", "needs_tool"], ["needs_tool"], [{ name: "tool", why: 'unoffered choice "Foo"' }])).toBe(
    'missing "tool"; got needs_tool; dropped tool (unoffered choice "Foo")',
  );
});
