import { describe, expect, test } from 'bun:test';
import { paragraphSpacing, MAX_PARAGRAPH_SPACING_PT } from '../paragraph-style.ts';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument, createFixedMeasurer } from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
const p = (attributes: Record<string, string>) => ({ localName: 'spacing', attributes });

describe('Word line-unit paragraph margins', () => {
  test('uses 12pt units independently of paragraph line height', () => {
    for (const lineRule of ['auto', 'exact', 'atLeast'])
      expect(
        paragraphSpacing([p({ beforeLines: '100', afterLines: '150', line: '600', lineRule })])
      ).toEqual({ before: 12, after: 18 });
  });
  test('positive line units override twips; zero line units leave the twips in force', () => {
    expect(
      paragraphSpacing([p({ before: '900', after: '800', beforeLines: '0', afterLines: '50' })])
    ).toEqual({ before: 45, after: 6 });
  });
  // Each row is a cascade: [style, paragraph] → points after.
  test.each([
    ['direct points with zero lines', [{}, { after: '360', afterLines: '0' }], 18],
    ['direct points with positive lines', [{}, { after: '360', afterLines: '50' }], 6],
    ['zero lines over style lines', [{ afterLines: '100' }, { after: '360', afterLines: '0' }], 18],
    ['direct points under style lines', [{ afterLines: '100' }, { after: '360' }], 12],
    ['style points with zero lines', [{ after: '360', afterLines: '0' }, {}], 18],
    ['zero lines alone cancel style lines', [{ afterLines: '100' }, { afterLines: '0' }], 0],
    ['zero lines keep style points', [{ after: '360' }, { afterLines: '0' }], 18],
    [
      'zero lines fall back to the points beside style lines',
      [{ after: '120', afterLines: '100' }, { afterLines: '0' }],
      6,
    ],
  ] as const)('%s', (_name, [style, direct], after) => {
    expect(paragraphSpacing([p(style), p(direct)]).after).toBe(after);
  });
  test('zero line units leave the points before a paragraph in force', () => {
    expect(paragraphSpacing([p({ before: '360', beforeLines: '0' })]).before).toBe(18);
    expect(
      paragraphSpacing([p({ beforeLines: '50' }), p({ before: '300', beforeLines: '0' })]).before
    ).toBe(15);
  });
  test('inherits line units independently; automatic spacing has precedence', () => {
    expect(
      paragraphSpacing([
        p({ beforeLines: '200', afterLines: '100' }),
        p({ afterLines: '50', before: '60' }),
      ])
    ).toEqual({ before: 24, after: 6 });
    expect(
      paragraphSpacing([p({ beforeLines: '200', beforeAutospacing: '1' })], { inList: true })
    ).toEqual({ before: 0, after: 0 });
    expect(
      paragraphSpacing([
        p({ beforeLines: '200', beforeAutospacing: '1' }),
        p({ beforeAutospacing: '0' }),
      ])
    ).toEqual({ before: 24, after: 0 });
  });
  test('uses the section grid pitch and bounds hostile values', () => {
    expect(
      paragraphSpacing([p({ beforeLines: '100', afterLines: '50' })], { lineUnitPt: 20 })
    ).toEqual({ before: 20, after: 10 });
    expect(paragraphSpacing([p({ beforeLines: '-100', afterLines: '999999999' })])).toEqual({
      before: 0,
      after: MAX_PARAGRAPH_SPACING_PT,
    });
    expect(paragraphSpacing([p({ before: '240', beforeLines: 'bad', afterLines: '1e9' })])).toEqual(
      { before: 12, after: 0 }
    );
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function documentWithGrid(pitch: number, cell = false, contextual = false) {
  const paragraph =
    '<w:p><w:pPr><w:spacing w:afterLines="100"/></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>'.replace(
      '</w:pPr>',
      contextual ? '<w:contextualSpacing/></w:pPr>' : '</w:pPr>'
    );
  const body = cell
    ? `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc>${paragraph}${paragraph}</w:tc></w:tr></w:tbl>`
    : paragraph + paragraph;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:docGrid w:type="lines" w:linePitch="${pitch}"/></w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
function paragraphMargins(value: unknown): number[] {
  if (!value || typeof value !== 'object') return [];
  if ('kind' in value && value.kind === 'paragraph' && 'spacing' in value)
    return [(value.spacing as { after: number }).after];
  return Object.values(value).flatMap(paragraphMargins);
}
test.each([false, true])(
  'grid spacing reaches body and cell layout, and invalidates cached layout: cell=%s',
  (cell) => {
    const cache = createParagraphLayoutCache();
    const session = createLayoutSession();
    const options = { cache, session, measurer: createFixedMeasurer(6, 14) };
    const first = layoutSemanticDocument(documentWithGrid(400, cell), 1, options);
    expect(paragraphMargins(first.pages)).toContain(20);
    const part = documentWithGrid(600, cell);
    const next = layoutSemanticDocument(part, 2, options);
    const cold = layoutSemanticDocument(part, 2, { measurer: options.measurer });
    expect(next.pages).toEqual(cold.pages);
    expect(paragraphMargins(next.pages)).toContain(30);
  }
);

test.each([false, true])(
  'contextual line-unit spacing uses implicit default styles in body and cells: %s',
  (cell) => {
    const layout = layoutSemanticDocument(documentWithGrid(240, cell, true), 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    // The last cell paragraph compares with the row end mark, which is in the same implicit
    // style. A body ending with the cell's table reads an empty paragraph after it, with no space.
    expect(paragraphMargins(layout.pages)).toEqual(cell ? [0, 0, 0] : [0, 12]);
  }
);

test('each section supplies its own line-unit pitch', () => {
  const section = (pitch: number) =>
    `<w:sectPr><w:docGrid w:type="lines" w:linePitch="${pitch}"/></w:sectPr>`;
  const paragraph = (tail = '') =>
    `<w:p><w:pPr><w:spacing w:afterLines="100"/>${tail}</w:pPr><w:r><w:t>Text</w:t></w:r></w:p>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${paragraph(section(400))}${paragraph()}${section(600)}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer(6, 14) });
  expect(paragraphMargins(layout.pages)).toEqual([20, 30]);
});
