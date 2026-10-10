/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text inserted into an empty paragraph whose mark names a character style takes that style.
//
// An anonymous probe inserted text into such a paragraph through a range and saved it: the run
// carried the mark's `w:rStyle`. The store copies the mark's own reference when it mints the
// run, so an automation insert gets it the same way the keyboard does.

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import { docx } from './support/docx.ts';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:rPr><w:sz w:val="24"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Big"><w:name w:val="Big"/>' +
  '<w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>';

test('insertText into an empty paragraph keeps the mark character style', async () => {
  const runtime = await DocxEditor.createServer(
    docx('<w:p><w:pPr><w:rPr><w:rStyle w:val="Big"/></w:rPr></w:pPr></w:p>', STYLES)
  );
  try {
    await runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText('typed', 'Start');
      await context.sync();
    });
    // `Word.Font` reads report direct formatting only, so the saved run is the evidence.
    const saved = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
    expect(saved).toContain('<w:r><w:rPr><w:rStyle w:val="Big"/></w:rPr><w:t>typed</w:t></w:r>');
  } finally {
    runtime.dispose();
  }
});
