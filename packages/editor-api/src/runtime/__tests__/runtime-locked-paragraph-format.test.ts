/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraph writes inside a content-locked control: indents, spacing, line spacing, and
// alignment apply, plainly or as one tracked paragraph property change. Text stays locked.

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import type { RequestContext } from '../../index.ts';
import { docx } from './support/docx.ts';

const BYTES = docx(
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
    '<w:p><w:pPr><w:ind w:left="240"/></w:pPr><w:r><w:t>LOCKED</w:t></w:r></w:p>' +
    '</w:sdtContent></w:sdt><w:p><w:r><w:t>free</w:t></w:r></w:p>'
);

/** The locked paragraph's `w:pPr` in the saved package, without dates or ids. */
async function lockedProperties(runtime: { save(): Promise<Uint8Array> }): Promise<string> {
  const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!)
    .replace(/ xmlns:\w+="[^"]*"/g, '')
    .replace(/ w:(date|id)="[^"]*"/g, '');
  return /<w:sdtContent><w:p\b[^>]*>(<w:pPr>.*?<\/w:pPr>)(?=<w:r\b)/.exec(xml)?.[1] ?? '';
}

async function lockedParagraph(c: RequestContext) {
  const paragraphs = c.document.body.paragraphs;
  paragraphs.load('items');
  await c.sync();
  return paragraphs.items[0]!;
}

test('paragraph placement writes apply inside a content-locked control', async () => {
  const runtime = await DocxEditor.createServer(BYTES, { author: 'Agent' });
  try {
    await runtime.run(async (c) => {
      const paragraph = await lockedParagraph(c);
      paragraph.leftIndent = 36;
      paragraph.rightIndent = 18;
      paragraph.firstLineIndent = 9;
      paragraph.spaceBefore = 12;
      paragraph.spaceAfter = 6;
      paragraph.lineSpacing = 18;
      paragraph.alignment = 'Centered';
      await c.sync();
      paragraph.load('leftIndent,rightIndent,firstLineIndent,spaceBefore,spaceAfter,alignment');
      await c.sync();
      expect(paragraph.leftIndent).toBe(36);
      expect(paragraph.rightIndent).toBe(18);
      expect(paragraph.firstLineIndent).toBe(9);
      expect(paragraph.spaceBefore).toBe(12);
      expect(paragraph.spaceAfter).toBe(6);
      expect(paragraph.alignment).toBe('Centered');
    });
    const saved = await lockedProperties(runtime);
    expect(saved).toContain('w:left="720"');
    expect(saved).toContain('w:right="360"');
    expect(saved).toContain('w:firstLine="180"');
    expect(saved).toContain('<w:jc w:val="center"/>');
    // The text itself stays locked.
    await runtime.run(async (c) => {
      (await lockedParagraph(c)).insertText('X', 'End');
      await expect(c.sync()).rejects.toThrow();
    });
  } finally {
    runtime.dispose();
  }
});

test('tracked placement writes in a lock record one paragraph property change', async () => {
  const runtime = await DocxEditor.createServer(BYTES, { author: 'Agent' });
  try {
    await runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = await lockedParagraph(c);
      paragraph.leftIndent = 36;
      paragraph.spaceBefore = 12;
      await c.sync();
    });
    const saved = await lockedProperties(runtime);
    expect(saved.match(/<w:pPrChange /g)?.length).toBe(1);
    expect(saved).toContain('<w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange>');
  } finally {
    runtime.dispose();
  }
});

const BOUND = docx(
  '<w:sdt><w:sdtPr><w:tag w:val="t"/>' +
    '<w:dataBinding w:storeItemID="{1}" w:xpath="/root/value"/><w:text/></w:sdtPr><w:sdtContent>' +
    '<w:p><w:pPr><w:ind w:left="240"/></w:pPr><w:r><w:t>LOCKED</w:t></w:r></w:p>' +
    '</w:sdtContent></w:sdt><w:p><w:r><w:t>free</w:t></w:r></w:p>'
);

test('paragraph writes apply inside a data-bound control and keep the bound text', async () => {
  const runtime = await DocxEditor.createServer(BOUND, { author: 'Agent' });
  try {
    await runtime.run(async (c) => {
      const paragraph = await lockedParagraph(c);
      paragraph.leftIndent = 36;
      paragraph.alignment = 'Centered';
      await c.sync();
      c.document.changeTrackingMode = 'TrackMineOnly';
      paragraph.spaceBefore = 12;
      await c.sync();
    });
    const saved = await lockedProperties(runtime);
    expect(saved).toContain('w:left="720"');
    expect(saved).toContain('<w:jc w:val="center"/>');
    expect(saved.match(/<w:pPrChange /g)?.length).toBe(1);
    const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
    expect(xml).toContain('w:dataBinding');
    expect(xml).toContain('<w:t>LOCKED</w:t>');
    // The bound text itself stays protected.
    await runtime.run(async (c) => {
      (await lockedParagraph(c)).insertText('X', 'End');
      await expect(c.sync()).rejects.toThrow();
    });
  } finally {
    runtime.dispose();
  }
});
