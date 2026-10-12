import type { ElementTable, RenderNode } from "claude-code";
import { status } from "../events.ts";
import { modelName } from "../feed.ts";
import { formatAge, formatNumber, text, type Locale } from "../i18n.ts";
import { displayWidth, rowsOf } from "../layout.ts";
import { DECK_DESIGN, GLYPH, UI_DESIGN, UI_INK as INK } from "../theme.ts";
import { MOODS } from "../mascots/pingo.ts";
import { renderDeck, type DeckBand, type Surface } from "../deck/band.tsx";
import { type View, type AboveBlock } from "./types.ts";
import { recentStats, statsLine, statsPartial, moodOf, lastJevCall } from "./shared.tsx";

export function renderAbove(els: ElementTable, view: View, deck: DeckBand | null, surface: string, jev: RenderNode = renderBand(els, view)) {
  const { Box } = els;
  if (!deck || (surface !== "terminal" && surface !== "desktop")) return jev;
  return (
    <Box flexDirection="column">
      {jev}
      {renderDeck(els, deck, surface as Surface)}
    </Box>
  );
}

/**
 * One feature's lines above the prompt (Farol, Clareza, Semente, Lapida, Sentinela, Vigia): its first line, then its
 * details, one node per line, each already cut to the band's width.
 */


/**
 * The features' lines above the prompt, held to `DECK_DESIGN.band.messages.maxRows` terminal rows however long or many
 * their messages are. The first line of each comes first, by rank; one that does not fit leaves a row for a "+N" line
 * naming those left out, each pressed to open its pane. Then the details, by rank, while rows are left: a block that
 * cannot show them all shows what fits and a line saying how many more wait in its pane. The blocks keep the order they
 * came in, so nothing moves on screen when one is cut. Rows are counted with `rowsOf`, which rather counts too many.
 */
export function stackAbove(els: ElementTable, blocks: readonly AboveBlock[], cols: number, locale: Locale, maxRows: number = DECK_DESIGN.band.messages.maxRows): RenderNode[] {
  const rows = (node: unknown) => rowsOf(node, cols);
  const ranked = [...blocks].sort((a, b) => a.rank - b.rank);
  const heads = ranked.reduce((sum, block) => sum + rows(block.lines[0]), 0);
  let room = heads <= maxRows ? maxRows : maxRows - 1;
  const kept = new Map<string, number>();
  const left: AboveBlock[] = [];
  for (const block of ranked) {
    const need = rows(block.lines[0]);
    if (need <= room) {
      kept.set(block.id, 1);
      room -= need;
    } else left.push(block);
  }
  const tails = new Map<string, RenderNode>();
  for (const block of ranked) {
    if (!kept.has(block.id)) continue;
    const details = block.lines.slice(1);
    const need = details.reduce((sum, line) => sum + rows(line), 0);
    if (need <= room) {
      kept.set(block.id, block.lines.length);
      room -= need;
      continue;
    }
    // no row even for the "more in its pane" line: its first line still opens the pane
    if (room < 1) continue;
    let shown = 0;
    let used = 0;
    while (shown < details.length && used + rows(details[shown]) + 1 <= room) used += rows(details[shown++]);
    kept.set(block.id, 1 + shown);
    room -= used + 1;
    tails.set(block.id, hiddenLine(els, block, details.length - shown, locale));
  }
  const out: RenderNode[] = [];
  for (const block of blocks) {
    const count = kept.get(block.id);
    if (count === undefined) continue;
    out.push(...block.lines.slice(0, count));
    const tail = tails.get(block.id);
    if (tail) out.push(tail);
  }
  if (left.length) out.push(leftLine(els, left, cols, locale));
  return out;
}

// the line under a block whose details did not all fit: how many wait in its pane, pressed to open it
function hiddenLine(els: ElementTable, block: AboveBlock, count: number, locale: Locale): RenderNode {
  const { Button, Text } = els;
  const label = text("deck.messages.hidden", locale, { count: formatNumber(count, locale) });
  return (
    <Button key={`${block.id}-hidden`} label={label} plain onPress={block.open}>
      <Text color={INK.border}>{`  ${GLYPH.branch}${GLYPH.rule} `}</Text>
      <Text color={INK.dim} underline>{label}</Text>
    </Button>
  );
}

