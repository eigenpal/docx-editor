/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `items/<property>` load paths: a collection's members and one of their properties in one sync.
//
// The item reads have to describe the document at the place the load was queued. These tests
// hold that line for read-only batches, for writes queued before or after the load, and for the
// one order that cannot be answered inside one atomic commit, which is refused before anything
// is sent.

import { describe, expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import type { LoadOption } from '../load-options.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

const THREE = docx(`${p('one')}${p('two')}${p('three')}`);

describe('a collection loads a property on each item in the same sync', () => {
  const shapes: readonly [string, LoadOption][] = [
    ['an items path', 'items/text'],
    ['a bare item property', 'text'],
    ['a comma list of paths', 'items/text,items/style'],
    ['an array of paths', ['items', 'items/text']],
    ['a query object', { select: 'items/text' }],
  ];

  for (const [what, option] of shapes) {
    test(`${what} loads text on every item`, async () => {
      const runtime = createRuntime({ host: openHost(THREE), save: true });
      const texts = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load(option);
        await context.sync();
        return paragraphs.items.map((item) => item.text);
      });
      expect(texts).toEqual(['one', 'two', 'three']);
      runtime.dispose();
    });
  }

  test('two item properties load together and nothing else is loaded', async () => {
    const runtime = createRuntime({ host: openHost(THREE), save: true });
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/text,items/style');
      await context.sync();
      const first = paragraphs.items[0]!;
      expect(first.text).toBe('one');
      expect(() => first.style).not.toThrow();
      expect(() => first.uniqueLocalId).toThrowError(
        expect.objectContaining({ code: 'PropertyNotLoaded' })
      );
    });
    runtime.dispose();
  });

  test('item reads go out in one following host call, all on the same revision', async () => {
    const spy = spyHost(openHost(THREE));
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/text');
      spy.reset();
      await context.sync();
    });
    expect(spy.requests).toHaveLength(2);
    expect(spy.requests[1]!.operations.map((operation) => operation.op)).toEqual([
      'getText',
      'getText',
      'getText',
    ]);
    expect(spy.requests[1]!.expectedRevision).toBeDefined();
    runtime.dispose();
  });

  test('top and skip apply before the item reads', async () => {
    const runtime = createRuntime({ host: openHost(THREE), save: true });
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load({ select: 'items/text', top: 1, skip: 1 });
      await context.sync();
      return paragraphs.items.map((item) => item.text);
    });
    expect(texts).toEqual(['two']);
    runtime.dispose();
  });

  test('search results load their text in the sync that runs the search', async () => {
    const runtime = createRuntime({ host: openHost(THREE), save: true });
    const texts = await runtime.run(async (context) => {
      const results = context.document.body.search('o');
      results.load('items/text');
      await context.sync();
      return results.items.map((item) => item.text);
    });
    expect(texts).toEqual(['o', 'o']);
    runtime.dispose();
  });
});

describe('item reads in a sync that writes', () => {
  // Every read in a batch answers the document as it was before the batch's writes. Item reads
  // follow the same rule wherever the load sits in the queue.
  for (const [where, before, after] of [
    ['after the load', false, true],
    ['before the load', true, false],
    ['on both sides of the load', true, true],
  ] as const) {
    test(`a write queued ${where} does not show in the loaded text`, async () => {
      const spy = spyHost(openHost(THREE));
      const runtime = createRuntime({ host: spy.host, save: true });
      const result = await runtime.run(async (context) => {
        const body = context.document.body;
        const paragraphs = body.paragraphs;
        if (before) body.insertText('start ', 'Start');
        paragraphs.load('items/text');
        if (after) body.insertText(' end', 'End');
        spy.reset();
        await context.sync();
        const revisions = spy.requests.map((request) => request.expectedRevision);
        body.load('text');
        await context.sync();
        return { items: paragraphs.items.map((item) => item.text), body: body.text, revisions };
      });
      expect(result.items).toEqual(['one', 'two', 'three']);
      expect(result.body).toBe(`${before ? 'start ' : ''}one\rtwo\rthree${after ? ' end' : ''}`);
      // The listing, the item reads and the writes: three host calls on one revision.
      expect(result.revisions).toHaveLength(3);
      expect(new Set(result.revisions).size).toBe(1);
      runtime.dispose();
    });
  }
});

describe('what an items path refuses, at the load call', () => {
  const refusals: readonly [string, string, string][] = [
    ['a deeper path', 'items/font/bold', 'document.body.paragraphs.items/font/bold'],
    ['a path that is not items', 'font/bold', 'document.body.paragraphs.font/bold'],
    ['an empty item property', 'items/', 'document.body.paragraphs'],
    ['a property items do not have', 'items/nope', 'document.body.paragraphs.items.nope'],
  ];

  for (const [what, option, target] of refusals) {
    test(`${what} is InvalidArgument naming ${target}`, async () => {
      const spy = spyHost(openHost(THREE));
      const runtime = createRuntime({ host: spy.host, save: true });
      await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        expect(() => paragraphs.load(option)).toThrowError(
          expect.objectContaining({ code: 'InvalidArgument', target })
        );
        spy.reset();
        await context.sync();
        expect(spy.requests).toHaveLength(0);
      });
      runtime.dispose();
    });
  }

  test('an object that is not a collection refuses an items path', async () => {
    const runtime = createRuntime({ host: openHost(THREE), save: true });
    await runtime.run(async (context) => {
      const body = context.document.body;
      expect(() => body.load('items/text')).toThrowError(
        expect.objectContaining({ code: 'InvalidArgument', target: 'document.body.items/text' })
      );
    });
    runtime.dispose();
  });

  test('pieces a split answers load item text once the split has synced', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('a,b'))), save: true });
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const pieces = paragraphs.items[0]!.split([',']);
      expect(() => pieces.load('items/text')).toThrowError(
        expect.objectContaining({ code: 'NotImplemented' })
      );
      await context.sync();
      pieces.load('items/text');
      await context.sync();
      return pieces.items.map((item) => item.text);
    });
    expect(texts).toEqual(['a,', 'b']);
    runtime.dispose();
  });
});
