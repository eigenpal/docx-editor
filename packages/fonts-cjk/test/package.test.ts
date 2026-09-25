import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { NOTO_SANS_CJK_JP_FAMILY, NOTO_SANS_CJK_JP_URL } from '../src/index.ts';

const sources = JSON.parse(
  readFileSync(new URL('../assets/sources.json', import.meta.url), 'utf8')
) as Record<string, { url: string; sha256?: string; installedSha256?: string }>;

test('the exported URL names the packaged face file', () => {
  expect(NOTO_SANS_CJK_JP_FAMILY).toBe('Noto Sans CJK JP');
  expect(NOTO_SANS_CJK_JP_URL.protocol).toBe('file:');
  expect(NOTO_SANS_CJK_JP_URL.href).toBe(
    new URL('../assets/NotoSansCJKjp-Regular.otf', import.meta.url).href
  );
  expect(statSync(NOTO_SANS_CJK_JP_URL).isFile()).toBe(true);
});

test('the face matches the recorded upstream binary', () => {
  const record = sources['NotoSansCJKjp-Regular.otf'];
  expect(record?.installedSha256).toBeDefined();
  const digest = createHash('sha256').update(readFileSync(NOTO_SANS_CJK_JP_URL)).digest('hex');
  expect(digest).toBe(record!.installedSha256!);
  expect(record!.sha256).toBe(record!.installedSha256!);
});

test('the face ships with its license', () => {
  expect(Object.keys(sources).sort()).toEqual([
    'NotoSansCJK-OFL.txt',
    'NotoSansCJKjp-Regular.otf',
  ]);
  const license = readFileSync(new URL('../licenses/NotoSansCJK-OFL.txt', import.meta.url));
  expect(createHash('sha256').update(license).digest('hex')).toBe(
    sources['NotoSansCJK-OFL.txt']!.sha256!
  );
  expect(license.toString('utf8')).toContain('SIL OPEN FONT LICENSE');
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.files).toEqual(expect.arrayContaining(['assets', 'licenses', 'LICENSE']));
  expect(manifest.license).toBe('Apache-2.0 AND OFL-1.1');
  expect(manifest.dependencies).toBeUndefined();
});
