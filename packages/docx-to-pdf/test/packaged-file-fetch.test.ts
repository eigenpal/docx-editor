/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPackagedFileFetch, type PackagedFileRead } from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT } from '@docx-editor.dev/fonts';

const TEST_ROOT = new URL('file:///packaged/');
const TEST_FILE = new URL('file:///packaged/font.woff2');
const exportSourcePath = join(import.meta.dir, '..', 'src', 'pdf-export.ts');

function confinedFetch(
  read?: PackagedFileRead,
  networkFetch?: typeof fetch,
  maxBytes = 1024
): typeof fetch {
  return createPackagedFileFetch({
    trustedRoot: TEST_ROOT,
    maxBytes,
    ...(read ? { read } : {}),
    ...(networkFetch ? { networkFetch } : {}),
  });
}

test('PDF export derives its packaged file root from the fonts package', () => {
  const source = readFileSync(exportSourcePath, 'utf8');
  expect(existsSync(join(import.meta.dir, '..', 'src', 'packaged-file-fetch.ts'))).toBe(false);
  expect(source).toContain(
    "import { FONT_ASSET_ROOT, packagedFonts } from '@docx-editor.dev/fonts'"
  );
  expect(source).toContain("trustedRoot: new URL('./', FONT_ASSET_ROOT)");
  expect(source).toContain('maxBytes: HARD_MAX_FONT_BYTES');
  expect(source).not.toMatch(/createPackagedFileFetch\(\s*\)/);
});

test('packaged file reads physically observe abort before a retry begins', async () => {
  const observedSignals: AbortSignal[] = [];
  const fetcher = confinedFetch(
    (_path, { signal }) =>
      new Promise<Uint8Array>((_resolve, reject) => {
        if (!signal) throw new Error('expected read cancellation signal');
        observedSignals.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
  );
  const first = new AbortController();
  const firstRead = fetcher(TEST_FILE, { signal: first.signal });
  first.abort('deadline-one');
  await expect(firstRead).rejects.toBe('deadline-one');
  expect(observedSignals[0]?.aborted).toBe(true);

  const second = new AbortController();
  const secondRead = fetcher(TEST_FILE, { signal: second.signal });
  expect(observedSignals).toHaveLength(2);
  expect(observedSignals[1]?.aborted).toBe(false);
  second.abort('deadline-two');
  await expect(secondRead).rejects.toBe('deadline-two');
});

test('packaged file fetch distinguishes missing files from cancellation', async () => {
  const missing = confinedFetch(async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
  expect((await missing(TEST_FILE)).status).toBe(404);

  const controller = new AbortController();
  controller.abort('already-stopped');
  await expect(missing(TEST_FILE, { signal: controller.signal })).rejects.toBe('already-stopped');
});

test('packaged file fetch delegates bundler HTTP asset URLs to the host fetch', async () => {
  const calls: Array<{ readonly url: string; readonly signal: AbortSignal | null }> = [];
  const controller = new AbortController();
  const fetcher = confinedFetch(
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

test('PDF packaged-font root admits only assets reported by the fonts package', async () => {
  const trustedRoot = new URL('./', FONT_ASSET_ROOT);
  const reads: string[] = [];
  const fetcher = createPackagedFileFetch({
    trustedRoot,
    maxBytes: HARD_MAX_FONT_BYTES,
    read: async (path) => {
      reads.push(String(path));
      return new Uint8Array([1]);
    },
  });

  const packagedFace = new URL('Carlito-Regular.ttf', trustedRoot);
  expect((await fetcher(packagedFace)).status).toBe(200);
  expect((await fetcher(new URL('file:///etc/passwd'))).status).toBe(404);
  expect((await fetcher(new URL('../secret.ttf', trustedRoot))).status).toBe(404);
  expect(reads).toEqual([packagedFace.href]);
});
