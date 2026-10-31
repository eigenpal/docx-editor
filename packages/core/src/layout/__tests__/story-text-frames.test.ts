import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory, type HeaderFooterPageContext } from '../hf-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const measurer = createFixedMeasurer(5, 12);
const page: HeaderFooterPageContext = {
  pageNumber: 1,
  pageWidth: 600,
  pageHeight: 800,
  marginLeft: 70,
  marginRight: 70,
  marginTop: 72,
  marginBottom: 72,
  storyDistance: 30,
};
const text = (value: string, props = '') =>
  `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;
const frame = (extra = '') =>
  `<w:framePr w:w="4000" w:h="1000" w:x="6400" w:y="960" w:hAnchor="page" w:vAnchor="text" ${extra}/>`;

function lay(content: string, root = 'hdr') {
  const read = readOoxmlPart(`<w:${root} xmlns:w="${WML_NAMESPACE_URI}">${content}</w:${root}>`, {
    name: `/word/${root === 'hdr' ? 'header1' : 'footer1'}.xml`,
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const story = layoutHeaderFooterStory(
    read.part,
    460,
    measurer,
    'story-text-frames-test',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'proposed',
    undefined,
    undefined,
    undefined,
    page
  );
  return { story, paragraphs: story.fragments as readonly ParagraphFragmentRecord[] };
}

test('a text-anchored story frame sits at its offset from the next block and takes no story room', () => {
  for (const root of ['hdr', 'ftr']) {
    const plain = lay(text('ANCHOR'), root);
    const { story, paragraphs } = lay(text('FRAME', frame()) + text('ANCHOR'), root);
    const [framed, anchor] = paragraphs;
    expect(framed!.outOfFlow).toBe(true);
    // Page x 320 is 250 from the left margin; the frame top is 48 below the anchor's top.
    expect(framed!.box.x).toBe(250);
    expect(framed!.box.y).toBe(anchor!.box.y + 48);
    expect(anchor!.box.y).toBe(0);
    expect(story.flowHeight).toBe(plain.story.flowHeight);
  }
});

test('a negative offset raises a footer frame above its anchor', () => {
  const { paragraphs } = lay(
    text('ANCHOR') + text('FRAME', frame().replace('w:y="960"', 'w:y="-1800"')) + text('LAST'),
    'ftr'
  );
  const last = paragraphs.find((paragraph) => paragraph.lines[0]?.spans[0]?.text === 'LAST')!;
  const framed = paragraphs.find((paragraph) => paragraph.outOfFlow)!;
  expect(framed.box.y).toBe(last.box.y - 90);
});

test('an exact story frame clips to its authored box', () => {
  const { paragraphs } = lay(text('FRAME', frame('w:hRule="exact"')) + text('ANCHOR'));
  expect(paragraphs[0]!.clipToBox).toBe(true);
  expect(paragraphs[0]!.box).toEqual({ x: 250, y: 48, width: 200, height: 50 });
});

test('story frames that would meet the story text, or lack a fixed geometry, stay in flow', () => {
  for (const content of [
    // The frame band crosses the anchor's own text.
    text('FRAME', frame().replace('w:x="6400"', 'w:x="1400"').replace('w:y="960"', 'w:y="0"')) +
      text('ANCHOR'),
    text('FRAME', frame().replace(' w:w="4000"', '')) + text('ANCHOR'),
    text('FRAME', frame('w:xAlign="right"')) + text('ANCHOR'),
    text('FRAME', frame()),
  ]) {
    const { paragraphs } = lay(content);
    expect(paragraphs.some((paragraph) => paragraph.outOfFlow)).toBe(false);
  }
});

const pageField = (instruction: string, cached: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${cached}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const framed = (framePr: string, runs: string) => `<w:p><w:pPr>${framePr}</w:pPr>${runs}</w:p>`;
const onPage = (story: ReturnType<typeof lay>['story'], pageNumber: number) =>
  story.withPageContext({ ...page, pageNumber, pageCount: 200, sectionPageCount: 200 })
    .fragments as readonly ParagraphFragmentRecord[];
const textOf = (paragraph: ParagraphFragmentRecord) =>
  paragraph.lines.map((line) => line.spans.map((span) => span.text).join('')).join('');
const inkRight = (paragraph: ParagraphFragmentRecord) =>
  Math.max(...paragraph.lines[0]!.spans.map((span) => span.box.x + span.box.width));

test('a page-anchored page-number frame that wraps nothing sits beside the footer text', () => {
  const framePr =
    '<w:framePr w:w="1940" w:wrap="none" w:vAnchor="text" w:hAnchor="page" w:x="9400" w:y="128"/><w:jc w:val="right"/>';
  const runs =
    `<w:r><w:t xml:space="preserve">Page </w:t></w:r>${pageField('PAGE', '1')}` +
    `<w:r><w:t xml:space="preserve"> of </w:t></w:r>${pageField('NUMPAGES', '1')}`;
  const plain = lay(text('ANCHOR'), 'ftr');
  const { story } = lay(framed(framePr, runs) + text('ANCHOR'), 'ftr');
  expect(story.flowHeight).toBe(plain.story.flowHeight);
  for (const pageNumber of [1, 12]) {
    const [number, anchor] = onPage(story, pageNumber);
    expect(number!.outOfFlow).toBe(true);
    expect(textOf(number!)).toBe(`Page ${pageNumber} of 200`);
    // Page x 470 is 400 from the left margin; the frame top is 6.4 below the anchor's top.
    expect(number!.box.x).toBe(400);
    expect(number!.box.y).toBeCloseTo(anchor!.box.y + 6.4, 6);
    // Right-aligned text ends at the frame's 97 pt width.
    expect(inkRight(number!)).toBeCloseTo(497, 6);
    expect(anchor!.box.y).toBe(0);
  }
});

test('a right-aligned page number without a width keeps its right edge on every page', () => {
  const framePr =
    '<w:framePr w:wrap="none" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/>';
  const number = framed(framePr, pageField('PAGE', '1'));
  const gallery =
    '<w:sdtPr><w:docPartObj><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/></w:docPartObj></w:sdtPr>';
  const plain = lay(text('Version 9'), 'ftr');
  for (const content of [
    number + text('Version 9'),
    `<w:sdt>${gallery}<w:sdtContent>${number}${text('Version 9')}</w:sdtContent></w:sdt>`,
  ]) {
    const { story } = lay(content, 'ftr');
    expect(story.flowHeight).toBe(plain.story.flowHeight);
    for (const pageNumber of [1, 12, 123]) {
      const [digits, anchor] = onPage(story, pageNumber);
      expect(digits!.outOfFlow).toBe(true);
      expect(textOf(digits!)).toBe(String(pageNumber));
      // The frame shrinks to its digits and keeps its right edge on the right margin.
      const ink = digits!.lines[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
      expect(ink).toBeGreaterThan(0);
      expect(digits!.box.width).toBeCloseTo(ink, 6);
      expect(digits!.box.x + digits!.box.width).toBeCloseTo(460, 6);
      expect(inkRight(digits!)).toBeCloseTo(460, 6);
      expect(textOf(anchor!)).toBe('Version 9');
      expect(anchor!.box.y).toBe(0);
    }
  }
});

test('page-number frames that wrap text, follow page parity, or span paragraphs stay in flow', () => {
  const framePr = (wrap: string, align = 'right') =>
    `<w:framePr w:wrap="${wrap}" w:vAnchor="text" w:hAnchor="margin" w:xAlign="${align}" w:y="1"/>`;
  const number = (props: string) => framed(props, pageField('PAGE', '1'));
  for (const content of [
    // A frame that wraps text needs a fixed width and position, and holds no fields.
    number(framePr('around')),
    number(frame('w:wrap="around"')),
    // Inside and outside alignment follow odd and even pages.
    number(framePr('none', 'outside')),
    // A frame without a width shrinks to one paragraph only.
    number(framePr('none')) + number(framePr('none')),
  ]) {
    const { paragraphs } = lay(content + text('Version 9'), 'ftr');
    expect(paragraphs.some((paragraph) => paragraph.outOfFlow)).toBe(false);
  }
});
