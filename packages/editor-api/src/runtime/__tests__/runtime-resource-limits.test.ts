/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { DocxEditor, DocxEditorError, type DocumentLimits } from '../../index.ts';
import { docx, p } from './support/docx.ts';

// Store entries without compression so synthetic repetition does not trip the ratio guard.
function storedDocx(body: string): Uint8Array {
  const entries = unzipSync(docx(''));
  entries['word/document.xml'] = strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`
  );
  return zipSync(entries, { level: 0 });
}

describe('server resource limits', () => {
  test('opens 101,322 formatted paragraphs with more than one million XML elements', async () => {
    const count = 101_322;
    // Eleven elements per paragraph: the old one-million-element ceiling rejects this.
    const paragraph =
      '<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="left"/>' +
      '<w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:i/><w:sz w:val="22"/></w:rPr>' +
      '<w:t>large document</w:t></w:r></w:p>';
    const bytes = storedDocx(paragraph.repeat(count));
    await expect(
      DocxEditor.createServer(bytes, {
        limits: { xml: { maxBytes: 64 * 1024 * 1024, maxElements: 1_000_000 } },
      })
    ).rejects.toMatchObject({ code: 'ResourceLimitExceeded', limit: 'xml.maxElements' });
    const runtime = await DocxEditor.createServer(bytes);
    try {
      await runtime.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        await context.sync();
        expect(body.text.split('large document').length - 1).toBe(count);
      });
    } finally {
      runtime.dispose();
    }
  }, 60_000);

  const cases: [string, DocumentLimits, string][] = [
    ['archive entries', { zip: { maxEntries: 1, maxTotalBytes: 100_000 } }, 'zip.maxEntries'],
    ['archive bytes', { zip: { maxEntries: 10, maxTotalBytes: 1 } }, 'zip.maxTotalBytes'],
    [
      'compression ratio',
      { zip: { maxEntries: 10, maxTotalBytes: 100_000, maxRatio: 1 } },
      'zip.maxRatio',
    ],
    ['XML bytes', { xml: { maxBytes: 1 } }, 'xml.maxBytes'],
    ['content types elements', { xml: { maxBytes: 100_000, maxElements: 1 } }, 'xml.maxElements'],
    ['document elements', { xml: { maxBytes: 100_000, maxElements: 4 } }, 'xml.maxElements'],
    ['XML parts', { maxXmlParts: 0 }, 'maxXmlParts'],
    ['relationships', { maxRelationships: 0 }, 'maxRelationships'],
  ];
  test.each(cases)('identifies the exceeded %s limit', async (_, limits, limit) => {
    const error = await DocxEditor.createServer(docx(p('private document text')), { limits }).catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(DocxEditorError);
    expect(error).toMatchObject({ code: 'ResourceLimitExceeded', target: 'createServer', limit });
    expect((error as Error).message).not.toContain('private document text');
    expect((error as Error).message).not.toContain('word/document.xml');
  });

  test('identifies the hard XML depth limit', async () => {
    await expect(
      DocxEditor.createServer(
        storedDocx('<w:sdt>'.repeat(256) + p('deep') + '</w:sdt>'.repeat(256))
      )
    ).rejects.toMatchObject({ code: 'ResourceLimitExceeded', limit: 'xml.maxDepth' });
  });

  test.each<DocumentLimits>([
    { zip: { maxEntries: -1, maxTotalBytes: 100_000 } },
    { zip: { maxEntries: 10, maxTotalBytes: -1 } },
    { zip: { maxEntries: 10, maxTotalBytes: 100_000, maxRatio: -1 } },
    { maxXmlParts: -1 },
    { maxRelationships: -1 },
    { zip: { maxEntries: Infinity, maxTotalBytes: 100_000 } },
    { zip: { maxEntries: 10, maxTotalBytes: 100_000, maxRatio: NaN } },
    { maxRelationships: NaN },
    { maxXmlParts: 0.5 },
  ])('rejects invalid caller budgets as arguments: %j', async (limits) => {
    await expect(DocxEditor.createServer(docx(p('text')), { limits })).rejects.toMatchObject({
      code: 'InvalidArgument',
      target: 'createServer',
    });
  });

  test('accepts fractional compression-ratio budgets', async () => {
    const runtime = await DocxEditor.createServer(docx(p('text')), {
      limits: { zip: { maxEntries: 10, maxTotalBytes: 100_000, maxRatio: 200.5 } },
    });
    runtime.dispose();
  });

  test('keeps malformed input and invalid limit configuration as InvalidArgument', async () => {
    for (const [bytes, limits] of [
      [new Uint8Array([1, 2, 3]), undefined],
      [docx(p('text')), { xml: { maxBytes: Number.NaN } }],
      [storedDocx('<!DOCTYPE x><w:p/>'), undefined],
    ] as const) {
      await expect(DocxEditor.createServer(bytes, { limits })).rejects.toMatchObject({
        code: 'InvalidArgument',
        target: 'createServer',
      });
    }
  });
});
