// What a failure means, exactly.
//
// A batching API's failures are its most load-bearing behaviour, because a consumer cannot see
// what happened: they called `sync()` once and something in a list of operations was refused.
// Four promises make that survivable, and each has a test here.
//
// ATOMIC — a refused batch wrote nothing, not even the operations before the failing one.
// NOT REPLAYED — the batch is gone; the next `sync()` does not quietly send it again.
// STILL USABLE — work queued after a failure is a new batch and can succeed on its own.
// STABLE AND OPAQUE — every refusal is one of this runtime's codes, and the message says nothing
// about handles, offsets, or the store's own vocabulary. What leaks into a message becomes API.

import { describe, expect, test } from 'bun:test';
import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationErrorCode,
  AutomationOperationResult,
} from '@docx-editor.dev/core-contract/automation';
import { createRuntime } from '../runtime.ts';
import { messageFor, type DocxEditorErrorCode } from '../errors.ts';
import { MiniDocument } from '../examples/minimal-model.ts';
import { openHost, spyHost, stubHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

/** A host that refuses every batch the way the real one does: one error, everything else skipped. */
function refusingHost(code: AutomationErrorCode, detail = 'paragraph:deadbeef:1 not in 0..5') {
  return stubHost({
    execute: (request: AutomationBatchRequest): AutomationBatchResponse => ({
      ok: false,
      results: request.operations.map(
        (_, index): AutomationOperationResult =>
          index === 0
            ? { status: 'error', error: { code, message: `host says ${code}`, detail } }
            : { status: 'skipped' }
      ),
      revision: 7,
      changed: false,
    }),
  });
}

async function caught(work: Promise<unknown>): Promise<{ code?: unknown; message?: unknown }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: unknown; message?: unknown };
  }
  throw new Error('expected a rejection');
}

describe('a refused batch', () => {
  test('writes nothing at all, including the operations queued before the bad one', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('intact'))), save: true });
    const text = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      first.insertText('good ', 0);
      first.insertText('bad ', 9_999);
      const failure = await caught(context.sync());
      expect(failure).toMatchObject({ code: 'InvalidArgument' });
      first.load('text');
      await context.sync();
      return first.text;
    });
    expect(text).toBe('intact');
    runtime.dispose();
  });

  test('is not sent again by the next sync', async () => {
    const spy = spyHost(openHost(docx(p('intact'))));
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[0]!.insertText('bad ', 9_999);
      await caught(context.sync());
      spy.reset();
      await context.sync();
      expect(spy.requests).toHaveLength(0);
    });
    runtime.dispose();
  });

  test('leaves the context able to run a later batch that succeeds on its own', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('base'))), save: true });
    const text = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      first.insertText('bad ', 9_999);
      await caught(context.sync());
      first.insertText('fine ', 0);
      await context.sync();
      first.load('text');
      await context.sync();
      return first.text;
    });
    expect(text).toBe('fine base');
    runtime.dispose();
  });

  test('a batch that cannot even be planned sends nothing', async () => {
    // The write's target stopped being addressable between the call and the sync. Planning
    // refuses before anything is dispatched, so this is not a document failure at all.
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      const missing = paragraphs.getItemOrNullObject(9);
      await context.sync();
      expect(missing.isNullObject).toBe(true);
      spy.reset();
      // Queue a read against a live object, then break one of the queue's targets by hand: the
      // pending item never became addressable, so an action against it cannot be planned.
      const first = paragraphs.items[0]!;
      first.load('text');
      expect(() => missing.load('text')).toThrow();
      await context.sync();
      expect(spy.requests).toHaveLength(1);
    });
    runtime.dispose();
  });
});

describe('a write made from a read the document has moved past', () => {
  test('is refused, and the error carries the revision it expected and the one it found', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('base'))), save: true });
    const failure = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;

      // Another run moves the document underneath this one.
      await runtime.run(async (inner) => {
        const theirs = MiniDocument.open(inner).body.paragraphs;
        theirs.load();
        await inner.sync();
        theirs.items[0]!.insertText('theirs ', 0);
        await inner.sync();
      });

      first.insertText('mine ', 0);
      return caught(context.sync());
    });
    expect(failure).toMatchObject({ code: 'StaleDocument' });
    const { expectedRevision, actualRevision } = failure as {
      expectedRevision: number;
      actualRevision: number;
    };
    expect(typeof expectedRevision).toBe('number');
    expect(actualRevision).toBeGreaterThan(expectedRevision);
    runtime.dispose();
  });

  test('applied nothing: only the other run is in the document', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('base'))), save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      await runtime.run(async (inner) => {
        const theirs = MiniDocument.open(inner).body.paragraphs;
        theirs.load();
        await inner.sync();
        theirs.items[0]!.insertText('theirs ', 0);
        await inner.sync();
      });
      paragraphs.items[0]!.insertText('mine ', 0);
      await caught(context.sync());
    });
    const text = await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(text).toBe('theirs base');
    runtime.dispose();
  });

  test('a write behind a read is conditional, and adopting the object carries that read along', async () => {
    // A context that decided something from a cached read says which revision it read at — and so
    // does a context that ADOPTED an object carrying that read. The alternative would be an
    // unconditional first write in the adopting run, computed from state a revision old: see
    // `runtime-adoption.test.ts` for the corruption that invites. A context that has read nothing
    // and adopted nothing still writes unconditionally, which is tested there too.
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });

    const kept = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      spy.reset();
      const first = paragraphs.items[0]!;
      first.insertText('read-then-write ', 0);
      await context.sync();
      expect(spy.requests[0]?.expectedRevision).toBeDefined();
      context.trackedObjects.add(first);
      return first;
    });

    const readAt = spy.host.revision();
    spy.reset();
    await runtime.run(kept, async (context) => {
      kept.insertText('adopted-then-write ', 0);
      await context.sync();
    });
    expect(spy.requests).toHaveLength(1);
    expect(spy.requests[0]?.expectedRevision).toBe(readAt);
    runtime.dispose();
  });
});

