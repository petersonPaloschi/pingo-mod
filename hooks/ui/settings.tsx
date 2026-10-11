import type { RenderChildren } from "claude-code";
import type { FeaturePreferences } from "../../types";
import { features } from "../feed.ts";
import { PROVIDER_IDS, PROVIDERS } from "../core/jev.ts";
import { status } from "../events.ts";
import { formatNumber, text, type Locale, type LocaleKey, type LocaleOption } from "../i18n.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../theme.ts";
import { COLLAPSED, SECTIONS, SIZES } from "../deck/settings.ts";
import { DESKTOP_STYLE_NAMES, DESKTOP_STYLES } from "../deck/styles-desktop.ts";
import { CLAUDE_MODELS, defaultPolicy, MODEL_LABEL, PROFILE_EFFORTS, ROLES, type OrchestrationPolicy, type Role } from "../core/orchestration.ts";
import { EFFORT_TEXT_VALUES, MODEL_TEXT_VALUES } from "../core/contracts.ts";
import { TERMINAL_STYLE_NAMES, TERMINAL_STYLES } from "../deck/styles-terminal.ts";
import { type Els, type View, type OrchestrationView, type Actions } from "./types.ts";
import { AI_FEATURES, AI_KEYS, toggleButton, card, stack, GUTTER, grid, routingButton, section, step } from "./shared.tsx";

export function featuresView(els: Els, view: View, act: Actions) {
  return featurePanel(els, view, act, false);
}

/** Feature switches and their preferences: the AI screen's (`ai`) or the Features screen's, never both. */
function featurePanel(els: Els, view: View, act: Actions, ai: boolean) {
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
export function configurationView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select } = els;
  const cardWidth = view.width >= UI_DESIGN.layout.configurationTwoColumnMinWidth ? Math.floor((view.width - GUTTER) / 2) : view.width;
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={GUTTER} rowGap={UI_DESIGN.space.xs}>
        {card(els, text("ui.configuration.interface", view.locale), [
          <Select
            key="language"
            label={text("ui.setup.language", view.locale)}
            value={view.localeOption}
            options={[
              { value: "auto", label: text("ui.setup.languageAuto", view.locale) },
              { value: "en", label: text("ui.setup.languageEnglish", view.locale) },
              { value: "pt", label: text("ui.setup.languagePortuguese", view.locale) },
            ]}
            onSelect={(value) => act.locale(value as LocaleOption)}
          />,
          <Text color={INK.faint} wrap="wrap">{text("ui.setup.languageHelp", view.locale)}</Text>,
        ], { width: cardWidth })}
        {card(els, text("ui.configuration.history", view.locale), [
          <Text color={INK.faint} wrap="truncate">{view.meta}</Text>,
          <Box flexDirection="row">
            <Button key="clear" label={`${text("ui.setup.clearHistory", view.locale)} (c)`} hotkey="c" onPress={() => act.clear()} />
          </Box>,
        ], { width: cardWidth })}
      </Box>
    </Box>
  );
}

