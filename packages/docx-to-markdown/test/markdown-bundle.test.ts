import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { createMarkdownZip, exportMarkdown, toMarkdownJSON } from '../src/index.ts';
import { writeMarkdownBundle } from '../src/node.ts';
import { imageDocx, PNG } from './media-fixture.ts';

const temporary = await mkdtemp(join(tmpdir(), 'markdown-media-'));
afterAll(() => rm(temporary, { recursive: true, force: true }));
const result = await exportMarkdown(imageDocx(), { images: true, measurer: createFixedMeasurer() });

test('JSON omits only image bytes and retains image/page/review metadata', () => {
  const json = toMarkdownJSON(result);
  const { bytes: _bytes, ...metadata } = result.media[0]!;
  expect(json.media).toEqual([metadata]);
  expect(json.pages).toEqual(result.pages);
  expect(json.reviewBindings).toEqual(result.reviewBindings);
  expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  expect(result.media[0]!.bytes).toEqual(PNG);
});

test('JSON safely represents arbitrary font-origin failure causes without mutating the report', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const causes = [new Error('font unavailable'), circular, 1n, Object.create(null)];
  const changed = {
    ...result,
    fontResolution: {
      requestedFamilies: [],
      defaultFamily: 'Arial',
      families: [],
      originFailures: causes.map((cause, originIndex) => ({ cause, originIndex })),
    },
  };
  const json = toMarkdownJSON(changed);
  expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  expect(json.fontResolution!.originFailures.map(({ cause }) => cause)).toEqual([
    'Error: font unavailable',
    '[object Object]',
    '1',
    'Font origin failed (cause could not be converted to text).',
  ]);
  expect(changed.fontResolution.originFailures[1]!.cause).toBe(circular);
});

test('deterministic ZIP and folder contain identical files and usable relative image links', async () => {
  const first = await createMarkdownZip(result);
  const second = await createMarkdownZip(result);
  expect(first).toEqual(second);
  const files = unzipSync(first);
  const directory = join(temporary, 'new');
  await writeMarkdownBundle(result, { directory });
  expect(Object.keys(files).sort()).toEqual(
    ['document.json', 'document.md', result.media[0]!.path].sort()
  );
  for (const [path, bytes] of Object.entries(files))
    expect(new Uint8Array(await readFile(join(directory, path)))).toEqual(bytes);
  expect(strFromU8(files['document.md']!)).toBe(result.markdown);
  expect(strFromU8(files['document.json']!)).toBe(JSON.stringify(toMarkdownJSON(result), null, 2));
  expect(files[result.media[0]!.path]).toEqual(PNG);
});

test('large ZIPs round-trip without workers, yield to the host, and retain caller bytes', async () => {
  const markdown = 'Large ZIP payload 😀\n'.repeat(20000);
  let yielded = false;
  const timer = setTimeout(() => {
    yielded = true;
  }, 0);
  try {
    const zip = await createMarkdownZip({ ...result, markdown });
    expect(yielded).toBe(true);
    expect(strFromU8(unzipSync(zip)['document.md']!)).toBe(markdown);
    expect(result.media[0]!.bytes).toEqual(PNG);
  } finally {
    clearTimeout(timer);
  }
});

test('empty text-only exports produce complete bundles without a media directory', async () => {
  const empty = await exportMarkdown(imageDocx('<w:p/>'), { measurer: createFixedMeasurer() });
  const files = unzipSync(await createMarkdownZip(empty));
  expect(Object.keys(files).sort()).toEqual(['document.json', 'document.md']);
  expect(strFromU8(files['document.md']!)).toBe('');
  const directory = join(temporary, 'text-only');
  await writeMarkdownBundle(empty, { directory });
  expect((await readdir(directory)).sort()).toEqual(['document.json', 'document.md']);
});

test('writes existing empty folders, refuses nonempty output without overwriting', async () => {
  const directory = join(temporary, 'empty');
  await mkdir(directory);
  await writeMarkdownBundle(result, { directory });
  await expect(writeMarkdownBundle(result, { directory })).rejects.toMatchObject({
    code: 'output-not-empty',
  });
  expect(new Uint8Array(await readFile(join(directory, result.media[0]!.path)))).toEqual(PNG);
});

test('preflight refuses traversal, duplicate paths, and hosted URLs before writes', async () => {
  const cases = [
    { media: [{ ...result.media[0]!, path: '../escape.png' }], code: 'invalid-media-path' },
    { media: [result.media[0]!, result.media[0]!], code: 'duplicate-output-path' },
    {
      media: [{ ...result.media[0]!, url: 'https://cdn.example.test/image.png' }],
      code: 'non-portable-image-url',
    },
  ];
  for (const item of cases) {
    const changed = { ...result, media: item.media };
    await expect(createMarkdownZip(changed)).rejects.toMatchObject({ code: item.code });
    const directory = join(temporary, item.code);
    await expect(writeMarkdownBundle(changed, { directory })).rejects.toMatchObject({
      code: item.code,
    });
    expect(await readdir(temporary)).not.toContain(item.code);
  }
});

test('refuses a symbolic-link output folder and leaves its target untouched', async () => {
  const outside = join(temporary, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'keep');
  const linked = join(temporary, 'linked');
  await symlink(outside, linked);
  await expect(writeMarkdownBundle(result, { directory: linked })).rejects.toMatchObject({
    code: 'write-failed',
  });
  expect(await readdir(outside)).toEqual(['keep.txt']);
});

test('cleans files created before a write failure', async () => {
  const directory = join(temporary, 'failed');
  // Force writeFile to reject the media payload after the two document files were written.
  const changed = { ...result, media: [{ ...result.media[0]!, bytes: {} as Uint8Array }] };
  await expect(writeMarkdownBundle(changed, { directory })).rejects.toMatchObject({
    code: 'write-failed',
  });
  expect(await readdir(temporary)).not.toContain('failed');
});
