/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Reads on an object that a write in the same sync returns.
//
// `const r = p.insertText(...); r.load('text'); await context.sync();` is one batch: the read
// is answered after the write, on the revision the write produced. A write on that object still
// needs a sync first (`runtime-read-dependencies.test.ts`).
import { expect, test } from 'bun:test';
import type {
  AutomationBatchRequest,
  AutomationHandle,
  AutomationHost,
} from '@docx-editor.dev/core/automation';
import { createRuntime } from '../runtime.ts';
import { DocxEditor } from '../../index.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

const ITALIC = '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>';

async function bodyText(runtime: ReturnType<typeof createRuntime>): Promise<string> {
  return runtime.run(async (context) => {
    context.document.body.load('text');
    await context.sync();
    return context.document.body.text;
  });
}

const writesOf = (requests: readonly AutomationBatchRequest[]) =>
  requests.filter((request) =>
    request.operations.some((op) => op.op === 'insertText' || op.op === 'replaceSpan')
  );

for (const where of ['Start', 'End'] as const) {
  test(`text and font load on the range insertText returns, in one sync (${where})`, async () => {
    const host = openHost(docx(ITALIC));
    const spy = spyHost(host);
    const runtime = createRuntime({ host: spy.host, save: true });
    const revision = host.revision();
    const answer = await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      const inserted = paragraph.insertText('#', where);
      inserted.load('text');
      inserted.font.load('italic');
      await context.sync();
      return { text: inserted.text, italic: inserted.font.italic };
    });
    expect(answer).toEqual({ text: '#', italic: true });
    expect(host.revision()).toBe(revision + 1);
    expect(writesOf(spy.requests)).toHaveLength(1);
    expect(await bodyText(runtime)).toBe(where === 'Start' ? '#italic' : 'italic#');
  });
}

test('a created paragraph loads in the same sync', async () => {
  const runtime = createRuntime({ host: openHost(docx(p('one'))), save: true });
  const text = await runtime.run(async (context) => {
    const created = context.document.body.insertParagraph('two', 'End');
    created.load('text');
    await context.sync();
    return created.text;
  });
  expect(text).toBe('two');
});

test('the paragraphs of a created range load in the same sync', async () => {
  const runtime = createRuntime({ host: openHost(docx(p('one') + p('two'))), save: true });
  const texts = await runtime.run(async (context) => {
    const replaced = context.document.body.paragraphs.getFirst().insertText('uno', 'Replace');
    replaced.paragraphs.load('items/text');
    await context.sync();
    return replaced.paragraphs.items.map((item) => item.text);
  });
  expect(texts).toEqual(['uno']);
});

test('a read on an existing object in the same sync still answers before the writes', async () => {
  const runtime = createRuntime({ host: openHost(docx(p('before'))), save: true });
  const answer = await runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    await context.sync();
    const inserted = paragraph.insertText(' after', 'End');
    paragraph.load('text');
    inserted.load('text');
    await context.sync();
    return { paragraph: paragraph.text, inserted: inserted.text };
  });
  expect(answer).toEqual({ paragraph: 'before', inserted: ' after' });
});

test('a tracked insertion answers its created range in the same sync', async () => {
  const runtime = await DocxEditor.createServer(docx(p('First clause.')), { author: 'Agent' });
  try {
    const text = await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const inserted = context.document.body.paragraphs.getFirst().insertText(' Added.', 'End');
      inserted.load('text');
      await context.sync();
      return inserted.text;
    });
    expect(text).toBe(' Added.');
  } finally {
    runtime.dispose();
  }
});

test('a failed read on a created object reports its error and keeps the committed write', async () => {
  const inner = openHost(docx(p('original')));
  let wrote = false;
  // Fails the first read that follows the write, the way a host refuses a stale handle.
  const host: AutomationHost = {
    ...inner,
    execute(request) {
      if (wrote && request.operations.every((op) => op.op === 'getSpanText'))
        return inner.execute({
          ...request,
          // A handle the host never minted.
          operations: [
            {
              op: 'getText',
              target: 'p:missing' as unknown as AutomationHandle,
              projection: 'allMarkup',
            },
          ],
        });
      const response = inner.execute(request);
      if (request.operations.some((op) => op.op === 'insertText')) wrote = response.ok;
      return response;
    },
  };
  const runtime = createRuntime({ host, save: true });
  const revision = inner.revision();
  await expect(
    runtime.run(async (context) => {
      const inserted = context.document.body.paragraphs.getFirst().insertText(' kept', 'End');
      inserted.load('text');
      await context.sync();
    })
  ).rejects.toMatchObject({
    code: 'InvalidObjectPath',
    debugInfo: { innerError: { code: 'edit.read-after-commit' } },
  });
  expect(inner.revision()).toBe(revision + 1);
  expect(await bodyText(createRuntime({ host: inner, save: true }))).toBe('original kept');
});

test('a writer between the commit and the read on a created object refuses as stale', async () => {
  const inner = openHost(docx(p('original')));
  let interfere = false;
  const host: AutomationHost = {
    ...inner,
    async prepare(request) {
      if (!interfere || !request.operations.every((op) => op.op === 'getSpanText')) return;
      interfere = false;
      const document = inner.execute({ operations: [{ op: 'getDocument' }] }).results[0];
      if (document?.status !== 'ok' || document.value.kind !== 'handle') throw new Error('doc');
      const body = inner.execute({
        operations: [{ op: 'getBody', document: document.value.handle }],
      }).results[0];
      if (body?.status !== 'ok' || body.value.kind !== 'handle') throw new Error('body');
      inner.execute({
        operations: [{ op: 'replaceSpan', span: { body: body.value.handle }, text: 'other' }],
      });
    },
    execute(request) {
      const response = inner.execute(request);
      if (response.ok && request.operations.some((op) => op.op === 'insertText')) interfere = true;
      return response;
    },
  };
  const runtime = createRuntime({ host, save: true });
  await expect(
    runtime.run(async (context) => {
      const inserted = context.document.body.paragraphs.getFirst().insertText(' mine', 'End');
      inserted.load('text');
      await context.sync();
    })
  ).rejects.toMatchObject({
    code: 'StaleDocument',
    debugInfo: { innerError: { code: 'edit.read-after-commit' } },
  });
  expect(await bodyText(createRuntime({ host: inner, save: true }))).toBe('other');
});

test('a write on a created object still refuses before its producer commits', async () => {
  const host = openHost(docx(p('original')));
  const runtime = createRuntime({ host, save: true });
  const revision = host.revision();
  await expect(
    runtime.run(async (context) => {
      const inserted = context.document.body.paragraphs.getFirst().insertText('#', 'End');
      inserted.load('text');
      inserted.font.bold = true;
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidObjectPath' });
  expect(host.revision()).toBe(revision);
  expect(await bodyText(runtime)).toBe('original');
});

test('an object found from a created one by a navigation read still needs a sync', async () => {
  const host = openHost(docx(p('original')));
  const runtime = createRuntime({ host, save: true });
  const revision = host.revision();
  await expect(
    runtime.run(async (context) => {
      const inserted = context.document.body.paragraphs.getFirst().insertText('#', 'End');
      inserted.paragraphs.getFirst().load('text');
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidObjectPath' });
  expect(host.revision()).toBe(revision);
});
