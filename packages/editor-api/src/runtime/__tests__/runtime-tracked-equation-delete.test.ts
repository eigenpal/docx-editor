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

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const EQUATION = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
const bytes = docx(
  `<w:p ${M}><w:r><w:t xml:space="preserve">Let </w:t></w:r>${EQUATION}` +
    `<w:r><w:t xml:space="preserve"> hold.</w:t></w:r></w:p>`
);

async function documentXml(runtime: DocxEditorServerRuntime): Promise<string> {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

test('a tracked deletion over an equation strikes it, and accept or reject decides it', async () => {
  const runtime = await DocxEditor.createServer(bytes, { author: 'Review agent' });
  try {
    await runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const found = c.document.body.paragraphs.getFirst().search('Let ￼ hold');
      found.load('items');
      await c.sync();
      found.items[0]!.delete();
      await c.sync();
    });
    expect(await documentXml(runtime)).toMatch(/<w:del [^>]*>.*<m:oMath>.*<\/w:del>/);

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
        expect(xml.includes(EQUATION)).toBe(kept);
        expect(xml).not.toContain('<w:del');
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    runtime.dispose();
  }
});
