/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Symbols (`w:sym`) through the server host.
//
// A symbol is one character of paragraph text and reads as "(", whatever glyph it paints.
// Search never matches it: not with "(", and not by skipping it.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import { docx } from './support/docx.ts';

const SYM = '<w:sym w:font="Wingdings" w:char="F04A"/>';
const BYTES = docx(
  `<w:p><w:r><w:t>a</w:t></w:r><w:r>${SYM}</w:r><w:r><w:t>b</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>a(b</w:t></w:r></w:p>'
);

describe('symbols in host text', () => {
  test('a symbol reads as one "(" character', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const text = await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.load('text');
        await context.sync();
        return paragraph.text;
      });
      expect(text).toBe('a(b');
    } finally {
      runtime.dispose();
    }
  });

  test('search matches a typed "(" but never a symbol', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const counts = await runtime.run(async (context) => {
        const body = context.document.body;
        const queries = ['a(b', '(', 'ab'].map((query) => body.search(query));
        for (const found of queries) found.load('items');
        await context.sync();
        return queries.map((found) => found.items.length);
      });
      // Only the second paragraph's literal parenthesis matches.
      expect(counts).toEqual([1, 1, 0]);
    } finally {
      runtime.dispose();
    }
  });

  test('text written after a symbol lands after it, and the symbol survives save', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.getRange('End').insertText('c', 'Before');
        await context.sync();
      });
      const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
      expect(xml).toContain('w:char="F04A"');
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        const text = await reopened.run(async (context) => {
          const paragraph = context.document.body.paragraphs.getFirst();
          paragraph.load('text');
          await context.sync();
          return paragraph.text;
        });
        expect(text).toBe('a(bc');
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test('replacing text over a symbol removes it, or strikes it when tracked', async () => {
    for (const mode of ['Off', 'TrackMineOnly'] as const) {
      const runtime = await DocxEditor.createServer(BYTES, { author: 'Reviewer' });
      try {
        const text = await runtime.run(async (context) => {
          context.document.changeTrackingMode = mode;
          const paragraph = context.document.body.paragraphs.getFirst();
          paragraph.insertText('xy', 'Replace');
          await context.sync();
          paragraph.load('text');
          await context.sync();
          return paragraph.text;
        });
        const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
        if (mode === 'Off') {
          expect(text).toBe('xy');
          expect(xml).not.toContain('w:sym');
        } else {
          // A tracked deletion keeps the symbol, struck, until it is accepted.
          expect(text).toContain('a(b');
          expect(xml).toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*w:sym/s);
        }
      } finally {
        runtime.dispose();
      }
    }
  });

  test('search never matches a symbol in the original revision view', async () => {
    const bytes = docx(
      '<w:p><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>new </w:t></w:r></w:ins>' +
        `<w:r><w:t>a</w:t></w:r><w:r>${SYM}</w:r><w:r><w:t>b</w:t></w:r></w:p>`
    );
    for (const view of ['original', 'allMarkup'] as const) {
      const runtime = await DocxEditor.createServer(bytes, { revisionTextView: view });
      try {
        const count = await runtime.run(async (context) => {
          const found = context.document.body.search('(');
          found.load('items');
          await context.sync();
          return found.items.length;
        });
        expect(count).toBe(0);
      } finally {
        runtime.dispose();
      }
    }
  });
});
