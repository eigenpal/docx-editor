import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const RUN = '<w:r><w:rPr><w:sz w:val="22"/></w:rPr>';

function paintAtWidth(chars: number): HTMLElement {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:p>${RUN}<w:t xml:space="preserve">xx aaaa</w:t></w:r>${RUN}<w:softHyphen/></w:r>` +
      `${RUN}<w:t>bbbb</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="${chars * 120 + 800}" w:h="6000"/>` +
      '<w:pgMar w:left="400" w:right="400" w:top="200" w:bottom="200"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const container = document.createElement('div');
  paintSemanticLayout(
    container,
    layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer(6, 14) }),
    { scale: 1 }
  );
  return container;
}

function hyphenElement(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-start="7"][data-end="8"]')!;
}

test('a line that breaks at an optional hyphen paints a visible hyphen over one offset', () => {
  const hyphen = hyphenElement(paintAtWidth(10));
  expect(hyphen.textContent).toBe('-');
  // The next line starts at the next offset, so the painted hyphen owns exactly one.
  expect(hyphen.nextElementSibling).toBeNull();
});

test('an optional hyphen inside a line paints U+00AD with no advance', () => {
  const hyphen = hyphenElement(paintAtWidth(12));
  expect(hyphen.textContent).toBe('­');
});
