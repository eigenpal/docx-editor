/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Body.insertParagraph at Start or End when a table opens or closes the body. The first or last
// paragraph is then inside a cell, and the new paragraph belongs beside the table.
import { describe, expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import type { RequestContext } from '../../index.ts';
import { cell, docx, mainXmlOf, p, row, table } from './support/documents.ts';

const LEADING = docx(`${table(row(cell(p('in cell'))))}${p('after')}`);
const TRAILING = docx(`${p('before')}${table(row(cell(p('in cell'))))}`);

/** The body's blocks in order: a paragraph's text, or the texts of a table's paragraphs. */
async function blocks(runtime: DocxEditorServerRuntime): Promise<string[]> {
  const xml = await mainXmlOf(runtime);
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.indexOf('</w:body>'));
  const pattern = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?: [^>]*)?\/>|<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g;
  const text = (block: string) =>
    [...block.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
  return (body.match(pattern) ?? []).map((block) =>
    block.startsWith('<w:tbl>') ? `[table: ${text(block)}]` : text(block)
  );
}

async function inserted(
  source: Uint8Array,
  write: (context: RequestContext) => { load(names: string): void; text: string },
  author?: string
): Promise<{ blocks: string[]; xml: string }> {
  const runtime = await createServer(source, { author: author ?? 'Writer' });
  try {
    await runtime.run(async (context) => {
      if (author) context.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = write(context);
      paragraph.load('text');
      await context.sync();
      expect(paragraph.text).toBe('new');
    });
    return { blocks: await blocks(runtime), xml: await mainXmlOf(runtime) };
  } finally {
    runtime.dispose();
  }
}

describe('Body.insertParagraph beside a table at the edge of the body', () => {
  test('Start goes before a table that opens the body, not into its first cell', async () => {
    const result = await inserted(LEADING, (context) =>
      context.document.body.insertParagraph('new', 'Start')
    );
    expect(result.blocks).toEqual(['new', '[table: in cell]', 'after']);
  });

  test('End goes after a table that closes the body, not into its last cell', async () => {
    const result = await inserted(TRAILING, (context) =>
      context.document.body.insertParagraph('new', 'End')
    );
    expect(result.blocks).toEqual(['before', '[table: in cell]', 'new']);
  });

  test('a tracked insertion proposes the paragraph and its text', async () => {
    const result = await inserted(
      LEADING,
      (context) => context.document.body.insertParagraph('new', 'Start'),
      'Writer'
    );
    expect(result.blocks).toEqual(['new', '[table: in cell]', 'after']);
    const first = result.xml.slice(result.xml.indexOf('<w:body>'), result.xml.indexOf('<w:tbl>'));
    expect(first).toContain('<w:rPr><w:ins ');
    expect(first).toMatch(/<w:ins [^>]*w:author="Writer"[^>]*><w:r>/);
  });

  test('rejecting the tracked paragraph restores the original body', async () => {
    const runtime = await createServer(LEADING, { author: 'Writer' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        context.document.body.insertParagraph('new', 'Start');
        await context.sync();
        context.document.body.revisions.rejectAll();
        await context.sync();
      });
      expect(await blocks(runtime)).toEqual(['[table: in cell]', 'after']);
    } finally {
      runtime.dispose();
    }
  });

  test('a cell body that opens with a nested table gets the paragraph before it', async () => {
    const source = docx(
      `${p('top')}${table(row(cell(table(row(cell(p('deep')))), p('cell tail'))))}${p('end')}`
    );
    const runtime = await createServer(source, { author: 'Writer' });
    try {
      await runtime.run(async (context) => {
        const body = context.document.body.tables.getFirst().getCell(0, 0).body;
        await context.sync();
        const paragraph = body.insertParagraph('new', 'Start');
        paragraph.load('text');
        await context.sync();
        expect(paragraph.text).toBe('new');
      });
      const xml = await mainXmlOf(runtime);
      const cellXml = xml.slice(xml.indexOf('<w:tc>'), xml.lastIndexOf('</w:tc>'));
      expect(cellXml.indexOf('>new<')).toBeGreaterThan(-1);
      expect(cellXml.indexOf('>new<')).toBeLessThan(cellXml.indexOf('<w:tbl>'));
    } finally {
      runtime.dispose();
    }
  });
});
