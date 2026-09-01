import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FONT_ASSET_MANIFEST } from '@docx-editor.dev/fonts';
import {
  DocumentOpenError,
  ExportResourceError,
  exportMarkdown,
  exportMarkdownFrom,
  openDocumentForExport,
} from '../src/index.ts';
import { docx } from './fixture.ts';

describe('server-first defaults', () => {
  test('one-shot conversion preserves structured DOCX open failures', async () => {
    const error = await exportMarkdown(new Uint8Array([1, 2, 3])).catch((caught) => caught);
    expect(error).toBeInstanceOf(DocumentOpenError);
    expect(error).toMatchObject({ reason: 'inflate-error' });
  });

  test('one-shot conversion exposes layout invariants through the shared typed error', async () => {
    const bytes = docx(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:hRule="exact" w:val="60000"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
        '<w:p><w:r><w:t>Authored overheight row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    );
    const error = await exportMarkdown(bytes).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'layoutInvariant' });
    expect((error as Error).cause).toMatchObject({ name: 'TablePaginationError' });
  });

  test('pins the exact packaged font manifest used by server/browser shaping parity', () => {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(FONT_ASSET_MANIFEST))
      .digest('hex');
    expect(fingerprint).toBe('30eda07ac5b5ac3dc5e5dd3759a66d3552c618003e53cac0a816c0d37df301fe');
  });

  test('uses the shaped path without a DOM and produces a pinned pagination golden', async () => {
    const bytes = docx(
      '<w:p><w:r><w:t>The quick brown fox jumps over the lazy dog repeatedly across this narrow page.</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="2880" w:h="2880"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360"/></w:sectPr>'
    );
    const opened = await openDocumentForExport(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const layout = await opened.session.layout();
      expect(layout.pages).toHaveLength(1);
      const paragraph = layout.pages[0]?.fragments.find(
        (fragment) => fragment.kind === 'paragraph'
      );
      expect(paragraph?.kind === 'paragraph' ? paragraph.lines.length : 0).toBe(4);
      const translated = await exportMarkdown(bytes);
      expect(translated.markdown).toBe(
        'The quick brown fox jumps over the lazy dog repeatedly across this narrow page\\.'
      );
    } finally {
      opened.session.dispose();
    }
  });

  test('pins shaped pagination and translation for the shared comprehensive layout fixture', async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL('../../../e2e/fixtures/comprehensive-word-element-test.docx', import.meta.url)
      )
    );
    const opened = await openDocumentForExport(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const layout = await opened.session.layout();
      const bodyLineCount = layout.pages.reduce(
        (total, page) =>
          total +
          page.fragments.reduce(
            (lines, fragment) =>
              lines + (fragment.kind === 'paragraph' ? fragment.lines.length : 0),
            0
          ),
        0
      );
      const translated = await exportMarkdownFrom(opened.session);
      const markdownHash = createHash('sha256').update(translated.markdown).digest('hex');
      expect({
        pages: layout.pages.length,
        bodyLineCount,
        markdownLength: translated.markdown.length,
        headers: translated.pages.filter((page) => page.headerMarkdown.length > 0).length,
        footers: translated.pages.filter((page) => page.footerMarkdown.length > 0).length,
        markdownHash,
      }).toEqual({
        pages: 26,
        bodyLineCount: 280,
        markdownLength: 17_326,
        headers: 25,
        footers: 25,
        markdownHash: '2db9b8abc4ca12c2a413e375ce38d9e685d75b0dce7d4422148769b27f5b7b43',
      });
      expect(translated.markdown).toStartWith('**COMPREHENSIVE WORD ELEMENT**');
      expect(translated.markdown).toEndWith(
        'Endnote 2: Additional bibliography reference – Smith et al\\., 2025\\.'
      );
    } finally {
      opened.session.dispose();
    }
  });
});
