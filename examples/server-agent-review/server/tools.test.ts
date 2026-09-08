import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createReviewTools } from './tools.ts';
import { sampleDocument } from './sample.ts';

async function setup() {
  const runtime = await DocxEditor.createServer(sampleDocument(), {
    author: 'Review agent',
    revisionTextView: 'original',
  });
  const abort = new AbortController();
  let committed = 0;
  const adapter = createReviewTools(runtime, {
    signal: abort.signal,
    progress() {},
    committed() {
      committed++;
    },
  });
  const read = async () =>
    (await adapter.read()).paragraphs.find((p) => p.text.includes('7 days'))!;
  return { runtime, adapter, abort, read, committed: () => committed };
}
describe('server review tools', () => {
  test('a human edit invalidates the model snapshot; rereading allows a fresh proposal', async () => {
    const s = await setup();
    try {
      const old = await s.read();
      await s.runtime.run(async (c) => {
        c.document.body.insertText('Human addition', 'End');
        await c.sync();
      });
      expect(
        await s.adapter.apply('replacement', {
          snapshot: old.snapshot,
          quote: '7 days',
          text: '30 days',
        })
      ).toMatchObject({ ok: false, code: 'stale-snapshot' });
      expect(s.committed()).toBe(0);
      const fresh = await s.read();
      expect(
        await s.adapter.apply('replacement', {
          snapshot: fresh.snapshot,
          quote: '7 days',
          text: '30 days',
        })
      ).toEqual({ ok: true });
      expect(s.committed()).toBe(1);
    } finally {
      s.runtime.dispose();
    }
  });
  test('cancelled jobs cannot commit', async () => {
    const s = await setup();
    try {
      const snapshot = await s.read();
      s.abort.abort();
      await expect(
        s.adapter.apply('deletion', { snapshot: snapshot.snapshot, quote: '7 days' })
      ).rejects.toBeDefined();
      expect(s.committed()).toBe(0);
    } finally {
      s.runtime.dispose();
    }
  });
  test('model tool call IDs are idempotent', async () => {
    const s = await setup();
    try {
      const snapshot = await s.read();
      const execute = s.adapter.tools.propose_replacement.execute!;
      const input = { snapshot: snapshot.snapshot, quote: '7 days', text: '30 days' };
      const first = await execute(input, { toolCallId: 'same-call', messages: [], context: {} });
      const second = await execute(input, { toolCallId: 'same-call', messages: [], context: {} });
      expect(first).toEqual({ ok: true });
      expect(second).toEqual(first);
      expect(s.committed()).toBe(1);
    } finally {
      s.runtime.dispose();
    }
  });
});

test('three stale tool calls abort the job and latch a refusal for later reads and writes', async () => {
  const runtime = await DocxEditor.createServer(sampleDocument(), { author: 'Agent' });
  const controller = new AbortController();
  let committed = 0;
  const adapter = createReviewTools(runtime, {
    signal: controller.signal,
    progress() {},
    committed() {
      committed++;
    },
    fatal: (error) => controller.abort(error),
  });
  try {
    const execute = adapter.tools.propose_deletion.execute!;
    for (let i = 0; i < 2; i++)
      expect(
        await execute(
          { snapshot: 'expired', quote: '7 days' },
          { toolCallId: `stale-${i}`, messages: [], context: {} }
        )
      ).toMatchObject({ ok: false });
    await expect(
      execute(
        { snapshot: 'expired', quote: '7 days' },
        { toolCallId: 'stale-3', messages: [], context: {} }
      )
    ).rejects.toThrow('Review stopped');
    expect(controller.signal.aborted).toBe(true);
    // The SDK may consume the exception as a tool-error; neither a fresh read nor a new
    // proposal may revive this adapter after that happens.
    await expect(adapter.read()).rejects.toThrow('Review stopped');
    await expect(
      execute(
        { snapshot: 'expired', quote: '7 days' },
        { toolCallId: 'later', messages: [], context: {} }
      )
    ).rejects.toThrow('Review stopped');
    expect(committed).toBe(0);
  } finally {
    runtime.dispose();
  }
});

for (const kind of ['insertion', 'replacement'] as const) {
  for (const value of [undefined, '']) {
    test(`${kind} with ${value === undefined ? 'missing' : 'empty'} text cannot commit or remove content`, async () => {
      const s = await setup();
      try {
        const before = await s.runtime.save();
        const snapshot = await s.read();
        expect(
          await s.adapter.apply(kind, {
            snapshot: snapshot.snapshot,
            quote: '7 days',
            ...(value === undefined ? {} : { text: value }),
          })
        ).toMatchObject({ ok: false, code: 'invalid-proposal' });
        expect(s.committed()).toBe(0);
        expect(await s.runtime.save()).toEqual(before);
        expect(
          await s.adapter.apply('deletion', {
            snapshot: snapshot.snapshot,
            quote: '7 days',
          })
        ).toEqual({ ok: true });
        expect(s.committed()).toBe(1);
      } finally {
        s.runtime.dispose();
      }
    });
  }
}
