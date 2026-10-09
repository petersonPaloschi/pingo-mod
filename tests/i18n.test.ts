import { expect, test } from "claude-code/testing";

import { formatDecimal, formatNumber, formatPercent, localeFor, text, type LocaleKey } from "../hooks/i18n.ts";
import { resolveSettings } from "../hooks/config.ts";
import { DEFAULT_FEATURES, agentQuestions } from "../hooks/core/plan.ts";
import { status, tiles } from "../hooks/events.ts";
import { flowLines } from "../hooks/flow.ts";
import { emptyTrace, startTurn } from "../hooks/trace.ts";
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
  expect(text("ui.overview.scope", "pt", { count: "2", requests: "solicitações" })).toBe("2 solicitações neste período");
  expect(formatNumber(1234.5, "pt", 1)).toBe("1.234,5");
  expect(formatDecimal(0.75, "pt")).toBe("0,75");
  expect(formatPercent(1, 4, "pt")).toBe("25%");
  expect(text("missing.runtime.key" as LocaleKey, "pt")).toBe("missing.runtime.key");
});

test("agent questions and dashboard summaries use Portuguese", () => {
  const question = agentQuestions({ ...DEFAULT_FEATURES, agents: true }, "pt");
  expect(question.model?.instructions).toContain("Selecione");
  expect(question.effort?.instructions).toContain("Escolha");
  expect(status([], false, 0, "pt").title).toBe(text("status.baseline.title", "pt"));
  expect(tiles([], "pt")[0]?.label).toBe("Solicitações");
});

test("the Flow drawing uses Portuguese labels", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const trace = startTurn(emptyTrace(), "t1", "", now - 5000);
  const lines = flowLines({ trace, now, width: 72, locale: "pt" });
  const drawn = lines.map((row) => row.map((part) => part.text).join("")).join("\n");
  expect(drawn).toContain("FLOW · EXECUÇÃO 1 · EM ANDAMENTO");
  expect(drawn).toContain("principal");
  expect(drawn).toContain("continuação · sem nova mensagem");
  expect(drawn).toContain("em andamento · 5s");
});
