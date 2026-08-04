// The lifecycle the whole object model rests on: queue, one batch, hydrate.
//
// Everything a consumer does inside a `run` is a promise about the future — construct a proxy,
// write to it, ask for a property — and NOTHING may reach the document until `sync()`. Then
// exactly one ordered, atomic host batch goes out and its answers come back into the proxies
// that asked for them. These tests pin that down against the real headless host, because the
// interesting failures (a batch that went out early, two batches where one was promised, an
// answer hydrated into the wrong proxy) are invisible from inside the runtime's own bookkeeping.

import { describe, expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import { MiniDocument } from '../examples/minimal-model.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

describe('a run, its queue, and its one batch', () => {
  test('run answers with the callback value', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const text = await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(text).toBe('alpha\nbeta');
    runtime.dispose();
  });

  test('queueing reads and writes sends nothing at all', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load('text');
      body.paragraphs.load();
      // The proxies exist, the queue is full, and the host has not been asked anything since
      // the runtime resolved its roots.
      spy.reset();
      expect(spy.requests).toHaveLength(0);
      await context.sync();
      expect(spy.requests).toHaveLength(1);
    });
    runtime.dispose();
  });

  test('one sync is one batch carrying the queued operations in order', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const document = MiniDocument.open(context);
      document.body.paragraphs.load();
      document.body.load('text');
      spy.reset();
      await context.sync();
      expect(spy.requests).toHaveLength(1);
      expect(spy.requests[0]?.operations.map((operation) => operation.op)).toEqual([
        'getParagraphs',
        'getText',
      ]);
    });
    runtime.dispose();
  });

  test('a sync with an empty queue does not touch the host', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      spy.reset();
      await context.sync();
      await context.sync();
      expect(spy.requests).toHaveLength(0);
    });
    runtime.dispose();
  });

  test('writes apply in the order they were queued', async () => {
    // Two inserts at the same offset in the same paragraph: the order is only observable in
    // the result, which is exactly why this is the ordering test.
    const runtime = createRuntime({ host: openHost(), save: true });
    const text = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      first.insertText('one ', 0);
      first.insertText('two ', 0);
      await context.sync();
      first.load('text');
      await context.sync();
      return first.text;
    });
    expect(text).toBe('two one alpha');
    runtime.dispose();
  });

  test('a returned result carries no value until the sync that fills it', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const result = MiniDocument.open(context).body.getText();
      expect(() => result.value).toThrow(/not been filled in/);
      await context.sync();
      expect(result.value).toBe('alpha\nbeta');
    });
    runtime.dispose();
  });

  test('a collection hydrates into proxies that can be read and written', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const read = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      expect(paragraphs.items).toHaveLength(2);
      // An item's own property is its own load: it had no handle to be asked about until the
      // batch above answered. See `minimal-model.ts` for why that is a protocol property.
      for (const item of paragraphs.items) item.load('text');
      await context.sync();
      expect(paragraphs.items.map((item) => item.text)).toEqual(['alpha', 'beta']);
      const second = paragraphs.items[1]!;
      second.insertText('!', 4);
      await context.sync();
      second.load('text');
      await context.sync();
      return second.text;
    });
    expect(read).toBe('beta!');
    runtime.dispose();
  });

  test('several syncs in one callback each carry only what was queued since the last', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      spy.reset();
      await context.sync();
      paragraphs.items[0]!.insertText('x', 0);
      await context.sync();
      expect(spy.requests.map((request) => request.operations.map((o) => o.op))).toEqual([
        ['getParagraphs'],
        ['insertText'],
      ]);
    });
    runtime.dispose();
  });

  test('a read queued behind a write in the same batch answers the state before the batch', async () => {
    // The core host answers every query against the start of the batch and commits its
    // commands at the end, so one batch is one revision. A consumer that wants to read its
    // own write syncs twice — and this test is here so that stays a documented property
    // rather than a surprise discovered in production.
    const runtime = createRuntime({ host: openHost(), save: true });
    const [duringBatch, afterBatch] = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      first.insertText('new ', 0);
      const sameBatch = first.getText();
      await context.sync();
      const nextBatch = first.getText();
      await context.sync();
      return [sameBatch.value, nextBatch.value];
    });
    expect(duringBatch).toBe('alpha');
    expect(afterBatch).toBe('new alpha');
    runtime.dispose();
  });
});

describe('the server runtime around the lifecycle', () => {
  test('save answers the edited document as bytes that reopen with the edit', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('before'))), save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[0]!.insertText('after ', 0);
      await context.sync();
    });
    const bytes = await runtime.save();
    expect(bytes.byteLength).toBeGreaterThan(0);

    const reopened = createRuntime({ host: openHost(bytes), save: true });
    const text = await reopened.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(text).toBe('after before');
    runtime.dispose();
    reopened.dispose();
  });

  test('dispose is idempotent, and a disposed runtime refuses everything after it', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    runtime.dispose();
    runtime.dispose();
    await expect(runtime.run(async () => 1)).rejects.toMatchObject({ code: 'RuntimeDisposed' });
    await expect(runtime.save()).rejects.toMatchObject({ code: 'RuntimeDisposed' });
  });
});
