import type { RenderChildren } from "claude-code";
import type { RouteEvent } from "../../types";
import { at, category, int, pct, reasons, routed, status, tiles, type Tile, type TileGroup } from "../events.ts";
import { hex } from "../dots.ts";
import { failureHint, failureKind } from "../errors.ts";
import { formatDecimal, formatNumber, reasonTitle, text, type Locale } from "../i18n.ts";
import { rowsOf } from "../layout.ts";
import { meter, UI_DESIGN, UI_INK as INK } from "../theme.ts";
import { type Els, type View, type Actions } from "./types.ts";
import { CATEGORY_DOT, clock, clockWidth, inRange, consultsInRange, INDENT, card, stack, grid, rangePicker, emptyLine, figures, outcomeBar, sparkline, ENTRIES_SHOWN, newestFirst } from "./shared.tsx";
import { conversation } from "./activity.tsx";

export function overview(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const events = inRange(view);
  const consults = consultsInRange(view);
  const state = status(view.events, view.routing, view.now, view.locale);
  const all = consults.length ? tiles(events, view.locale, consults) : tiles(events, view.locale);
  const group = (id: TileGroup) => all.filter((tile) => tile.group === id);
  // With nothing ever recorded, "no requests in the last 5 minutes" only repeats the empty line.
  const note = state.kind === "routing" || (state.kind === "idle" && view.events.length === 0) ? null : state.text;
  const head = (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
        {rangePicker(els, view, act)}
        {events.length === 0 ? null : (
          <Text bold color={INK.ink} wrap="truncate">
            {text("ui.overview.scope", view.locale, { count: int(events.length, view.locale), requests: text(events.length === 1 ? "unit.request" : "unit.requests", view.locale) })}
          </Text>
        )}
        {consults.length ? <Text color={INK.dim} wrap="truncate">{text(view.range <= 0 && view.trace.turns > view.trace.runs.length ? "ui.overview.consultScopeRetained" : "ui.overview.consultScope", view.locale, { count: int(consults.length, view.locale) })}</Text> : null}
      </Box>
      {note === null ? null : <Text color={INK.pass} wrap="wrap">{note}</Text>}
      <Text color={INK.faint} wrap="wrap">{view.meta}</Text>
    </Box>
  );
  if (events.length === 0 && consults.length === 0) {
    return (
      <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
        {head}
        {emptyLine(els, text("ui.overview.empty", view.locale))}
      </Box>
    );
  }
  const alertOf = (group: readonly Tile[]) => group.some((tile) => tile.alert);
  // Routing and Jev's answers side by side where they fit; usage and the timeline across the whole width under them.
  const pair: ((width: number) => RenderChildren)[] = [];
  if (events.length) {
    pair.push((width) => card(els, text("ui.overview.routing", view.locale), [outcomeBar(els, events, width - INDENT, view.locale), figures(els, group("routing"), width - INDENT)], { width, alert: alertOf(group("routing")) }));
  }
  if (group("jev").length) pair.push((width) => card(els, text("ui.overview.jev", view.locale), figures(els, group("jev"), width - INDENT), { width, alert: alertOf(group("jev")) }));
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {head}
      {stack(els, [
        pair.length ? grid(els, view.width, pair) : null,
        group("tokens").length ? card(els, text("ui.overview.tokens", view.locale), figures(els, group("tokens"), view.width - INDENT), { width: view.width, alert: alertOf(group("tokens")) }) : null,
        events.length ? card(els, text("ui.overview.timeline", view.locale), sparkline(els, view, events, view.width - INDENT), { width: view.width }) : null,
      ])}
    </Box>
  );
}

/** AI calls the Logs screen lists, newest first. */
const CALLS_SHOWN = 20;
/** Entries the Live log and the Logs request log draw at most; older ones stay in the kept history. */


/** The latest Jev call in the live log (its line, rewritten when the call ends), if one is still kept. */


/**
 * What the Live log draws: the latest Jev call pinned on top, so newer lines never push it out, then the newest
 * other lines, newest first, `ENTRIES_SHOWN` in all.
 */


