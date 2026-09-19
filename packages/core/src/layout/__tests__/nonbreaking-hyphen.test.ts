import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

test('preserved noBreakHyphen paints without changing canonical offsets or permitting a break', () => {
  const opened = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>A No</w:t><w:noBreakHyphen/><w:t>Break</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="1880" w:h="3000"/><w:pgMar w:left="400" w:right="400" w:top="200" w:bottom="200"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  const layout = layoutSemanticDocument(opened.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const paragraph = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  if (paragraph.kind !== 'paragraph') throw new Error('Missing paragraph');
  expect(paragraph.lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'A ',
    'No\u2011Break',
  ]);
  const hyphen = paragraph.lines
    .flatMap((line) => line.spans)
    .find((span) => span.text === '\u2011')!;
  expect(hyphen.range.start).toBe(4);
  expect(hyphen.range.end).toBe(4);
});