/** Jev's provider, its key and the connection test. */
function providerCard(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const chosen = PROVIDER_IDS.includes(view.setup.provider as never) ? view.setup.provider : PROVIDER_IDS.includes(view.key.provider as never) ? view.key.provider : "typesafe";
  const info = PROVIDERS[chosen as keyof typeof PROVIDERS];
  const saved = view.key.source !== "none";
  const typed = view.setup.typed ?? "";
  const message = view.setup.message;
  const connected = view.setup.isOk && Boolean(message) && !view.setup.busy;
  return card(
    els,
    text("ui.configuration.provider", view.locale),
    [
      step(
        els,
        1,
        text("ui.setup.provider", view.locale),
        true,
        <Box flexDirection="column">
          <Select key="provider" value={chosen} options={PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label }))} onSelect={(value) => act.provider(value)} />
          <Text color={INK.faint} wrap="wrap">{text("ui.setup.providerNote", view.locale, { note: text(info.noteKey, view.locale), url: info.keyUrl })}</Text>
        </Box>,
      ),
      step(
        els,
        2,
        text("ui.setup.keyLabel", view.locale),
        saved && !typed,
        <Box flexDirection="column">
          {saved ? (
            <Text wrap="truncate">
              <Text color={INK.route}>{`••••${view.key.tail}`}</Text>
              <Text color={INK.dim}>{text("ui.setup.keyInUse", view.locale, { source: text(`source.${view.key.source}` as LocaleKey, view.locale) })}</Text>
            </Text>
          ) : (
            <Text color={INK.pass} wrap="truncate">{text("ui.setup.noKeyYet", view.locale, { env: info.keyEnv })}</Text>
          )}
          <Input
            key="api-key"
            value={typed}
            placeholder={text(saved ? "ui.setup.keyPlaceholder" : "ui.setup.keyPlaceholderEmpty", view.locale)}
            submitLabel={text("ui.setup.testSave", view.locale)}
            onInput={(value) => act.typeKey(value)}
            onSubmit={(value) => act.submitKey(value)}
          />
          <Text color={INK.faint} wrap="wrap">{text("ui.setup.maskedHelp", view.locale)}</Text>
        </Box>,
      ),
      step(
        els,
        3,
        text("ui.setup.connection", view.locale),
        connected,
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={UI_DESIGN.space.sm} flexWrap="wrap">
            <Button key="validate" label={`${text(typed ? "ui.setup.testSave" : "ui.setup.testConnection", view.locale)} (v)`} hotkey="v" onPress={() => act.validate()} />
            {saved && view.key.source === "plugin" ? <Button key="forget" label={`${text("ui.setup.removeKey", view.locale)} (f)`} hotkey="f" onPress={() => act.forgetKey()} /> : null}
          </Box>
          {message ? (
            <Text bold color={view.setup.busy ? INK.dim : view.setup.isOk ? INK.route : INK.fail} wrap="truncate">
              {`${view.setup.busy ? "◌" : view.setup.isOk ? GLYPH.on : GLYPH.fail} ${message}`}
            </Text>
          ) : null}
        </Box>,
      ),
      <Box marginTop={UI_DESIGN.space.xs}>
        <Text color={INK.pass} wrap="wrap">{text("ui.setup.privacy", view.locale)}</Text>
      </Box>,
    ],
    { width: view.width, ...(connected ? { rule: INK.route } : {}) },
  );
}

/**
 * The AI screen: everything that changes which model runs, how it runs or what is sent to it. Jev's switch and
 * provider, then the features and preferences that reach the model; orchestration has its own tab.
 */
export function aiView(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Box flexDirection="column">
        <Text color={INK.dim} wrap="wrap">{text("ui.setup.intro", view.locale)}</Text>
        {!view.routing ? <Text color={INK.pass} wrap="wrap">{text("ui.configuration.routingOff", view.locale)}</Text> : null}
        <Box flexDirection="row">{routingButton(els, view, act)}</Box>
      </Box>
      {providerCard(els, view, act)}
      {featurePanel(els, view, act, true)}
    </Box>
  );
}

/** The Orchestration screen: the orchestration card as it was on the AI screen; a fresh policy until the store is read. */
export function orchestrationView(els: Els, view: View, act: Actions) {
  return orchestrationCard(els, view, view.orchestration ?? { policy: defaultPolicy(), draft: "", batches: [] }, act);
}

const profileText = (profile: { model?: string; effort?: string } | undefined, locale: Locale) =>
  profile?.model ? `${MODEL_LABEL[profile.model as keyof typeof MODEL_LABEL] ?? modelName(profile.model)} ${profile.effort ?? text("ui.orch.unknown", locale)}` : text("ui.orch.unknown", locale);

const fixedModelOptions = (locale: Locale) =>
  CLAUDE_MODELS.map((id) => ({ value: id, label: `${text("ui.orch.fixed", locale)}: ${MODEL_LABEL[id]}` }));

