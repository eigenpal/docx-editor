import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paint(tblPr: string, fill = '') {
  const cell = (tcPr: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${tcPr}</w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;
  const body =
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/>${tblPr}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `<w:tr>${cell('')}${cell(fill)}</w:tr></w:tbl><w:p/>`;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  return container;
}

const SHADED = '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>';
const SPACING = '<w:tblCellSpacing w:w="100" w:type="dxa"/>';

test('the gaps of a spaced table paint its fill under the rows, cut around the cells', () => {
  const container = paint(
    SPACING + SHADED,
    '<w:shd w:val="clear" w:color="auto" w:fill="FFE699"/>'
  );
  const fragment = container.querySelector<HTMLElement>('.docx-table-fragment')!;
  const band = fragment.querySelector<HTMLElement>(':scope > .docx-table-spacing-shading')!;
  expect(band).not.toBeNull();
  // The band is the first child, so every row paints over it.
  expect(fragment.firstElementChild).toBe(band);
  expect(band.getAttribute('aria-hidden')).toBe('true');
  expect(band.style.backgroundColor).toMatch(/^(#D9E2F3|rgb\(217, 226, 243\))$/i);
  expect(band.style.pointerEvents).toBe('none');
  // Even-odd: the band outline, then one hole per cell.
  expect(band.style.clipPath).toMatch(/^path\(evenodd, "M0 0H[^Z]*Z(M[^Z]*Z){2}"\)$/);
  const cells = [...container.querySelectorAll<HTMLElement>('.docx-table-cell')];
  expect(cells[0]!.style.backgroundColor).toBe('');
  expect(cells[1]!.style.backgroundColor).toMatch(/^(#FFE699|rgb\(255, 230, 153\))$/i);
});

test('a table without spacing paints no band, and its unshaded cells stay unshaded', () => {
  const container = paint(SHADED);
  expect(container.querySelector('.docx-table-spacing-shading')).toBeNull();
  for (const cell of container.querySelectorAll<HTMLElement>('.docx-table-cell'))
    expect(cell.style.backgroundColor).toBe('');
});
