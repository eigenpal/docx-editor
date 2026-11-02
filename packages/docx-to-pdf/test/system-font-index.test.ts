/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Installed families that no fixed rule names resolve through an index of the font folders,
// read from each file's own `name` and `OS/2` tables rather than from its file name.
import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedWordFontResolver } from '../src/font-provisioning.ts';
import { buildSystemFontIndex, indexedFace } from '../src/system-font-index.ts';

const fixture = (name: string) =>
  new URL(`../../core/src/layout/__tests__/fixtures/fonts/${name}`, import.meta.url);

async function directory(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-font-index-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('the index reads family and style from the font tables, in nested folders', async () => {
  await directory(async (root) => {
    await mkdir(join(root, 'a', 'b'), { recursive: true });
    await copyFile(fixture('DejaVuSans.ttf'), join(root, 'a', 'one.ttf'));
    await copyFile(fixture('DejaVuSans-Bold.ttf'), join(root, 'a', 'b', 'two.ttf'));
    await writeFile(join(root, 'broken.ttf'), new Uint8Array([0, 1, 0, 0, 0, 9]));
    const index = await buildSystemFontIndex([root]);
    expect(indexedFace(index, 'dejavu sans', false, false)?.path).toEndWith('one.ttf');
    expect(indexedFace(index, 'DejaVu Sans', true, false)?.path).toEndWith('two.ttf');
    // A missing italic reads the nearest upright face; the renderer slants it.
    expect(indexedFace(index, 'DejaVu Sans', true, true)?.path).toEndWith('two.ttf');
    expect(indexedFace(index, 'DejaVu Sans', false, true)?.path).toEndWith('one.ttf');
    expect(indexedFace(index, 'Missing Family', false, false)).toBeUndefined();
    // A PostScript name is not a family name.
    expect(indexedFace(index, 'DejaVuSans', false, false)).toBeUndefined();
  });
});

test('the index does not follow a link out of its folder', async () => {
  await directory(async (outside) => {
    await copyFile(fixture('DejaVuSans.ttf'), join(outside, 'face.ttf'));
    await directory(async (root) => {
      await symlink(outside, join(root, 'linked'));
      await symlink(join(outside, 'face.ttf'), join(root, 'linked-face.ttf'));
      const index = await buildSystemFontIndex([root]);
      expect(index.size).toBe(0);
    });
  });
});

test('an installed family with no fixed rule resolves its installed faces from the index', async () => {
  await directory(async (root) => {
    await copyFile(fixture('DejaVuSans.ttf'), join(root, 'regular.ttf'));
    await copyFile(fixture('DejaVuSans-Bold.ttf'), join(root, 'bold.ttf'));
    const resolve = installedWordFontResolver([], [root]);
    const result = await resolve({ families: ['DejaVu Sans'], defaultFamily: 'Unavailable Font' });
    // Each file loads once. The italics have no file of their own; the engine maps them to
    // the nearest face, which the renderer slants.
    expect(result.sources.map((source) => source.request)).toEqual([
      { family: 'DejaVu Sans', weight: 400, style: 'normal' },
      { family: 'DejaVu Sans', weight: 700, style: 'normal' },
    ]);
    // A face this package ships is never read from a system copy.
    await copyFile(fixture('DejaVuSans.ttf'), join(root, 'Carlito.ttf'));
    const shipped = await resolve({ families: ['Carlito'], defaultFamily: 'Carlito' });
    expect(shipped.sources).toHaveLength(0);
    const missing = await resolve({ families: ['Other Family'], defaultFamily: 'Other Family' });
    expect(missing.sources).toHaveLength(0);
  });
});