// the line for the blocks left out: "+N more:" and their names, underlined, each pressed to
// open its pane; the names that do not fit the line are only counted
function leftLine(els: ElementTable, left: readonly AboveBlock[], cols: number, locale: Locale): RenderNode {
  const { Box, Button, Text } = els;
  const { xs, sm } = UI_DESIGN.space;
  const lead = text("deck.messages.left", locale, { count: formatNumber(left.length, locale) });
  // the tab and the count as on every line above the prompt, then the names a little apart from each other
  let room = cols - displayWidth(GLYPH.tab) - xs - displayWidth(lead) - xs;
  const named: AboveBlock[] = [];
  for (const block of left) {
    const width = (named.length ? sm : 0) + displayWidth(block.name);
    if (width > room) break;
    named.push(block);
    room -= width;
  }
  return (
    <Box key="above-left" flexDirection="row" columnGap={xs} overflow="hidden">
      <Text color={INK.dim} bold>{GLYPH.tab}</Text>
      <Text color={INK.dim} wrap="truncate-end">{lead}</Text>
      <Box flexDirection="row" columnGap={sm}>
        {named.map((block) => (
          <Button key={`above-left-${block.id}`} label={block.name} plain onPress={block.open}>
            <Text underline>{block.name}</Text>
          </Button>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Above the prompt, in the dashboard's language: Pingo's face and Jev's state with the last five
 * minutes beside it, then Jev's latest call (when and what, kept after it ends) under a tab, then the
 * main model under a tab, what Claude is doing, and a # per subagent at work.
 */
export function renderBand(els: ElementTable, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const stats = recentStats(view);
  const now = view.live;
  const runningAgents = view.agents.filter((run) => run.state === "running");
  const running = runningAgents.length;
  const lastJev = lastJevCall(view.feed);
  // three lines, each kept to one row on a narrow band, so the stack above the prompt can count them: the short parts
  // keep their width (each "-" rides with the part before or after it) and the long ones are cut with "..."
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs} overflow="hidden">
        <Box flexShrink={0}>
          <Text bold color={INK.ink} wrap="truncate-end">{MOODS[mood].face}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text wrap="truncate-end">
            <Text bold color={INK.ink}>{`${text("ui.live.jev", view.locale)}: ${view.live.asking ? text("ui.band.asking", view.locale) : state.title}`}</Text>
            <Text color={INK.border}>{` ${GLYPH.leader}`}</Text>
          </Text>
        </Box>
        <Text color={stats.failures > 0 ? INK.fail : INK.dim} wrap="truncate-end">{`${stats.failures > 0 ? `${GLYPH.warn} ` : ""}${statsLine(stats, view.locale)}`}</Text>
        {statsPartial(stats, view.locale) ? <Text color={INK.faint} wrap="truncate-end">{statsPartial(stats, view.locale)}</Text> : null}
      </Box>
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs}>
        <Text bold color={!lastJev ? INK.faint : lastJev.tone === "bad" ? INK.fail : INK.brand}>{GLYPH.tab}</Text>
        <Text color={lastJev ? INK.ink : INK.faint} wrap="truncate-end">
          {lastJev ? text("ui.band.lastJev", view.locale, { age: formatAge(view.now - lastJev.time, view.locale), what: lastJev.text }) : text("ui.band.noJev", view.locale)}
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs} overflow="hidden">
        <Box flexShrink={0}>
          <Text bold color={INK.claude}>{GLYPH.tab}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={INK.ink} wrap="truncate-end">{`${modelName(now.model)}${now.effort ? ` ${GLYPH.leader} ${now.effort}` : ""}`}</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text color={INK.border}>{`${GLYPH.leader} `}</Text>
          <Text color={now.activity ? INK.ink : INK.faint}>{now.activity ? `${GLYPH.run} ${now.activity}` : text("ui.band.idle", view.locale)}</Text>
        </Text>
        {/* the # per subagent keep their width; what Claude is doing and their count give way */}
        {running ? (
          <Box flexShrink={0}>
            <Text wrap="truncate-end">
              <Text color={INK.border}>{GLYPH.leader}</Text>
              {runningAgents.map((run) => <Text key={run.id} bold color={INK.ink}>{" " + GLYPH.on}</Text>)}
            </Text>
          </Box>
        ) : null}
        {running ? <Text color={INK.route} wrap="truncate-end">{text("ui.band.runningCount", view.locale, { count: formatNumber(running, view.locale), agents: text(running === 1 ? "ui.band.running.agent" : "ui.band.running.agents", view.locale) })}</Text> : null}
      </Box>
    </Box>
  );
}
