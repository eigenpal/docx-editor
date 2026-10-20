/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { DocxEditor } from '../index.ts';
import { docx } from '../model/__tests__/support/documents.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const field =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> DATE \\@ "d MMMM yyyy" </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>1 January 2030</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function storyFixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rHeader" Type="${OFFICE}/header" Target="header1.xml"/>` +
        `<Relationship Id="rFootnotes" Type="${OFFICE}/footnotes" Target="footnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${OFFICE}"><w:body>` +
        '<w:p><w:r><w:footnoteReference w:id="2"/></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}"><w:p>${field}</w:p></w:hdr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="2">` +
        '<w:p><w:r><w:t>synthetic note text</w:t></w:r></w:p>' +
        '</w:footnote></w:footnotes>'
    ),
  });
}

describe('field result search', () => {
  test('returns the visible cached result through the server object model', async () => {
    const bytes = docx(
      `<w:p><w:r><w:t xml:space="preserve">Renewal date: </w:t></w:r>${field}` +
        '<w:r><w:t xml:space="preserve"> is synthetic.</w:t></w:r></w:p>'
    );
    const runtime = await DocxEditor.createServer(bytes);

    try {
      const result = await runtime.run(async (context) => {
        const matches = context.document.body.search('1 January 2030', { matchCase: true });
        matches.load('items');
        await context.sync();
        const match = matches.items[0];
        if (!match) return { count: 0, text: '' };
        match.load('text');
        await context.sync();
        return { count: matches.items.length, text: match.text };
      });

      expect(result).toEqual({ count: 1, text: '1 January 2030' });
    } finally {
      runtime.dispose();
    }
  });

  test('writes at every paragraph location using raw field offsets', async () => {
    const paragraph = `<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`;
    const cases = [
      { location: 'Start', text: '<', expected: '<A1 January 2030Z' },
      { location: 'End', text: '>', expected: 'A1 January 2030Z>' },
      { location: 'Replace', text: 'replacement', expected: 'replacement' },
    ] as const;

    for (const entry of cases) {
      const runtime = await DocxEditor.createServer(docx(paragraph));
      try {
        const result = await runtime.run(async (context) => {
          const body = context.document.body;
          const paragraphs = body.paragraphs;
          paragraphs.load('items');
          await context.sync();
          const first = paragraphs.items[0]!;
          first.insertText(entry.text, entry.location);
          await context.sync();
          body.load('text');
          first.load('text');
          await context.sync();
          return { body: body.text, paragraph: first.text };
        });

        expect(result).toEqual({ body: entry.expected, paragraph: entry.expected });
      } finally {
        runtime.dispose();
      }
    }
  });

  test('replaces the whole field through a visible search range', async () => {
    const bytes = docx(`<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`);
    const runtime = await DocxEditor.createServer(bytes);

    try {
      const result = await runtime.run(async (context) => {
        const body = context.document.body;
        const matches = body.search('1 January 2030', { matchCase: true });
        matches.load('items');
        await context.sync();
        matches.items[0]!.insertText('new', 'Replace');
        await context.sync();
        body.load('text');
        await context.sync();
        return body.text;
      });

      expect(result).toBe('AnewZ');
    } finally {
      runtime.dispose();
    }
  });

  test('finds a visible field result in a primary header', async () => {
    const runtime = await DocxEditor.createServer(storyFixture());

    try {
      const result = await runtime.run(async (context) => {
        const sections = context.document.sections;
        sections.load('items');
        await context.sync();
        const header = sections.items[0]!.getHeader('Primary');
        await context.sync();
        const matches = header.search('1 January 2030', { matchCase: true });
        matches.load('items');
        await context.sync();
        matches.items[0]?.load('text');
        await context.sync();
        return { count: matches.items.length, text: matches.items[0]?.text };
      });

      expect(result).toEqual({ count: 1, text: '1 January 2030' });
    } finally {
      runtime.dispose();
    }
  });

  test('finds text in a footnote body', async () => {
    const runtime = await DocxEditor.createServer(storyFixture());

    try {
      const result = await runtime.run(async (context) => {
        const notes = context.document.footnotes;
        notes.load('items');
        await context.sync();
        const body = notes.items[0]!.body;
        await context.sync();
        const matches = body.search('synthetic note text', { matchCase: true });
        matches.load('items');
        await context.sync();
        matches.items[0]?.load('text');
        await context.sync();
        return { count: matches.items.length, text: matches.items[0]?.text };
      });

      expect(result).toEqual({ count: 1, text: 'synthetic note text' });
    } finally {
      runtime.dispose();
    }
  });
});
