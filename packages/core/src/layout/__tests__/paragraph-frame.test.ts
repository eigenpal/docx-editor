import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlProperty } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readParagraphFrame } from '../paragraph-frame.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string, properties = '') =>
  `<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact"/>${properties}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const frame = (attributes = '') => `<w:framePr w:x="400" w:y="600" w:w="1000" ${attributes}/>`;
function document(body: string, sectionType = '') {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr>${sectionType}<w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/></w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const measurer = createFixedMeasurer(6, 10);
const framesOf = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter(
      (fragment): fragment is ParagraphFragmentRecord =>
        fragment.kind === 'paragraph' && fragment.outOfFlow === true
    );

test('bounded frame properties preserve Word defaults and refuse unsupported variants', () => {
  const read = (attributes: Record<string, string>) =>
    readParagraphFrame([{ localName: 'framePr', attributes }]);
  const attributes = { x: '400', y: '600', w: '1000' };
  expect(read(attributes)).toMatchObject({
    x: 20,
    y: 30,
    width: 50,
    horizontalAnchor: 'text',
    verticalAnchor: 'text',
    wrap: 'around',
  });
  for (const override of [
    { w: '0' },
    { x: 'Infinity' },
    { y: '999999999' },
    { h: '100' },
    { dropCap: 'drop' },
    { wrap: 'through' },
    { hAnchor: 'bogus' },
  ])
    expect(read({ ...attributes, ...override })).toBeNull();
  const props: OoxmlProperty[] = [
    { localName: 'framePr', attributes },
    { localName: 'framePr', attributes: { ...attributes, x: '800' } },
  ];
  expect(readParagraphFrame(props)?.x).toBe(40);
});

test('page and margin frame origins differ while authored paragraph alignment survives', () => {
  const source = document(
    paragraph('page', frame('w:hAnchor="page" w:vAnchor="page"') + '<w:jc w:val="right"/>') +
      paragraph('margin', frame('w:hAnchor="margin" w:vAnchor="margin"')) +
      paragraph('anchor')
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  const [page, margin] = framesOf(layout);
  expect(page!.box).toMatchObject({ x: 10, y: 20, width: 50 });
  expect(page!.alignment).toBe('right');
  expect(margin!.box).toMatchObject({ x: 20, y: 30, width: 50 });
  expect(layout.pages).toHaveLength(1);
});

test('identical adjacent frame paragraphs share one frame and wrap at its authored width', () => {
  const source = document(
    paragraph('abcdefghijklmno', frame()) + paragraph('second', frame()) + paragraph('anchor')
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  const [first, second] = framesOf(layout);
  expect(first!.lines).toHaveLength(2);
  expect(second!.box.y).toBe(first!.box.y + first!.box.height);
  expect(second!.positionedFrame?.groupId).toBe(first!.positionedFrame?.groupId);
  expect(second!.positionedFrame?.box).toEqual(first!.positionedFrame?.box);
  expect(second!.paragraphId).not.toBe(first!.paragraphId);
});

test('text frames follow the placed anchor across spacing and page breaks', () => {
  for (const pageBreak of ['', '<w:pageBreakBefore/>']) {
    const source = document(
      paragraph('lead') +
        paragraph('framed', frame()) +
        paragraph(
          'anchor',
          '<w:spacing w:before="400" w:line="200" w:lineRule="exact"/>' + pageBreak
        )
    );
    const layout = layoutSemanticDocument(source, 0, { measurer });
    const placed = framesOf(layout)[0]!;
    const page = layout.pages.find((item) => item.fragments.includes(placed))!;
    const anchor = page.fragments.find(
      (fragment) =>
        fragment.kind === 'paragraph' && fragment.paragraphId === placed.positionedFrame?.anchorId
    ) as ParagraphFragmentRecord;
    expect(placed.box.y).toBeCloseTo(anchor.lines[0]!.box.y + 30, 6);
    expect(page.index).toBe(pageBreak ? 1 : 0);
  }
});

test('anchor edits and frame group edits agree between incremental and cold layout', () => {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  for (const [revision, before] of [0, 400, 100, 0].entries()) {
    const source = document(
      paragraph('lead') +
        paragraph('first', frame()) +
        paragraph(`second${revision}`, frame()) +
        paragraph('anchor', `<w:spacing w:before="${before}" w:line="200" w:lineRule="exact"/>`)
    );
    const warm = layoutSemanticDocument(source, revision, { measurer, session, cache });
    const cold = layoutSemanticDocument(source, revision, { measurer });
    expect(warm.pages).toEqual(cold.pages);
  }
});

test('keep-next measures the next ordinary paragraph across positioned frames', () => {
  const source = document(
    paragraph('Lead', '<w:spacing w:line="2800" w:lineRule="exact"/>') +
      paragraph('Heading', '<w:keepNext/><w:spacing w:line="400" w:lineRule="exact"/>') +
      paragraph(
        'Frame',
        '<w:framePr w:x="0" w:y="0" w:w="1000"/><w:spacing w:line="1600" w:lineRule="exact"/>'
      ) +
      paragraph('Anchor', '<w:spacing w:line="400" w:lineRule="exact"/>')
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  expect(layout.pages).toHaveLength(1);
  const heading = layout.pages[0]!.fragments.find(
    (block) =>
      block.kind === 'paragraph' &&
      block.lines.some((line) => line.spans.some((span) => span.text === 'Heading'))
  )!;
  expect(heading.box.y).toBe(140);
});

test('a continuous section clears preceding frame groups and their vertical text distance', () => {
  const geometry =
    '<w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/>';
  const source = document(
    paragraph(
      'Frame',
      '<w:framePr w:x="0" w:y="0" w:w="1000" w:vSpace="100"/><w:spacing w:line="2000" w:lineRule="exact"/>'
    ) +
      paragraph('', `<w:sectPr>${geometry}</w:sectPr>`) +
      paragraph('Following section'),
    '<w:type w:val="continuous"/>'
  );
  const layout = layoutSemanticDocument(source, 0, { measurer });
  expect(layout.pages).toHaveLength(1);
  const positioned = framesOf(layout)[0]!;
  const following = layout.pages[0]!.fragments.at(-1)!;
  expect(following.box.y).toBeGreaterThanOrEqual(
    positioned.positionedFrame!.box.y + positioned.positionedFrame!.box.height + 5
  );
});
