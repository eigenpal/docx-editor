// A body line placed where an earlier pass placed it takes that placement: the same record
// for the same top, the aligned spans moved for another top. The tests pin the work (how many
// lines a pass places in full) and that the reuse never changes a published layout.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import {
  bodyLinePlacementTestRecorder,
  placeBodyLine,
  type BodyLinePlacement,
} from '../body-line-placement.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import { frozenLine, type PendingLine } from '../pending-line.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import type { OoxmlPart } from '../../store/package/ooxml-package.ts';
import type { InlineDrawingRecord } from '../drawing-layout.ts';
import type { LineRecord, SemanticLayout, StyleSpanRecord } from '../semantic-records.ts';
import { layoutContext, load as loadPart } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

let recorder: ReturnType<typeof bodyLinePlacementTestRecorder> | null = null;
afterEach(() => {
  recorder?.dispose();
  recorder = null;
});
const record = (disabled = false) => (recorder = bodyLinePlacementTestRecorder(disabled));

/** Justified, centered, right-aligned and indented paragraphs of several lines, with notes. */
function bodyXml(paragraphs: number, lead = ''): string {
  const alignments = ['both', 'both', 'center', 'right', 'left'];
  const body = Array.from({ length: paragraphs }, (_, index) => {
    const jc = alignments[index % alignments.length]!;
    const indent = index % 7 === 3 ? '<w:ind w:left="720" w:firstLine="360"/>' : '';
    const words = Array.from(
      { length: 30 + (index % 9) * 4 },
      (_, word) => `w${(index * 7 + word * 3) % 23}${'x'.repeat((index + word) % 5)}`
    ).join(' ');
    const note =
      index % 11 === 5 ? `<w:r><w:footnoteReference w:id="${1 + (index % 3)}"/></w:r>` : '';
    return `<w:p><w:pPr><w:jc w:val="${jc}"/>${indent}</w:pPr><w:r><w:t>${words}</w:t></w:r>${note}</w:p>`;
  }).join('');
  return `${lead}${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`;
}

