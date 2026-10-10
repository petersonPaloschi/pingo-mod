import { expect, test } from "claude-code/testing";

import { DEFAULT_FEATURES } from "../hooks/core/plan.ts";
import { renderDeck, type DeckBand } from "../hooks/deck/band.tsx";
import { createPet } from "../hooks/deck/pet.ts";
import { DEFAULT_SETTINGS } from "../hooks/deck/settings.ts";
import { features as featureList } from "../hooks/feed.ts";
import { text as say } from "../hooks/i18n.ts";
import { displayWidth, rowsOf } from "../hooks/layout.ts";
import { emptyTrace } from "../hooks/trace.ts";
import { renderPane, type Actions, type Els, type View } from "../hooks/ui.tsx";
import { en } from "../hooks/strings/en.ts";

const widths = [40, 60, 80, 100, 120, 160] as const;
const tabs = ["overview", "live", "models", "agents", "logs", "features", "configuration", "deck", "ai"] as const;
const features = Object.fromEntries(Object.keys(DEFAULT_FEATURES).map((id) => [id, true])) as typeof DEFAULT_FEATURES;
const preferences = {
  assumptionScope: "all",
  plainLevel: "beginner",
  plainReview: true,
  plainSound: true,
  petHat: "random",
  petShades: false,
  designSurface: "auto",
  ideaNudges: true,
  promptLearning: true,
  monitorEveryMs: 5000,
  trackerSummary: false,
  clashMinutes: 30,
} as const;
const prefixes = [...new Set(Object.keys(en).map((key) => key.split(".")[0]!))];
const rawLocaleKey = new RegExp(`(?<![\\w/.-])(?:${prefixes.join("|")})\\.[A-Za-z]\\w*(?:\\.\\w+)*`);

function element(tag: string) {
  return (props: Record<string, unknown>, ...children: unknown[]) => ({ type: tag, props, children: props.children ?? children });
}

const els = Object.fromEntries(["Box", "Text", "Button", "Select", "Input", "Raster", "Svg"].map((tag) => [tag, element(tag)])) as unknown as Els;

type Element = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const childrenOf = (node: Element): unknown[] => node.children ?? (Array.isArray(node.props?.children) ? node.props.children as unknown[] : node.props?.children === undefined ? [] : [node.props.children]);

function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const item = node as Element;
  return [item, ...elements(childrenOf(item))];
}

function textOf(node: unknown): string[] {
  if (node === null || node === undefined || node === false) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  const item = node as Element;
  const own = ["label", "alt", "placeholder", "submitLabel"].map((key) => item.props?.[key]).filter((value): value is string => typeof value === "string");
  return [...own, ...textOf(childrenOf(item))];
}

function content(node: unknown): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join("");
  const item = node as Element;
  return content(childrenOf(item));
}

function naturalWidth(node: unknown): number {
  if (node === null || node === undefined || node === false) return 0;
  if (typeof node === "string" || typeof node === "number") return displayWidth(String(node));
  if (Array.isArray(node)) return Math.max(0, ...node.map(naturalWidth));
  const item = node as Element;
  const props = item.props ?? {};
  const label = typeof props.label === "string" ? props.label : content(childrenOf(item));
  if (item.type === "Button") return displayWidth(label) + (props.plain ? (props.hotkey ? 3 : 0) : 4);
  if (item.type === "Select") {
    const options = Array.isArray(props.options) ? props.options as { value?: string; label?: string }[] : [];
    const value = typeof props.value === "string" ? props.value : "";
    const selected = options.find((option) => option.value === value) ?? options[0];
    return displayWidth(`${props.label ? `${props.label}: ` : ""}${selected?.label ?? ""}`) + 2;
  }
  if (item.type === "Input") {
    const caption = typeof props.label === "string" ? props.label : "";
    const entry = typeof props.value === "string" ? props.value : typeof props.placeholder === "string" ? props.placeholder : "";
    const submit = typeof props.submitLabel === "string" ? props.submitLabel : "";
    return displayWidth(`${caption}${caption ? ": " : ""}${entry}${submit ? ` ${submit}` : ""}`);
  }
  if (item.type === "Raster") return Number(props.columns ?? 0);
  if (typeof props.width === "number") return props.width;
  if (item.type === "Text") return Math.max(...content(childrenOf(item)).split("\n").map(displayWidth));
  const kids = childrenOf(item);
  const gap = Number(props.columnGap ?? props.gap ?? 0);
  return props.flexDirection === "row"
    ? kids.reduce<number>((sum, child) => sum + naturalWidth(child), 0) + Math.max(0, kids.length - 1) * gap
    : Math.max(0, ...kids.map(naturalWidth));
}

