import { text, type LocaleOption } from "../../i18n.ts";
import { UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import type { Els, View, Actions } from "../types.ts";
import { card, GUTTER } from "../shared.tsx";

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
