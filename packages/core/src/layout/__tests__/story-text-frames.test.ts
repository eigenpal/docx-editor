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