async function fitControls(node: unknown, available: number, location: string, invoke: () => void): Promise<void> {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) {
    for (const child of node) await fitControls(child, available, location, invoke);
    return;
  }
  if (typeof node !== "object") return;
  const item = node as Element;
  const props = item.props ?? {};
  const ownWidth = typeof props.width === "number" ? props.width : available;
  if (ownWidth > available) throw new Error(`${location}: ${item.type} width ${ownWidth} exceeds parent ${available}`);
  const controlWidth = ["Button", "Select", "Input"].includes(item.type ?? "") ? naturalWidth(item) : 0;
  if (controlWidth && controlWidth > available) {
    const label = typeof props.label === "string" ? props.label : content(childrenOf(item));
    throw new Error(`${location}: ${item.type} “${label}” needs ${controlWidth} columns in a ${available}-column cell`);
  }
  if (item.type === "Button") {
    const onPress = props.onPress;
    if (typeof onPress !== "function") throw new Error(`${location}: button “${String(props.label ?? content(childrenOf(item)))}” has no onPress handler`);
    invoke();
    await (onPress as () => unknown)();
    return;
  }
  if (item.type === "Select") {
    const onSelect = props.onSelect;
    if (typeof onSelect !== "function") throw new Error(`${location}: select “${String(props.label ?? "")}" has no onSelect handler`);
    invoke();
    const options = Array.isArray(props.options) ? props.options as { value?: string }[] : [];
    await (onSelect as (value: string, event: never) => unknown)(String(options[0]?.value ?? props.value ?? ""), {} as never);
    return;
  }
  if (item.type === "Input") {
    const onInput = props.onInput;
    const onSubmit = props.onSubmit;
    if (typeof onInput !== "function" && typeof onSubmit !== "function") throw new Error(`${location}: input “${String(props.label ?? "")}" has no input handler`);
    const value = String(props.value ?? "");
    if (typeof onInput === "function") await (onInput as (value: string) => unknown)(value);
    if (typeof onSubmit === "function") await (onSubmit as (value: string) => unknown)(value);
    invoke();
    return;
  }
  if (item.type !== "Box") {
    for (const child of childrenOf(item)) await fitControls(child, available, location, invoke);
    return;
  }
  const border = props.borderStyle ? 2 : 0;
  const padding = 2 * Number(props.paddingX ?? props.padding ?? 0) + Number(props.paddingLeft ?? 0) + Number(props.paddingRight ?? 0);
  const inner = Math.max(1, ownWidth - border - padding - Number(props.marginLeft ?? 0) - Number(props.marginRight ?? 0));
  const children = childrenOf(item).filter((child) => child !== null && child !== undefined && child !== false);
  const gap = Number(props.columnGap ?? props.gap ?? 0);
  if (props.flexDirection === "row" && props.flexWrap === "wrap") {
    let used = 0;
    for (const child of children) {
      const width = Math.max(1, Math.min(inner, naturalWidth(child) || inner));
      if (used > 0 && used + gap + width > inner) used = 0;
      const space = Math.max(1, Math.min(width, inner - used - (used ? gap : 0)));
      await fitControls(child, space, location, invoke);
      used += (used ? gap : 0) + space;
    }
    return;
  }
  if (props.flexDirection === "row") {
    const fixed = children.map((child) => {
      const item = child as Element;
      if (typeof item.props?.width === "number") return Number(item.props.width);
      return item.type === "Raster" ? Number(item.props?.columns ?? 0) : 0;
    });
    const free = fixed.filter((width) => width === 0).length;
    const share = Math.max(1, Math.floor((inner - fixed.reduce((sum, width) => sum + width, 0) - gap * Math.max(0, children.length - 1)) / Math.max(1, free)));
    for (const [index, child] of children.entries()) await fitControls(child, fixed[index] || share, location, invoke);
    return;
  }
  for (const child of children) await fitControls(child, inner, location, invoke);
}

