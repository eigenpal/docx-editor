/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A tracked delete over a simple field is one revision the API lists and can resolve.

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createServer } from '../../runtime/server.ts';
import { docx } from './support/documents.ts';

const xml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);

for (const field of [
  '<w:fldSimple w:instr="PAGE"/>',
  '<w:fldSimple w:instr=" AUTHOR "><w:r><w:t>Someone</w:t></w:r></w:fldSimple>',
]) {
  test(`a tracked delete over ${field.slice(0, 40)}… is a listed revision`, async () => {
    const server = await createServer(
      docx(`<w:p><w:r><w:t xml:space="preserve">Field: </w:t></w:r>${field}</w:p>`),
      { author: 'Ada Lovelace' }
    );
    try {
      await server.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        context.document.changeTrackingMode = 'TrackMineOnly';
        paragraphs.items[0]!.getRange('Content').delete();
        await context.sync();
        const revisions = context.document.revisions;
        revisions.load('items');
        await context.sync();
        for (const revision of revisions.items) revision.load(['author', 'type']);
        await context.sync();
        expect(revisions.items.map((revision) => [revision.type, revision.author])).toEqual([
          ['Delete', 'Ada Lovelace'],
        ]);
      });
      const saved = xml(await server.save());
      expect(saved).not.toContain('fldSimple');
      expect(saved).toMatch(/<w:del [^>]*>.*<w:fldChar w:fldCharType="begin"\/>.*<w:delInstrText/);
      await server.run(async (context) => {
        const revisions = context.document.revisions;
        revisions.load('items');
        await context.sync();
        revisions.items[0]!.reject();
        await context.sync();
      });
      const rejected = xml(await server.save());
      expect(rejected).not.toContain('<w:del ');
      expect(rejected).toContain('w:fldCharType="begin"');
      expect(rejected).toMatch(/<w:instrText[^>]*>\s*(PAGE|AUTHOR)\s*<\/w:instrText>/);
    } finally {
      server.dispose();
    }
  });
}
