import type { FeatureId, JevTab } from "../../../types";
import { status, type StatusKind } from "../../events.ts";
import { formatNumber, text, type Locale, type LocaleKey } from "../../i18n.ts";
import { displayWidth } from "../../layout.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { MOODS, type Mood } from "../../mascots/pingo.ts";
import { type Els, type View, type Actions } from "../types.ts";
import { clip } from "./base.tsx";
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

/** Columns the host adds after a plain button for its key: a space and the key in angle quotes. */
const HOTKEY_COLUMNS = UI_DESIGN.layout.hotkeyColumns;

/** The mood's face as text, in the terminal's own ink: it stands where Pingo's mini picture used to. */
function moodFace(els: Els, mood: Mood) {
  const { Box, Text } = els;
  const face = MOODS[mood].face;
  return (
    <Box key="pingo" width={displayWidth(face)} flexShrink={0}>
      <Text key="pingo-face" color={INK.ink} wrap="truncate">{face}</Text>
    </Box>
  );
}

/** The open screen's mark on the rail, then its name: `> Name`; the others leave the mark's place empty. */
const tabLabel = (open: boolean, name: string) => `${open ? GLYPH.open : " "} ${name}`;

/**
 * One screen's button on the rail. The open one is marked `>` and bold, so it reads without color too; the others
 * are plain. `pad` fills the label out to the room before the host's key, so the keys line up in a column.
 */
function tabButton(els: Els, view: View, act: Actions, [id, label, hotkey]: readonly [JevTab, string, string], pad: number) {
  const { Button, Text } = els;
  const name = text(label as LocaleKey, view.locale);
  const open = view.tab === id;
  return (
    <Button key={"tab-" + id} label={open ? tabLabel(true, name) : name} hotkey={hotkey} plain onPress={() => act.tab(id)}>
      <Text bold={open} color={INK.ink}>{` ${tabLabel(open, name)}`.padEnd(pad)}</Text>
    </Button>
  );
}

/** The rail's width in this language: the longest screen name, its mark and its key, at least the minimum. */
export function railColumns(locale: Locale): number {
  const longest = Math.max(...TABS.flat().map(([, label]) => displayWidth(text(label as LocaleKey, locale))));
  return Math.max(UI_DESIGN.layout.rail.minColumns, longest + 3 + HOTKEY_COLUMNS);
}

/** The rail down the left: each folder's name in bold and dim, then its screens, the folders one right after another. */
export function rail(els: Els, view: View, act: Actions, columns: number) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" width={columns} flexShrink={0}>
      {TABS.map((folder, i) => (
        <Box key={"folder-" + i} flexDirection="column">
          <Text bold color={INK.dim}>{` ${text(FOLDERS[i]!, view.locale)}`}</Text>
          {folder.map((tab) => tabButton(els, view, act, tab, columns - HOTKEY_COLUMNS))}
        </Box>
      ))}
    </Box>
  );
}

/**
 * The rail folded for a narrow or short pane: a line per folder, `SESSÃO: > Overview / Live / Models`, the screens
 * separated by ` /`. The line breaks are made here, at the pane's width, so a line that wraps continues indented by
 * two. The buttons carry no key here: the host would draw it after each one and the line would not hold three screens.
 */
