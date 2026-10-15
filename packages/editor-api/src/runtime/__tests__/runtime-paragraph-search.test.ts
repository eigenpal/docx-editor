/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Paragraph.search`: matches inside one paragraph only, with the options `Body.search` takes.

import { describe, expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
const IN_TABLE = docx(
  `${p('term outside')}<w:tbl><w:tr>${cell('first term')}${cell('second term')}</w:tr></w:tbl>`
);
const TRACKED = docx(
  '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
    '<w:del w:id="1" w:author="Ada"><w:r><w:delText>gone</w:delText></w:r></w:del>' +
    '<w:ins w:id="2" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins></w:p>'
);

const TWO = docx(`${p('Alpha beta alpha')}${p('alpha again')}`);

describe('Paragraph.search', () => {
  test('answers matches in this paragraph only, in reading order', async () => {
    const runtime = createRuntime({ host: openHost(TWO), save: true });
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const results = paragraphs.items[0]!.search('alpha');
      results.load('items/text');
      await context.sync();
      return results.items.map((range) => range.text);
    });
    expect(texts).toEqual(['Alpha', 'alpha']);
    runtime.dispose();
  });

  test('takes search options', async () => {
    const runtime = createRuntime({ host: openHost(TWO), save: true });
    const count = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const results = paragraphs.items[0]!.search('alpha', { matchCase: true });
      results.load('items');
      await context.sync();
      return results.items.length;
    });
    expect(count).toBe(1);
    runtime.dispose();
  });

  test('searches a paragraph from getFirst() in the same sync that finds it', async () => {
    const spy = spyHost(openHost(TWO));
    const runtime = createRuntime({ host: spy.host, save: true });
    const texts = await runtime.run(async (context) => {
      const results = context.document.body.paragraphs.getLast().search('again');
      results.load('items/text');
      spy.reset();
      await context.sync();
      return results.items.map((range) => range.text);
    });
    expect(texts).toEqual(['again']);
    expect(spy.requests[0]!.operations.map((operation) => operation.op)).toContain('getParagraphs');
    runtime.dispose();
  });

  test('a matched range can be edited', async () => {
    const runtime = createRuntime({ host: openHost(TWO), save: true });
    const text = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      const results = first.search('beta');
      results.load('items');
      await context.sync();
      results.items[0]!.insertText('gamma', 'Replace');
      await context.sync();
      first.load('text');
      await context.sync();
      return first.text;
    });
    expect(text).toBe('Alpha gamma alpha');
    runtime.dispose();
  });

  test('searches a paragraph inside a table cell, and only that cell', async () => {
    const runtime = createRuntime({ host: openHost(IN_TABLE), save: true });
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/text');
      await context.sync();
      const inCell = paragraphs.items.find((item) => item.text === 'second term')!;
      const results = inCell.search('term');
      results.load('items/text');
      await context.sync();
      return { count: results.items.length, texts: results.items.map((range) => range.text) };
    });
    expect(texts).toEqual({ count: 1, texts: ['term'] });
    runtime.dispose();
  });

  test('searches a paragraph in a header', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('body term'))), save: true });
    await runtime.run(async (context) => {
      const section = context.document.sections.getFirst();
      await context.sync();
      const header = section.getHeader('Primary');
      await context.sync();
      header.insertParagraph('header term', 'Start');
      await context.sync();
    });
    const texts = await runtime.run(async (context) => {
      const section = context.document.sections.getFirst();
      await context.sync();
      const header = section.getHeader('Primary');
      await context.sync();
      const results = header.paragraphs.getFirst().search('term');
      results.load('items/text');
      await context.sync();
      return results.items.map((range) => range.text);
    });
    expect(texts).toEqual(['term']);
    runtime.dispose();
  });

  for (const [view, gone, added] of [
    ['allMarkup', 1, 1],
    ['original', 1, 0],
  ] as const) {
    test(`tracked text follows the ${view} revision text view`, async () => {
      const runtime = createRuntime({
        host: openHost(TRACKED),
        save: true,
        revisionTextView: view,
      });
      const counts = await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        const deleted = paragraph.search('gone');
        const inserted = paragraph.search('added');
        deleted.load('items/text');
        inserted.load('items');
        await context.sync();
        return {
          gone: deleted.items.length,
          added: inserted.items.length,
          texts: deleted.items.map((range) => range.text),
        };
      });
      expect(counts).toEqual({ gone, added, texts: ['gone'] });
      runtime.dispose();
    });
  }

  test('refuses a search text that is not a string', async () => {
    const runtime = createRuntime({ host: openHost(TWO), save: true });
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      expect(() => paragraphs.items[0]!.search(7 as unknown as string)).toThrowError(
        expect.objectContaining({
          code: 'InvalidArgument',
          target: 'document.body.paragraphs.items[0].search',
        })
      );
    });
    runtime.dispose();
  });
});
