import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

test('character borders group adjacent formatted runs using placed line geometry', () => {
  const border = '<w:bdr w:val="single" w:sz="4" w:space="0"/>';
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:sz w:val="22"/>${border}</w:rPr><w:t>one</w:t></w:r><w:r><w:rPr><w:sz w:val="22"/>${border}<w:b/></w:rPr><w:t>two</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const rules = container.querySelectorAll<HTMLElement>('.docx-run-border');
  expect(rules).toHaveLength(4);
  expect(container.querySelector<HTMLElement>('.docx-run-border-top')!.style.width).toBe('37px');
  for (const rule of rules) {
    expect(rule.style.position).toBe('absolute');
    expect(rule.getAttribute('aria-hidden')).toBe('true');
    expect(rule.textContent).toBe('');
  }
});

test('a thin character border paints one pixel, and grows inward at the right and bottom', () => {
  // A 1/2pt rule is 0.67px at 96dpi: the browser drops it at some positions.
  const border = '<w:bdr w:val="single" w:sz="4" w:space="0"/>';
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:sz w:val="22"/>${border}</w:rPr><w:t>one</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const rule = (side: string) =>
    container.querySelector<HTMLElement>(`.docx-run-border-${side}`)!.style;
  expect(rule('left').width).toBe('1px');
  expect(rule('right').width).toBe('1px');
  expect(rule('top').height).toBe('1px');
  expect(rule('bottom').height).toBe('1px');
  // The outline is 19pt wide: the right rule ends where layout ends it.
  expect(parseFloat(rule('right').left) + 1 - parseFloat(rule('left').left)).toBe(19);
  expect(parseFloat(rule('bottom').top) + 1).toBe(
    parseFloat(rule('left').top) + parseFloat(rule('left').height)
  );
});

test('the highlight of the text before a border stops at the border', () => {
  const border = '<w:bdr w:val="single" w:sz="8" w:space="6"/>';
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:sz w:val="22"/><w:highlight w:val="yellow"/></w:rPr><w:t>one</w:t></w:r><w:r><w:rPr><w:sz w:val="22"/>${border}</w:rPr><w:t>two</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const spans = [...container.querySelectorAll<HTMLElement>('[data-start]')];
  const highlighted = spans.find((span) => span.textContent === 'one')!;
  expect(highlighted.style.backgroundColor).not.toBe('');
  // The 7pt before `two` is the border's room: no fill reaches into it.
  expect(highlighted.style.boxShadow).toBe('');
});
