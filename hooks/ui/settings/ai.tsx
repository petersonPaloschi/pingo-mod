import { PROVIDER_IDS, PROVIDERS } from "../../core/jev.ts";
import { text, type LocaleKey } from "../../i18n.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import type { Els, View, Actions } from "../types.ts";
import { card, step, routingButton } from "../shared.tsx";
import { featurePanel } from "./features.tsx";

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
