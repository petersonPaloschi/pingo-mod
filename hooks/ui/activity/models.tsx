import type { TraceState, TraceStep } from "../../../types";
import { modelName } from "../../feed.ts";
import { trailLines } from "../../trail.ts";
import { traceConsults } from "../../trace.ts";
import { formatCompact, formatDuration, formatNumber, text, type Locale } from "../../i18n.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { type Els, type View } from "../types.ts";
import { clock, pill, card, stack } from "../shared.tsx";
export function flowView(els: Els, view: View) {
  const { Box, Text } = els;
  const lines = trailLines({ trace: view.trace, now: view.now, width: Math.max(1, view.width), locale: view.locale });
  return (
    <Box flexDirection="column">
      {lines.map((parts) => (
        <Text wrap="truncate">
          {parts.length === 0 ? " " : null}
          {parts.map((part) => (
            <Text color={part.color} bold={part.bold ?? false}>
              {part.text}
            </Text>
          ))}
        </Text>
      ))}
      <Box marginTop={UI_DESIGN.space.xs}>
        <Text color={INK.faint} wrap="wrap">{text("trail.help", view.locale)}</Text>
      </Box>
    </Box>
  );
}

// --- Models tab ---

export function stepUsage(usage: TraceStep["usage"], locale: Locale): string {
  if (!usage) return text("ui.models.usageUnavailable", locale);
  const parts = [
    usage.input === undefined ? "" : text("ui.models.inputTokens", locale, { value: formatCompact(usage.input, locale) }),
    usage.output === undefined ? "" : text("ui.models.outputTokens", locale, { value: formatCompact(usage.output, locale) }),
    usage.cacheRead === undefined ? "" : text("ui.models.cacheReadTokens", locale, { value: formatCompact(usage.cacheRead, locale) }),
    usage.cacheWrite === undefined ? "" : text("ui.models.cacheWriteTokens", locale, { value: formatCompact(usage.cacheWrite, locale) }),
  ].filter(Boolean);
  return parts.length ? `${parts.join(" - ")}${parts.length < 4 ? ` - ${text("ui.models.usagePartial", locale)}` : ""}` : text("ui.models.usageUnavailable", locale);
}

function jevUsageGroups(trace: TraceState) {
  type Counter = "input" | "output" | "cacheRead" | "cacheWrite";
  type Group = { model: string; observed: boolean; calls: number; sums: Partial<Record<Counter, number>>; reported: Partial<Record<Counter, number>> };
  const counters: readonly Counter[] = ["input", "output", "cacheRead", "cacheWrite"];
  const groups = new Map<string, Group>();
  for (const consult of traceConsults(trace)) {
    const observed = consult.observed !== undefined;
    const model = consult.observed ?? consult.model;
    const key = `${observed ? "observed" : "requested"}:${model}`;
    const group: Group = groups.get(key) ?? { model, observed, calls: 0, sums: {}, reported: {} };
    group.calls++;
    for (const counter of counters) {
      const value = consult.usage?.[counter];
      if (value !== undefined) {
        group.sums[counter] = (group.sums[counter] ?? 0) + value;
        group.reported[counter] = (group.reported[counter] ?? 0) + 1;
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

function jevCounterText(group: ReturnType<typeof jevUsageGroups>[number], counter: "input" | "output" | "cacheRead" | "cacheWrite", locale: Locale): string {
  const labels = {
    input: "ui.models.inputTokens",
    output: "ui.models.outputTokens",
    cacheRead: "ui.models.cacheReadTokens",
    cacheWrite: "ui.models.cacheWriteTokens",
  } as const;
  const label = text(labels[counter], locale, { value: "" }).trim();
  const sum = group.sums[counter];
  if (sum === undefined) return text("ui.models.counterUnknown", locale, { name: label });
  const value = text(labels[counter], locale, { value: formatCompact(sum, locale) });
  const reported = group.reported[counter] ?? 0;
  return reported < group.calls ? `${value} ${text("ui.models.counterPartial", locale, { reported: formatNumber(reported, locale), total: formatNumber(group.calls, locale) })}` : value;
}

/**
 * The Models screen reports recorded requests and responses, without predicting later choices: the main model
 * now, Jev's usage, and the latest run's requests one row each, as cards.
 */
export function modelsView(els: Els, view: View) {
  const { Box, Text } = els;
  const run = view.trace.runs.find((candidate) => candidate.id === view.trace.active) ?? view.trace.runs.at(-1);
  const steps = run?.steps.filter((step) => !step.agentId) ?? [];
  const jevGroups = jevUsageGroups(view.trace).slice(-2);
  const shown = steps.slice(-5);
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {stack(els, [
        card(els, text("ui.models.now", view.locale), <Text wrap="truncate">{pill(els, `${GLYPH.on} ${modelName(view.live.model)}`)}{view.live.effort ? <Text color={INK.ink}>{` ${text("ui.models.effort", view.locale, { effort: view.live.effort })}`}</Text> : null}</Text>, { color: INK.claude, rule: INK.claude, width: view.width }),
        card(els, text("ui.models.jevUsage", view.locale), jevGroups.length
          ? jevGroups.map((group) => {
              const counters = (["input", "output", "cacheRead", "cacheWrite"] as const).filter((counter) => group.sums[counter] !== undefined).map((counter) => jevCounterText(group, counter, view.locale));
              return <Box flexDirection="column"><Text bold color={INK.ink} wrap="truncate">{text(group.observed ? "ui.models.jevObserved" : "ui.models.jevRequested", view.locale, { model: modelName(group.model), calls: formatNumber(group.calls, view.locale) })}</Text><Text color={INK.dim} wrap="truncate">{counters.join(" - ") || text("ui.models.jevNoUsage", view.locale)}</Text></Box>;
            })
          : <Text color={INK.faint} wrap="wrap">{text("ui.models.jevNoUsage", view.locale)}</Text>, { width: view.width }),
      ])}
      {card(els, text("ui.models.requests", view.locale), shown.length
        ? shown.map((step) => {
            const model = step.observed && step.observed !== step.sent
              ? `${modelName(step.sent)} -> ${modelName(step.observed)}`
              : modelName(step.observed ?? step.sent);
            const elapsed = step.endedAt === undefined ? text("ui.models.inProgress", view.locale) : formatDuration(step.endedAt - step.startedAt, view.locale);
            return <Text color={INK.ink} wrap="truncate">{`${clock(step.startedAt, view.locale)} - ${model}${step.effort ? ` - ${step.effort}` : ""} - ${elapsed} - ${stepUsage(step.usage, view.locale)}`}</Text>;
          })
        : <Text color={INK.faint} wrap="truncate">{text("ui.models.empty", view.locale)}</Text>, {
          width: view.width,
          note: text("ui.models.recent", view.locale, { shown: formatNumber(shown.length, view.locale), total: formatNumber(steps.length, view.locale) }),
        })}
    </Box>
  );
}