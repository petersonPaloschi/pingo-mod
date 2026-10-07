// The pane scrolls its own body under a fixed header: the engine's window stays put (the tree is
// exactly as tall as the pane) and the body moves by its own offset. To know how far the body may
// move, its height is estimated here from the tree itself, row by row, the way the terminal lays
// it out: a column adds its children, a row takes its tallest, a text wraps at the width it has.
/** Any node of a drawn tree: an element, a string, a list, or nothing. */
type Node = unknown;
type Element = { type: string; props?: Record<string, unknown>; children?: Node[] };

const num = (value: unknown) => (typeof value === "number" ? value : 0);

// The Wide and Fullwidth blocks of East Asian Width: CJK, Hangul, kana, fullwidth forms.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18aff],
  [0x1b000, 0x1b2ff],
  [0x1f200, 0x1f2ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];
const EMOJI = /\p{Emoji_Presentation}/u;
const ZERO = /[\p{Mn}\p{Me}\p{Cc}\u200b-\u200f\u2060-\u2064\ufeff]/u;
const MODIFIER = /\p{Emoji_Modifier}/u;

/** The columns a terminal gives one character: 2 for CJK and emoji, 0 for a combining mark. */
function charWidth(ch: string): number {
  if (ZERO.test(ch)) return 0;
  const code = ch.codePointAt(0)!;
  if (code < 0x1100) return 1;
  if (EMOJI.test(ch)) return 2;
  return WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
}

/** The columns a text takes on one line of a terminal: wide characters count two, marks none. */
export function displayWidth(text: string): number {
  let width = 0;
  let joined = false;
  for (const ch of text) {
    // What a zero-width joiner or a skin tone adds is drawn inside the emoji before it.
    if (joined || (width && MODIFIER.test(ch))) {
      joined = false;
      continue;
    }
    joined = ch === "\u200d";
    width += charWidth(ch);
  }
  return width;
}

/** All the characters a Text draws, its inline children's included. */
function textOf(node: Node): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return ((node as Element).children ?? []).map(textOf).join("");
}

function flat(nodes: readonly Node[] | undefined): (Element | string)[] {
  const out: (Element | string)[] = [];
  for (const node of nodes ?? []) {
    if (node === null || node === undefined || node === false) continue;
    if (Array.isArray(node)) out.push(...flat(node));
    else out.push(node as Element | string);
  }
  return out;
}

/** A width the node fixes for itself: its width, or a picture's columns. */
function fixedWidth(node: Element | string): number | undefined {
  if (typeof node === "string") return undefined;
  if (typeof node.props?.width === "number") return node.props.width;
  return node.type === "Raster" ? num(node.props?.columns) : undefined;
}

/** How many columns a node wants on one line, for rows that share their width. */
function widthOf(node: Element | string): number {
  if (typeof node === "string") return displayWidth(node);
  const props = node.props ?? {};
  if (typeof props.width === "number") return props.width;
  if (node.type === "Text") return Math.max(...textOf(node).split("\n").map(displayWidth));
  if (node.type === "Button") return displayWidth(String(props.label ?? "")) + 4;
  if (node.type === "Raster") return num(props.columns);
  const kids = flat(node.children);
  if (props.flexDirection === "row") return kids.reduce((s, kid) => s + widthOf(kid), 0) + num(props.columnGap ?? props.gap) * Math.max(0, kids.length - 1);
  return Math.max(0, ...kids.map(widthOf));
}

/** The rows a node takes at a given width: an estimate, generous rather than short. */
export function rowsOf(node: Node, width: number): number {
  if (node === null || node === undefined || node === false) return 0;
  if (Array.isArray(node)) return node.reduce((s: number, kid: Node) => s + rowsOf(kid, width), 0);
  if (typeof node === "string") return wrapped(node, width);
  const el = node as Element;
  const props = el.props ?? {};
  if (props.display === "none" || props.position === "absolute") return 0;
  if (typeof props.height === "number") return props.height;
  switch (el.type) {
    case "Text":
      return props.wrap && props.wrap !== "wrap" ? textOf(el).split("\n").length : wrapped(textOf(el), width);
    case "Raster":
      return num(props.rows);
    case "Svg":
      return 6;
    case "Button":
    case "Input":
    case "Select":
      return 1;
    case "Box":
      break;
    default:
      return 1;
  }
  const border = props.borderStyle ? 2 : 0;
  const padX = num(props.paddingX ?? props.padding) * 2 + num(props.paddingLeft) + num(props.paddingRight);
  const padY = num(props.paddingY ?? props.padding) * 2 + num(props.paddingTop) + num(props.paddingBottom);
  const margin = num(props.marginY ?? props.margin) * 2 + num(props.marginTop) + num(props.marginBottom);
  const inner = Math.max(1, (typeof props.width === "number" ? props.width : width) - border - padX - num(props.marginLeft) - num(props.marginRight));
  const kids = flat(el.children);
  let rows: number;
  if (props.flexDirection === "row") {
    const gap = num(props.columnGap ?? props.gap);
    if (props.flexWrap === "wrap") {
      // Children laid end to end, a new line where the next one does not fit.
      let lines = kids.length ? 1 : 0;
      let used = 0;
      let tallest = 0;
      rows = 0;
      for (const kid of kids) {
        const w = Math.min(inner, widthOf(kid));
        if (used > 0 && used + gap + w > inner) {
          rows += tallest;
          lines++;
          used = 0;
          tallest = 0;
        }
        used += (used ? gap : 0) + w;
        tallest = Math.max(tallest, rowsOf(kid, w || inner));
      }
      rows += tallest + num(props.rowGap ?? props.gap) * Math.max(0, lines - 1);
    } else {
      // Fixed widths first, a picture's columns among them; whatever has none shares the rest.
      const fixed = kids.reduce((s, kid) => s + (fixedWidth(kid) ?? 0), 0);
      const free = kids.filter((kid) => fixedWidth(kid) === undefined);
      const share = Math.max(1, Math.floor((inner - fixed - gap * Math.max(0, kids.length - 1)) / Math.max(1, free.length)));
      // A lone free child (a text beside a picture) takes all the room left.
      rows = Math.max(0, ...kids.map((kid) => rowsOf(kid, fixedWidth(kid) ?? share)));
    }
  } else {
    rows = kids.reduce((s, kid) => s + rowsOf(kid, inner), 0) + num(props.rowGap ?? props.gap) * Math.max(0, kids.length - 1);
  }
  return rows + border + padY + margin;
}

function wrapped(text: string, width: number): number {
  const w = Math.max(1, width);
  return text.split("\n").reduce((s, line) => s + Math.max(1, Math.ceil(displayWidth(line) / w)), 0);
}
