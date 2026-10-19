/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import type { DocxEditorServerRuntime } from '../runtime.ts';
import { docx } from './support/docx.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const control =
  '<w:sdt><w:sdtPr><w:tag w:val="acme:ref"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
  `<w:sdtContent>${run('SEQ 1')}</w:sdtContent></w:sdt>`;
const bytes = docx(`<w:p>${run('binds ')}${control}${run(' in full.')}</w:p>`);

async function documentXml(runtime: DocxEditorServerRuntime): Promise<string> {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

test('a tracked deletion over a whole content-locked control proposes removing it', async () => {
  const runtime = await DocxEditor.createServer(bytes, { author: 'Review agent' });
  try {
    await runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const found = c.document.body.paragraphs.getFirst().search('binds SEQ 1 in');
      found.load('items');
      await c.sync();
      found.items[0]!.delete();
      await c.sync();
    });
    expect(await documentXml(runtime)).toMatch(/<w:del [^>]*>.*<w:sdt>.*<\/w:sdt>.*<\/w:del>/);

    for (const [decision, kept] of [
      ['acceptAll', false],
      ['rejectAll', true],
    ] as const) {
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        await reopened.run(async (c) => {
          c.document.body.getRange('Whole').revisions[decision]();
          await c.sync();
        });
        const xml = await documentXml(reopened);
        expect(xml.includes('acme:ref')).toBe(kept);
        expect(xml).not.toContain('<w:del');
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    runtime.dispose();
  }
});
