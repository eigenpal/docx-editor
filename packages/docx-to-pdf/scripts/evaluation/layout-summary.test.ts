import { expect, test } from 'bun:test';
import { docx, paragraph } from '../../test/fixture.ts';
import { exportPdf } from '../../src/index.ts';
import { summarizePages } from './layout-summary.ts';

test('pagination-only session agrees with PDF export for page breaks and tables', async () => {
  const source = docx(
    paragraph('First page') +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr/>' +
      paragraph('Second page cell') +
      '</w:tc></w:tr></w:tbl>'
  );
  const summary = await summarizePages(source);
  const pdf = await exportPdf(source, {
    displayMode: 'proposed',
    comments: false,
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
  });
  expect(summary.pageCount).toBe(2);
  expect(summary.pageCount).toBe(pdf.pageCount);
  expect(summary.textStatus).toBe('not-measured');
  expect(summary.visualStatus).toBe('not-measured');
});

test('pagination-only session refuses invalid documents', async () => {
  await expect(summarizePages(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});
