// A heading that opens with a page break writes its heading marker on the page of its text.
//
// The break lays out as its own fragment at the end of the page before. It writes nothing, so
// that page ends with the body text and the next page opens with the heading.

import { expect, test } from 'bun:test';
import { openDocumentForExport } from '@docx-editor.dev/core/export';
import { exportMarkdownFrom, type MarkdownExportResult } from '../src/index.ts';
import { docx } from './fixture.ts';

async function exportMarkdown(bytes: Uint8Array): Promise<MarkdownExportResult> {
  const opened = openDocumentForExport(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return await exportMarkdownFrom(opened.session);
  } finally {
    opened.session.dispose();
  }
}

const heading = (runs: string) => `<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>${runs}</w:p>`;
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const body = (value: string) => `<w:p>${text(value)}</w:p>`;
const PAGE_BREAK = '<w:r><w:br w:type="page"/></w:r>';

test('the heading marker moves with the text to the page after a leading page break', async () => {
  const result = await exportMarkdown(
    docx(
      heading(text('First heading')) +
        body('Body text on page 1.') +
        heading(PAGE_BREAK + text('Second heading')) +
        body('Body text on page 2.')
    )
  );
  expect(result.markdown).toBe(
    '# First heading\n\nBody text on page 1\\.\n\n# Second heading\n\nBody text on page 2\\.'
  );
  expect(result.pages.map((page) => page.markdown)).toEqual([
    '# First heading\n\nBody text on page 1\\.',
    '# Second heading\n\nBody text on page 2\\.',
  ]);
});

test('a page break and its text in one run give the same Markdown', async () => {
  const result = await exportMarkdown(
    docx(body('Page 1.') + heading('<w:r><w:br w:type="page"/><w:t>Second heading</w:t></w:r>'))
  );
  expect(result.pages.map((page) => page.markdown)).toEqual(['Page 1\\.', '# Second heading']);
});

test('a heading split by a page break after its text keeps one marker', async () => {
  const result = await exportMarkdown(
    docx(heading(text('Split') + PAGE_BREAK + text('heading')) + body('After.'))
  );
  expect(result.pages.map((page) => page.markdown)).toEqual(['# Split<br>', 'heading\n\nAfter\\.']);
});
