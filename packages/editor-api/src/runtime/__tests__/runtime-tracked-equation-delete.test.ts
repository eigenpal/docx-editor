/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import { DocxEditorError } from '../errors.ts';
import { docx } from './support/docx.ts';

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const bytes = docx(
  `<w:p ${M}><w:r><w:t xml:space="preserve">Let </w:t></w:r>` +
    `<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>` +
    `<w:r><w:t xml:space="preserve"> hold.</w:t></w:r></w:p>`
);

test('a tracked deletion over an equation refuses and leaves the paragraph unchanged', async () => {
  const runtime = await DocxEditor.createServer(bytes, { author: 'Review agent' });
  try {
    const before = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
    let error: unknown;
    try {
      await runtime.run(async (c) => {
        const paragraphs = c.document.body.paragraphs;
        paragraphs.load('items');
        await c.sync();
        c.document.changeTrackingMode = 'TrackMineOnly';
        paragraphs.items[0]!.getRange('Whole').delete();
        await c.sync();
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocxEditorError);
    expect((error as DocxEditorError).debugInfo.innerError?.code).toBe('edit.unsupported-content');
    const after = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
    expect(after).toBe(before);
  } finally {
    runtime.dispose();
  }
});
