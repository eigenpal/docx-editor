import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { elevenPointDefaults } from '../../layout/__tests__/fixtures/eleven-point-defaults.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

function paint(body: string): HTMLElement {
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 7, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: elevenPointDefaults(),
  });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  return container;
}

test('exact spacing fills each marked advance for the full line in body and cells', () => {
  const formatted =
    '<w:p><w:pPr><w:spacing w:line="580" w:lineRule="exact"/></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="16"/><w:highlight w:val="yellow"/></w:rPr><w:t>small</w:t></w:r>' +
    '<w:r><w:t>plain</w:t></w:r>' +
    '<w:r><w:rPr><w:sz w:val="32"/><w:highlight w:val="green"/></w:rPr><w:t>large</w:t></w:r></w:p>';
  const cell =
    '<w:tbl><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc>' +
    formatted +
    '</w:tc></w:tr></w:tbl>';
  const container = paint(formatted + cell);
  const layers = [...container.querySelectorAll<HTMLElement>('.docx-exact-line-highlight')];
  expect(layers).toHaveLength(2);
  for (const layer of layers) {
    const bands = [...layer.querySelectorAll<HTMLElement>('[data-highlight]')];
    expect(bands.map((band) => band.dataset.highlight)).toEqual(['yellow', 'green']);
    expect(bands.map((band) => band.style.height)).toEqual(['29px', '29px']);
    expect(bands.map((band) => band.style.top)).toEqual(['0px', '0px']);
    expect(parseFloat(bands[0]!.style.left) + parseFloat(bands[0]!.style.width)).toBeLessThan(
      parseFloat(bands[1]!.style.left)
    );
  }
  const automatic = paint(
    formatted.replace('w:line="580" w:lineRule="exact"', 'w:line="360" w:lineRule="auto"')
  );
  expect(automatic.querySelector('.docx-exact-line-highlight')).toBeNull();
  expect(automatic.querySelectorAll('.layout-run[data-highlight]')).toHaveLength(2);
});
