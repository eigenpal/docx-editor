/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import type { RequestContext } from '../../runtime/request-context.ts';
import {
  zipDocument,
  W,
  R,
  REL,
} from '../../../../pro/src/collaboration/__tests__/document-peer-support';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function fixture(kind: 'footnote' | 'endnote', note: string) {
  const part = `${kind}s`;
  return zipDocument(
    `<w:p><w:r><w:t>Body</w:t></w:r><w:r><w:${kind}Reference w:id="1"/></w:r></w:p>` +
      `<w:tbl><w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>${p('')}`,
    {
      overrides: `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part}+xml"/>`,
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="n" Type="${R}/${part}" Target="${part}.xml"/></Relationships>`,
      extraXml: {
        [`word/${part}.xml`]: `<w:${part} xmlns:w="${W}"><w:${kind} w:id="1">${note}</w:${kind}></w:${part}>`,
      },
    }
  );
}

describe.each(['footnote', 'endnote'] as const)('Paragraph.delete in a %s', (kind) => {
  const notesOf = (context: RequestContext) =>
    kind === 'footnote' ? context.document.body.footnotes : context.document.body.endnotes;

  test('removes one paragraph of a note with several', async () => {
    const runtime = await DocxEditor.createServer(fixture(kind, p('A') + p('B') + p('C')));
    try {
      const texts = await runtime.run(async (context) => {
        const notes = notesOf(context);
        notes.load('items');
        await context.sync();
        const paragraphs = notes.items[0]!.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        paragraphs.items[1]!.delete();
        await context.sync();
        const after = notes.items[0]!.body.paragraphs;
        after.load('items/text');
        await context.sync();
        return after.items.map((paragraph) => paragraph.text);
      });
      expect(texts).toEqual(['A', 'C']);
    } finally {
      runtime.dispose();
    }
  });

  test('refuses the last paragraph of a note with NotSupported and edit.content-required', async () => {
    const runtime = await DocxEditor.createServer(fixture(kind, p('Only')));
    try {
      const failure = await runtime.run(async (context) => {
        const notes = notesOf(context);
        notes.load('items');
        await context.sync();
        const paragraphs = notes.items[0]!.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        paragraphs.items[0]!.delete();
        return context.sync().then(
          () => null,
          (error: { code: string; debugInfo: { innerError?: { code: string } } }) => error
        );
      });
      expect(failure?.code).toBe('NotSupported');
      expect(failure?.debugInfo.innerError?.code).toBe('edit.content-required');
    } finally {
      runtime.dispose();
    }
  });
});

test('Paragraph.delete refuses the only paragraph of a table cell with edit.content-required', async () => {
  const runtime = await DocxEditor.createServer(fixture('footnote', p('Note')));
  try {
    const failure = await runtime.run(async (context) => {
      const tables = context.document.body.tables;
      tables.load('items');
      await context.sync();
      const paragraphs = tables.items[0]!.getCell(0, 0).body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      paragraphs.items[0]!.delete();
      return context.sync().then(
        () => null,
        (error: { code: string; debugInfo: { innerError?: { code: string } } }) => error
      );
    });
    expect(failure?.code).toBe('NotSupported');
    expect(failure?.debugInfo.innerError?.code).toBe('edit.content-required');
  } finally {
    runtime.dispose();
  }
});
