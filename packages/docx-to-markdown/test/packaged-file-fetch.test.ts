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

test('packaged file fetch delegates bundler HTTP asset URLs to the host fetch', async () => {
  const calls: Array<{ readonly url: string; readonly signal: AbortSignal | null }> = [];
  const controller = new AbortController();
  const fetcher = createPackagedFileFetch(
    async () => {
      throw new Error('file reader must not receive browser assets');
    },
    (async (input, init) => {
      calls.push({
        url: input instanceof URL ? input.href : String(input),
        signal: init?.signal ?? null,
      });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch
  );

  const response = await fetcher(new URL('https://demo.test/assets/Carlito-Regular.ttf'), {
    signal: controller.signal,
  });

  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(calls).toEqual([
    {
      url: 'https://demo.test/assets/Carlito-Regular.ttf',
      signal: controller.signal,
    },
  ]);
});
