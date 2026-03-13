import { describe, it, expect } from 'bun:test';
import { createWorkerClient } from './pmDocumentWorkerClient';

type WorkerMessage = { data: any };

function createFakeWorker() {
  let onmessage: ((event: WorkerMessage) => void) | null = null;
  const queue: any[] = [];

  return {
    postMessage(payload: any) {
      queue.push(payload);
    },
    terminate() {
      queue.length = 0;
    },
    getQueue() {
      return [...queue];
    },
    flushById(id: number, document: any = { package: { document: { content: [] } } }) {
      const idx = queue.findIndex((item) => item.id === id);
      if (idx === -1) return;
      const [item] = queue.splice(idx, 1);
      onmessage?.({ data: { id: item.id, mode: item.mode, document } });
    },
    set onmessage(handler: ((event: WorkerMessage) => void) | null) {
      onmessage = handler;
    },
    get onmessage() {
      return onmessage;
    },
  };
}

describe('pmDocumentWorkerClient', () => {
  it('returns null when disabled', async () => {
    const client = createWorkerClient({ enabled: false });
    const result = await client.convert({
      mode: 'full',
      pmDocJson: { type: 'doc', content: [] },
      baseDocument: null,
    });
    expect(result).toBeNull();
  });

  it('resolves stale results as null when newer request exists', async () => {
    const fakeWorker = createFakeWorker();
    const client = createWorkerClient({
      enabled: true,
      workerFactory: () => fakeWorker as any,
    });

    const first = client.convert({
      mode: 'full',
      pmDocJson: { type: 'doc', content: [] },
      baseDocument: null,
    });
    const second = client.convert({
      mode: 'full',
      pmDocJson: { type: 'doc', content: [] },
      baseDocument: null,
    });

    fakeWorker.flushById(2, { package: { document: { content: [] } } });
    fakeWorker.flushById(1, { package: { document: { content: [] } } });

    await expect(second).resolves.not.toBeNull();
    await expect(first).resolves.toBeNull();
  });
});
