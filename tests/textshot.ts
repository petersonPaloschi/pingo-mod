// Text screenshots of drawn trees (`ui.drawn()`): Box/Text flex layout into a monospace grid, colors
// dropped. A rough approximation of the terminal, good enough to compare a screen before and after a
// change; scripts/screens.ts runs the scenes in tests/screens.snap.tsx through it. Not a test file.
import { displayWidth } from "../hooks/layout.ts";

type El = { type?: string; props?: Record<string, any>; children?: unknown[] };

const kids = (n: El): unknown[] => {
  const c = n.children && [n.children].flat(Infinity).length ? n.children : (n.props?.children === undefined ? [] : [n.props.children]);
  return [c].flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== true);
};

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function unb64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return new Uint8Array(out);
}

/** Set by shot(): draw rasters as a blank block of their size instead of their cells. */
let maskRasters = false;

function raster(p: Record<string, any>): string[] {
  const cols = Number(p.columns ?? 0), rows = Number(p.rows ?? 0);
  if (maskRasters) return Array.from({ length: rows }, (_, r) => (r === 0 ? cut(`[raster ${cols}×${rows}]`, cols) : "").padEnd(cols, "░"));
  const lines: string[] = [];
  try {
    const bytes = unb64(String(p.cells ?? ""));
    const u = new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
    for (let r = 0; r < rows; r++) {
      let line = "";
      for (let c = 0; c < cols; c++) {
        const cp = u[(r * cols + c) * 3] ?? 32;
        line += cp ? String.fromCodePoint(cp) : " ";
      }
      lines.push(line);
    }
  } catch {
    for (let r = 0; r < rows; r++) lines.push("▒".repeat(cols));
  }
  return lines;
}

const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - displayWidth(s)));

function cut(s: string, w: number): string {
  if (displayWidth(s) <= w) return s;
  let out = "";
  for (const ch of s) {
    if (displayWidth(out + ch) > w - 1) break;
    out += ch;
  }
  return out + "…";
}

function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/(?<= )/)) {
      if (displayWidth(line + word.trimEnd()) <= w) { line += word; continue; }
      if (line) out.push(line.trimEnd());
      let rest = word;
      while (displayWidth(rest.trimEnd()) > w) {
        let chunk = "";
        for (const ch of rest) { if (displayWidth(chunk + ch) > w) break; chunk += ch; }
        out.push(chunk);
        rest = rest.slice(chunk.length);
      }
      line = rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}

function inline(n: unknown): string {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (!n || typeof n !== "object") return "";
  const e = n as El;
  if (e.type === "Button") return buttonText(e);
  const s = kids(e).map(inline).join("");
  // a colored ground is lost in text: show blank cells on a ground as shaded blocks
  return e.props?.backgroundColor ? s.replace(/ /g, "▒") : s;
}

function buttonText(e: El): string {
  const p = e.props ?? {};
  // children are drawn in the label's place, as the terminal draws them; the label then only names the control
  const children = kids(e);
  const label = children.length ? children.map(inline).join("") : typeof p.label === "string" ? p.label : "";
  const hk = p.hotkey ? ` ‹${p.hotkey}›` : "";
  return p.plain ? `${label}${hk}` : `[ ${label} ]${hk}`;
}

const BORDERS: Record<string, string> = { round: "╭╮╰╯─│", single: "┌┐└┘─│", bold: "┏┓┗┛━┃", double: "╔╗╚╝═║", classic: "++++-|" };

function natural(n: unknown): number {
  if (typeof n === "string" || typeof n === "number") return Math.max(0, ...String(n).split("\n").map(displayWidth));
  const e = n as El;
  if (e && typeof e === "object" && e.type === "Text") return Math.max(0, ...inline(e).split("\n").map(displayWidth));
  if (e && typeof e === "object" && e.type === "Button") return displayWidth(buttonText(e));
  return Math.max(0, ...render(n, 400).map((l) => displayWidth(l.trimEnd())));
}

