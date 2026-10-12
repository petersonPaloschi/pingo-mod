import type { QualityCycle, QualityItem } from "../../../types";
import { formatClock, formatNumber, text } from "../../i18n.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import type { Els, View, Actions } from "../types.ts";
import { toggleButton, card, stack, section, emptyLine } from "../shared.tsx";

export function qualityView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const { locale } = view;
  const on = view.features.codeQuality;
  const { running, queued, cycles } = view.quality ?? { running: false, queued: [], cycles: [] };
  const name = text("feature.codeQuality.name", locale);
  const status = !on ? "feature.codeQuality.off" : running ? "feature.codeQuality.running" : "feature.codeQuality.idle";
  const item = (glyph: string, color: string, one: QualityItem) => (
    <Text wrap="wrap"><Text bold color={color}>{`${glyph} `}</Text>{one.where ? <Text bold>{`${one.where} `}</Text> : null}{one.text}</Text>
  );
  const cycleNode = (cycle: QualityCycle) => {
    const title = text("feature.codeQuality.cycle", locale, { n: formatNumber(cycle.n, locale), time: formatClock(cycle.startedAt, locale) });
    if (cycle.state === "running") {
      const files = cycle.files.length ? text("feature.codeQuality.queued", locale, { files: cycle.files.join(", ") }) : undefined;
      return card(els, title, <Text color={INK.dim} wrap="wrap">{text("feature.codeQuality.running", locale)}</Text>, { width: view.width, rule: INK.brand, glyph: GLYPH.run, ...(files ? { note: files } : {}) });
    }
    const counts = text("feature.codeQuality.counts", locale, { fixed: formatNumber(cycle.fixed.length, locale), skipped: formatNumber(cycle.skipped.length, locale) });
    return card(els, title, [
      cycle.summary ? <Text wrap="wrap">{cycle.summary}</Text> : null,
      cycle.state === "failed" && !cycle.summary ? <Text color={INK.fail} wrap="wrap">{text("feature.codeQuality.noReport", locale)}</Text> : null,
      cycle.reviewed.length ? <Text color={INK.faint} wrap="wrap">{text("feature.codeQuality.reviewed", locale, { files: cycle.reviewed.join(", ") })}</Text> : null,
      ...cycle.fixed.map((one) => item(GLYPH.ok, INK.route, one)),
      ...cycle.skipped.map((one) => item(GLYPH.off, INK.dim, one)),
    ], { width: view.width, note: counts, alert: cycle.state === "failed" });
  };
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {card(els, name, [
        <Text color={INK.dim} wrap="wrap">{text(status, locale)}</Text>,
        on && queued.length ? <Text color={INK.faint} wrap="wrap">{text("feature.codeQuality.queued", locale, { files: queued.join(", ") })}</Text> : null,
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
          {toggleButton(els, "feature-codeQuality", on, name, () => act.feature("codeQuality", !on), "k")}
          {on && !running ? <Button key="quality-run" label={text("feature.codeQuality.runNow", locale)} onPress={() => act.qualityRun()} /> : null}
        </Box>,
      ], { width: view.width })}
      {section(els, text("feature.codeQuality.cycles", locale))}
      {cycles.length ? stack(els, cycles.map(cycleNode)) : emptyLine(els, text("feature.codeQuality.none", locale))}
    </Box>
  );
}
