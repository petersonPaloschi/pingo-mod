import type { RouteEvent } from "../../../types";
import { at, categories, category, int, pct, RANGES, tally, type Category, type Tile } from "../../events.ts";
import { hex } from "../../dots.ts";
import { traceConsults } from "../../trace.ts";
import { formatAge, formatCompact, formatNumber, text, type Locale } from "../../i18n.ts";
import { displayWidth } from "../../layout.ts";
import { GLYPH, meter, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { type Els, type View, type Actions } from "../types.ts";
import { CATEGORY_DOT } from "./base.tsx";
/** Dots per category for a strip of `room`, by largest remainders; each present category gets one when the room allows. */
export function shares(counts: readonly number[], room: number): number[] {
  const total = counts.reduce((s, n) => s + n, 0);
  if (!total || room <= 0) return counts.map(() => 0);
  const exact = counts.map((n) => (room * n) / total);
  const out = exact.map(Math.floor);
  let left = room - out.reduce((s, n) => s + n, 0);
  for (const i of exact.map((_, i) => i).sort((a, b) => exact[b]! - out[b]! - (exact[a]! - out[a]!))) {
    if (left-- <= 0) break;
    out[i] = out[i]! + 1;
  }
  // A category that rounded to nothing takes one dot from the widest.
  counts.forEach((n, i) => {
    if (n <= 0 || out[i]) return;
    const widest = out.indexOf(Math.max(...out));
    if (out[widest]! > 1) {
      out[widest] = out[widest]! - 1;
      out[i] = 1;
    }
  });
  return out;
}

export const inRange = (view: View) => view.events.filter((event) => view.range <= 0 || view.now - at(event) < view.range);

export const consultsInRange = (view: View) => {
  const start = view.range > 0 ? view.now - view.range : Number.NEGATIVE_INFINITY;
  return traceConsults(view.trace).filter((consult) => consult.startedAt >= start && consult.startedAt <= view.now);
};

export { cellsOf };

/** The last five minutes: observed Jev calls, elapsed latency, usage coverage, and failures. */
export function recentStats(view: View) {
  const since = view.now - 5 * 60e3;
  const events = view.events.filter((event) => view.now - at(event) < 5 * 60e3);
  const consults = traceConsults(view.trace).filter((consult) => consult.startedAt >= since && consult.startedAt <= view.now);
  const legacy = consults.length ? [] : events.filter((event) => event.jev);
  const calls = consults.length ? consults : legacy;
  const reportedTokens = consults.length
    ? consults.flatMap((consult) => consult.usage?.input === undefined ? [] : [consult.usage.input])
    : legacy.flatMap((event) => event.jev?.inputTokens === undefined ? [] : [event.jev.inputTokens]);
  const latencies = consults.length
    ? consults.flatMap((consult) => consult.endedAt === undefined ? [] : [Math.max(0, consult.endedAt - consult.startedAt)])
    : legacy.flatMap((event) => event.jev ? [event.jev.latencyMs] : []);
  const failures = consults.length ? consults.filter((consult) => consult.error).length : events.filter((event) => category(event) === "failed").length;
  return {
    calls: calls.length,
    latency: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : undefined,
    tokens: reportedTokens.length ? reportedTokens.reduce((sum, value) => sum + value, 0) : undefined,
    reported: reportedTokens.length,
    failures,
  };
}

function statsParts(stats: ReturnType<typeof recentStats>, locale: Locale) {
  return {
    calls: text("ui.stats.calls", locale, { count: formatNumber(stats.calls, locale) }),
    latency: stats.latency === undefined ? "" : text("ui.stats.latency", locale, { value: formatNumber(stats.latency, locale) }),
    tokens: text("ui.stats.tokens", locale, { value: stats.tokens === undefined ? "–" : formatCompact(stats.tokens, locale) }),
    failures: text("ui.stats.failures", locale, { count: formatNumber(stats.failures, locale) }),
  };
}

export function statsLine(stats: ReturnType<typeof recentStats>, locale: Locale): string {
  const parts = statsParts(stats, locale);
  return [parts.calls, parts.latency, parts.tokens, parts.failures].filter(Boolean).join(" · ");
}

export function statsPartial(stats: ReturnType<typeof recentStats>, locale: Locale): string | undefined {
  return stats.reported < stats.calls
    ? text("ui.stats.tokensPartial", locale, { reported: formatNumber(stats.reported, locale), total: formatNumber(stats.calls, locale) })
    : undefined;
}

/** The last five minutes in one line, under Pingo's sentence. A failure count above zero is red and marked "!". */
export function recentLine(els: Els, view: View) {
  const { Text } = els;
  const stats = recentStats(view);
  const partial = statsPartial(stats, view.locale);
  const parts = statsParts(stats, view.locale);
  return [
    <Text wrap="wrap">
      <Text color={INK.dim}>{`${text("ui.rail.recent", view.locale)}: `}</Text>
      <Text color={INK.ink}>{`${[parts.calls, parts.latency, parts.tokens].filter(Boolean).join(" · ")} · `}</Text>
      <Text bold={stats.failures > 0} color={stats.failures > 0 ? INK.fail : INK.ink}>
        {`${stats.failures > 0 ? `${GLYPH.warn} ` : ""}${parts.failures}`}
      </Text>
    </Text>,
    partial ? <Text color={INK.faint} wrap="wrap">{partial}</Text> : null,
  ];
}

export function rangePicker(els: Els, view: View, act: Actions) {
  const { Select } = els;
  return (
    <Select
      key="range"
      label={text("ui.range", view.locale)}
      value={String(view.range)}
      options={RANGES.map(([key, ms]) => ({ value: String(ms), label: text(key, view.locale) }))}
      onSelect={(value) => act.range(Number(value))}
    />
  );
}

/**
 * A group of figures, `width` columns wide: the label, the value in bold, and its note, in aligned columns with room
 * between them. A figure that flags a failure is red and marked "!". A label too long for its column wraps there
 * rather than being cut; a note too narrow beside them goes under.
 */
export function figures(els: Els, group: readonly Tile[], width: number) {
  const { Box, Text } = els;
  const valueWidth = Math.min(Math.max(...group.map((tile) => displayWidth(tile.value) + (tile.alert ? 2 : 0))), 16);
  const longest = Math.max(...group.map((tile) => displayWidth(tile.label)));
  const labelWidth = Math.max(8, Math.min(longest + 2, width - valueWidth - 2));
  const noteWidth = width - labelWidth - valueWidth - 4;
  const under = noteWidth < 16;
  const note = (tile: Tile) => <Text color={tile.alert ? INK.fail : INK.faint} wrap="wrap">{tile.sub}</Text>;
  return (
    <Box flexDirection="column" rowGap={under ? UI_DESIGN.space.xs : UI_DESIGN.space.none}>
      {group.map((tile) => (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={UI_DESIGN.space.xs}>
            <Box width={labelWidth} flexShrink={0}>
              <Text color={INK.dim} wrap="wrap">{tile.label}</Text>
            </Box>
            <Box width={valueWidth} flexShrink={0} justifyContent="flex-end">
              <Text bold color={tile.alert ? INK.fail : INK.ink}>{`${tile.alert ? `${GLYPH.warn} ` : ""}${tile.value}`}</Text>
            </Box>
            {under ? null : <Box width={noteWidth} flexShrink={0} marginLeft={1}>{note(tile)}</Box>}
          </Box>
          {under ? <Box paddingLeft={UI_DESIGN.space.sm}>{note(tile)}</Box> : null}
        </Box>
      ))}
    </Box>
  );
}

/**
 * What happened to the requests: each outcome on its own line, its glyph and name, then a ▰▱ meter of ten cells for
 * its share of all requests, with the count and share written beside it. The glyph and the words tell the outcome;
 * the color repeats them.
 */
export function outcomeBar(els: Els, events: readonly RouteEvent[], width: number, locale: Locale) {
  const { Box, Text } = els;
  const counts = new Map(tally(events.map(category)));
  const present = categories(locale).filter(([name]) => counts.get(name));
  return (
    <Box flexDirection="column" marginBottom={1}>
      {present.map(([name, label]) => {
        const count = counts.get(name) ?? 0;
        const [glyph, color] = CATEGORY_DOT[name];
        const [filled, empty] = meter(count / Math.max(1, events.length));
        return (
          <Box flexDirection="column" width={width}>
            <Text wrap="wrap">
              <Text bold color={hex(color)}>{`${glyph} `}</Text>
              <Text color={INK.ink}>{label}</Text>
            </Text>
            <Text wrap="truncate">
              <Text color={hex(color)}>{`  ${filled}`}</Text>
              <Text color={INK.border}>{empty}</Text>
              <Text bold color={INK.ink}>{`  ${int(count, locale)} · ${pct(count, events.length, locale)}`}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

const LEVELS = "▁▂▃▄▅▆▇█";
const OUTCOMES: readonly Category[] = ["passthrough", "hint", "failed"];

/** A request's reported tokens, every counter it has; none when it reported none. */
function requestTokens(event: RouteEvent): number | undefined {
  return event.usage && Object.values(event.usage).some((value) => value !== undefined)
    ? (event.usage.input ?? 0) + (event.usage.cached ?? 0) + (event.usage.cacheWrite ?? 0) + (event.usage.output ?? 0)
    : undefined;
}

/**
 * The range as a sparkline `width` columns wide: one column per slot of time, as tall as the tokens its requests
 * reported (by square root, so a few huge requests do not flatten the rest), in the color of its worst outcome.
 * A slot with no request is a faint dot.
 */
export function sparkline(els: Els, view: View, events: readonly RouteEvent[], width: number) {
  const { Box, Text } = els;
  const columns = Math.max(10, width);
  const end = view.now;
  const start = view.range > 0 ? end - view.range : Math.min(end - 60e3, ...events.map(at));
  if (!events.some((event) => requestTokens(event) !== undefined)) {
    return <Text color={INK.faint} wrap="wrap">{text("ui.timeline.usageUnavailable", view.locale)}</Text>;
  }
  const sums = new Array<number>(columns).fill(0);
  const worst = new Array<number>(columns).fill(-1);
  for (const event of events) {
    const slot = Math.min(columns - 1, Math.max(0, Math.floor(((at(event) - start) / Math.max(1, end - start)) * columns)));
    sums[slot] = sums[slot]! + (requestTokens(event) ?? 0);
    worst[slot] = Math.max(worst[slot]!, OUTCOMES.indexOf(category(event)));
  }
  const peak = Math.max(1, ...sums);
  // runs of one color, so the row is a handful of Texts and not one per column
  const runs: [string, string][] = [];
  sums.forEach((sum, i) => {
    const color = worst[i]! < 0 ? INK.faint : hex(CATEGORY_DOT[OUTCOMES[worst[i]!]!][1]);
    const char = worst[i]! < 0 ? "·" : LEVELS[Math.min(LEVELS.length - 1, Math.floor(Math.sqrt(sum / peak) * LEVELS.length))]!;
    const last = runs.at(-1);
    if (last && last[1] === color) last[0] += char;
    else runs.push([char, color]);
  });
  const complete = events.filter((event) => event.usage?.input !== undefined && event.usage.cached !== undefined && event.usage.cacheWrite !== undefined && event.usage.output !== undefined).length;
  // a slot whose worst outcome failed is marked under the line, so a failure is told by a glyph and not by color alone
  const failedSlot = OUTCOMES.indexOf("failed");
  const marks = worst.some((outcome) => outcome === failedSlot) ? worst.map((outcome) => (outcome === failedSlot ? CATEGORY_DOT.failed[0] : " ")).join("").trimEnd() : "";
  return (
    <Box flexDirection="column">
      <Text>
        {runs.map(([chars, color]) => (
          <Text color={color}>{chars}</Text>
        ))}
      </Text>
      {marks ? <Text bold color={INK.fail} wrap="truncate">{marks}</Text> : null}
      {marks ? <Text color={INK.fail} wrap="wrap">{text("ui.timeline.failMarks", view.locale)}</Text> : null}
      <Text color={INK.faint} wrap="wrap">
        {text("ui.timeline.caption", view.locale, {
          start: view.range > 0 ? text("ui.timeline.ago", view.locale, { age: formatAge(view.range, view.locale) }) : text("ui.timeline.start", view.locale),
          peak: int(peak, view.locale),
        })}
      </Text>
      {complete < events.length ? <Text color={INK.faint} wrap="wrap">{text("ui.timeline.partial", view.locale, { reported: int(complete, view.locale), total: int(events.length, view.locale) })}</Text> : null}
    </Box>
  );
}
