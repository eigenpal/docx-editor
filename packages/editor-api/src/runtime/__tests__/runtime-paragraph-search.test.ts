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