/** One role's model and effort: AUTO with its allowlist, or one fixed value. */
function roleRows(els: Els, view: View, policy: OrchestrationPolicy, role: Role, act: Actions) {
  const { Box, Text, Button, Select } = els;
  const locale = view.locale;
  const setting = policy.roles[role];
  const chip = (on: boolean, label: string, line: string, key: string) => (
    <Button key={key} label={`${on ? GLYPH.ok : GLYPH.leader} ${label}`} plain dimColor={!on} onPress={() => act.orchestration(line)} />
  );
  return (
    <Box flexDirection="column" key={"role-" + role}>
      <Text bold color={INK.ink} wrap="wrap">{text(`ui.orch.role.${role}` as LocaleKey, locale)}</Text>
      <Text color={INK.faint} wrap="wrap">{text(`ui.orch.role.${role}.purpose` as LocaleKey, locale)}</Text>
      <Select
        key={`model-${role}`}
        label={text("ui.orch.model", locale)}
        value={setting.model.mode === "auto" ? "auto" : setting.model.fixed}
        options={[{ value: "auto", label: text("ui.orch.auto", locale) }, ...fixedModelOptions(locale)]}
        onSelect={(value) => act.orchestration(value === "auto" ? `role ${role} model auto` : `role ${role} model fixed ${value}`)}
      />
      {setting.model.mode === "auto" ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
          {CLAUDE_MODELS.map((id) => chip(setting.model.allowed.includes(id), MODEL_LABEL[id], `role ${role} model allow ${id}`, `allow-${role}-${id}`))}
        </Box>
      ) : null}
      <Select
        key={`effort-${role}`}
        label={text("ui.orch.effort", locale)}
        value={setting.effort.mode === "auto" ? "auto" : setting.effort.fixed}
        options={[{ value: "auto", label: text("ui.orch.auto", locale) }, ...PROFILE_EFFORTS.map((level) => ({ value: level, label: `${text("ui.orch.fixed", locale)}: ${level}` }))]}
        onSelect={(value) => act.orchestration(value === "auto" ? `role ${role} effort auto` : `role ${role} effort fixed ${value}`)}
      />
      {setting.effort.mode === "auto" ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
          {PROFILE_EFFORTS.map((level) => chip(setting.effort.allowed.includes(level), level, `role ${role} effort allow ${level}`, `allow-${role}-${level}`))}
        </Box>
      ) : null}
      {setting.model.fallback.length || setting.effort.fallback.length ? (
        <Text color={INK.faint} wrap="wrap">{text("ui.orch.fallback", locale, { models: setting.model.fallback.map((id) => MODEL_LABEL[id]).join(", ") || "–", efforts: setting.effort.fallback.join(", ") || "–" })}</Text>
      ) : null}
      {policy.override[role] ? <Text color={INK.pass} wrap="wrap">{text("ui.orch.override", locale, { value: profileText(policy.override[role], locale) })}</Text> : null}
    </Box>
  );
}

/** The advisor switch cycles AUTO → always on → off → AUTO. */
const ADVICE_NEXT = { auto: "on", on: "off", off: "auto" } as const;

