import { expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPackagedFileFetch, type PackagedFileRead } from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_MANIFEST, FONT_ASSET_ROOT } from '@docx-editor.dev/fonts';

const TEST_ROOT = new URL('file:///packaged/');
const TEST_FILE = new URL('file:///packaged/font.woff2');

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

test('markdown export confines packaged file reads to the fonts package asset root', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf8');
  expect(source).toContain('FONT_ASSET_ROOT');
  expect(source).toContain("new URL('./', FONT_ASSET_ROOT)");
  expect(source).toContain("FONT_ASSET_ROOT.protocol === 'file:'");
  expect(source).toContain('maxBytes: HARD_MAX_FONT_BYTES');
  expect(source).not.toContain('../../fonts/assets/');
  expect(source).not.toContain("new URL('../assets/', import.meta.url)");
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

test('markdown packaged-font root admits fonts-package assets and refuses anything else', async () => {
  const reads: string[] = [];
  const fetcher = createPackagedFileFetch({
    trustedRoot: new URL('./', FONT_ASSET_ROOT),
    maxBytes: HARD_MAX_FONT_BYTES,
    read: async (path) => {
      reads.push(String(path));
      return new Uint8Array([1]);
    },
  });

  const packagedFace = new URL(FONT_ASSET_MANIFEST[0]!.file, FONT_ASSET_ROOT);
  expect((await fetcher(packagedFace)).status).toBe(200);
  expect((await fetcher(new URL('file:///etc/passwd'))).status).toBe(404);
  expect((await fetcher(new URL('../secret.ttf', FONT_ASSET_ROOT))).status).toBe(404);
  expect(reads).toEqual([packagedFace.href]);
});

test('derived packaged-font root admits faces when the fonts package is reached through a symlink', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'markdown-packaged-fonts-'));
  try {
    const realFonts = join(tmp, '.pnpm', 'fonts', 'node_modules', '@docx-editor.dev', 'fonts');
    mkdirSync(join(realFonts, 'assets'), { recursive: true });
    mkdirSync(join(realFonts, 'dist'), { recursive: true });
    writeFileSync(join(realFonts, 'assets', 'face.ttf'), 'font');

    const markdownPkg = join(
      tmp,
      '.pnpm',
      'markdown',
      'node_modules',
      '@docx-editor.dev',
      'docx-to-markdown'
    );
    mkdirSync(join(markdownPkg, 'dist'), { recursive: true });

    const nestedFontsLink = join(
      tmp,
      '.pnpm',
      'markdown',
      'node_modules',
      '@docx-editor.dev',
      'fonts'
    );
    mkdirSync(dirname(nestedFontsLink), { recursive: true });
    symlinkSync(realFonts, nestedFontsLink);

    const fontsModuleUrl = pathToFileURL(
      join(realpathSync(nestedFontsLink), 'dist', 'index.js')
    ).href;
    const faceUrl = new URL('../assets/face.ttf', fontsModuleUrl);
    const derivedRoot = new URL('./', faceUrl);
    const guessedRoot = new URL(
      '../../fonts/assets/',
      pathToFileURL(join(markdownPkg, 'dist', 'index.js')).href
    );

    const derived = createPackagedFileFetch({
      trustedRoot: derivedRoot,
      maxBytes: HARD_MAX_FONT_BYTES,
    });
    const admitted = await derived(faceUrl);
    expect(admitted.status).toBe(200);
    expect(new Uint8Array(await admitted.arrayBuffer())).toEqual(
      new Uint8Array([102, 111, 110, 116])
    );

    const guessed = createPackagedFileFetch({
      trustedRoot: guessedRoot,
      maxBytes: HARD_MAX_FONT_BYTES,
    });
    expect((await guessed(faceUrl)).status).toBe(404);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
