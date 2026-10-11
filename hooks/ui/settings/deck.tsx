import type { RenderChildren } from "claude-code";
import { text, type LocaleKey } from "../../i18n.ts";
import { UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { COLLAPSED, SECTIONS, SIZES } from "../../deck/settings.ts";
import { DESKTOP_STYLE_NAMES, DESKTOP_STYLES } from "../../deck/styles-desktop.ts";
import { TERMINAL_STYLE_NAMES, TERMINAL_STYLES } from "../../deck/styles-terminal.ts";
import type { Els, View, Actions } from "../types.ts";
import { toggleButton, card, stack, section } from "../shared.tsx";

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