/** The AI tab's orchestration card: roles, switches, limits, the live objective and batches. */
function orchestrationCard(els: Els, view: View, orch: OrchestrationView, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const locale = view.locale;
  const policy = orch.policy;
  const toggle = (on: boolean, label: string, line: string, key: string) => toggleButton(els, key, on, label, () => act.orchestration(line));
  const objective = orch.objective;
  const limits = policy.limits;
  const nativeValue = policy.nativeAdvisor.mode === "fixed" ? policy.nativeAdvisor.model : policy.nativeAdvisor.mode;
  return card(els, text("ui.orch.title", locale), [
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm} key="orch-switches">
      {toggle(policy.enabled, text(policy.enabled ? "ui.orch.on" : "ui.orch.off", locale), policy.enabled ? "off" : "on", "orch-enabled")}
      {toggle(policy.review, text("ui.orch.review", locale), policy.review ? "review off" : "review on", "orch-review")}
      {toggle(policy.advice !== "off", text(`ui.orch.advice.${policy.advice}`, locale), `advice ${ADVICE_NEXT[policy.advice]}`, "orch-advice")}
      {toggle(policy.batch === "auto", text("ui.orch.batch", locale), policy.batch === "auto" ? "batch off" : "batch auto", "orch-batch")}
    </Box>,
    <Text color={INK.faint} wrap="wrap" key="orch-intro">{text("ui.orch.intro", locale, { revision: formatNumber(policy.revision, locale) })}</Text>,
    ...(policy.review ? [] : [<Text color={INK.fail} wrap="wrap" key="orch-review-off">{text("ui.orch.reviewOff", locale)}</Text>]),
    grid(els, view.width - 4, ROLES.map((role) => (width: number) => <Box width={width} flexShrink={0} key={"cell-" + role}>{roleRows(els, view, policy, role, act)}</Box>), 30, 3),
    <Box flexDirection="column" key="orch-native" marginTop={UI_DESIGN.space.xs}>
      <Select
        key="native-advisor"
        label={text("ui.orch.nativeLabel", locale)}
        value={nativeValue}
        options={[
          { value: "off", label: text("ui.orch.nativeOff", locale) },
          { value: "auto", label: text("ui.orch.nativeAuto", locale) },
          ...fixedModelOptions(locale),
        ]}
        onSelect={(value) => act.orchestration(value === "off" || value === "auto" ? `native ${value}` : `native fixed ${value}`)}
      />
      <Text color={INK.faint} wrap="wrap">{text("ui.orch.nativeNote", locale)}</Text>
      {policy.nativeAdvisor.mode !== "off" ? <Text color={INK.pass} wrap="wrap">{text("ui.orch.nativeHeld", locale)}</Text> : null}
    </Box>,
    <Text color={INK.dim} wrap="wrap" key="orch-limits">{text("ui.orch.limits", locale, {
      workers: limits.workers, reviewers: limits.reviewers, calls: limits.activeCalls, units: limits.units,
      advice: limits.adviceCalls, repairs: limits.repairRounds, reviews: limits.reviewPasses, turns: limits.workerTurns,
      timeout: formatNumber(Math.round(limits.callTimeoutMs / 1000), locale),
    })}</Text>,
    <Input
      key="orch-command"
      value={orch.draft}
      placeholder={text("ui.orch.commandPlaceholder", locale, { ...MODEL_TEXT_VALUES, ...EFFORT_TEXT_VALUES })}
      submitLabel={text("ui.orch.commandSubmit", locale)}
      onInput={(value) => act.orchestrationType(value)}
      onSubmit={(value) => act.orchestrationSubmit(value)}
    />,
    orch.message ? <Text key="orch-message" color={orch.message.ok ? INK.route : INK.fail} wrap="wrap">{orch.message.text}</Text> : null,
    <Box flexDirection="column" key="orch-objective" marginTop={UI_DESIGN.space.xs}>
      <Text bold color={INK.ink}>{text("ui.orch.objective", locale)}</Text>
      {objective ? (
        <Box flexDirection="column">
          <Text color={INK.dim} wrap="wrap">{text("ui.orch.objectiveLine", locale, { id: objective.id, mode: objective.workMode, revision: formatNumber(objective.revision, locale) })}</Text>
          <Text wrap="wrap">{text("ui.orch.requested", locale, { value: objective.requested ? profileText(objective.requested, locale) : text("ui.orch.nativeRequest", locale) + (objective.why ? ` (${objective.why})` : "") })}</Text>
          <Text wrap="wrap">{text("ui.orch.applied", locale, { value: objective.applied ? profileText(objective.applied, locale) : text("ui.orch.unknown", locale) })}</Text>
          <Text wrap="wrap">{text("ui.orch.observed", locale, { value: objective.observed?.model ? `${modelName(objective.observed.model)} · ${text("ui.orch.effortUnknown", locale)}` : text("ui.orch.unknown", locale) })}</Text>
          <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
            <Button key="orch-apply" label={text(objective.applyPending ? "ui.orch.applyPending" : "ui.orch.apply", locale)} plain dimColor={objective.applyPending === true} onPress={() => act.orchestration("apply")} />
            <Button key="orch-end" label={text("ui.orch.end", locale)} plain onPress={() => act.orchestration("end")} />
          </Box>
        </Box>
      ) : <Text color={INK.faint} wrap="wrap">{text("ui.orch.noObjective", locale)}</Text>}
    </Box>,
    ...(orch.batches.length ? [
      <Box flexDirection="column" key="orch-batches" marginTop={UI_DESIGN.space.xs}>
        <Text bold color={INK.ink}>{text("ui.orch.batches", locale)}</Text>
        {orch.batches.map((b) => (
          <Box flexDirection="row" columnGap={UI_DESIGN.space.sm} key={"batch-" + b.id}>
            <Text color={b.verified ? INK.route : INK.pass} wrap="truncate">{text("ui.orch.batchLine", locale, { id: b.id, approved: b.approved, total: b.total, integration: b.integration, state: text(b.verified ? "ui.orch.verified" : "ui.orch.unverified", locale) })}</Text>
            {!b.cancelled && !b.verified ? <Button key={"cancel-" + b.id} label={text("ui.orch.cancel", locale)} plain onPress={() => act.orchestration(`cancel ${b.id}`)} /> : null}
          </Box>
        ))}
      </Box>,
    ] : []),
  ], { width: view.width, ...(policy.enabled ? { rule: INK.route } : {}), note: text("ui.orch.note", locale) });
}

/**
 * The Deck screen: every /deck command as a control, in cards, each with the command it runs beneath it. A
 * control sends its command line through act.deck, so the screen and the slash command are one code path.
 */