describe('every host refusal arrives as one of this runtime\u2019s codes', () => {
  const mappings: readonly [AutomationErrorCode, DocxEditorErrorCode][] = [
    ['unsupported-capability', 'NotSupported'],
    ['unknown-operation', 'NotSupported'],
    ['document-unavailable', 'DocumentUnavailable'],
    ['transaction-refused', 'GeneralException'],
    ['invalid-handle', 'InvalidObjectPath'],
    ['invalid-offset', 'InvalidArgument'],
    ['disposed', 'RuntimeDisposed'],
  ];

  for (const [host, mine] of mappings) {
    test(`${host} becomes ${mine}`, async () => {
      const runtime = createRuntime({ host: refusingHost(host).host, save: true });
      const failure = await caught(
        runtime.run(async (context) => {
          MiniDocument.open(context).body.load('text');
          await context.sync();
        })
      );
      expect(failure).toMatchObject({ code: mine });
      runtime.dispose();
    });
  }

  test('nothing from the host reaches the message: no handle, no detail, no store vocabulary', async () => {
    const runtime = createRuntime({
      host: refusingHost('transaction-refused', 'paragraph:deadbeef:1 not-adjacent-siblings').host,
      save: true,
    });
    const failure = (await caught(
      runtime.run(async (context) => {
        MiniDocument.open(context).body.load('text');
        await context.sync();
      })
    )) as { message: string; code: DocxEditorErrorCode; target?: string };
    expect(failure.message).toBe(`${messageFor('GeneralException')} (document)`);
    expect(failure.message).not.toContain('deadbeef');
    expect(failure.message).not.toContain('not-adjacent-siblings');
    expect(failure.message).not.toContain('host says');
    runtime.dispose();
  });

  test('a host that answers a shape the action did not ask for is a general failure', async () => {
    const runtime = createRuntime({
      host: stubHost({
        execute: (request) => ({
          ok: true,
          // A command's answer where a text read was expected.
          results: request.operations.map(() => ({
            status: 'ok' as const,
            value: { kind: 'applied' as const },
          })),
          revision: 1,
          changed: false,
        }),
      }).host,
      save: true,
    });
    const failure = await caught(
      runtime.run(async (context) => {
        // Root resolution itself asks for a handle, so this host cannot even name the document.
        MiniDocument.open(context).body.load('text');
        await context.sync();
      })
    );
    expect(failure).toMatchObject({ code: 'GeneralException' });
    runtime.dispose();
  });

  test('a response with the wrong number of results is a general failure, not a mis-hydration', async () => {
    let batches = 0;
    const runtime = createRuntime({
      host: stubHost({
        execute: (request) => {
          batches += 1;
          const handled = batches <= 2;
          return {
            ok: true,
            results: handled
              ? request.operations.map(() => ({
                  status: 'ok' as const,
                  value: {
                    kind: 'handle' as const,
                    handle: { kind: 'body' as const, ref: 'x' as never },
                  },
                }))
              : [],
            revision: 1,
            changed: false,
          };
        },
      }).host,
      save: true,
    });
    const failure = await caught(
      runtime.run(async (context) => {
        MiniDocument.open(context).body.load('text');
        await context.sync();
      })
    );
    expect(failure).toMatchObject({ code: 'GeneralException' });
    runtime.dispose();
  });
});

describe('disposal', () => {
  test('a host disposed underneath the runtime surfaces as RuntimeDisposed', async () => {
    const host = openHost();
    const runtime = createRuntime({ host, save: true });
    const failure = await caught(
      runtime.run(async (context) => {
        const body = MiniDocument.open(context).body;
        host.dispose();
        body.load('text');
        await context.sync();
      })
    );
    expect(failure).toMatchObject({ code: 'RuntimeDisposed' });
    runtime.dispose();
  });

  test('the runtime disposes its host once, however often it is asked', async () => {
    const stub = stubHost();
    const runtime = createRuntime({ host: stub.host, save: true });
    runtime.dispose();
    runtime.dispose();
    runtime.dispose();
    expect(stub.disposals()).toBe(1);
  });
});

describe('save, and what it refuses', () => {
  test('a runtime that does not offer saving has no save method at all', () => {
    // Not a method that throws: a browser runtime borrows an editor that owns its own saving, and
    // a `save` present-but-refusing would invite consumers to call it and handle the failure.
    const runtime = createRuntime({ host: openHost(), save: false });
    expect('save' in runtime).toBe(false);
    runtime.dispose();
  });

  test('a host that cannot save answers NotSupported', async () => {
    const runtime = createRuntime({
      host: stubHost({ capabilities: { save: false } }).host,
      save: true,
    });
    await expect(runtime.save()).rejects.toMatchObject({
      code: 'NotSupported',
      target: 'save',
    });
    runtime.dispose();
  });

  test('a host with no document to save answers DocumentUnavailable', async () => {
    const runtime = createRuntime({
      host: stubHost({
        save: () => ({
          ok: false,
          error: { code: 'document-unavailable', message: 'nothing open' },
        }),
      }).host,
      save: true,
    });
    await expect(runtime.save()).rejects.toMatchObject({ code: 'DocumentUnavailable' });
    runtime.dispose();
  });
});
