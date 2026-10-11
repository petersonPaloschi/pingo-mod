import { formatNumber, text, type Locale, type LocaleKey } from "../../i18n.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { modelName } from "../../feed.ts";
import { CLAUDE_MODELS, defaultPolicy, MODEL_LABEL, PROFILE_EFFORTS, ROLES, type OrchestrationPolicy, type Role } from "../../core/orchestration.ts";
import { EFFORT_TEXT_VALUES, MODEL_TEXT_VALUES } from "../../core/contracts.ts";
import type { Els, View, OrchestrationView, Actions } from "../types.ts";
import { toggleButton, card, grid } from "../shared.tsx";

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
