import { formatClock, text, type Locale } from "../i18n.ts";
import { displayWidth } from "../layout.ts";
import { C, type Event } from "./events.ts";
import { wrap, type Line, type TrailSegment } from "./format.ts";

/** The advisor's branch: a heavy bar in its color down the lines that belong to it. */
const BRANCH = "┃";
const HEAD_LINES = 2;
const DETAIL_LINES = 3;

export function draw(title: Line, events: readonly Event[], width: number, locale: Locale): TrailSegment[][] {
  const times = events.map((event) => formatClock(event.at, locale));
  const timeWidth = Math.max(0, ...times.map(displayWidth));
  // Narrow panes drop the time column before they drop the sentence.
  const timed = width - timeWidth - 3 >= 18;
  const lead = timed ? timeWidth + 1 : 0;
  const room = Math.max(1, width - lead - 2);
  const pad = (value: string) => value + " ".repeat(Math.max(0, timeWidth - displayWidth(value)));
  const lines: TrailSegment[][] = wrap(title.text, width, HEAD_LINES).map((line) => [{ text: line, color: title.color, bold: true }]);
  events.forEach((event, index) => {
    const bar = event.branch ? { text: BRANCH, color: C.amber } : { text: " ", color: C.rule };
    const blank = timed ? [{ text: " ".repeat(lead), color: C.dim }] : [];
    const tag = event.agent ? text("trail.agent.tag", locale, { agent: event.agent }) : "";
    wrap(`${tag}${event.head}`, room, HEAD_LINES).forEach((line, i) => {
      lines.push(i === 0
        ? [...(timed ? [{ text: `${pad(times[index]!)} `, color: C.dim }] : []), { text: event.glyph, color: event.color, bold: true }, { text: ` ${line}`, color: event.branch ? C.amber : C.ink, bold: event.bold ?? false }]
        : [...blank, bar, { text: ` ${line}`, color: event.branch ? C.amber : C.ink, bold: event.bold ?? false }]);
    });
    for (const detail of event.details) {
      for (const line of wrap(detail.text, room, DETAIL_LINES)) lines.push([...blank, bar, { text: ` ${line}`, color: detail.color, bold: detail.bold ?? false }]);
    }
  });
  return lines;
}

/** The Flow tab's lines: a message still entering, then each kept request, newest first. */
