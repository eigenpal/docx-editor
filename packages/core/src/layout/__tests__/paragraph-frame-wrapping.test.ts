import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

function render(wrap: string, extra = '', members = 1) {
  const frame = `<w:p><w:pPr><w:framePr w:x="0" w:y="0" w:w="1600" ${wrap ? `w:wrap="${wrap}"` : ''} ${extra}/><w:spacing w:line="400" w:lineRule="exact" w:after="0"/></w:pPr><w:r><w:t>Frame</w:t></w:r></w:p>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${frame.repeat(members)}<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact"/></w:pPr><w:r><w:t>${'word '.repeat(24)}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="4000" w:h="6000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 0, { measurer: createFixedMeasurer(10, 10) });
  const paragraphs = layout.pages
    .flatMap((page) => page.fragments)
    .filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');
  return { layout, frames: paragraphs.slice(0, members), anchor: paragraphs[members]! };
}

test('wraps text beside numeric frames without an image layout port, including default around wrapping', () => {
  for (const wrap of ['', 'around']) {
    const { layout, frames, anchor } = render(wrap);
    expect(layout.pages).toHaveLength(1);
    expect(frames[0]!.box.y).toBe(0);
    expect(anchor.lines[0]!.box.y).toBe(0);
    expect(anchor.lines[0]!.contentX).toBeGreaterThanOrEqual(80);
    const below = anchor.lines.find((line) => line.box.y >= 20)!;
    expect(below.contentX).toBe(0);
  }
});

test('none and notBeside clear following text below the frame without moving its text anchor again', () => {
  for (const wrap of ['none', 'notBeside']) {
    const { layout, frames, anchor } = render(wrap, 'w:vSpace="100"');
    expect(layout.pages).toHaveLength(1);
    expect(frames[0]!.box.y).toBe(0);
    expect(anchor.lines[0]!.box.y).toBeCloseTo(25, 3);
    expect(anchor.lines[0]!.contentX).toBe(0);
  }
});

test('applies horizontal text distance and wraps around the complete shared frame', () => {
  const { frames, anchor } = render('around', 'w:hSpace="200"', 2);
  expect(frames[0]!.box.y).toBe(0);
  expect(frames[1]!.box.y).toBe(20);
  expect(anchor.lines.filter((line) => line.box.y < 40).every((line) => line.contentX >= 90)).toBe(
    true
  );
  expect(anchor.lines.find((line) => line.box.y >= 40)!.contentX).toBe(0);
});