function load(body: string): { part: OoxmlPart; notes: NotesLayoutInput } {
  const note = (id: number) =>
    `<w:footnote w:id="${id}"><w:p><w:r><w:t>Note ${id} ${'note '.repeat(30 * id)}</w:t></w:r></w:p></w:footnote>`;
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `${note(1)}${note(2)}${note(3)}</w:footnotes>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const props = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  return {
    part,
    notes: {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [props],
      endnotePropsBySection: [endnoteProps],
      documentFootnoteProps: props,
      documentEndnoteProps: endnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'body-line-placement-test',
    },
  };
}

type Pass = Parameters<typeof layoutSemanticDocument>[2];

function passOptions(
  notes: NotesLayoutInput,
  cache: NonNullable<Pass['cache']>,
  session: NonNullable<Pass['session']>
): Pass {
  return {
    measurer: notes.measurer,
    notes,
    cache,
    session,
    producer: 'body-line-placement-test',
  };
}

function bodyLines(layout: SemanticLayout): LineRecord[] {
  return layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
  );
}

/** The layout of `part` with no line reuse, in its own cache and session. */
function plainLayout(part: OoxmlPart, notes: NotesLayoutInput, revision: number): SemanticLayout {
  const own = bodyLinePlacementTestRecorder(true);
  try {
    return layoutSemanticDocument(
      part,
      revision,
      passOptions(notes, createParagraphLayoutCache(), createLayoutSession())
    );
  } finally {
    own.dispose();
  }
}

describe('a full pass over unchanged content', () => {
  test('in a fresh session aligns no body line again and publishes the same layout', () => {
    const { part, notes } = load(bodyXml(140));
    const cache = createParagraphLayoutCache<never>();
    const first = layoutSemanticDocument(part, 1, passOptions(notes, cache, createLayoutSession()));
    const lines = bodyLines(first);
    expect(first.pages.length).toBeGreaterThan(4);
    expect(first.pages.some((page) => (page.footnotes?.notes.length ?? 0) > 0)).toBe(true);
    expect(lines.length).toBeGreaterThan(300);

    const counts = record();
    const second = layoutSemanticDocument(
      part,
      1,
      passOptions(notes, cache, createLayoutSession())
    );
    // The fresh session holds no page, so its pass places every line at least once.
    expect(counts.placed).toBe(0);
    expect(counts.moved + counts.reused).toBeGreaterThanOrEqual(lines.length);
    expect(counts.reused).toBeGreaterThan(0);
    // The published lines are the records the first pass published.
    const again = bodyLines(second);
    expect(again.length).toBe(lines.length);
    expect(again.every((line, index) => line === lines[index])).toBe(true);
    expect(second).toEqual(first);
    expect(second).toEqual(plainLayout(part, notes, 1));
  });

  test('the first pass places each line once, also through footnote reserve rounds', () => {
    const { part, notes } = load(bodyXml(140));
    const counts = record();
    const layout = layoutSemanticDocument(
      part,
      1,
      passOptions(notes, createParagraphLayoutCache(), createLayoutSession())
    );
    const lines = bodyLines(layout).length;
    // A reserve round places a line again at the same top or at another top; neither aligns.
    // A record that no round holds any more can be placed in full again, so the count of
    // full placements has no exact upper bound here.
    expect(counts.placed).toBeGreaterThanOrEqual(lines);
    expect(counts.moved + counts.reused).toBeGreaterThan(0);
  });

  test('lines an edit moved up keep their alignment and equal a pass without reuse', () => {
    const { part, notes } = load(bodyXml(60));
    const cache = createParagraphLayoutCache<never>();
    const before = layoutSemanticDocument(
      part,
      1,
      passOptions(notes, cache, createLayoutSession())
    );
    // The same tree without its first paragraph: every other paragraph keeps its identity.
    const body = part.root.children[0]!;
    if (body.kind === 'textValue') throw new Error('no body');
    const edited: OoxmlPart = {
      ...part,
      root: { ...part.root, children: [{ ...body, children: body.children.slice(1) }] },
    };
    const removed = bodyLines(before).filter(
      (line) => line.range.paragraphId === body.children[0]!.id
    ).length;
    expect(removed).toBeGreaterThan(1);
    const counts = record();
    // A fresh session, so the pass places every line: each sits higher than before.
    const after = layoutSemanticDocument(
      edited,
      2,
      passOptions(notes, cache, createLayoutSession())
    );
    const lines = bodyLines(after);
    expect(lines.length).toBe(bodyLines(before).length - removed);
    expect(lines[0]!.box.y).toBeLessThan(
      bodyLines(before).find((line) => line.range.paragraphId === lines[0]!.range.paragraphId)!.box
        .y
    );
    expect(counts.moved).toBeGreaterThan(lines.length / 2);
    // Only lines that broke again, around a page boundary that moved, align again.
    expect(counts.placed).toBeLessThan(lines.length / 4);
    expect(after).toEqual(plainLayout(edited, notes, 2));
  });
});

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const EMU_PER_PT = 12_700;

/** A square-wrapped picture run, `x` points from its column and at its paragraph's top. */
function picture(id: number, x: number, width: number, height: number): string {
  const extent = `cx="${width * EMU_PER_PT}" cy="${height * EMU_PER_PT}"`;
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${x * EMU_PER_PT}</wp:posOffset></wp:positionH>` +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent ${extent}/>` +
    '<wp:wrapSquare wrapText="bothSides"/>' +
    `<wp:docPr id="${id}" name="pic ${id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext ${extent}/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

/**
 * Paragraphs of several lines beside two pictures: one at the column's left edge, which leaves
 * each line one passage, and one inside the column, which leaves each line a passage on each
 * side. Each picture is taller than its paragraph, so the paragraphs after it wrap too. More
 * paragraphs follow, onto pages that hold no picture.
 */
function floatXml(word: string, paragraphProperties = ''): string {
  const alignments = ['both', 'center', 'right', 'left'];
  const paragraph = (index: number, runs = '') =>
    `<w:p><w:pPr>${paragraphProperties}<w:jc w:val="${alignments[index % alignments.length]}"/></w:pPr>` +
    `${runs}<w:r><w:t>${`${word} `.repeat(70 + (index % 7) * 9)}</w:t></w:r></w:p>`;
  const body = [
    paragraph(0, picture(1, 0, 120, 150)),
    paragraph(1),
    paragraph(2),
    paragraph(3, picture(2, 200, 90, 150)),
    ...Array.from({ length: 26 }, (_, index) => paragraph(4 + index)),
  ].join('');
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
  );
}

