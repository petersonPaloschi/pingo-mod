import { expect, test } from "claude-code/testing";

import { formatDecimal, formatNumber, formatPercent, localeFor, text } from "../hooks/i18n.ts";
import { resolveSettings } from "../hooks/config.ts";
import { buildQuestions } from "../hooks/core/questions.ts";
import { status, tiles } from "../hooks/events.ts";
import { flowLines } from "../hooks/flow.ts";
import { en } from "../hooks/strings/en.ts";
import { pt } from "../hooks/strings/pt.ts";

test("English and Portuguese catalogs have the same keys", () => {
  expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
});

test("locale selection accepts explicit plugin choices and language tags", () => {
  expect(localeFor("pt-BR")).toBe("pt");
  expect(localeFor("Português")).toBe("pt");
  expect(localeFor("en-US")).toBe("en");
  expect(resolveSettings({ locale: "pt" }, {}).locale).toBe("pt");
  expect(resolveSettings({ locale: "en" }, {}).locale).toBe("en");
});

test("messages and formatters use the selected locale", () => {
  expect(text("ui.header.confidence", "pt", { value: "0,75" })).toBe("confiança 0,75");
  expect(formatNumber(1234.5, "pt", 1)).toBe("1.234,5");
  expect(formatDecimal(0.75, "pt")).toBe("0,75");
  expect(formatPercent(1, 4, "pt")).toBe("25%");
});

test("routing prompts and dashboard summaries are Portuguese", () => {
  const question = buildQuestions([{ kind: "function", name: "Read" }], "pt");
  expect(question.tool?.instructions).toContain("Considerando a conversa");
  expect(question.needs_tool?.instructions).toContain("responder à pessoa em texto");
  expect(status([], false, 0, "pt").title).toBe("Referência — roteamento desligado");
  expect(tiles([], "pt")[0]?.label).toBe("Solicitações");
});

test("the Flow drawing uses Portuguese labels", () => {
  const lines = flowLines({
    flow: { turn: 0, wave: [], waveTurn: 0, confirmed: false, edits: 0, files: [], working: false },
    agents: [],
    model: "claude-opus-5-5",
    now: Date.parse("2026-10-07T12:00:00Z"),
    width: 72,
    locale: "pt",
  });
  const drawn = lines.map((row) => row.map((part) => part.text).join("")).join("\n");
  expect(drawn).toContain("VERIFICAÇÃO ANTES DO ENVIO");
  expect(drawn).toContain("sessão principal");
  expect(drawn).toContain("planejar");
});
