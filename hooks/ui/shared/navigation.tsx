import type { ElementTable } from "claude-code";
import type { FeatureId, JevTab } from "../../../types";
import { status, type StatusKind } from "../../events.ts";
import { cellsOf, hex } from "../../dots.ts";
import { text, type Locale, type LocaleKey } from "../../i18n.ts";
import { displayWidth } from "../../layout.ts";
import { css, GLYPH, HUE, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { MOODS, type Mood } from "../../mascots/pingo.ts";
import { miniPingo } from "../../mascots/pixel.ts";
import { type Els, type View, type Actions } from "../types.ts";
import { PILL_INK } from "./base.tsx";
import { recentLine } from "./metrics.tsx";
/**
 * The fourteen screens in their three folders, in the order the rail lists them, with their keys (1 to 9, then 0, o,
 * q, d and a): what this session is doing, the work Pingo and the agents do, and the settings.
 */
export const TABS: readonly (readonly (readonly [JevTab, string, string])[])[] = [
  [
    ["overview", "ui.tab.overview", "1"],
    ["live", "ui.tab.live", "2"],
    ["models", "ui.tab.models", "3"],
  ],
  [
    ["agents", "ui.tab.agents", "4"],
    ["logs", "ui.tab.logs", "5"],
    ["flow", "ui.tab.flow", "0"],
    ["orchestration", "ui.tab.orchestration", "o"],
    ["quality", "ui.tab.quality", "q"],
    ["comandante", "ui.tab.comandante", "d"],
    ["autonomos", "ui.tab.autonomos", "a"],
  ],
  [
    ["configuration", "ui.tab.configuration", "6"],
    ["deck", "ui.tab.deck", "7"],
    ["features", "ui.tab.features", "8"],
    ["ai", "ui.tab.ai", "9"],
  ],
];
/** Each folder's label, in the order of TABS. */
const FOLDERS: readonly LocaleKey[] = ["ui.folder.session", "ui.folder.work", "ui.folder.settings"];

/**
 * The features that change which model runs, how it runs or what is sent to it: the AI screen's, not Features'.
 * The rest (Pingo Vivo, Sentinela) only show state or looks.
 */
export const AI_FEATURES: ReadonlySet<FeatureId> = new Set(["agents", "clareza", "lapida", "farol", "prisma", "semente", "vigia", "contexto", "codeQuality", "comandante", "portao", "rumo", "ensaio", "chaveiro", "oficina"]);
/** Keys the AI screen's own buttons hold (routing, test, remove key): a feature sharing one is toggled without it. */
export const AI_KEYS: ReadonlySet<string> = new Set(["r", "v", "f"]);

const MOOD_OF: Record<StatusKind, Mood> = {
  routing: "routing",
  passthrough: "passthrough",
  failing: "failing",
  idle: "idle",
  baseline: "baseline",
};

/** Pingo's mood: thinking while Jev is being asked, otherwise the routing status. */
export function moodOf(view: Pick<View, "events" | "routing" | "now" | "live" | "locale">): Mood {
  if (view.live.asking) return "thinking";
  return MOOD_OF[status(view.events, view.routing, view.now, view.locale).kind];
}

/**
 * Pingo on the dashboard, still: on the terminal its smallest pixel self, two cells tall, its eyes in the mood's color
 * and its body in the terminal's own; where a Raster does not draw (the desktop) or there is one line to spare, its
 * face as text in the mood's color. No timer moves either.
 */
function pingoMark(els: Els, view: View, mood: Mood, oneLine = false) {
  const { Box, Text } = els;
  if (!oneLine && view.surface === "terminal" && "Raster" in els) {
    const { Raster } = els as unknown as ElementTable<"terminal">;
    const cells = miniPingo(MOODS[mood].color, mood === "baseline");
    const columns = cells[0]!.length;
    return (
      <Box key="pingo" width={columns} height={cells.length} flexShrink={0}>
        <Raster key="pingo-mark" columns={columns} rows={cells.length} cells={cellsOf(cells)} />
      </Box>
    );
  }
  return <Text key="pingo" bold color={hex(MOODS[mood].color)}>{MOODS[mood].face}</Text>;
}

/**
 * One screen's button on the rail or the folded rail. The open one is marked ▸ and bold on the brand's ground, so it
 * reads without color too; the others are dim. `pad` widens the open one's ground across the rail.
 */
function tabButton(els: Els, view: View, act: Actions, [id, label, hotkey]: readonly [JevTab, string, string], pad = 0) {
  const { Button, Text } = els;
  const name = text(label as LocaleKey, view.locale);
  return view.tab === id ? (
    <Button key={"tab-" + id} label={`${GLYPH.open} ${name}`} hotkey={hotkey} plain onPress={() => act.tab(id)}>
      <Text bold color={PILL_INK} backgroundColor={css(HUE.brand)}>{`${GLYPH.open} ${name} `.padEnd(pad)}</Text>
    </Button>
  ) : (
    <Button key={"tab-" + id} label={name} hotkey={hotkey} plain onPress={() => act.tab(id)}>
      <Text color={INK.dim}>{`  ${name}`}</Text>
    </Button>
  );
}

/** Columns the host adds after a plain button for its key: a space and the key in angle quotes. */
const HOTKEY_COLUMNS = UI_DESIGN.layout.hotkeyColumns;

/** The rail's width in this language: the longest screen name, its mark and its key, at least the minimum. */
export function railColumns(locale: Locale): number {
  const longest = Math.max(...TABS.flat().map(([, label]) => displayWidth(text(label as LocaleKey, locale))));
  return Math.max(UI_DESIGN.layout.rail.minColumns, longest + 3 + HOTKEY_COLUMNS);
}

/** The rail down the left: each folder's name, faint and in capitals, then its screens, a blank row between folders. */
export function rail(els: Els, view: View, act: Actions, columns: number) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" width={columns} flexShrink={0} rowGap={UI_DESIGN.space.xs}>
      {TABS.map((folder, i) => (
        <Box key={"folder-" + i} flexDirection="column">
          <Text bold color={INK.faint}>{` ${text(FOLDERS[i]!, view.locale)}`}</Text>
          {folder.map((tab) => tabButton(els, view, act, tab, columns - HOTKEY_COLUMNS))}
        </Box>
      ))}
    </Box>
  );
}

