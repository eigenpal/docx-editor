import { describe, expect, test } from 'bun:test';
import { deferredTick } from '../src/editor/deferred-notifier';

describe('deferredTick', () => {
  test('coalesces a burst into one notification', async () => {
    let count = 0;
    const notify = deferredTick(() => {
      count++;
    });
    notify();
    notify();
    notify();
    expect(count).toBe(0);
    await new Promise((r) => queueMicrotask(r));
    expect(count).toBe(1);
  });
});
