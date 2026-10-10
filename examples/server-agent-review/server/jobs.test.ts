import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JobStore } from './jobs.ts';

describe('browser-independent jobs', () => {
  test('duplicate submissions share a job, cancellation stops it, and restart preserves terminal status', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'review-jobs-'));
    let calls = 0;
    const store = new JobStore(directory, async ({ signal, committed }) => {
      calls++;
      committed('replacement');
      await new Promise<void>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    try {
      await store.load();
      const input = {
        roomId: 'room-test',
        requestId: crypto.randomUUID(),
        instruction: 'Review',
        mode: 'scripted' as const,
      };
      const first = await store.start(input);
      const duplicate = await store.start(input);
      expect(duplicate.id).toBe(first.id);
      expect(calls).toBe(1);
      await expect(store.start({ ...input, requestId: crypto.randomUUID() })).rejects.toThrow(
        'already running'
      );
      store.cancel(first.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      await store.close();
      const recovered = new JobStore(directory);
      await recovered.load();
      expect(recovered.latest(input.roomId)?.state).toBe('cancelled');
      expect(recovered.latest(input.roomId)?.proposals).toBe(1);
      await recovered.close();
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('loading an unfinished job marks it interrupted and does not resume model execution', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'review-jobs-'));
    let finish!: () => void;
    const first = new JobStore(
      directory,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    try {
      await first.load();
      const job = await first.start({
        roomId: 'room-test',
        requestId: crypto.randomUUID(),
        instruction: 'Review',
        mode: 'scripted',
      });
      const recovered = new JobStore(directory);
      await recovered.load();
      expect(recovered.jobs.get(job.id)?.state).toBe('interrupted');
      await recovered.close();
      finish();
      await first.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
