/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';
import type { AutomationHost } from '@docx-editor.dev/core/automation';

async function textOf(runtime: ReturnType<typeof createRuntime>): Promise<string> {
  return runtime.run(async (context) => {
    context.document.body.load('text');
    await context.sync();
    return context.document.body.text;
  });
}

test('read-derived ranges edit with one sync and one committed transaction', async () => {
  const host = openHost(docx(p('before')));
  const spy = spyHost(host);
  const runtime = createRuntime({ host: spy.host, save: true });
  const revision = host.revision();
  await runtime.run(async (context) => {
    const range = context.document.body.getRange('Content');
    range.insertText('after', 'Replace');
    await context.sync();
  });
  expect(host.revision()).toBe(revision + 1);
  expect(await textOf(runtime)).toBe('after');
  const writes = spy.requests.filter((r) => r.operations.some((op) => op.op === 'replaceSpan'));
  expect(writes).toHaveLength(1);
  expect(writes[0]!.expectedRevision).toBe(revision);
});

test('a failed final command leaves all edits unapplied after read prerequisites', async () => {
  const host = openHost(docx(p('original')));
  const runtime = createRuntime({ host, save: true });
  const revision = host.revision();
  await expect(
    runtime.run(async (context) => {
      const range = context.document.body.getRange();
      range.insertText('replacement', 'Replace');
      range.hyperlink = 'javascript:alert(1)';
      await context.sync();
    })
  ).rejects.toBeDefined();
  expect(host.revision()).toBe(revision);
  expect(await textOf(runtime)).toBe('original');
});

test('a writer between prerequisite reads and final commit causes stale refusal without replay', async () => {
  const inner = openHost(docx(p('original')));
  let inject = false;
  const host: AutomationHost = {
    ...inner,
    execute(request) {
      const response = inner.execute(request);
      if (inject && request.operations.some((op) => op.op === 'getRange')) {
        inject = false;
        const getDocument = inner.execute({ operations: [{ op: 'getDocument' }] });
        const d = getDocument.results[0];
        if (d?.status !== 'ok' || d.value.kind !== 'handle') throw new Error('document');
        const getBody = inner.execute({
          operations: [{ op: 'getBody', document: d.value.handle }],
        });
        const b = getBody.results[0];
        if (b?.status !== 'ok' || b.value.kind !== 'handle') throw new Error('body');
        expect(
          inner.execute({
            operations: [
              { op: 'replaceSpan', span: { body: b.value.handle }, text: 'other writer' },
            ],
          }).ok
        ).toBe(true);
      }
      return response;
    },
  };
  const runtime = createRuntime({ host, save: true });
  inject = true;
  await expect(
    runtime.run(async (context) => {
      context.document.body.getRange().insertText('stale replacement', 'Replace');
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'StaleDocument' });
  expect(await textOf(runtime)).toBe('other writer');
});

test('created-by-write dependencies refuse before committing their producer', async () => {
  const host = openHost(docx(p('original')));
  const runtime = createRuntime({ host, save: true });
  const revision = host.revision();
  await expect(
    runtime.run(async (context) => {
      const created = context.document.body.insertText('created', 'End');
      created.insertText('again', 'Replace');
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidObjectPath' });
  expect(host.revision()).toBe(revision);
  expect(await textOf(runtime)).toBe('original');
});

test('asynchronous host preparation pins a first write before resources finish loading', async () => {
  const inner = openHost(docx(p('original')));
  let prepared = false;
  const host: AutomationHost = {
    ...inner,
    async prepare(request) {
      if (!request.operations.some((op) => op.op === 'replaceSpan')) return;
      prepared = true;
      const d = inner.execute({ operations: [{ op: 'getDocument' }] }).results[0];
      if (d?.status !== 'ok' || d.value.kind !== 'handle') throw new Error('document');
      const b = inner.execute({ operations: [{ op: 'getBody', document: d.value.handle }] })
        .results[0];
      if (b?.status !== 'ok' || b.value.kind !== 'handle') throw new Error('body');
      inner.execute({
        operations: [
          { op: 'replaceSpan', span: { body: b.value.handle }, text: 'changed during preparation' },
        ],
      });
      await Promise.resolve();
    },
  };
  const runtime = createRuntime({ host, save: true });
  await expect(
    runtime.run(async (context) => {
      context.document.body.insertText('stale first write', 'Replace');
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'StaleDocument' });
  expect(prepared).toBe(true);
  expect(await textOf(runtime)).toBe('changed during preparation');
});

test('a failed prerequisite discards coalesced writes so the same proxy can be edited again', async () => {
  const inner = openHost(docx(p('original')));
  let refuseRead = true;
  const requests: import('@docx-editor.dev/core/automation').AutomationBatchRequest[] = [];
  const host: AutomationHost = {
    ...inner,
    execute(request) {
      requests.push(request);
      if (refuseRead && request.operations.some((op) => op.op === 'getRange')) {
        refuseRead = false;
        return {
          ok: false,
          changed: false,
          revision: inner.revision(),
          results: request.operations.map(() => ({
            status: 'error' as const,
            error: { code: 'unsupported-content' as const, message: 'injected read failure' },
          })),
        };
      }
      return inner.execute(request);
    },
  };
  const runtime = createRuntime({ host, save: true });
  await runtime.run(async (context) => {
    const body = context.document.body;
    body.font.bold = true;
    body.getRange().insertText('discarded', 'Replace');
    await expect(context.sync()).rejects.toBeDefined();
    body.font.italic = true;
    await context.sync();
  });
  const writes = requests
    .flatMap((request) => request.operations)
    .filter((op) => op.op === 'setFont');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ font: { italic: true } });
  expect(writes[0]).not.toMatchObject({ font: { bold: true } });
  expect(await textOf(runtime)).toBe('original');
});

test('read-derived paragraph formatting and page setup defer addresses until sync', async () => {
  const runtime = createRuntime({
    host: openHost(docx(p('original') + '<w:sectPr/>')),
    save: true,
  });
  await runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    paragraph.alignment = 'Centered';
    paragraph.spaceAfter = 12;
    await context.sync();
    paragraph.load(['alignment', 'spaceAfter']);
    await context.sync();
    expect(paragraph.alignment).toBe('Centered');
    expect(paragraph.spaceAfter).toBe(12);
    const section = context.document.sections.getFirst();
    section.pageSetup.topMargin = 54;
    await context.sync();
    section.pageSetup.load('topMargin');
    await context.sync();
    expect(section.pageSetup.topMargin).toBe(54);
  });
});

test('read-derived ranges create controls with one atomic write', async () => {
  const host = openHost(docx(p('original')));
  const runtime = createRuntime({ host, save: true });
  const before = host.revision();
  await runtime.run(async (context) => {
    const control = context.document.body.getRange().insertContentControl();
    await context.sync();
    control.load('id');
    await context.sync();
    expect(String(control.id)).toMatch(/^\d+$/);
  });
  expect(host.revision()).toBe(before + 1);
});
