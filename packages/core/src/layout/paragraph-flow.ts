// Paragraph measuring and breaking, shared between the body flow and table cells.
//
// Extracted from `semantic-layout.ts` unchanged so a cell paragraph breaks exactly like a
// body paragraph: same pieces, same word boundaries, same cache discipline. The BREAK is
// position-independent — span x offsets are relative to the paragraph origin — which is
// what lets one cached break serve the same content at any x (body or any cell).

import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core-contract/store';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import {
  DEFAULT_RUN_STYLE,
  displayText,
  resolveRunStyle,
  type ResolvedRunStyle,
} from './run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** One measurable piece of a paragraph: text carrying one property set. */
interface Piece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  /** Resolved once here, so nothing downstream re-derives it. */
  readonly style: ResolvedRunStyle;
  readonly start: number;
  readonly end: number;
}

export function propertiesOf(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    const attributes: Record<string, string> = {};
    for (const attribute of child.attributes) attributes[attribute.localName] = attribute.value;
    props.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return props;
}

/** Flatten a paragraph into measurable pieces with UTF-16 source offsets. */
function piecesOf(paragraph: OoxmlNode): Piece[] {
  if (paragraph.kind === 'textValue') return [];
  const pieces: Piece[] = [];
  let offset = 0;
  for (const child of paragraph.children) {
    if (child.kind !== 'run') continue;
    const props = propertiesOf(child.children.find((grand) => grand.kind === 'runProperties'));
    const style = resolveRunStyle(props);
    for (const grand of child.children) {
      if (grand.kind === 'runProperties') continue;
      let text = '';
      if (grand.kind === 'text') {
        for (const value of grand.children) if (value.kind === 'textValue') text += value.value;
      } else if (grand.kind === 'tab') text = '\t';
      else if (grand.kind === 'hardBreak') text = '\n';
      // Unknown content has no text projection, so it occupies no offset — the same rule
      // the ops and the binding use, which is what keeps their offsets in agreement.
      if (text.length === 0) continue;
      pieces.push({ text, props, style, start: offset, end: offset + text.length });
      offset += text.length;
    }
  }
  return pieces;
}

/** Break points inside a piece: after each run of whitespace, so words stay whole. */
function wordBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === ' ' || text[index] === '\t') boundaries.push(index + 1);
  }
  if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length);
  return boundaries;
}

export interface PendingLine {
  readonly spans: StyleSpanRecord[];
  readonly start: number;
  end: number;
  width: number;
  height: number;
  baseline: number;
}

/**
 * A cached line, safe to hand back on every later hit.
 *
 * Placement copies span boxes rather than mutating them, but a cache entry outlives the
 * layout that produced it — freezing means a future change to the placement path cannot
 * quietly corrupt every subsequent reuse.
 */
export function frozenLine(line: PendingLine): PendingLine {
  return Object.freeze({
    spans: line.spans.map((span) =>
      Object.freeze({ ...span, box: Object.freeze({ ...span.box }) })
    ),
    start: line.start,
    end: line.end,
    width: line.width,
    height: line.height,
    baseline: line.baseline,
  }) as PendingLine;
}

export function paragraphIndent(props: readonly OoxmlProperty[]): {
  left: number;
  right: number;
} {
  let left = 0;
  let right = 0;
  for (const property of props) {
    if (property.localName !== 'ind') continue;
    const rawLeft = property.attributes?.left ?? property.attributes?.start;
    const rawRight = property.attributes?.right ?? property.attributes?.end;
    if (rawLeft && /^-?\d+$/.test(rawLeft)) left = Number(rawLeft) / 20;
    if (rawRight && /^-?\d+$/.test(rawRight)) right = Number(rawRight) / 20;
  }
  return { left, right };
}

/** Horizontal alignment of a paragraph (`w:jc`, ECMA-376 §17.3.1.13). */
export type Alignment = 'left' | 'center' | 'right' | 'both';

export function paragraphAlignment(props: readonly OoxmlProperty[]): Alignment {
  let alignment: Alignment = 'left';
  for (const property of props) {
    if (property.localName !== 'jc') continue;
    switch (property.attributes?.val) {
      // `start`/`end` are the direction-relative spellings; this lane is left-to-right only,
      // so they resolve to left/right rather than being ignored as unknown.
      case 'center':
        alignment = 'center';
        break;
      case 'right':
      case 'end':
        alignment = 'right';
        break;
      case 'both':
      case 'distribute':
        alignment = 'both';
        break;
      default:
        alignment = 'left';
    }
  }
  return alignment;
}