/** `part` with a paragraph of a few lines first. Every other node keeps its identity. */
function withLeadingParagraph(part: OoxmlPart): OoxmlPart {
  const lead = loadPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${'lead '.repeat(40)}</w:t></w:r></w:p></w:body></w:document>`,
    '/word/lead.xml'
  );
  const leadBody = lead.root.children[0]!;
  const body = part.root.children[0]!;
  if (leadBody.kind === 'textValue' || body.kind === 'textValue') throw new Error('no body');
  return {
    ...part,
    root: {
      ...part.root,
      children: [{ ...body, children: [leadBody.children[0]!, ...body.children] }],
    },
  };
}

describe('body lines beside a float', () => {
  const measurer = createFixedMeasurer(6, 14);
  type BreakCache = ReturnType<typeof createParagraphLayoutCache<readonly PendingLine[]>>;
  const layout = (
    part: OoxmlPart,
    revision: number,
    cache: BreakCache = createParagraphLayoutCache()
  ): SemanticLayout =>
    layoutSemanticDocument(part, revision, {
      measurer,
      compatibilityMode: 15,
      inlineDrawingLayout: layoutContext(part),
      cache,
      session: createLayoutSession(),
      producer: 'body-line-placement-test',
    });
  const withoutReuse = <T>(run: () => T): T => {
    const own = bodyLinePlacementTestRecorder(true);
    try {
      return run();
    } finally {
      own.dispose();
    }
  };
  /** A cache, and every broken line it was given to hold. */
  const recordingCache = (): { cache: BreakCache; held: PendingLine[] } => {
    const cache: BreakCache = createParagraphLayoutCache();
    const held: PendingLine[] = [];
    const set = cache.set.bind(cache);
    cache.set = (key, lines) => {
      held.push(...lines);
      set(key, lines);
    };
    return { cache, held };
  };
  const wrapped = (line: PendingLine): boolean =>
    line.wrapSegment !== undefined || line.wrapPassages !== undefined;

  for (const [name, rtl, word, properties] of [
    ['left-to-right', false, 'wrap', ''],
    ['right-to-left', true, 'אבגד', '<w:bidi/>'],
  ] as const) {
    test(`${name} paragraphs an inserted paragraph moved down equal a pass without reuse`, () => {
      const part = loadPart(floatXml(word, properties));
      const { cache, held } = recordingCache();
      const before = layout(part, 1, cache);
      const linesBefore = bodyLines(before);
      expect(before.pages.length).toBeGreaterThan(2);
      // Lines broke beside each picture: one passage, and a passage on each side.
      const wrappedBefore = held.filter(wrapped).length;
      expect(held.filter((line) => line.wrapSegment !== undefined).length).toBeGreaterThan(4);
      expect(held.filter((line) => line.wrapPassages !== undefined).length).toBeGreaterThan(4);
      expect(held.some((line) => line.wrapMirrored === true)).toBe(rtl);
      expect(before).toEqual(withoutReuse(() => layout(part, 1)));

      const edited = withLeadingParagraph(part);
      const counts = record();
      const after = layout(edited, 2, cache);
      const linesAfter = bodyLines(after);
      const lead = linesAfter.findIndex(
        (line) => line.range.paragraphId === linesBefore[0]!.range.paragraphId
      );
      expect(lead).toBeGreaterThan(1);
      expect(linesAfter.length).toBe(linesBefore.length + lead);
      expect(linesAfter[lead]!.box.y).toBeGreaterThan(linesBefore[0]!.box.y);
      // A float's band is at a place on the page, so a line beside it breaks again at its
      // new top and is placed in full. The lines clear of every float keep their alignment.
      const brokenAgain = held.filter(wrapped).length - wrappedBefore;
      expect(brokenAgain).toBeGreaterThan(wrappedBefore / 2);
      expect(counts.placed).toBeGreaterThanOrEqual(brokenAgain);
      expect(counts.moved).toBeGreaterThan(linesBefore.length / 3);
      const reference = withoutReuse(() => layout(edited, 2));
      const referenceLines = bodyLines(reference);
      expect(referenceLines.length).toBe(linesAfter.length);
      for (const [index, line] of linesAfter.entries()) {
        expect(line).toEqual(referenceLines[index]!);
      }
      expect(after).toEqual(reference);
      // The first pass still holds its own records, at the tops it placed them.
      expect(before).toEqual(withoutReuse(() => layout(part, 1)));
    });

    test(`${name} lines broken beside a float move to another top with their passages`, () => {
      const part = loadPart(floatXml(word, properties));
      const { cache, held } = recordingCache();
      layout(part, 1, cache);
      const lines = held.filter(wrapped);
      expect(lines.some((line) => line.wrapSegment !== undefined)).toBe(true);
      expect(lines.some((line) => line.wrapPassages !== undefined)).toBe(true);
      expect(lines.every(Object.isFrozen)).toBe(true);
      const counts = record();
      const props: BodyLinePlacement['props'] = [];
      let placements = 0;
      for (const [lineIndex, pendingLine] of lines.entries()) {
        for (const alignment of ['both', 'center', 'right', 'left'] as const) {
          const at = (y: number): BodyLinePlacement => ({
            pendingLine,
            paragraphId: pendingLine.spans[0]?.range.paragraphId ?? 'p',
            lineIndex,
            isLastLine: false,
            y,
            columnX: 0,
            indentLeft: 0,
            available: 468,
            rtl,
            alignment,
            props,
            styleCascade: undefined,
            measurer,
            clipDrawing: (drawing) => drawing,
          });
          const first = placeBodyLine(at(100)).record;
          const lower = placeBodyLine(at(340)).record;
          placements += 1;
          expect(first).toEqual(withoutReuse(() => placeBodyLine(at(100)).record));
          expect(lower).toEqual(withoutReuse(() => placeBodyLine(at(340)).record));
          expect(lower.spans.every((span) => span.box.y === 340)).toBe(true);
          expect(lower.spans.map((span) => span.box.x)).toEqual(
            first.spans.map((span) => span.box.x)
          );
        }
      }
      // Each alignment places the line once in full; the lower top takes that alignment.
      expect(counts.placed).toBe(placements);
      expect(counts.moved).toBe(placements);
    });
  }
});

describe('placeBodyLine', () => {
  const measurer = createFixedMeasurer();
  const span = (text: string, start: number, x: number): StyleSpanRecord => ({
    range: { paragraphId: 'p1', start, end: start + text.length },
    text,
    props: [],
    style: DEFAULT_RUN_STYLE,
    box: { x, y: 0, width: measurer.measure(text, DEFAULT_RUN_STYLE), height: 14 },
  });
  const pending = (): PendingLine => {
    const spans = [span('aa ', 0, 0), span('bb ', 3, 18), span('cc', 6, 36)];
    return {
      spans,
      drawings: [],
      start: 0,
      end: 8,
      width: 48,
      height: 14,
      baseline: 11,
      leading: 0,
      trailingSpacing: 0,
    };
  };
  const props = [{ localName: 'jc', attributes: { val: 'both' } }];
  const placement = (
    pendingLine: PendingLine,
    change: Partial<BodyLinePlacement> = {}
  ): BodyLinePlacement => ({
    pendingLine,
    paragraphId: 'p1',
    lineIndex: 0,
    isLastLine: false,
    y: 100,
    columnX: 72,
    indentLeft: 0,
    available: 200,
    rtl: false,
    alignment: 'both',
    props,
    styleCascade: undefined,
    measurer,
    clipDrawing: (drawing) => drawing,
    ...change,
  });
  /** What a placement gives with no reuse. */
  const plain = (input: BodyLinePlacement): LineRecord => {
    const own = bodyLinePlacementTestRecorder(true);
    try {
      return placeBodyLine(input).record;
    } finally {
      own.dispose();
    }
  };

  test('an equal placement of a frozen line returns the same record', () => {
    const line = frozenLine(pending());
    const counts = record();
    const first = placeBodyLine(placement(line));
    const second = placeBodyLine(placement(line));
    expect(second.record).toBe(first.record);
    expect(second.alignOffset).toBe(first.alignOffset);
    expect(counts.placed).toBe(1);
    expect(counts.reused).toBe(1);
    // The justified line stretched: the test would pass trivially on an unaligned line.
    expect(first.record.spans[2]!.box.x).toBeGreaterThan(72 + 36);
    expect(first.record).toEqual(plain(placement(line)));
  });

  test('another top moves the kept spans, and both tops stay kept', () => {
    const line = frozenLine(pending());
    const counts = record();
    const first = placeBodyLine(placement(line));
    const lower = placeBodyLine(placement(line, { y: 240 }));
    expect(counts.placed).toBe(1);
    expect(counts.moved).toBe(1);
    expect(lower.record).toEqual(plain(placement(line, { y: 240 })));
    expect(lower.record.box.y).toBe(240);
    expect(lower.record.spans.every((placed) => placed.box.y === 240)).toBe(true);
    // The first record is untouched, and each top hands its own record back.
    expect(first.record.box.y).toBe(100);
    expect(placeBodyLine(placement(line)).record).toBe(first.record);
    expect(placeBodyLine(placement(line, { y: 240 })).record).toBe(lower.record);
    expect(counts.reused).toBe(2);
    expect(counts.placed).toBe(1);
  });

  for (const [name, change] of [
    ['line width', { available: 260 }],
    ['alignment', { alignment: 'center' }],
    ['last line', { isLastLine: true }],
    ['column', { columnX: 90 }],
    ['indent', { indentLeft: 36 }],
    ['paragraph direction', { rtl: true }],
    ['paragraph properties', { props: [{ localName: 'jc', attributes: { val: 'distribute' } }] }],
    ['measurer', { measurer: createFixedMeasurer(7) }],
    ['style cascade', { styleCascade: {} as BodyLinePlacement['styleCascade'] }],
    ['paragraph', { paragraphId: 'p2' }],
    ['line index', { lineIndex: 3 }],
  ] as const satisfies readonly (readonly [string, Partial<BodyLinePlacement>])[]) {
    test(`a different ${name} places the line in full`, () => {
      const line = frozenLine(pending());
      const counts = record();
      const first = placeBodyLine(placement(line));
      const other = placeBodyLine(placement(line, change));
      expect(counts.placed).toBe(2);
      expect(counts.moved + counts.reused).toBe(0);
      expect(other.record).not.toBe(first.record);
      expect(other.record).toEqual(plain(placement(line, change)));
    });
  }

  test('a right-to-left line at another top equals a full placement', () => {
    const line = frozenLine({ ...pending(), firstLineOffset: 18 });
    const rtl = { rtl: true, alignment: 'right' } as const;
    const counts = record();
    const first = placeBodyLine(placement(line, rtl));
    const lower = placeBodyLine(placement(line, { ...rtl, y: 240 }));
    expect(counts.moved).toBe(1);
    expect(first.record).toEqual(plain(placement(line, rtl)));
    expect(lower.record).toEqual(plain(placement(line, { ...rtl, y: 240 })));
    expect(lower.alignOffset).toBe(first.alignOffset);
  });

  test('one broken line placed for two paragraphs gives each its own record', () => {
    const line = frozenLine(pending());
    const counts = record();
    const first = placeBodyLine(placement(line));
    const second = placeBodyLine(placement(line, { paragraphId: 'p2' }));
    const firstAgain = placeBodyLine(placement(line));
    expect(counts.moved + counts.reused).toBe(0);
    expect(second.record.range.paragraphId).toBe('p2');
    expect(second.record.spans.every((placed) => placed.range.paragraphId === 'p2')).toBe(true);
    expect(firstAgain.record).toEqual(first.record);
    expect(firstAgain.record.range.paragraphId).toBe('p1');
  });

  test('a line with an inline picture is placed every time', () => {
    const box = { x: 48, y: 0, width: 12, height: 12 };
    const picture = {
      kind: 'inlineDrawing',
      drawingNodeId: 'd1',
      paragraphId: 'p1',
      ownerPartName: '/word/document.xml',
      start: 8,
      x: 48,
      y: 0,
      advanceStart: 48,
      advanceEnd: 60,
      paintBounds: box,
      hitBounds: box,
      geometry: { contentBounds: box, paintBounds: box, hitBounds: box, transformedCorners: [] },
    } as unknown as InlineDrawingRecord;
    const line = frozenLine({ ...pending(), drawings: [picture], end: 9, width: 60 });
    const counts = record();
    let clips = 0;
    const clipDrawing = (drawing: InlineDrawingRecord) => {
      clips += 1;
      return drawing;
    };
    const first = placeBodyLine(placement(line, { clipDrawing }));
    const second = placeBodyLine(placement(line, { clipDrawing }));
    expect(counts.placed).toBe(2);
    expect(clips).toBe(2);
    expect(first.record.drawings?.length).toBe(1);
    expect(second.record).not.toBe(first.record);
  });

  test('a top that a placement came back to outlives the trial tops of later searches', () => {
    const line = frozenLine(pending());
    const counts = record();
    // Hold every record, as the layouts of a search do until it ends.
    const held = [placeBodyLine(placement(line)).record];
    // A second pass finds the line at the same top: that top is now one to come back to.
    expect(placeBodyLine(placement(line)).record).toBe(held[0]!);
    for (let round = 0; round < 3; round += 1) {
      for (const trial of [1, 2, 3, 4, 5]) {
        held.push(placeBodyLine(placement(line, { y: 1000 * (round + 1) + trial })).record);
      }
      // Each search ends at the published top and takes the record kept there.
      expect(placeBodyLine(placement(line)).record).toBe(held[0]!);
    }
    expect(counts.placed).toBe(1);
    expect(counts.reused).toBe(4);
  });

  test('a kept record, its box, its spans, and their boxes refuse a write', () => {
    const line = frozenLine(pending());
    const kept = placeBodyLine(placement(line)).record;
    const moved = placeBodyLine(placement(line, { y: 240 })).record;
    type Writable<T> = { -readonly [Key in keyof T]: T[Key] };
    for (const placed of [kept, moved]) {
      const top = placed.box.y;
      expect(() => ((placed as Writable<LineRecord>).baseline = 1)).toThrow(TypeError);
      expect(() => ((placed.box as Writable<LineRecord['box']>).y = 1)).toThrow(TypeError);
      expect(placed.spans.length).toBe(3);
      for (const placedSpan of placed.spans) {
        const span = placedSpan as Writable<StyleSpanRecord>;
        expect(() => (span.text = 'changed')).toThrow(TypeError);
        expect(() => (span.box = { x: 0, y: 0, width: 0, height: 0 })).toThrow(TypeError);
        expect(() => ((span.box as Writable<StyleSpanRecord['box']>).x = 1)).toThrow(TypeError);
        expect(() => ((span.box as Writable<StyleSpanRecord['box']>).y = 1)).toThrow(TypeError);
        expect(span.box.y).toBe(top);
      }
      // The span list is not frozen: a frozen array costs every reader of the line.
      expect(Object.isFrozen(placed.spans)).toBe(false);
    }
    expect(kept).toEqual(plain(placement(line)));
    expect(moved).toEqual(plain(placement(line, { y: 240 })));
  });

  test('a placement after the kept record was collected places the line in full', async () => {
    const line = frozenLine(pending());
    const counts = record();
    // The record leaves this scope at once, as the layout of a dropped pass does.
    const placeAndDrop = (): WeakRef<LineRecord> =>
      new WeakRef(placeBodyLine(placement(line)).record);
    const dropped = placeAndDrop();
    expect(counts.placed).toBe(1);
    // A weak reference holds its target until the running task ends, so collect in later tasks.
    for (let attempt = 0; attempt < 5 && dropped.deref() !== undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      Bun.gc(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const collected = dropped.deref() === undefined;
    const again = placeBodyLine(placement(line));
    const lower = placeBodyLine(placement(line, { y: 240 }));
    // Collected or not, each placement is what a placement without reuse gives.
    expect(again.record).toEqual(plain(placement(line)));
    expect(lower.record).toEqual(plain(placement(line, { y: 240 })));
    expect(counts.moved).toBe(1);
    if (collected) {
      // Nothing was left to take or to move: the line was placed and aligned again.
      expect(counts.placed).toBe(2);
      expect(counts.reused).toBe(0);
      expect(Object.isFrozen(again.record)).toBe(true);
      // The new record is kept in its turn.
      expect(placeBodyLine(placement(line)).record).toBe(again.record);
      expect(counts.reused).toBe(1);
    } else {
      expect(counts.placed).toBe(1);
      expect(counts.reused).toBe(1);
    }
  });

  test('a line that is not frozen is placed every time', () => {
    const line = pending();
    const counts = record();
    const first = placeBodyLine(placement(line));
    const second = placeBodyLine(placement(line));
    expect(counts.placed).toBe(2);
    expect(second.record).not.toBe(first.record);
    expect(second.record).toEqual(first.record);
  });
});
