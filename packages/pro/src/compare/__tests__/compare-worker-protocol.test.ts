/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The compare worker protocol fails closed: data of other code is ignored, a malformed message
// of the protocol ends the compare, and a worker that never starts or cannot receive the
// documents rejects instead of leaving the compare waiting.
import { expect, test } from 'bun:test';
import { createCompareWorkerEngine, type CompareWorkerLike } from '../worker-engine.ts';
import { COMPARE_WORKER_PROTOCOL } from '../worker-protocol.ts';

const WORKER = new URL('../../compare-worker.ts', import.meta.url).href;
const BYTES = new Uint8Array([1]);

type Listener = (event: { data?: unknown; message?: string }) => void;

/** A fake worker the test drives: `emit` sends an event, `ended` counts terminations. */
function fakeWorker(onPost: (worker: FakeWorker) => void = () => {}) {
  const fake = {
    listeners: new Map<string, Set<Listener>>(),
    ended: 0,
    emit(type: string, event: { data?: unknown; message?: string }) {
      for (const listener of fake.listeners.get(type) ?? []) listener(event);
    },
    get listening() {
      let count = 0;
      for (const set of fake.listeners.values()) count += set.size;
      return count;
    },
  };
  const worker = {
    postMessage() {
      onPost(fake);
    },
    addEventListener(type: string, listener: Listener) {
      const set = fake.listeners.get(type) ?? new Set();
      set.add(listener);
      fake.listeners.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      fake.listeners.get(type)?.delete(listener);
    },
    terminate() {
      fake.ended++;
    },
  } as unknown as CompareWorkerLike;
  return { fake, worker };
}
type FakeWorker = ReturnType<typeof fakeWorker>['fake'];

function run(worker: CompareWorkerLike, startupMs?: number) {
  const steps: string[] = [];
  const promise = createCompareWorkerEngine(() => worker, startupMs)(
    BYTES,
    BYTES,
    {},
    { signal: new AbortController().signal, onProgress: (step) => steps.push(step.phase) }
  );
  return { promise, steps };
}

const own = (message: object) => ({ data: { protocol: COMPARE_WORKER_PROTOCOL, ...message } });

test('data of other code is ignored, and the compare still ends on its result', async () => {
  const { fake, worker } = fakeWorker((self) => {
    self.emit('message', { data: { hello: 'world' } });
    self.emit('message', { data: null });
    self.emit('message', own({ type: 'progress', phase: 'comparing', fraction: 0.5 }));
    self.emit(
      'message',
      own({ type: 'result', result: { ok: true, bytes: null, revisionCount: 0, changed: false } })
    );
  });
  const { promise, steps } = run(worker);
  expect(await promise).toEqual({ ok: true, bytes: null, revisionCount: 0, changed: false });
  expect(steps).toEqual(['comparing']);
  expect(fake.ended).toBe(1);
  expect(fake.listening).toBe(0);
});

test('a malformed message of the protocol ends the compare', async () => {
  const malformed = [
    { type: 'unknown' },
    { type: 'progress', phase: 'painting', fraction: 0.5 },
    { type: 'progress', phase: 'reading', fraction: Number.NaN },
    { type: 'progress', phase: 'reading', fraction: 2 },
    { type: 'result', result: 'ok' },
    { type: 'result', result: { ok: true, bytes: 'x', revisionCount: 1, changed: true } },
    { type: 'result', result: { ok: true, bytes: null, revisionCount: '1', changed: true } },
    { type: 'result', result: { ok: false, code: 'busy', message: 'x' } },
    // A changed result without bytes, or bytes for an unchanged one, cannot be applied.
    { type: 'result', result: { ok: true, bytes: null, revisionCount: 1, changed: true } },
    {
      type: 'result',
      result: { ok: true, bytes: new Uint8Array(1), revisionCount: 0, changed: false },
    },
    { type: 'result', result: { ok: true, bytes: null, revisionCount: -1, changed: false } },
    { type: 'error', message: 7 },
  ];
  for (const message of malformed) {
    const { fake, worker } = fakeWorker((self) => self.emit('message', own(message)));
    const { promise } = run(worker);
    await expect(promise).rejects.toThrow('malformed');
    expect(fake.ended).toBe(1);
    expect(fake.listening).toBe(0);
  }
});

test('a message that cannot be read ends the compare', async () => {
  const { fake, worker } = fakeWorker((self) => self.emit('messageerror', {}));
  await expect(run(worker).promise).rejects.toThrow('cannot be read');
  expect(fake.ended).toBe(1);
  expect(fake.listening).toBe(0);
});

test('a worker that cannot receive the documents rejects with the cause', async () => {
  const { fake, worker } = fakeWorker(() => {
    throw new DOMException('could not clone', 'DataCloneError');
  });
  const promise = run(worker).promise;
  await expect(promise).rejects.toThrow('could not receive');
  const error = (await promise.catch((caught: unknown) => caught)) as Error;
  expect((error.cause as DOMException).name).toBe('DataCloneError');
  expect(fake.ended).toBe(1);
  expect(fake.listening).toBe(0);
});

test('a worker that never sends a valid message misses the startup deadline', async () => {
  // Data of other code does not count as a start.
  const { fake, worker } = fakeWorker((self) => self.emit('message', { data: { hello: 1 } }));
  await expect(run(worker, 20).promise).rejects.toThrow('did not start');
  expect(fake.ended).toBe(1);
  // After the first valid message there is no deadline.
  const started = fakeWorker((self) => {
    self.emit('message', own({ type: 'progress', phase: 'reading', fraction: 0 }));
    setTimeout(
      () =>
        self.emit(
          'message',
          own({
            type: 'result',
            result: { ok: true, bytes: null, revisionCount: 0, changed: false },
          })
        ),
      60
    );
  });
  expect((await run(started.worker, 20).promise).ok).toBe(true);
});

function reply(worker: Worker, data: unknown, waitMs = 400): Promise<unknown[]> {
  return new Promise((resolve) => {
    const received: unknown[] = [];
    worker.addEventListener('message', (event) => received.push(event.data));
    worker.postMessage(data);
    setTimeout(() => resolve(received), waitMs);
  });
}

test('the worker answers a malformed request of its protocol, and nothing else', async () => {
  const worker = new Worker(WORKER, { type: 'module' });
  try {
    expect(await reply(worker, { hello: 'world' })).toEqual([]);
    expect(
      await reply(worker, { protocol: COMPARE_WORKER_PROTOCOL, type: 'compare', original: 'x' })
    ).toEqual([
      {
        protocol: COMPARE_WORKER_PROTOCOL,
        type: 'error',
        message: 'The compare request is malformed.',
      },
    ]);
  } finally {
    worker.terminate();
  }
});
