import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';

const frame =
  '<w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="center" w:y="1"/>';
const field =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
const body = `<w:p><w:pPr><w:pStyle w:val="Footer"/>${frame}</w:pPr>${field}</w:p><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p>`;
const measurer = createFixedMeasurer(6, 14);

function partOf(content = body, header = false) {
  const kind = header ? 'header' : 'footer';
  const root = header ? 'hdr' : 'ftr';
  const parsed = readOoxmlPart(`<w:${root} xmlns:w="${WML_NAMESPACE_URI}">${content}</w:${root}>`, {
    name: `/word/${kind}1.xml`,
    contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

test('centers the legacy PAGE frame without charging its empty anchor paragraph twice', () => {
  const part = partOf();
  const before = serializeOoxmlPart(part);
  const story = layoutHeaderFooterStory(part, 400, measurer, 'test');
  expect(story.fragments).toHaveLength(2);
  const first = story.fragments[0]!;
  const second = story.fragments[1]!;
  if (first.kind !== 'paragraph' || second.kind !== 'paragraph')
    throw new Error('paragraphs required');
  expect(story.flowHeight).toBeCloseTo(first.box.height + 0.05, 3);
  expect(first.alignment).toBe('center');
  const span = first.lines[0]!.spans[0]!;
  expect(span.box.x + span.box.width / 2).toBeCloseTo(200, 4);
  expect(first.lines[0]!.contentX).toBe(span.box.x);
  expect(second.box.y).toBeCloseTo(0, 4);
  expect(first.paragraphId).not.toBe(second.paragraphId);
  expect(story.part).toBe(part);
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('re-evaluates and re-centers multi-digit PAGE results per page', () => {
  const story = layoutHeaderFooterStory(partOf(), 400, measurer, 'test');
  for (const pageNumber of [1, 12, 123]) {
    const projected = story.withPageContext({ pageNumber, pageCount: 200, sectionPageCount: 200 });
    const paragraph = projected.fragments[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('paragraph required');
    const spans = paragraph.lines[0]!.spans;
    expect(spans.map((span) => span.text).join('')).toBe(String(pageNumber));
    expect(spans[0]!.box.x + spans.reduce((sum, span) => sum + span.box.width, 0) / 2).toBeCloseTo(
      200,
      4
    );
    expect(projected.flowHeight).toBeCloseTo(story.flowHeight, 4);
  }
});

test('leaves other frame structures in ordinary flow', () => {
  const samples = [
    body.replace('w:xAlign="center"', 'w:xAlign="right"'),
    body.replace('w:y="1"', 'w:y="200"'),
    body.replace('w:y="1"', 'w:y="1" w:w="200"'),
    body.replace(' PAGE ', ' NUMPAGES '),
    body.replace('</w:pPr></w:p>', '</w:pPr><w:r><w:t>not empty</w:t></w:r></w:p>'),
    body.replace('<w:t>1</w:t>', '<w:t>Page 1</w:t>'),
    body.replace(frame, frame + '<w:spacing w:after="200"/>'),
    body.replace(frame, frame + frame),
    body.replace('w:xAlign="center"', 'xAlign="center"'),
    body.replace('<w:t>1</w:t>', '<w:t>' + '1'.repeat(257) + '</w:t>'),
  ];
  for (const content of samples) {
    const story = layoutHeaderFooterStory(partOf(content), 400, measurer, 'test');
    expect(story.fragments[1]!.box.y).toBeGreaterThan(0);
  }
  const header = layoutHeaderFooterStory(partOf(body, true), 400, measurer, 'test');
  expect(header.fragments[1]!.box.y).toBeGreaterThan(0);
});

test('centers PAGE over a middle-dot anchor without moving or merging its text', () => {
  const decorated = body.replace(
    '</w:pPr></w:p>',
    '<w:jc w:val="center"/><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">·   ·</w:t></w:r></w:p>'
  );
  const part = partOf(decorated),
    before = serializeOoxmlPart(part);
  const story = layoutHeaderFooterStory(part, 400, measurer, 'decorated');
  for (const pageNumber of [1, 12, 123]) {
    const projected = story.withPageContext({ pageNumber, pageCount: 200, sectionPageCount: 200 });
    const [first, second] = projected.fragments;
    if (first?.kind !== 'paragraph' || second?.kind !== 'paragraph')
      throw new Error('paragraphs required');
    expect(first.lines[0]!.spans.map((span) => span.text).join('')).toBe(String(pageNumber));
    expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('·   ·');
    expect(first.paragraphId).not.toBe(second.paragraphId);
    const start = first.lines[0]!.spans[0]!.box,
      end = first.lines[0]!.spans.at(-1)!.box;
    expect((start.x + end.x + end.width) / 2).toBeCloseTo(200, 4);
    expect(second.box.y).toBe(0);
    expect(projected.flowHeight).toBeCloseTo(first.box.height + 0.05, 3);
  }
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('does not overlay meaningful, left-aligned or field-bearing anchor content', () => {
  for (const [content, align] of [
    ['· note ·', 'center'],
    ['·   ·', 'left'],
    ['·'.repeat(40), 'center'],
  ]) {
    const decorated = body.replace(
      '</w:pPr></w:p>',
      `<w:jc w:val="${align}"/></w:pPr><w:r><w:t>${content}</w:t></w:r></w:p>`
    );
    const story = layoutHeaderFooterStory(partOf(decorated), 400, measurer, 'refused');
    expect(story.fragments[1]!.box.y).toBeGreaterThan(0);
  }
  const fieldAnchor = body.replace('</w:pPr></w:p>', `</w:pPr>${field}</w:p>`);
  expect(
    layoutHeaderFooterStory(partOf(fieldAnchor), 400, measurer, 'field-anchor').fragments[1]!.box.y
  ).toBeGreaterThan(0);
});
