import { expect, test } from 'bun:test';
import { createPackagedFileFetch } from '../src/packaged-file-fetch.ts';

test('packaged file reads physically observe abort before a retry begins', async () => {
  const observedSignals: AbortSignal[] = [];
  const fetcher = createPackagedFileFetch(
    (_path, { signal }) =>
      new Promise<Uint8Array>((_resolve, reject) => {
        if (!signal) throw new Error('expected read cancellation signal');
        observedSignals.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
  );
  const first = new AbortController();
  const firstRead = fetcher(new URL('file:///packaged-font.woff2'), { signal: first.signal });
  first.abort('deadline-one');
  await expect(firstRead).rejects.toBe('deadline-one');
  expect(observedSignals[0]?.aborted).toBe(true);

  const second = new AbortController();
  const secondRead = fetcher(new URL('file:///packaged-font.woff2'), { signal: second.signal });
  expect(observedSignals).toHaveLength(2);
  expect(observedSignals[1]?.aborted).toBe(false);
  second.abort('deadline-two');
  await expect(secondRead).rejects.toBe('deadline-two');
});

test('packaged file fetch distinguishes missing files from cancellation', async () => {
  const missing = createPackagedFileFetch(async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
  expect((await missing(new URL('file:///missing-font.woff2'))).status).toBe(404);

  const controller = new AbortController();
  controller.abort('already-stopped');
  await expect(
    missing(new URL('file:///missing-font.woff2'), { signal: controller.signal })
  ).rejects.toBe('already-stopped');
});
