/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Page breaks, section breaks, and tables proposed through the Office.js shape: set
// changeTrackingMode, then write as usual. Rejecting every change gives back the paragraphs.
import { describe, expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import type { Paragraph } from '../paragraph.ts';
import { docx, mainXmlOf, p } from './support/documents.ts';

const TEXTS = ['Heading text', 'Body one.', 'Body two.'];

/** Proposes one write anchored on the second paragraph, then rejects every change. */
async function proposeThenReject(
  write: (paragraph: Paragraph) => void
): Promise<{ readonly proposed: string; readonly texts: string[] }> {
  const source = TEXTS.map(p).join('') + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
  const runtime: DocxEditorServerRuntime = await createServer(docx(source), { author: 'Reviewer' });
  try {
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      context.document.changeTrackingMode = 'TrackMineOnly';
      write(paragraphs.items[1]!);
      await context.sync();
    });
    const proposed = await mainXmlOf(runtime);
    const texts = await runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    return { proposed, texts };
  } finally {
    runtime.dispose();
  }
}

describe('tracked breaks and tables through the Office.js shape', () => {
  test('a tracked page break is an inserted break that reject removes', async () => {
    const { proposed, texts } = await proposeThenReject((paragraph) =>
      paragraph.getRange('Start').insertBreak('Page', 'After')
    );
    expect(proposed).toMatch(/<w:ins [^>]*><w:r><w:br w:type="page"\/><\/w:r><\/w:ins>/);
    expect(texts).toEqual(TEXTS);
  });

  test('a tracked section break is an inserted mark with the section that reject removes', async () => {
    const { proposed, texts } = await proposeThenReject((paragraph) =>
      paragraph.getRange('Start').insertBreak('SectionNext', 'After')
    );
    expect(proposed).toMatch(/<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><w:sectPr>/);
    expect(texts).toEqual(TEXTS);
  });

  test('a tracked table changes no paragraph mark around it', async () => {
    const { proposed, texts } = await proposeThenReject((paragraph) => {
      paragraph.getRange('End').insertTable(1, 2, 'After', [['A', 'B']]);
    });
    expect(proposed.replace(/<w:tbl>[\s\S]*<\/w:tbl>/, '')).not.toContain('<w:ins ');
    expect(proposed).not.toContain('<w:cellIns');
    expect(texts).toEqual(TEXTS);
  });
});
