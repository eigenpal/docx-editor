/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import { docx } from './support/documents.ts';

const document = () =>
  docx(
    '<w:sdt><w:sdtPr><w:tag w:val="locked"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
      '<w:sdtContent><w:p><w:pPr><w:ind w:left="240"/><w:jc w:val="left"/></w:pPr>' +
      '<w:r><w:t>LOCKED</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p/><w:sectPr/>'
  );

for (const decision of ['plain', 'accept', 'reject'] as const) {
  test(`Paragraph.alignment in a locked block supports ${decision} changes`, async () => {
    const runtime = await createServer(document(), { author: 'Reviewer' });
    try {
      await runtime.run(async (context) => {
        if (decision !== 'plain') context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.alignment = 'Centered';
        await context.sync();
        paragraph.load('alignment,text,leftIndent');
        const revisions = context.document.revisions;
        revisions.load('items/type');
        await context.sync();
        expect(paragraph.alignment).toBe('Centered');
        expect(paragraph.text).toBe('LOCKED');
        expect(paragraph.leftIndent).toBe(12);
        expect(revisions.items).toHaveLength(decision === 'plain' ? 0 : 1);
        if (decision === 'plain') return;
        if (decision === 'accept') revisions.items[0]!.accept();
        else revisions.items[0]!.reject();
        await context.sync();
        paragraph.load('alignment,text,leftIndent');
        revisions.load('items');
        await context.sync();
        expect(String(paragraph.alignment)).toBe(decision === 'accept' ? 'Centered' : 'Left');
        expect(paragraph.text).toBe('LOCKED');
        expect(paragraph.leftIndent).toBe(12);
        expect(revisions.items).toHaveLength(0);
      });
    } finally {
      runtime.dispose();
    }
  });
}