/** Rows the entries newer than `since` take at the top of a newest-first log, as drawn at `width`. */
export function rowsAbove<T extends { seq: number }>(shown: readonly T[], since: number, draw: (entry: T) => RenderChildren, width: number): number {
  return shown.filter((entry) => entry.seq > since).reduce((sum, entry) => sum + rowsOf(draw(entry), width), 0);
}

/**
 * The Logs screen: a card of reason groups, each with a meter for its share of the largest, then the request
 * log itself, its newest `ENTRIES_SHOWN` newest first, one line per request with its outcome's glyph in its color,
 * then the latest AI calls.
 */
export function logView(els: Els, view: View) {
  const { Box, Text } = els;
  const grouped = reasons(view.events, view.locale);
  const unhandled = view.events.filter((event) => !routed(event)).length;
  const colorFor = (who: string) => (who === text("reason.who.failed", view.locale) ? INK.fail : who === text("reason.who.asked", view.locale) ? INK.pass : INK.dim);
  const most = Math.max(1, ...grouped.map((reason) => reason.count));
  const reasonsShown = grouped.slice(0, 6);
  const rows = newestFirst(view.events);
  // Every AI call (Jev's and the features' own) as Live wrote it, newest first: the same lines, not a second record.
  const calls = view.feed.filter((entry) => entry.kind === "call");
  const shownCalls = calls.slice(-CALLS_SHOWN).reverse();
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {card(
        els,
        text("ui.log.reasons", view.locale),
        grouped.length === 0
          ? <Text color={INK.faint}>{text("ui.log.noReasons", view.locale)}</Text>
          : grid(els, view.width - 4, reasonsShown.map((reason) => (reasonWidth) => {
                const [filled, empty] = meter(reason.count / most, Math.max(6, reasonWidth - 2));
                return (
                  <Box flexDirection="column" width={reasonWidth} flexShrink={0}>
                    <Text bold color={colorFor(reason.who)} wrap="wrap">{`${reasonTitle(reason.name, view.locale)} · ${int(reason.count, view.locale)} · ${pct(reason.count, unhandled, view.locale)}`}</Text>
                    <Text wrap="truncate">
                      <Text color={colorFor(reason.who)}>{filled}</Text>
                      <Text color={INK.border}>{empty}</Text>
                    </Text>
                  </Box>
                );
              }), 28),
        { width: view.width, note: grouped.length > reasonsShown.length ? text("ui.log.moreReasons", view.locale, { hidden: formatNumber(grouped.length - reasonsShown.length, view.locale) }) : undefined },
      )}
      {card(els, text("ui.log.title", view.locale), rows.length ? rows.map((event) => logEntry(els, { ...view, width: view.width - 4 }, event)) : <Text color={INK.dim}>{text("ui.log.empty", view.locale)}</Text>, {
        width: view.width,
        note: text("ui.log.recent", view.locale, { shown: formatNumber(rows.length, view.locale), total: formatNumber(view.events.length, view.locale) }),
      })}
      {card(els, text("ui.log.calls", view.locale), conversation(els, { ...view, width: view.width - 4 }, shownCalls, text("ui.log.noCalls", view.locale)), {
        width: view.width,
        note: text("ui.log.recent", view.locale, { shown: formatNumber(shownCalls.length, view.locale), total: formatNumber(calls.length, view.locale) }),
      })}
    </Box>
  );
}

/**
 * One request of the log, in two columns: its time, then what happened (its outcome's glyph in its color) and how
 * long it took; its figures faint under that; why it went that way under them. Wrapped lines stay in the second
 * column, and a blank row closes each request so they stand apart.
 */
