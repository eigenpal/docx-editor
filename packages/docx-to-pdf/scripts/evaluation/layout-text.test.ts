import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../../core/src/store/package/ooxml-tree.ts';
import { layoutSemanticDocument } from '../../../core/src/layout/semantic-layout.ts';
import { buildNumberingIndex } from '../../../core/src/layout/numbering-index.ts';
import { recordLayoutText } from './layout-text.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function read(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}
test('a physical line has one marker and keeps each source span', () => {
  const part = read(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:rPr><w:del w:id="1" w:author="Editor"/></w:rPr></w:pPr><w:r><w:t>Stock</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>. Body</w:t></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const numbering = read(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    '/word/numbering.xml'
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: {
      measure: (text) => text.length * 5,
      lineMetrics: () => ({ height: 12, baseline: 9 }),
    },
    numberingIndex: buildNumberingIndex(numbering.root),
    displayMode: 'proposed',
  });
  const result = recordLayoutText({ ...layout, reviewArtifacts: [] });
  expect(result.pages[0]!.lines).toHaveLength(1);
  const line = result.pages[0]!.lines[0]!;
  expect(line.text).toBe('1. Stock. Body');
  expect(new Set(line.spans.map((span) => span.sourceRange?.paragraphId)).size).toBe(2);
  expect(line.spans[0]!.sourceRange).toMatchObject({ start: 0, end: 5 });
  expect(line.spans[1]!.sourceRange).toMatchObject({ start: 0 });
  expect(line.spans.at(-1)!.sourceRange).toMatchObject({ end: 6 });
  const hidden = {
    ...layout,
    pages: layout.pages.map((page) => ({
      ...page,
      fragments: page.fragments.map((fragment) =>
        fragment.kind === 'paragraph' && fragment.marker
          ? {
              ...fragment,
              marker: { ...fragment.marker, style: { ...fragment.marker.style, hidden: true } },
            }
          : fragment
      ),
    })),
  };
  expect(recordLayoutText({ ...hidden, reviewArtifacts: [] }).pages[0]!.lines[0]!.text).toBe(
    'Stock. Body'
  );
});
