/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A held object the document no longer holds, told apart from every other InvalidObjectPath.
//
// When an edit removes or merges the object a proxy names, the refusal carries
// `edit.stale-target` and a message that says the object is gone. A proxy that is not synced
// yet, and a handle the host refuses for any other reason, keep the neutral message and no
// stale-target reason, because reading the document again does not help them.

import { describe, expect, test } from 'bun:test';
import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationOperationResult,
} from '@docx-editor.dev/core/automation';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { ClientObject } from '../client-object.ts';
import { messageFor } from '../errors.ts';
import { createRuntime } from '../runtime.ts';
import type { RequestContext } from '../request-context.ts';
import { openHost, stubHost } from './support/hosts.ts';
import { commentedDocx, docx, p } from './support/docx.ts';

const TWO = docx(`${p('one')}${p('two')}`);

async function caught(work: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await work;
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('expected a rejection');
}

type Runtime = ReturnType<typeof createRuntime>;

/** Hold the second paragraph and its range past the run that read them. */
async function holdSecond(runtime: Pick<Runtime, 'run'>) {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();
    const second = paragraphs.items[1]!;
    const range = second.getRange('Whole');
    await context.sync();
    context.trackedObjects.add([second, range]);
    return { second, range };
  });
}

async function expectRemoved(
  runtime: Pick<Runtime, 'run'>,
  proxies: readonly (ClientObject & { load(option: string): unknown })[],
  property = 'text'
) {
  for (const proxy of proxies) {
    const failure = await runtime.run(proxy, async (context: RequestContext) => {
      proxy.load(property);
      return caught(context.sync());
    });
    expect(failure).toMatchObject({
      code: 'InvalidObjectPath',
      debugInfo: { innerError: { code: 'edit.stale-target' } },
    });
    expect(String(failure['message'])).toStartWith(
      messageFor('InvalidObjectPath', 'edit.stale-target')
    );
    expect(String(failure['message'])).toContain('no longer exists in the document');
  }
}

describe('an object an edit removed', () => {
  test('a paragraph deleted by another run', async () => {
    const runtime = createRuntime({ host: openHost(TWO), save: true });
    const held = await holdSecond(runtime);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[1]!.delete();
      await context.sync();
    });
    await expectRemoved(runtime, [held.second, held.range]);
    runtime.dispose();
  });

  test('a paragraph merged into another by a replacement across paragraphs', async () => {
    const runtime = createRuntime({ host: openHost(TWO), save: true });
    const held = await holdSecond(runtime);
    await runtime.run(async (context) => {
      context.document.body.getRange('Whole').insertText('merged', 'Replace');
      await context.sync();
    });
    await expectRemoved(runtime, [held.second, held.range]);
    runtime.dispose();
  });

  test('a comment deleted by another run', async () => {
    const runtime = createRuntime({ host: openHost(commentedDocx()), save: true });
    const comment = await runtime.run(async (context) => {
      const comments = context.document.body.getComments();
      comments.load('items');
      await context.sync();
      const first = comments.items[0]!;
      context.trackedObjects.add(first);
      return first;
    });
    await runtime.run(async (context) => {
      const comments = context.document.body.getComments();
      comments.load('items');
      await context.sync();
      comments.items[0]!.delete();
      await context.sync();
    });
    await expectRemoved(runtime, [comment], 'authorName');
    runtime.dispose();
  });

  test('a tracked change accepted by another run', async () => {
    const tracked = docx(
      '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
        '<w:ins w:id="2" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins></w:p>'
    );
    const runtime = createRuntime({ host: openHost(tracked), save: true });
    const revision = await runtime.run(async (context) => {
      const revisions = context.document.body.revisions;
      revisions.load('items');
      await context.sync();
      const first = revisions.items[0]!;
      context.trackedObjects.add(first);
      return first;
    });
    await runtime.run(async (context) => {
      context.document.body.revisions.acceptAll();
      await context.sync();
    });
    await expectRemoved(runtime, [revision], 'author');
    runtime.dispose();
  });

  test('a paragraph removed by an editor undo', async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(p('one')),
    });
    const runtime = DocxEditorBrowser.createBrowser(editor);
    try {
      const inserted = await runtime.run(async (context) => {
        const created = context.document.body.insertParagraph('two', 'End');
        await context.sync();
        context.trackedObjects.add(created);
        return created;
      });
      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
      await expectRemoved(runtime, [inserted]);
    } finally {
      runtime.dispose();
      editor.destroy();
    }
  });
});

describe('every other InvalidObjectPath keeps the neutral message', () => {
  test('a proxy an edit creates, used before its sync', async () => {
    const runtime = createRuntime({ host: openHost(TWO), save: true });
    const failure = await caught(
      runtime.run(async (context) => {
        const created = context.document.body.insertParagraph('three', 'End');
        created.insertText(' more', 'End');
        await context.sync();
      })
    );
    expect(failure).toMatchObject({ code: 'InvalidObjectPath' });
    expect(String(failure['message'])).toStartWith(messageFor('InvalidObjectPath'));
    expect((failure['debugInfo'] as { innerError?: unknown }).innerError).toBeUndefined();
    runtime.dispose();
  });

  for (const detail of ['span-crosses-stories', 'not-a-paragraph-handle', undefined]) {
    test(`a host refusal with detail ${String(detail)} has no stale-target reason`, async () => {
      const { host } = stubHost({
        execute: (request: AutomationBatchRequest): AutomationBatchResponse => ({
          ok: false,
          results: request.operations.map(
            (_, index): AutomationOperationResult =>
              index === 0
                ? {
                    status: 'error',
                    error: {
                      code: 'invalid-handle',
                      message: 'refused',
                      ...(detail === undefined ? {} : { detail }),
                    },
                  }
                : { status: 'skipped' }
          ),
          revision: 3,
          changed: false,
        }),
      });
      const runtime = createRuntime({ host, save: true });
      const failure = await caught(
        runtime.run(async (context) => {
          context.document.body.load('text');
          await context.sync();
        })
      );
      expect(failure).toMatchObject({ code: 'InvalidObjectPath' });
      expect(String(failure['message'])).toStartWith(messageFor('InvalidObjectPath'));
      expect((failure['debugInfo'] as { innerError?: unknown }).innerError).toBeUndefined();
      runtime.dispose();
    });
  }
});
