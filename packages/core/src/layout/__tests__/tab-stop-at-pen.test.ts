// A pen that ends on a stop takes the next stop, even when the first line starts left of the
// margin and the sum of advances misses the stop by a rounding error.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { nextTabDestination, type ResolvedTabStops } from '../paragraph-tabs.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { listFirstLineOffset, resolveStoryListItems } from '../list-resolve.ts';
import { listMarkerWidth } from '../list-marker-geometry.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// A right stop at 22.7pt for the number, a left stop at 36.85pt for the text.
const STOPS =
  '<w:tabs><w:tab w:val="right" w:pos="454"/><w:tab w:val="left" w:pos="737"/></w:tabs>';
const CONDENSED = '<w:rPr><w:spacing w:val="-4"/></w:rPr>';

function layout(paragraphs: readonly string[], indent: string, inCell = false) {
  const body = paragraphs
    .map((content) => `<w:p><w:pPr>${STOPS}${indent}</w:pPr>${content}</w:p>`)
    .join('');
  const content = inCell
    ? `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${body}</w:tc></w:tr></w:tbl>`
    : body;
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    compatibilityMode: 14,
    geometry: { width: 400, height: 400, margin: { top: 0, bottom: 0, left: 72, right: 72 } },
  });
}

const PARAGRAPHS = [
  '<w:r><w:tab/><w:t>(1)</w:t></w:r><w:r><w:tab/><w:t>Text</w:t></w:r>',
  `<w:r>${CONDENSED}<w:tab/><w:t>(3)</w:t></w:r><w:r>${CONDENSED}<w:tab/><w:t>Text</w:t></w:r>`,
  '<w:r><w:tab/><w:tab/><w:t>Text</w:t></w:r>',
];

function textStarts(result: ReturnType<typeof layout>): number[] {
  return linesOf(result).map((line) => line.spans.find((span) => span.text === 'Text')!.box.x);
}

test('a left tab after right-aligned text takes the next stop on a first line left of the margin', () => {
  // The first line starts at -14.2pt: `w:left` 36.85pt minus `w:hanging` 51.05pt.
  const starts = textStarts(layout(PARAGRAPHS, '<w:ind w:left="737" w:hanging="1021"/>'));
  for (const x of starts) expect(x).toBeCloseTo(36.85, 6);
});

test('the same paragraphs with the first line at the margin keep their text on the left stop', () => {
  const starts = textStarts(layout(PARAGRAPHS, '<w:ind w:left="737" w:hanging="737"/>'));
  for (const x of starts) expect(x).toBeCloseTo(36.85, 6);
});

test('a cell paragraph with a first line left of its edge takes the next stop', () => {
  const result = layout(PARAGRAPHS, '<w:ind w:left="737" w:hanging="1021"/>', true);
  const lines = linesOf(result).filter((line) => line.spans.some((span) => span.text === 'Text'));
  expect(lines).toHaveLength(3);
  for (const line of lines) {
    // Each line opens with a tab at the first-line start, 51.05pt before the left stop.
    const text = line.spans.find((span) => span.text === 'Text')!;
    expect(text.box.x - line.spans[0]!.box.x).toBeCloseTo(51.05, 6);
  }
});

test('a pen a rounding error short of a stop counts as on it', () => {
  const tabs: ResolvedTabStops = {
    stops: [
      { positionPt: 22.7, alignment: 'right' },
      { positionPt: 36.85, alignment: 'left' },
    ],
    defaultIntervalPt: 57,
  };
  const pen = 22.7 - 4e-15;
  expect(pen).toBeLessThan(22.7);
  expect(nextTabDestination(tabs, pen, 400)).toEqual({ positionPt: 36.85, alignment: 'left' });
  // A pen that is really short of the stop still reaches it.
  expect(nextTabDestination(tabs, 22.69, 400).positionPt).toBe(22.7);
  // The default grid uses the same tolerance.
  expect(nextTabDestination(tabs, 57 - 1e-9, 400).positionPt).toBe(114);
});

/** The item of a one-level list: a one-glyph marker at 0pt, text indent 36pt, tab suffix. */
function listItem() {
  const read = (name: string, xml: string) => {
    const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  };
  const numbering = read(
    '/word/numbering.xml',
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
  );
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/>
      <w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p></w:body></w:document>`
  );
  const body = document.root.children.find((child) => child.localName === 'body')!;
  const items = resolveStoryListItems(
    body.children.filter((child) => child.kind === 'paragraph'),
    buildNumberingIndex(numbering.root),
    undefined
  );
  return [...items.values()][0]!;
}

test('a numbering suffix tab passes a stop the marker already ends on', () => {
  const measurer = createFixedMeasurer(6, 12);
  const item = listItem();
  const stops = (positionPt: number): ResolvedTabStops => ({
    stops: [{ positionPt, alignment: 'left' }],
    defaultIntervalPt: 36,
  });
  const markerEnd = listMarkerWidth(item, measurer);
  // The marker ends on the stop, within a rounding error: the text starts at the indent.
  expect(listFirstLineOffset(item, measurer, stops(markerEnd * (1 + 1e-15)))).toBe(0);
  // A stop really past the marker end is nearer than the indent.
  expect(listFirstLineOffset(item, measurer, stops(12))).toBeCloseTo(-24, 6);
});