export function render(n: unknown, w: number): string[] {
  w = Math.max(1, w);
  if (typeof n === "string" || typeof n === "number") return wrap(String(n), w);
  if (!n || typeof n !== "object") return [];
  if (Array.isArray(n)) return n.flatMap((c) => render(c, w));
  const e = n as El;
  const p = e.props ?? {};
  switch (e.type) {
    case "Text": {
      const s = inline(e);
      return String(p.wrap ?? "wrap").startsWith("truncate") ? s.split("\n").map((l) => cut(l, w)) : wrap(s, w);
    }
    case "Button": return wrap(buttonText(e), w);
    case "Select": {
      const opts = (p.options ?? []) as { value: string; label: string }[];
      const sel = opts.find((o) => o.value === p.value) ?? opts[0];
      return [cut(`${p.label ? p.label + ": " : ""}${sel?.label ?? ""} ▾`, w)];
    }
    case "Input": return [cut(`${p.label ? p.label + ": " : ""}[${p.value || p.placeholder || ""}]${p.submitLabel ? " " + p.submitLabel : ""}`, w)];
    case "Raster": return raster(p);
    case "Svg": return [cut(`[svg${p.alt ? ": " + p.alt : ""}]`, w)];
    case "Box": return box(e, w);
    default: return kids(e).flatMap((c) => render(c, w));
  }
}

function box(e: El, avail: number): string[] {
  const p = e.props ?? {};
  if (p.display === "none") return [];
  const ml = Number(p.marginLeft ?? p.marginX ?? p.margin ?? 0);
  const mr = Number(p.marginRight ?? p.marginX ?? p.margin ?? 0);
  let w = avail - ml - mr;
  if (typeof p.width === "number") w = Math.min(w, p.width);
  const b = p.borderStyle ? BORDERS[p.borderStyle] ?? BORDERS.round! : null;
  const px = Number(p.paddingX ?? p.padding ?? 0);
  const pl = Number(p.paddingLeft ?? px), pr = Number(p.paddingRight ?? px);
  const inner = Math.max(1, w - (b ? 2 : 0) - pl - pr);
  const dir = String(p.flexDirection ?? "row");
  const all = kids(e);
  const isAbs = (c: unknown) => (c as El)?.props?.position === "absolute";
  const children = all.filter((c) => !isAbs(c));
  const absolute = all.filter(isAbs);
  let body: string[];
  if (dir.startsWith("column")) {
    const gap = Number(p.rowGap ?? p.gap ?? 0);
    body = [];
    children.forEach((c, i) => {
      if (i && gap) for (let g = 0; g < gap; g++) body.push("");
      const ce = c as El;
      const mt = Number(ce?.props?.marginTop ?? ce?.props?.marginY ?? 0), mb = Number(ce?.props?.marginBottom ?? ce?.props?.marginY ?? 0);
      for (let g = 0; g < mt; g++) body.push("");
      let lines = render(c, inner);
      if (p.alignItems === "center") {
        const nw = Math.max(0, ...lines.map((l) => displayWidth(l.trimEnd())));
        const off = Math.max(0, Math.floor((inner - nw) / 2));
        lines = lines.map((l) => " ".repeat(off) + l);
      }
      body.push(...lines);
      for (let g = 0; g < mb; g++) body.push("");
    });
  } else {
    body = row(children, inner, p);
  }
  if (typeof p.height === "number") {
    const h = p.height - (b ? 2 : 0);
    body = body.slice(0, h);
    while (body.length < h) body.push("");
  }
  const py = Number(p.paddingY ?? p.padding ?? 0);
  const pt = Number(p.paddingTop ?? py), pb = Number(p.paddingBottom ?? py);
  body = [...Array(pt).fill(""), ...body, ...Array(pb).fill("")];
  const lines = body.map((l) => " ".repeat(pl) + pad(l, inner) + " ".repeat(pr));
  for (const a of absolute as El[]) {
    const ap = a.props ?? {};
    const top = Number(ap.top ?? 0), left = Number(ap.left ?? 0);
    const height = ap.bottom !== undefined ? Math.max(0, lines.length - top - Number(ap.bottom)) : Infinity;
    const drawn = render(a, typeof ap.width === "number" ? ap.width : inner).slice(0, height);
    drawn.forEach((d, r) => {
      const at = top + r;
      if (at >= lines.length) return;
      const chars = [...lines[at]!];
      [...d.trimEnd()].forEach((ch, k) => { if (left + k < chars.length) chars[left + k] = ch; });
      lines[at] = chars.join("");
    });
  }
  const framed = b
    ? [b[0] + b[4]!.repeat(inner + pl + pr) + b[1], ...lines.map((l) => b[5] + l + b[5]), b[2] + b[4]!.repeat(inner + pl + pr) + b[3]]
    : lines;
  return framed.map((l) => " ".repeat(ml) + l);
}

