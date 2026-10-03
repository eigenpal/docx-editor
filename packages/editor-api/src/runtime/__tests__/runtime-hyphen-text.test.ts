/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Hyphen elements through the server host (issue #1071).
//
// `w:noBreakHyphen` reads as U+001E and `w:softHyphen` as U+001F. Search matches a typed
// hyphen against a non-breaking hyphen and ignores an optional hyphen.

import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx } from './support/docx.ts';

const BYTES = docx(
  '<w:p><w:r><w:t xml:space="preserve">the then</w:t><w:noBreakHyphen/>' +
    '<w:t>applicable rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>'
);

describe('hyphen elements in host text', () => {
  test('body and paragraph text show both hyphens', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const read = await runtime.run(async (context) => {
        const body = context.document.body;
        const paragraph = body.paragraphs.getFirst();
        body.load('text');
        paragraph.load('text');
        await context.sync();
        return { body: body.text, paragraph: paragraph.text };
      });
      expect(read.paragraph).toBe('the then\u001eapplicable rate\u001fs');
      expect(read.body).toContain('then\u001eapplicable');
    } finally {
      runtime.dispose();
    }
  });

  test('search finds a typed hyphen and a word with an optional hyphen', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const found = await runtime.run(async (context) => {
        const body = context.document.body;
        const hyphenated = body.search('then-applicable');
        const joined = body.search('thenapplicable');
        const rates = body.search('rates');
        hyphenated.load('items');
        joined.load('items');
        rates.load('items');
        await context.sync();
        for (const range of [...hyphenated.items, ...rates.items]) range.load('text');
        await context.sync();
        return {
          hyphenated: hyphenated.items.map((range) => range.text),
          joined: joined.items.length,
          rates: rates.items.map((range) => range.text),
        };
      });
      expect(found.hyphenated).toEqual(['then\u001eapplicable']);
      expect(found.joined).toBe(0);
      expect(found.rates).toEqual(['rate\u001fs']);
    } finally {
      runtime.dispose();
    }
  });

  test('replacing a found range keeps the surrounding text', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const text = await runtime.run(async (context) => {
        const body = context.document.body;
        const found = body.search('then-applicable');
        found.load('items');
        await context.sync();
        found.items[0]!.insertText('current', 'Replace');
        await context.sync();
        const paragraph = body.paragraphs.getFirst();
        paragraph.load('text');
        await context.sync();
        return paragraph.text;
      });
      expect(text).toBe('the current rate\u001fs');
    } finally {
      runtime.dispose();
    }
  });
});
