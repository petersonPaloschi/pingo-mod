import type { ComandanteFilter, ComandanteRecord, ComandanteSource } from "../../../types";
import { pct } from "../../events.ts";
import { formatNumber, text, type LocaleKey } from "../../i18n.ts";
import { UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { COMANDANTE_ALL, COMANDANTE_DECISIONS, COMANDANTE_SOURCES, comandanteCounts, comandanteSessions, comandanteSourcesAll, filterComandante } from "../../core/comandante.ts";
import type { Els, View, Actions } from "../types.ts";
import { toggleButton, clock, oneLine, card, stack, section, emptyLine } from "../shared.tsx";
import { DECISION_MARK } from "./shared.ts";

/**
 * Which assistants the Comandante judges: "All" switches every one on (or, all on, off), then one switch per source,
 * each a switch that reads `[x]` or `[ ]`.
 */
function comandanteSourcesCard(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const { locale } = view;
  const sources = view.preferences.comandanteSources;
  const onCount = COMANDANTE_SOURCES.filter((source) => sources[source]).length;
  const allOn = onCount === COMANDANTE_SOURCES.length;
  const toggle = (source: ComandanteSource) => {
    const on = sources[source];
    return toggleButton(els, `comandante-source-${source}`, on, text(`feature.${source}.name`, locale), () => act.preference("comandanteSources", { ...sources, [source]: !on }));
  };
  return card(els, text("feature.comandante.sources.title", locale), [
    <Text color={INK.dim} wrap="wrap">{text("feature.comandante.sources.hint", locale)}</Text>,
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
      {toggleButton(els, "comandante-sources-all", allOn, text("feature.comandante.sources.all", locale), () => act.preference("comandanteSources", comandanteSourcesAll(!allOn)))}
      <Text color={INK.faint}>{text("feature.comandante.sources.count", locale, { on: formatNumber(onCount, locale), total: formatNumber(COMANDANTE_SOURCES.length, locale) })}</Text>
    </Box>,
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>{COMANDANTE_SOURCES.map(toggle)}</Box>,
  ], { width: view.width });
}

/**
 * The Comandante: its switch and what it is doing, which assistants it judges, the filters by session and by
 * decision, then each decision of every session of the project as a card, newest first: what was judged, why, and
 * where it came from.
 */
export function comandanteView(els: Els, view: View, act: Actions) {
  const { Box, Text, Select } = els;
  const { locale } = view;
  const on = view.features.comandante;
  const panel = view.comandante ?? { log: [], filter: { session: COMANDANTE_ALL, decision: COMANDANTE_ALL }, me: "", busy: false };
  const name = text("feature.comandante.name", locale);
  const status = !on ? "feature.comandante.off" : panel.busy ? "feature.comandante.busy" : "feature.comandante.idle";
  const sessions = comandanteSessions(panel.log);
  const sessionName = (id: string, label: string) => (id === panel.me ? text("feature.comandante.this", locale) : `${oneLine(label, 30)} - ${id.slice(0, 8)}`);
  const kept = filterComandante(panel.log, panel.filter);
  const shown = kept.slice(0, view.width >= 70 ? 30 : 15);
  const counts = comandanteCounts(kept);
  const lineWidth = Math.max(20, view.width - 6);
  const node = (record: ComandanteRecord) => {
    const [glyph, color] = DECISION_MARK[record.decision];
    const title = `${text(`feature.comandante.decision.${record.decision}`, locale)} - ${text(`feature.${record.source}.name`, locale)}`;
    const origin = [
      clock(record.at, locale),
      sessionName(record.session, record.sessionName),
      record.project,
      record.agent ? text("feature.comandante.by", locale, { agent: record.agent }) : "",
    ].filter(Boolean).join(" - ");
    return card(els, title, [
      <Text wrap="wrap">{oneLine(record.summary, lineWidth * 3)}</Text>,
      <Text color={INK.dim} wrap="wrap">{`${text(`feature.comandante.reason.${record.reason}` as LocaleKey, locale)} - ${text("feature.comandante.confidence", locale, { value: pct(record.confidence, 1, locale) })}`}</Text>,
      <Text color={INK.faint} wrap="truncate">{oneLine(origin, lineWidth)}</Text>,
      // a held message the person let through to Claude anyway
      record.releasedAt !== undefined ? <Text color={INK.you} wrap="wrap">{text("feature.comandante.released", locale, { time: clock(record.releasedAt, locale) })}</Text> : null,
    ], { width: view.width, glyph, color });
  };
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {card(els, name, [
        <Text color={INK.dim} wrap="wrap">{text(status, locale)}</Text>,
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
          {toggleButton(els, "feature-comandante", on, name, () => act.feature("comandante", !on), "m")}
        </Box>,
      ], { width: view.width })}
      {comandanteSourcesCard(els, view, act)}
      {section(els, text("feature.comandante.log", locale))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
        <Select
          key="comandante-session"
          label={text("feature.comandante.filter.session", locale)}
          value={panel.filter.session}
          options={[
            { value: COMANDANTE_ALL, label: text("feature.comandante.filter.allSessions", locale) },
            ...sessions.map((one) => ({ value: one.id, label: `${sessionName(one.id, one.name)}${one.project ? ` - ${one.project}` : ""}` })),
          ]}
          onSelect={(value) => act.comandanteFilter({ session: String(value) })}
        />
        <Select
          key="comandante-decision"
          label={text("feature.comandante.filter.decision", locale)}
          value={panel.filter.decision}
          options={[
            { value: COMANDANTE_ALL, label: text("feature.comandante.filter.allDecisions", locale) },
            ...COMANDANTE_DECISIONS.map((decision) => ({ value: decision, label: text(`feature.comandante.decision.${decision}`, locale) })),
          ]}
          onSelect={(value) => act.comandanteFilter({ decision: value as ComandanteFilter["decision"] })}
        />
      </Box>
      {kept.length ? (
        <Text color={INK.faint} wrap="wrap">
          {[
            text("feature.comandante.counts", locale, { approved: formatNumber(counts.approved, locale), rejected: formatNumber(counts.rejected, locale), questioned: formatNumber(counts.questioned, locale) }),
            shown.length < kept.length ? text("feature.comandante.shown", locale, { shown: formatNumber(shown.length, locale), total: formatNumber(kept.length, locale) }) : "",
          ].filter(Boolean).join(" ")}
        </Text>
      ) : null}
      {shown.length ? stack(els, shown.map(node)) : emptyLine(els, text(panel.log.length ? "feature.comandante.noMatch" : "feature.comandante.empty", locale))}
    </Box>
  );
}