/** The rail folded for a narrow or short pane: one line per folder, its name and then its screens, wrapping. */
export function foldedRail(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column">
      {TABS.map((folder, i) => (
        <Box key={"folder-" + i} flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.xs}>
          <Text bold color={INK.faint}>{text(FOLDERS[i]!, view.locale)}</Text>
          {folder.map((tab) => tabButton(els, view, act, tab))}
        </Box>
      ))}
    </Box>
  );
}

/** Whether the screens go down a rail on the left: the pane is wide enough beside the cards and tall enough for it. */
export function railed(view: View): boolean {
  return view.width >= UI_DESIGN.layout.rail.minPaneWidth && !(view.fixed && view.rows < UI_DESIGN.layout.rail.minRows);
}

/** Jev's on/off switch, on the AI screen. */
export function routingButton(els: Els, view: View, act: Actions) {
  const { Button } = els;
  return <Button key="routing" plain label={text(view.routing ? "ui.header.turnOff" : "ui.header.turnOn", view.locale)} hotkey="r" onPress={() => act.routing(!view.routing)} />;
}

/**
 * The top of the pane at every width: Pingo, then "jev" on the brand's ground and the state in bold, and under them,
 * in plain words, what is going on and the last five minutes. A short terminal pane keeps the first line only, with
 * Pingo's face.
 */
export function header(els: Els, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const compact = view.surface === "terminal" && view.rows < 24;
  const said = view.live.asking ? text("ui.header.asking", view.locale) : state.title;
  const nameLine = (
    <Text bold wrap="wrap">
      <Text color={PILL_INK} backgroundColor={css(HUE.brand)}>{" jev "}</Text>
      <Text color={INK.ink}>{` ${state.icon} ${said}`}</Text>
    </Text>
  );
  if (compact) {
    return (
      <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
        {pingoMark(els, view, mood, true)}
        {nameLine}
      </Box>
    );
  }
  return (
    <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
      {pingoMark(els, view, mood)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {nameLine}
        <Text color={INK.ink} wrap="wrap">{view.live.asking ? text("ui.header.asking", view.locale) : state.text}</Text>
        {recentLine(els, view)}
      </Box>
    </Box>
  );
}

/** The open screen's name in Pingo's color and, under it, what the screen is for. */
export function titleBar(els: Els, view: View) {
  const { Box, Text } = els;
  const entry = TABS.flat().find(([id]) => id === view.tab) ?? TABS[0]![0]!;
  return (
    <Box flexDirection="column">
      <Text bold color={INK.brand}>{text(entry[1] as LocaleKey, view.locale)}</Text>
      <Text color={INK.dim} wrap="wrap">{text(`ui.purpose.${view.tab}` as LocaleKey, view.locale)}</Text>
    </Box>
  );
}
