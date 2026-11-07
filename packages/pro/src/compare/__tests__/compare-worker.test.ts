/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The compare worker gives the same result as the compare on the calling thread, reports its
// steps in order, and stops when the signal aborts.
import { expect, test } from 'bun:test';
import { readOoxmlPackage, writeOoxmlPackage } from '@docx-editor.dev/core/store';
import type { CompareDocumentsProgress } from '@docx-editor.dev/core/editor';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';
import { createCompareWorkerEngine } from '../worker-engine.ts';

const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const ORIGINAL = buildDocx({ body: para('The quick brown fox jumps.') + para('Kept.') });
const REVISED = buildDocx({ body: para('The quick red fox jumps far.') + para('Kept.') });
const WORKER = new URL('../../compare-worker.ts', import.meta.url).href;

const engine = createCompareWorkerEngine(() => new Worker(WORKER, { type: 'module' }));

/** The original as the editor sends it: written from its live package. */
function originalBytes(): Uint8Array {
  const read = readOoxmlPackage(ORIGINAL);
  if (!read.ok) throw new Error(read.reason);
  return writeOoxmlPackage(read.package);
}

test('the worker gives the same result as the compare on the calling thread', async () => {
  const steps: CompareDocumentsProgress[] = [];
  const original = originalBytes();
  const result = await engine(
    original,
    REVISED,
    { authorName: 'Legal', removeDateAndTime: true },
    { signal: new AbortController().signal, onProgress: (step) => steps.push(step) }
  );
  const expected = compareDocuments(original, REVISED, {
    authorName: 'Legal',
    removeDateAndTime: true,
  });
  if (!result.ok || !expected.ok) throw new Error('compare refused');
  expect(result.changed).toBe(true);
  expect(result.revisionCount).toBe(expected.revisionCount);
  expect(result.bytes).toEqual(expected.bytes);
  // The caller keeps its bytes: the worker gets copies.
  expect(original.byteLength).toBeGreaterThan(0);
  expect(REVISED.byteLength).toBeGreaterThan(0);
  expect(steps.map((step) => step.phase)).toEqual(['reading', 'comparing', 'checking']);
  const fractions = steps.map((step) => step.fraction);
  expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
});

test('the worker answers no differences without bytes', async () => {
  const original = originalBytes();
  const result = await engine(
    original,
    ORIGINAL,
    {},
    { signal: new AbortController().signal, onProgress: () => {} }
  );
  expect(result).toEqual({ ok: true, bytes: null, revisionCount: 0, changed: false });
});

test('the worker refuses an unreadable revised file with its code', async () => {
  const result = await engine(
    originalBytes(),
    new Uint8Array([1, 2, 3]),
    {},
    { signal: new AbortController().signal, onProgress: () => {} }
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('invalidRevised');
});

test('an aborted compare rejects with the reason and ends its worker', async () => {
  let ended = 0;
  const counted = createCompareWorkerEngine(() => {
    const worker = new Worker(WORKER, { type: 'module' });
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      ended++;
      terminate();
    };
    return worker;
  });
  const controller = new AbortController();
  const running = counted(
    originalBytes(),
    REVISED,
    {},
    {
      signal: controller.signal,
      onProgress: () => {},
    }
  );
  controller.abort(new Error('stopped'));
  await expect(running).rejects.toThrow('stopped');
  expect(ended).toBe(1);
  // A signal that aborted before the call starts no worker.
  await expect(
    counted(originalBytes(), REVISED, {}, { signal: controller.signal, onProgress: () => {} })
  ).rejects.toThrow('stopped');
  expect(ended).toBe(1);
});
