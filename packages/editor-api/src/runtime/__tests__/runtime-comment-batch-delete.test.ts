/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { commentBatchFixture } from '../../../../core/src/store/__tests__/comment-batch-fixture.ts';
import { DocxEditor } from '../../index.ts';

test('600 thread deletions commit in one sync and survive save and reopen', async () => {
  const runtime = await DocxEditor.createServer(writeOoxmlPackage(commentBatchFixture()));
  try {
    await runtime.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      expect(comments.items).toHaveLength(600);
      for (const comment of comments.items) comment.delete();
      await context.sync();
      comments.load('items');
      await context.sync();
      expect(comments.items).toHaveLength(0);
    });
    const saved = await runtime.save();
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    expect(xml).not.toContain('commentRange');
    expect(xml).not.toContain('commentReference');
    expect(xml.match(/>kept</g)).toHaveLength(600);
    const reopened = await DocxEditor.createServer(saved);
    try {
      await reopened.run(async (context) => {
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        expect(comments.items).toHaveLength(0);
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});