export function logEntry(els: Els, view: View, event: RouteEvent) {
  const { Box, Text } = els;
  const kind = category(event);
  const [glyph, color] = CATEGORY_DOT[kind];
  const what =
    event.mode === "hint"
      ? text("ui.log.suggested", view.locale, { tool: event.tool ?? "" })
      : event.jev?.choice
        ? text("ui.log.picked", view.locale, { choice: event.jev.choice })
      : text("ui.log.stayedOut", view.locale);
  const confidence = event.confidence ?? event.jev?.confidence;
  const reason = event.reason ? reasonTitle(event.reason, view.locale) : "";
  const reasonDetail = event.reason && reason !== event.reason ? `${reason} (${event.reason})` : reason;
  const usage = event.usage ? [
    event.usage.input === undefined ? "" : text("ui.log.inputTokens", view.locale, { value: int(event.usage.input, view.locale) }),
    event.usage.cached === undefined ? "" : text("ui.log.cachedTokens", view.locale, { value: int(event.usage.cached, view.locale) }),
    event.usage.cacheWrite === undefined ? "" : text("ui.log.cacheWriteTokens", view.locale, { value: int(event.usage.cacheWrite, view.locale) }),
    event.usage.output === undefined ? "" : text("ui.log.outputTokens", view.locale, { value: int(event.usage.output, view.locale) }),
  ].filter(Boolean).join(" · ") : "";
  const figures = [
    confidence === undefined ? "" : formatDecimal(confidence, view.locale),
    event.jev ? `${int(event.jev.latencyMs, view.locale)} ms` : "",
    usage,
  ].filter(Boolean).join(" · ");
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box width={clockWidth(view.locale)} flexShrink={0}>
        <Text color={INK.faint}>{clock(at(event), view.locale)}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">
          <Text bold color={hex(color)}>{glyph}</Text>
          <Text bold color={INK.ink}>{` ${what}`}</Text>
          <Text color={INK.dim}>{text("ui.log.duration", view.locale, { value: formatDecimal(event.durationMs / 1000, view.locale, 1) + text("format.seconds", view.locale, { value: "" }) })}</Text>
        </Text>
        {figures ? <Text color={INK.faint} wrap="wrap">{figures}</Text> : null}
        {event.reason ? <Text color={kind === "failed" ? INK.fail : INK.dim} wrap="wrap">{text("ui.log.reason", view.locale, { reason: reasonDetail })}</Text> : null}
        {kind === "failed" && event.error ? <Text color={INK.fail} wrap="wrap">{text("ui.log.cause", view.locale, { cause: event.error })}</Text> : null}
        {kind === "failed" ? <Text color={INK.pass} wrap="wrap">{text("ui.log.hint", view.locale, { hint: failureHint(failureKind(event.error ?? "", event.reason), view.locale) })}</Text> : null}
        {kind === "failed"
          ? (event.jevRaw ?? []).map((raw, index, all) => (
              <Box flexDirection="column" borderStyle="round" borderColor={INK.fail} paddingX={UI_DESIGN.space.xs}>
                <Text color={INK.ink} bold wrap="truncate">
                  {text("ui.log.raw", view.locale, {
                    part: all.length > 1 ? text("ui.log.rawPart", view.locale, { n: formatNumber(index + 1, view.locale), total: formatNumber(all.length, view.locale) }) : "",
                    chars: formatNumber(raw.length, view.locale),
                  })}
                </Text>
                <Text color={INK.dim} wrap="wrap">{rawReply(raw, view.locale)}</Text>
              </Box>
            ))
          : null}
      </Box>
    </Box>
  );
}

/** Rows of a raw reply the log shows before saying how many more there are. */
const RAW_ROWS = 120;

/** A reply body for reading: indented when it is JSON, cut after RAW_ROWS rows. */
function rawReply(raw: string, locale: Locale): string {
  let body = raw;
  try {
    body = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {}
  const lines = body.split("\n");
  if (lines.length <= RAW_ROWS) return body;
  return [...lines.slice(0, RAW_ROWS), text("ui.log.rawMore", locale, { count: formatNumber(lines.length - RAW_ROWS, locale) })].join("\n");
}

/** One step of the setup: a ✓ once done or a hollow dot, its number and label, and what is set there. */


/** Feature switches and the preferences that control their behavior, except the AI screen's. */