export function foldedRail(els: Els, view: View, act: Actions) {
  const { Box, Button, Text } = els;
  return (
    <Box flexDirection="column">
      {TABS.flatMap((folder, i) => {
        const head = `${text(FOLDERS[i]!, view.locale)}:`;
        const units = folder.map(([id, label], j) => {
          const name = text(label as LocaleKey, view.locale);
          const shown = view.tab === id ? tabLabel(true, name).trimStart() : name;
          const last = j === folder.length - 1;
          return { id, shown, tail: last ? "" : ` ${GLYPH.slash}`, size: displayWidth(shown) + (last ? 0 : 2) };
        });
        const lines: (typeof units)[] = [[]];
        let used = displayWidth(head);
        for (const unit of units) {
          const line = lines.at(-1)!;
          if (line.length && used + 1 + unit.size > view.width) {
            lines.push([unit]);
            used = 2 + unit.size;
          } else {
            line.push(unit);
            used += 1 + unit.size;
          }
        }
        // every piece has a width of its own, so the line holds as many screens as were counted for it
        return lines.map((line, row) => (
          <Box key={`folder-${i}-${row}`} flexDirection="row">
            {row === 0 ? <Box width={displayWidth(head)} flexShrink={0}><Text bold color={INK.dim}>{head}</Text></Box> : <Box width={2} flexShrink={0}><Text>{"  "}</Text></Box>}
            {line.map((unit, k) => (
              <Box key={unit.id} flexDirection="row" width={(row === 0 || k > 0 ? 1 : 0) + unit.size} flexShrink={0}>
                {row === 0 || k > 0 ? <Box width={1} flexShrink={0}><Text> </Text></Box> : null}
                <Box width={displayWidth(unit.shown)} flexShrink={0}>
                  <Button key={"tab-" + unit.id} label={unit.shown} plain onPress={() => act.tab(unit.id)}>
                    <Text bold={view.tab === unit.id} color={INK.ink}>{unit.shown}</Text>
                  </Button>
                </Box>
                {unit.tail ? <Box width={displayWidth(unit.tail)} flexShrink={0}><Text color={INK.ink}>{unit.tail}</Text></Box> : null}
              </Box>
            ))}
          </Box>
        ));
      })}
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
 * The top of the pane at every width: the mood's face, then `jev` in bold and the state, and under them, in plain
 * words, what is going on and the last five minutes. A short terminal pane keeps the first line only.
 */
export function header(els: Els, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const compact = view.surface === "terminal" && view.rows < 24;
  const said = view.live.asking ? text("ui.header.asking", view.locale) : state.title;
  const nameLine = (
    <Text wrap="wrap">
      <Text bold color={INK.ink}>jev</Text>
      <Text color={INK.ink}>{` ${state.icon} ${said}`}</Text>
    </Text>
  );
  if (compact) {
    return (
      <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
        {moodFace(els, mood)}
        {nameLine}
      </Box>
    );
  }
  return (
    <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
      {moodFace(els, mood)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {nameLine}
        <Text color={INK.ink} wrap="wrap">{view.live.asking ? text("ui.header.asking", view.locale) : state.text}</Text>
        {recentLine(els, view)}
      </Box>
    </Box>
  );
}

/** The screens that say what they are for in their own first lines: the title is all the bar adds. */
export const SELF_EXPLAINED: ReadonlySet<JevTab> = new Set(["overview", "agents", "features"]);

/** The subagents' count by state, as the Agents title closes its line with; empty when there are none. */
function agentsSummary(view: View): string {
  if (!view.agents.length) return "";
  const running = view.agents.filter((run) => run.state === "running").length;
  const done = view.agents.filter((run) => run.state === "done").length;
  return text("ui.agents.summary", view.locale, {
    running: formatNumber(running, view.locale),
    done: formatNumber(done, view.locale),
    failed: formatNumber(view.agents.length - running - done, view.locale),
  });
}

/** The open screen's name in bold and, under it, what the screen is for (the ones that explain themselves skip it). */
export function titleBar(els: Els, view: View) {
  const { Box, Text } = els;
  const entry = TABS.flat().find(([id]) => id === view.tab) ?? TABS[0]![0]!;
  const name = text(entry[1] as LocaleKey, view.locale);
  const summary = view.tab === "agents" ? agentsSummary(view) : "";
  // the summary closes the title's line when both fit, else it goes under it
  const beside = displayWidth(name) + UI_DESIGN.space.sm + displayWidth(summary) <= view.width;
  return (
    <Box flexDirection="column">
      <Box flexDirection={beside ? "row" : "column"} justifyContent="space-between">
        <Text bold color={INK.ink} wrap="truncate">{name}</Text>
        {summary ? <Text color={INK.dim} wrap="truncate">{beside ? summary : clip(summary, view.width)}</Text> : null}
      </Box>
      {SELF_EXPLAINED.has(view.tab) ? null : <Text color={INK.dim} wrap="wrap">{text(`ui.purpose.${view.tab}` as LocaleKey, view.locale)}</Text>}
    </Box>
  );
}
