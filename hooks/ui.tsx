// The Jev dashboard, drawn in black and white ASCII: the Jev header at the top, the screens filed in three folders
// down a rail on the left, and the open screen as cards beside it: a classic `+-|` frame with its title written on
// the top edge, the figures in bold, a `[####....]` meter for a share. A narrow pane folds the rail into a few lines.

import type { RenderChildren } from "claude-code";
import { formatNumber, text } from "./i18n.ts";
import { rowsOf } from "./layout.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "./theme.ts";
import { type Els, type View, type Actions } from "./ui/types.ts";
import { SELF_EXPLAINED } from "./ui/shared/navigation.tsx";
import { anchored, INDENT, railColumns, rail, foldedRail, railed, header, titleBar, liveLines, newestFirst } from "./ui/shared.tsx";
import { overview, rowsAbove, logView, logEntry } from "./ui/overview.tsx";
import { featuresView, configurationView, aiView, orchestrationView, deckView } from "./ui/settings.tsx";
import { feedLine, liveView, agentsView, flowView, modelsView } from "./ui/activity.tsx";
import { qualityView, comandanteView, autonomosView } from "./ui/panels.tsx";

export { TABS, ENTRIES_SHOWN, cellsOf, clip, oneLine, clockWidth, shares, moodOf, lineTab, featureHead, sheetCard } from "./ui/shared.tsx";
export type { Els, DeckPanel, View, ComandantePanel, QualityPanel, OrchestrationView, Actions, AutonomosPanel, AutonomoId, AutonomoVerb, AboveBlock } from "./ui/types.ts";
export { speaker, renderAgentPane } from "./ui/activity.tsx";
export { portaoSettled, rumoSettled } from "./ui/panels.tsx";
export { renderAbove, stackAbove, renderBand } from "./ui/band.tsx";

export function renderPane(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const side = railed(view);
  const railWidth = side ? railColumns(view.locale) : 0;
  const gap = side ? UI_DESIGN.layout.rail.gap : 0;
  const width = view.width - railWidth - gap;
  const inner: View = { ...view, width };
  const top = side ? header(els, view) : (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {header(els, view)}
      {foldedRail(els, view, act)}
    </Box>
  );
  const title = titleBar(els, inner);
  // The title sits right on the cards of a screen that explains itself; a purpose line under it gets a blank row after.
  const titleGap = SELF_EXPLAINED.has(view.tab) ? UI_DESIGN.space.none : UI_DESIGN.space.xs;
  // The rail beside the screen, or the screen alone; `height` clips both to the room under the header.
  const beside = (main: RenderChildren, height?: number) => (
    <Box flexDirection="row" columnGap={gap} {...(height === undefined ? {} : { height, overflow: "hidden" as const })}>
      {side ? rail(els, view, act, railWidth) : null}
      <Box flexDirection="column" width={width} flexShrink={0} rowGap={titleGap}>
        {main}
      </Box>
    </Box>
  );
  if (!view.fixed) {
    return (
      <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
        {top}
        {beside([title, tabBody(els, inner, act)])}
      </Box>
    );
  }
  const room = Math.max(5, view.rows - rowsOf(top, view.width) - UI_DESIGN.space.xs);
  const rows = Math.max(4, room - rowsOf(title, width) - titleGap);
  const body = <Box flexDirection="column" flexShrink={0}>{tabBody(els, inner, act)}</Box>;
  const total = rowsOf(body, width);
  const max = Math.max(0, total - rows + 1);
  // Logs and Live have their newest on top: scrolled down, each keeps to the entries it showed.
  const offset =
    view.tab === "logs"
      ? anchored("log", view.scroll, view.events.at(-1)?.seq ?? 0, (since) => rowsAbove(newestFirst(view.events), since, (event) => logEntry(els, { ...inner, width: width - INDENT }, event), width - INDENT), max)
      : view.tab === "live"
        ? anchored("live", view.scroll, view.feed.at(-1)?.seq ?? 0, (since) => rowsAbove(liveLines(view.feed).lines, since, (entry) => feedLine(els, inner, entry), width), max)
        : Math.min(view.scroll, max);
  act.layout((view.tab === "logs" || view.tab === "live") && max ? view.scroll + max - offset : max, false);
  const more = total - offset > rows - 1;
  return (
    <Box flexDirection="column" height={view.rows} overflow="hidden" rowGap={UI_DESIGN.space.xs}>
      {top}
      {beside([
        title,
        <Box flexDirection="column" flexShrink={0}>
          <Box flexDirection="column" height={rows - (max ? 1 : 0)} overflow="hidden" flexShrink={0}>
            <Box flexDirection="column" flexShrink={0} marginTop={-offset}>
              {body}
            </Box>
          </Box>
          {max ? (
            <Text color={INK.faint} wrap="truncate">
              {text("ui.scroll.footer", view.locale, { up: offset > 0 ? GLYPH.up : " ", down: more ? GLYPH.down : " ", percent: formatNumber((100 * offset) / max, view.locale) })}
            </Text>
          ) : null}
        </Box>,
      ], room)}
    </Box>
  );
}

/** Code Quality: its switch and what it is doing, then each cycle with what it fixed and what it left as it was. */

function tabBody(els: Els, view: View, act: Actions) {
  return view.tab === "live"
      ? liveView(els, view)
      : view.tab === "agents"
        ? agentsView(els, view, act)
      : view.tab === "models"
        ? modelsView(els, view)
      : view.tab === "logs"
              ? logView(els, view)
              : view.tab === "features"
                ? featuresView(els, view, act)
              : view.tab === "configuration"
                ? configurationView(els, view, act)
              : view.tab === "ai"
                ? aiView(els, view, act)
              : view.tab === "flow"
                ? flowView(els, view)
              : view.tab === "orchestration"
                ? orchestrationView(els, view, act)
              : view.tab === "quality"
                ? qualityView(els, view, act)
              : view.tab === "comandante"
                ? comandanteView(els, view, act)
              : view.tab === "autonomos"
                ? autonomosView(els, view, act)
                : view.tab === "deck"
                  ? deckView(els, view, act)
                  : overview(els, view, act);
}

/**
 * Above the prompt: the Jev band, then the Deck band beneath it. A surface Deck does not draw
 * (neither the terminal nor the desktop) gets the Jev band alone.
 */