/**
 * Shift a line's spans to satisfy the paragraph alignment.
 *
 * Layout is the only geometry authority, so alignment has to move the published span boxes
 * rather than being left to CSS: the painter positions each span absolutely, and hit testing
 * and the caret read the same boxes. Delegating this to `text-align` would put the caret
 * where no glyph is.
 */
export function alignSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean
): readonly StyleSpanRecord[] {
  if (spans.length === 0 || alignment === 'left') return spans;

  // Trailing whitespace hangs into the margin rather than pushing the text off-centre, which
  // is what Word does and what stops a line ending in a space from looking misaligned.
  const last = spans[spans.length - 1]!;
  const visible = last.text.replace(/\s+$/, '');
  const trailing =
    visible === last.text ? 0 : last.box.width - measurer.measure(visible, last.style);
  const used = last.box.x - indentLeft + last.box.width - trailing;
  const slack = available - used;
  if (slack <= 0) return spans;

  // The last line of a justified paragraph is set flush left, never stretched.
  if (alignment === 'both') {
    const gaps = spans.length - 1;
    if (isLastLine || gaps <= 0) return spans;
    const step = slack / gaps;
    return spans.map((span, index) =>
      index === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + step * index } }
    );
  }

  const offset = alignment === 'center' ? slack / 2 : slack;
  return spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + offset } }));
}

/**
 * Measure and break one paragraph into pending lines at `available` width.
 *
 * Verbatim behaviour of the pre-extraction main-loop body: cache hit short-circuits the
 * measurement entirely; a miss measures pieces, breaks greedily at word boundaries, and
 * stores the frozen result under `cacheKey`. Span x offsets are relative to the paragraph
 * origin (`indentLeft` from the paragraph's own properties), never to the page.
 */
export function breakParagraph(
  paragraph: OoxmlNode,
  paragraphId: string,
  indentLeft: number,
  available: number,
  measurer: TextMeasurer,
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined,
  cacheKey: string | null
): readonly PendingLine[] {
  const cached = cacheKey !== null && cache ? cache.get(cacheKey) : undefined;
  if (cached) return cached;

  const pieces = piecesOf(paragraph);
  const lines: PendingLine[] = [];
  let line: PendingLine = { spans: [], start: 0, end: 0, width: 0, height: 0, baseline: 0 };

  const closeLine = (): void => {
    const metrics = measurer.lineMetrics(DEFAULT_RUN_STYLE);
    if (line.height === 0) {
      line.height = metrics.height;
      line.baseline = metrics.baseline;
    }
    lines.push(line);
    line = {
      spans: [],
      start: line.end,
      end: line.end,
      width: 0,
      height: 0,
      baseline: 0,
    };
  };

  for (const piece of pieces) {
    if (piece.text === '\n') {
      // A hard break ends the line without ending the paragraph — and it OCCUPIES a model
      // offset. Emitting no span for it meant the text reconstructed from the records was
      // shorter than the model: Select All stopped short and left residue, a copied break
      // came back as a space, and Delete before a trailing break merged the next paragraph
      // instead of removing the break. A zero-width span keeps the two in step.
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: '\n',
        props: piece.props,
        style: piece.style,
        box: { x: indentLeft + line.width, y: 0, width: 0, height: breakMetrics.height },
      });
      line.height = Math.max(line.height, breakMetrics.height);
      line.baseline = Math.max(line.baseline, breakMetrics.baseline);
      line.end = piece.end;
      closeLine();
      continue;
    }
    const metrics = measurer.lineMetrics(piece.style);
    let consumed = 0;
    for (const boundary of wordBoundaries(piece.text)) {
      const candidate = piece.text.slice(consumed, boundary);
      if (candidate.length === 0) continue;
      // Measured as DRAWN: `w:caps` changes the glyphs, so measuring the source text
      // would size the line for characters the reader never sees.
      const width = measurer.measure(displayText(candidate, piece.style), piece.style);
      if (line.width + width > available && line.spans.length > 0) closeLine();
      const spanStart = piece.start + consumed;
      line.spans.push({
        range: { paragraphId, start: spanStart, end: piece.start + boundary },
        text: candidate,
        props: piece.props,
        style: piece.style,
        box: { x: indentLeft + line.width, y: 0, width, height: metrics.height },
      });
      line.width += width;
      line.height = Math.max(line.height, metrics.height);
      line.baseline = Math.max(line.baseline, metrics.baseline);
      line.end = piece.start + boundary;
      consumed = boundary;
    }
  }
  // An empty paragraph still occupies one line, or it would have no caret target.
  if (line.spans.length > 0 || lines.length === 0) closeLine();
  if (cacheKey !== null && cache) cache.set(cacheKey, lines.map(frozenLine));
  return lines;
}
