import { describe, expect, test } from 'bun:test';
import { createRetryingLoader } from '../src/retrying-loader.ts';

describe('retrying single-flight loader', () => {
  test('shares successful work but retries a transient rejection', async () => {
    let attempts = 0;
    const load = createRetryingLoader(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return { ready: true };
    });
    await expect(load()).rejects.toThrow('transient');
    const [first, second] = await Promise.all([load(), load()]);
    expect(first).toBe(second);
    expect(attempts).toBe(2);
  });
});