function row(children: unknown[], inner: number, p: Record<string, any>): string[] {
  const gap = Number(p.columnGap ?? p.gap ?? 0);
  const fixed = (c: unknown) => {
    const ce = c as El;
    if (typeof ce?.props?.width === "number") return ce.props.width + Number(ce.props.marginLeft ?? 0);
    if (ce?.type === "Raster") return Number(ce.props?.columns ?? 0);
    return undefined;
  };
  const nat = children.map((c) => fixed(c) ?? natural(c));
  const lines: number[][] = [];
  if (p.flexWrap === "wrap") {
    let cur: number[] = [], used = 0;
    nat.forEach((nw, i) => {
      const width = Math.min(nw, inner);
      if (cur.length && used + gap + width > inner) { lines.push(cur); cur = []; used = 0; }
      used += (cur.length ? gap : 0) + width;
      cur.push(i);
    });
    if (cur.length) lines.push(cur);
  } else lines.push(children.map((_, i) => i));
  const rowGap = Number(p.rowGap ?? p.gap ?? 0);
  const out: string[] = [];
  lines.forEach((idx, li) => {
    if (li && rowGap) for (let g = 0; g < rowGap; g++) out.push("");
    const widths = idx.map((i) => Math.min(nat[i]!, inner));
    const total = () => widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, idx.length - 1);
    let over = total() - inner;
    if (over > 0) {
      const shrinkable = idx.map((i, k) => ((children[i] as El)?.props?.flexShrink === 0 || fixed(children[i]) !== undefined ? 0 : widths[k]!));
      const sum = shrinkable.reduce((a, b) => a + b, 0) || 1;
      idx.forEach((_, k) => { widths[k] = Math.max(1, widths[k]! - Math.ceil((over * shrinkable[k]!) / sum)); });
    }
    let free = inner - total();
    const grow = idx.map((i) => Number((children[i] as El)?.props?.flexGrow ?? 0));
    const gsum = grow.reduce((a, b) => a + b, 0);
    if (free > 0 && gsum > 0) idx.forEach((_, k) => { widths[k]! += Math.floor((free * grow[k]!) / gsum); });
    free = inner - total();
    let between = gap;
    let lead = 0;
    if (free > 0 && p.justifyContent === "space-between" && idx.length > 1) between = gap + Math.floor(free / (idx.length - 1));
    if (free > 0 && p.justifyContent === "flex-end") lead = free;
    if (free > 0 && p.justifyContent === "center") lead = Math.floor(free / 2);
    const cols = idx.map((i, k) => render(children[i], widths[k]!));
    const h = Math.max(0, ...cols.map((c) => c.length));
    for (let r = 0; r < h; r++) out.push(" ".repeat(lead) + cols.map((c, k) => pad(c[r] ?? "", widths[k]!)).join(" ".repeat(between)));
  });
  return out;
}

/**
 * The tree as text, `width` columns wide. `rasters: "mask"` keeps each Raster's size but not its
 * cells: the pet's frames are drawn at random, so two captures of the same code would differ.
 */
export function shot(tree: unknown, width: number, options: { rasters?: "draw" | "mask" } = {}): string {
  maskRasters = options.rasters === "mask";
  try {
    return render(tree, width).map((l) => l.trimEnd()).join("\n");
  } finally {
    maskRasters = false;
  }
}