export function deckView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const { locale, deck } = view;
  if (!deck) return <Text color={INK.faint} wrap="wrap">{text("ui.deck.intro", locale)}</Text>;
  const { settings } = deck;
  const toggle = (key: string, on: boolean, label: string, command: string) => toggleButton(els, key, on, label, () => act.deck(`${command} ${on ? "off" : "on"}`));
  const choices = <T extends string,>(names: Readonly<Record<T, string>>, list: readonly T[]) => list.map((value) => ({ value, label: names[value] }));
  const verb = deck.note?.verb;
  const noteGroup = !verb ? undefined
    : ["expand", "collapse", "style", "collapsed", "size"].includes(verb) ? "ui.deck.band"
    : verb === "all" || (SECTIONS as readonly string[]).includes(verb) ? "ui.deck.show"
    : ["auto", "sound", "quiet", "cost"].includes(verb) ? "ui.deck.extras"
    : verb === "city" ? "ui.deck.city"
    : ["panel", "demo", "clear"].includes(verb) ? "ui.deck.tools"
    : "ui.deck.status";
  const groups: [LocaleKey, RenderChildren][] = [
    ["ui.deck.band", <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {toggleButton(els, "deck-band", deck.open, text(deck.open ? "ui.deck.bandOpen" : "ui.deck.bandShut", locale, { hotkey: "e" }), () => act.deck(deck.open ? "collapse" : "expand"), "e")}
      <Box flexDirection="column">
        <Text color={INK.dim}>{text("ui.deck.look", locale)}</Text>
        <Select key="deck-look" value={settings.collapsed} options={COLLAPSED.map((value) => ({ value, label: text(`ui.deck.look.${value}`, locale) }))} onSelect={(value) => act.deck(`collapsed ${value}`)} />
      </Box>
      <Select key="deck-size" label={text("ui.deck.size", locale)} value={settings.size} options={SIZES.map((value) => ({ value, label: text(`ui.deck.size.${value}`, locale) }))} onSelect={(value) => act.deck(`size ${value}`)} />
      <Select key="deck-style-cli" label={text("ui.deck.styleCli", locale)} value={settings.style.terminal} options={choices(TERMINAL_STYLE_NAMES, TERMINAL_STYLES)} onSelect={(value) => act.deckStyle("terminal", value)} />
      <Select key="deck-style-desktop" label={text("ui.deck.styleDesktop", locale)} value={settings.style.desktop} options={choices(DESKTOP_STYLE_NAMES, DESKTOP_STYLES)} onSelect={(value) => act.deckStyle("desktop", value)} />
      <Button key="deck-style-pick" plain label={text("ui.deck.stylePick", locale, { hotkey: "s" })} hotkey="s" onPress={() => act.deck("style")} />
    </Box>],
    ["ui.deck.show", <Box flexDirection="column">
      {SECTIONS.map((id) => toggle(`deck-show-${id}`, settings.show[id], text(`deck.section.${id}`, locale), id))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm} marginTop={UI_DESIGN.space.xs}>
        <Button key="deck-all-on" plain label={text("ui.deck.showAll", locale)} onPress={() => act.deck("all on")} />
        <Button key="deck-all-off" plain label={text("ui.deck.hideAll", locale)} dimColor onPress={() => act.deck("all off")} />
      </Box>
    </Box>],
    ["ui.deck.extras", <Box flexDirection="column">
      {toggle("deck-auto", settings.auto, text("ui.deck.auto", locale), "auto")}
      {toggle("deck-sound", settings.sound, text("ui.deck.sound", locale), "sound")}
      {toggle("deck-quiet", settings.quiet, text("ui.deck.quiet", locale), "quiet")}
      {toggle("deck-cost", settings.cost, text("ui.deck.cost", locale), "cost")}
    </Box>],
    ["ui.deck.city", <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Text color={INK.dim} wrap="wrap">{settings.city ? text("ui.deck.cityNow", locale, { city: settings.city.name }) : text("ui.deck.cityNone", locale)}</Text>
      <Input key="deck-city" value={deck.draft} placeholder={text("ui.deck.cityPlaceholder", locale)} submitLabel={text("ui.deck.citySet", locale)} onInput={(value) => act.deckType(value)} onSubmit={(value) => act.deckCity(value)} />
    </Box>],
    ["ui.deck.tools", <Box flexDirection="column">
      <Button key="deck-panel-open" plain label={text("ui.deck.panelOpen", locale, { hotkey: "p" })} hotkey="p" onPress={() => act.deck("panel")} />
      <Button key="deck-panel-close" plain label={text("ui.deck.panelClose", locale)} onPress={() => act.deck("panel off")} />
      <Button key="deck-demo" plain label={text("ui.deck.demo", locale)} onPress={() => act.deck("demo")} />
      <Button key="deck-clear" plain label={text("ui.deck.clear", locale)} onPress={() => act.deck("clear")} />
    </Box>],
    ["ui.deck.status", <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Text color={INK.dim} wrap="wrap">{deck.status}</Text>
      <Text color={INK.faint}>{text("deck.reply.version", locale, { version: deck.version })}</Text>
    </Box>],
  ];
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {stack(els, groups.map(([title, body]) => card(els, text(title, locale), <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
        {body}
        {deck.note && noteGroup === title ? <Text color={INK.route} wrap="wrap">{deck.note.text}</Text> : null}
      </Box>, { width: view.width })))}
    </Box>
  );
}
