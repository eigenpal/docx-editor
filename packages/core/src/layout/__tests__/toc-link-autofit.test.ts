import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, createFixedMeasurer } from '../index.ts';
import { autofitContextOf, paragraphContentWidthsPt } from '../table-autofit-widths.ts';
import type { TextMeasurer } from '../text-measurer.ts';
import type { TocLinkRanges } from '../toc-link-formatting.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// The built-in Hyperlink style under a numeric id. It is bold, so it changes the text width.
const styles = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="37">` +
      '<w:name w:val="Hyperlink"/><w:rPr><w:b/><w:u w:val="single"/></w:rPr></w:style></w:styles>',
    '/word/styles.xml'
  ).root
);

const document = read(
  `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="600"/></w:tblGrid><w:tr><w:tc><w:p>' +
    '<w:hyperlink w:anchor="_TocA"><w:r><w:rPr><w:rStyle w:val="37"/></w:rPr>' +
    '<w:t>ABCDEFGHIJ</w:t></w:r></w:hyperlink></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  '/word/document.xml'
);

function cellParagraph(node: OoxmlNode): OoxmlNode | undefined {
  if (node.kind === 'paragraph') return node;
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    const found = cellParagraph(child);
    if (found) return found;
  }
  return undefined;
}

/** Bold text measures twice as wide, so the minimum shows which style applied. */
function boldAwareMeasurer(): TextMeasurer {
  const fixed = createFixedMeasurer(6, 12);
  return { ...fixed, measure: (text, style) => fixed.measure(text, style) * (style.bold ? 2 : 1) };
}

function widths(ranges?: TocLinkRanges) {
  const paragraph = cellParagraph(document.root);
  if (paragraph?.kind !== 'paragraph') throw new Error('no cell paragraph');
  const context = autofitContextOf({
    measurer: boldAwareMeasurer(),
    tocLinkStyleRanges: ranges,
  });
  const view = {
    styleCascade: styles,
    displayMode: 'all-markup' as const,
    authorFilter: undefined,
    readNested: () => null,
  };
  return paragraphContentWidthsPt(paragraph, { context, view, tableCellStyle: undefined });
}

// Body TOC detection does not enter table cells, so the ranges come in directly here, with
// the style ids that TOC detection resolves by definition. Autofit column widths
// (`w:tblLayout` `autofit`) must drop them as paint does.
test('autofit column widths measure TOC link text in a cell without the numeric-id Hyperlink style', () => {
  const paragraph = cellParagraph(document.root)!;
  const styled = widths();
  const linked = widths(new Map([[paragraph.id, [{ start: 0, end: 10, styleIds: ['37'] }]]]));
  // Ten characters at the default size: the bold style doubles the plain width.
  expect(linked.min).toBeGreaterThan(0);
  expect(styled.min).toBeCloseTo(2 * linked.min, 6);
  expect(linked.max).toBeCloseTo(linked.min, 6);
});
