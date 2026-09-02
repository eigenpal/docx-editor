import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPackagedFileFetch, type PackagedFileRead } from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';

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

test('PDF export pins packaged file reads to workspace and bundle-co-located roots', () => {
  const source = readFileSync(exportSourcePath, 'utf8');
  expect(existsSync(join(import.meta.dir, '..', 'src', 'packaged-file-fetch.ts'))).toBe(false);
  expect(source).toContain("new URL('../../fonts/assets/', import.meta.url)");
  expect(source).toContain("new URL('../assets/', import.meta.url)");
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

test('PDF packaged-font roots admit workspace and bundle-co-located assets only', async () => {
  const exportModuleUrl = new URL('../src/pdf-export.ts', import.meta.url);
  const workspaceRoot = new URL('../../fonts/assets/', exportModuleUrl);
  const bundledRoot = new URL('../assets/', exportModuleUrl);
  const reads: string[] = [];
  const fetcher = createPackagedFileFetch({
    trustedRoot: [workspaceRoot, bundledRoot],
    maxBytes: HARD_MAX_FONT_BYTES,
    read: async (path) => {
      reads.push(String(path));
      return new Uint8Array([1]);
    },
  });

  const workspaceFace = new URL('Carlito-Regular.ttf', workspaceRoot);
  const bundledFace = new URL('Carlito-Regular.ttf', bundledRoot);
  expect((await fetcher(workspaceFace)).status).toBe(200);
  expect((await fetcher(bundledFace)).status).toBe(200);
  expect((await fetcher(new URL('file:///etc/passwd'))).status).toBe(404);
  expect((await fetcher(new URL('../secret.ttf', workspaceRoot))).status).toBe(404);
  expect((await fetcher(new URL('../secret.ttf', bundledRoot))).status).toBe(404);
  expect(reads).toEqual([workspaceFace.href, bundledFace.href]);
});
