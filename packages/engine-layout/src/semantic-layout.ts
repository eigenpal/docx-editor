// Semantic paragraph layout over the canonical tree (tasks 7.1, 7.3).
//
// Produces the revision-tagged records in `semantic-records.ts`: pages, paragraph fragments,
// lines and style spans, each carrying a stable source range. It reads the CANONICAL TREE
// and a measurement port, never the DOM and never ProseMirror.
//
// A paragraph that does not fit the remaining page height is FRAGMENTED rather than moved
// wholesale: the lines that fit stay, the rest continue on the next page under the same
// paragraph id. That is what makes a cross-page paragraph one paragraph for selection and
// two boxes for pagination.

import type { OoxmlNode, OoxmlPart, OoxmlProperty } from '@docx-editor.dev/engine-core';
import {
  DEFAULT_RUN_STYLE,
  displayText,
  resolveRunStyle,
  type ResolvedRunStyle,
} from './run-style.ts';
import {
  DEFAULT_PAGE_GEOMETRY,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type ParagraphFragmentRecord,
  type SemanticLayout,
  type StyleSpanRecord,
  type TextMeasurer,
} from './semantic-records.ts';

export interface SemanticLayoutOptions {
  readonly geometry?: PageGeometry;
  readonly measurer: TextMeasurer;
}

/** One measurable piece of a paragraph: text carrying one property set. */
interface Piece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  /** Resolved once here, so nothing downstream re-derives it. */
  readonly style: ResolvedRunStyle;
  readonly start: number;
  readonly end: number;
}

function propertiesOf(container: OoxmlNode | undefined): OoxmlProperty[] {
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

interface PendingLine {
  readonly spans: StyleSpanRecord[];
  readonly start: number;
  end: number;
  width: number;
  height: number;
  baseline: number;
}

function paragraphIndent(props: readonly OoxmlProperty[]): { left: number; right: number } {
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
type Alignment = 'left' | 'center' | 'right' | 'both';

function paragraphAlignment(props: readonly OoxmlProperty[]): Alignment {
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
function alignSpans(
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

/** Whether a paragraph must start a new page (`w:pageBreakBefore`). */
function breaksBefore(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'pageBreakBefore' &&
      property.attributes?.val !== '0' &&
      property.attributes?.val !== 'false'
  );
}

/** Body paragraphs of a part, in document order. */
function bodyParagraphs(part: OoxmlPart): OoxmlNode[] {
  const paragraphs: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'body') {
      for (const child of node.children) if (child.kind === 'paragraph') paragraphs.push(child);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return paragraphs;
}

/**
 * Lay a part out into pages, fragments, lines and spans.
 *
 * Deterministic: same tree plus same measurer produces byte-identical records, which is what
 * makes the incremental engine of section 9 differentially testable against a clean run.
 */
export function layoutSemanticDocument(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): SemanticLayout {
  const geometry = options.geometry ?? DEFAULT_PAGE_GEOMETRY;
  const measurer = options.measurer;
  const contentWidth = geometry.width - geometry.margin.left - geometry.margin.right;
  const contentHeight = geometry.height - geometry.margin.top - geometry.margin.bottom;

  const pages: PageRecord[] = [];
  let pageFragments: ParagraphFragmentRecord[] = [];
  let cursorY = 0;
  let lineCounter = 0;

  const pageBox = (index: number): LayoutBox => ({
    x: 0,
    y: index * (geometry.height + 24), // 24pt gutter between sheets, for the scroll surface
    width: geometry.width,
    height: geometry.height,
  });

  const flushPage = (): void => {
    const index = pages.length;
    const box = pageBox(index);
    pages.push({
      id: `page-${index}`,
      index,
      box,
      contentBox: {
        x: box.x + geometry.margin.left,
        y: box.y + geometry.margin.top,
        width: contentWidth,
        height: contentHeight,
      },
      fragments: pageFragments,
    });
    pageFragments = [];
    cursorY = 0;
  };

  for (const paragraph of bodyParagraphs(part)) {
    const paragraphId = paragraph.id;
    const props = propertiesOf(
      paragraph.kind === 'textValue'
        ? undefined
        : paragraph.children.find((child) => child.kind === 'paragraphProperties')
    );
    const indent = paragraphIndent(props);
    const alignment = paragraphAlignment(props);
    const available = Math.max(1, contentWidth - indent.left - indent.right);

    if (breaksBefore(props) && (pageFragments.length > 0 || pages.length === 0)) {
      flushPage();
    }

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
        // A hard break ends the line without ending the paragraph.
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
          box: { x: indent.left + line.width, y: 0, width, height: metrics.height },
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

    // Place the lines, fragmenting at page boundaries.
    let fragmentIndex = 0;
    let pending: LineRecord[] = [];
    let fragmentStart = lines[0]?.start ?? 0;

    const flushFragment = (): void => {
      if (pending.length === 0) return;
      const top = pending[0]!.box.y;
      const height = pending.reduce((sum, record) => sum + record.box.height, 0);
      pageFragments.push({
        id: `${paragraphId}#f${fragmentIndex}`,
        paragraphId,
        fragmentIndex,
        range: {
          paragraphId,
          start: fragmentStart,
          end: pending[pending.length - 1]!.range.end,
        },
        props,
        lines: pending,
        box: { x: indent.left, y: top, width: available, height },
      });
      fragmentIndex += 1;
      fragmentStart = pending[pending.length - 1]!.range.end;
      pending = [];
    };

    for (const [lineIndex, pendingLine] of lines.entries()) {
      if (
        cursorY + pendingLine.height > contentHeight &&
        (pending.length > 0 || pageFragments.length > 0)
      ) {
        flushFragment();
        flushPage();
      }
      const record: LineRecord = {
        id: `line-${lineCounter}`,
        range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
        spans: alignSpans(
          pendingLine.spans.map((span) => ({ ...span, box: { ...span.box, y: cursorY } })),
          measurer,
          indent.left,
          available,
          alignment,
          lineIndex === lines.length - 1
        ),
        box: { x: indent.left, y: cursorY, width: available, height: pendingLine.height },
        baseline: pendingLine.baseline,
      };
      lineCounter += 1;
      pending.push(record);
      cursorY += pendingLine.height;
    }
    flushFragment();
  }

  if (pageFragments.length > 0 || pages.length === 0) flushPage();
  return { revision, pages };
}

/**
 * A deterministic measurer for tests and headless use.
 *
 * Monospace by construction: every character is the same width and every line the same
 * height, scaled by `w:sz` when present. Real shaping is the HarfBuzz path; this exists so
 * layout behaviour can be asserted without a font stack deciding the answer.
 */
export function createFixedMeasurer(charWidth = 6, lineHeight = 14): TextMeasurer {
  // 11pt is the size the base width and height describe; everything else scales from it.
  const scale = (style: ResolvedRunStyle): number => style.fontSizePt / 11;
  return {
    measure: (text, style) => {
      // Advance, then horizontal scaling, then character spacing — the order Word applies
      // them, and the order that makes `w:spacing` an absolute per-character addition
      // rather than something the scale multiplies.
      const advance = text.length * charWidth * scale(style);
      const scaled = advance * (style.horizontalScalePercent / 100);
      return scaled + text.length * style.characterSpacingPt;
    },
    lineMetrics: (style) => {
      // Super/subscript draw smaller, so they need less line height than their nominal size.
      const shrink = style.verticalAlign === 'baseline' ? 1 : 0.75;
      const height = lineHeight * scale(style) * shrink;
      return { height, baseline: height * 0.8 };
    },
  };
}