function view(width: number, tab: View["tab"], locale: View["locale"]): View {
  return {
    locale,
    localeOption: "auto",
    events: [],
    routing: true,
    tab,
    range: 0,
    setup: { provider: "typesafe", message: "", isOk: true },
    features,
    preferences,
    feed: [],
    live: {},
    now: Date.parse("2026-10-07T12:00:00Z"),
    width,
    rows: 48,
    surface: "terminal",
    meta: "",
    agents: [],
    trace: emptyTrace(),
    scroll: 0,
    fixed: false,
    key: { source: "none", tail: "", provider: "typesafe" },
    deck: null,
  } as View;
}

const act = new Proxy({}, { get: (_target, name) => name === "layout" ? () => undefined : () => undefined }) as Actions;

test("the terminal dashboard fits every tab and keeps every control actionable at common widths", async () => {
  let actions = 0;
  for (const locale of ["en", "pt"] as const) {
    for (const width of widths) {
      for (const tab of tabs) {
        const tree = renderPane(els, view(width, tab, locale), act);
        const nodes = elements(tree);
        expect(rowsOf(tree, width)).toBeGreaterThan(0);
        for (const node of nodes) {
        }
        await fitControls(tree, width, `${locale}/${width}/${tab}`, () => actions++);
        expect(textOf(tree).join("\n")).not.toMatch(rawLocaleKey);
      }
    }
  }
  expect(actions).toBeGreaterThan(0);
});

/**
 * The Deck pane with no rows yet: its header and every feature's switch, every other one off. The desktop pet is a
 * picture sized in pixels, which this column count cannot place, so the desktop pane is drawn without it.
 */
function deckPane(width: number, locale: View["locale"], pressed: string[], pet: boolean): DeckBand {
  const now = Date.parse("2026-10-07T12:00:00Z");
  return {
    rows: [],
    settings: { ...DEFAULT_SETTINGS, show: { ...DEFAULT_SETTINGS.show, pet } },
    expanded: true,
    pane: true,
    locale,
    cols: width,
    now,
    caches: { head: new Map(), strip: new Map() },
    routeHist: [],
    spend: { day: "2026-10-07", dayUsd: 0, month: "2026-10", monthUsd: 0 },
    extras: ["12:00:00"],
    pet: createPet(now),
    toggle: () => undefined,
    dismiss: () => undefined,
    foldAge: null,
    features: featureList(locale).map((one, i) => ({
      id: one.id,
      name: one.id === "agents" ? say("ui.features.agentsShort", locale) : one.name,
      on: i % 2 === 0,
    })),
    feature: (id) => void pressed.push(id),
  };
}

test("the Deck's feature switches fit whole at every width on both surfaces, and each one turns its feature", async () => {
  const terminalEls = Object.fromEntries(Object.entries(els).filter(([tag]) => tag !== "Svg")) as unknown as Els;
  const ids = Object.keys(DEFAULT_FEATURES).sort();
  for (const locale of ["en", "pt"] as const) {
    for (const width of widths) {
      for (const [surface, table] of [["terminal", terminalEls], ["desktop", els]] as const) {
        const pressed: string[] = [];
        const band = deckPane(width, locale, pressed, surface === "terminal");
        const tree = renderDeck(table, band, surface);
        // every control fits the room it is given, and pressing it acts: the switches name their own feature
        await fitControls(tree, width, `deck/${surface}/${locale}/${width}`, () => undefined);
        expect([...pressed].sort()).toEqual(ids);
        // each switch shows its state glyph and its whole name, and nothing else draws a raw string key
        const labels = elements(tree).filter((node) => node.type === "Button").map((node) => String(node.props?.label ?? ""));
        for (const sw of band.features) expect(labels).toContain(`${sw.on ? "●" : "○"} ${sw.name}`);
        expect(textOf(tree).join("\n")).not.toMatch(rawLocaleKey);
        if (surface === "terminal") {
          // the terminal packs whole lines itself, counted against its row budget: no line may need the host to wrap it
          const switchLines = elements(tree).filter((node) => {
            const kids = node.type === "Box" ? childrenOf(node).filter(Boolean) as Element[] : [];
            return kids.length > 0 && kids.every((kid) => kid.type === "Button" && /^[●○] /.test(String(kid.props?.label)));
          });
          expect(switchLines.length).toBeGreaterThan(0);
          for (const line of switchLines) expect(naturalWidth(line) + Number(line.props?.paddingLeft ?? 0)).toBeLessThanOrEqual(width);
        }
      }
    }
  }
});
