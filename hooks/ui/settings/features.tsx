import type { RenderChildren } from "claude-code";
import type { FeaturePreferences } from "../../../types";
import { features } from "../../feed.ts";
import { text, type LocaleKey } from "../../i18n.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import type { Els, View, Actions } from "../types.ts";
import { AI_FEATURES, AI_KEYS, toggleButton, card, stack, grid, section } from "../shared.tsx";

export function featuresView(els: Els, view: View, act: Actions) {
  return featurePanel(els, view, act, false);
}

/** Feature switches and their preferences: the AI screen's (`ai`) or the Features screen's, never both. */
export function featurePanel(els: Els, view: View, act: Actions, ai: boolean) {
  const { Box, Text, Select } = els;
  const state = `${GLYPH.check} ${text("ui.configuration.enabledValue", view.locale)}  ${GLYPH.off} ${text("ui.configuration.disabledValue", view.locale)}`;
  const preferenceToggle = (key: keyof FeaturePreferences, label: string, on: boolean) => () =>
    toggleButton(els, key, on, label, () => act.preference(key, !on));
  const locale = view.locale;
  const preferences = view.preferences;
  const featuresList = features(locale).filter((feature) => AI_FEATURES.has(feature.id) === ai).map((feature) => (cellWidth: number) => {
    const on = view.features[feature.id];
    const name = feature.id === "agents" ? text("ui.features.agentsShort", locale) : feature.name;
    return (
      <Box flexDirection="column" width={cellWidth} flexShrink={0}>
        {toggleButton(els, "feature-" + feature.id, on, name, () => act.feature(feature.id, !on), ai && AI_KEYS.has(feature.hotkey) ? undefined : feature.hotkey)}
        <Text key={`feature-${feature.id}-description`} color={INK.dim} wrap="wrap">{feature.description}</Text>
      </Box>
    );
  });
  const scope = () => <Select key="assumption-scope" label={text("ui.features.scope", locale)} value={preferences.assumptionScope} options={[
    { value: "all", label: text("ui.features.scopeAll", locale) },
    { value: "important", label: text("ui.features.scopeImportant", locale) },
  ]} onSelect={(value) => act.preference("assumptionScope", value as FeaturePreferences["assumptionScope"])} />;
  const style = () => <Select key="plain-level" label={text("ui.features.style", locale)} value={preferences.plainLevel} options={[
    { value: "beginner", label: text("ui.features.beginner", locale) },
    { value: "expert", label: text("ui.features.expert", locale) },
  ]} onSelect={(value) => act.preference("plainLevel", value as FeaturePreferences["plainLevel"])} />;
  const hat = () => <Select key="pet-hat" label={text("ui.features.hat", locale)} value={preferences.petHat} options={[
    { value: "random", label: text("ui.features.randomHat", locale) },
    ...["tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"].map((hat) => ({ value: hat, label: text(`deck.pet.hat.${hat}` as LocaleKey, locale) })),
  ]} onSelect={(value) => act.preference("petHat", String(value))} />;
  const surface = () => <Select key="design-surface" label={text("ui.features.surface", locale)} value={preferences.designSurface} options={[
    { value: "auto", label: text("ui.configuration.surfaceAuto", locale) },
    { value: "pane", label: text("ui.configuration.surfacePane", locale) },
    { value: "browser", label: text("ui.configuration.surfaceBrowser", locale) },
  ]} onSelect={(value) => act.preference("designSurface", value as FeaturePreferences["designSurface"])} />;
  const monitor = () => <Select key="monitor-interval" label={text("ui.features.monitor", locale)} value={String(preferences.monitorEveryMs)} options={[2000, 5000, 10000].map((ms) => ({ value: String(ms), label: `${ms / 1000}s` }))} onSelect={(value) => act.preference("monitorEveryMs", Number(value) as FeaturePreferences["monitorEveryMs"])} />;
  const clash = () => <Select key="clash-window" label={text("ui.features.clashWindow", locale)} value={String(preferences.clashMinutes)} options={[15, 30, 60].map((minutes) => ({ value: String(minutes), label: `${minutes} min` }))} onSelect={(value) => act.preference("clashMinutes", Number(value) as FeaturePreferences["clashMinutes"])} />;
  // What is sent to the model (Farol's scope, Clareza's level and review, Prisma, Semente, Lapida, Vigia's summary)
  // goes with the AI screen; sound, mascot and monitoring stay on Features.
  const preferenceGroups: [LocaleKey, readonly (() => RenderChildren)[]][] = ai ? [
    ["ui.features.replyGroup", [
      scope,
      style,
      preferenceToggle("plainReview", text("ui.features.answerReview", locale), preferences.plainReview),
    ]],
    ["ui.features.workflowGroup", [
      surface,
      preferenceToggle("ideaNudges", text("ui.features.ideaNudges", locale), preferences.ideaNudges),
      preferenceToggle("promptLearning", text("ui.features.promptLearning", locale), preferences.promptLearning),
      preferenceToggle("trackerSummary", text("ui.features.trackerSummary", locale), preferences.trackerSummary),
    ]],
  ] : [
    ["ui.features.replyGroup", [preferenceToggle("plainSound", text("ui.features.completionSound", locale), preferences.plainSound)]],
    ["ui.features.mascotGroup", [hat, preferenceToggle("petShades", text("ui.features.petShades", locale), preferences.petShades)]],
    ["ui.features.monitorGroup", [monitor, clash]],
  ];
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {card(els, text("ui.configuration.features", locale), grid(els, view.width - 4, featuresList, 32), { width: view.width, note: `${state} · ${text("ui.features.clickToChange", locale)}` })}
      {section(els, text("ui.features.preferencesTitle", locale))}
      {stack(els, preferenceGroups.map(([title, controls]) => card(els, text(title, locale), <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>{controls.map((make) => make())}</Box>, { width: view.width })))}
    </Box>
  );
}

/** The language and history controls; the provider and its key are on the AI screen. */
