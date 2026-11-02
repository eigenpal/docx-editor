/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFontFileCache, derivedOnce } from '../src/font-file-cache.ts';

const dir = mkdtempSync(join(tmpdir(), 'font-file-cache-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fontFile(name: string, size: number, fill: number): string {
  const path = join(dir, name);
  writeFileSync(path, new Uint8Array(size).fill(fill));
  return path;
}

test('a file read twice returns the same bytes and keeps what was derived from them', async () => {
  const cache = createFontFileCache(1024);
  const path = fontFile('a.ttf', 100, 1);
  const first = await cache.read(path);
  let calls = 0;
  expect(derivedOnce(first, 'hash', () => ++calls)).toBe(1);
  const second = await cache.read(path);
  expect(second).toBe(first);
  expect(derivedOnce(second, 'hash', () => ++calls)).toBe(1);
  expect(cache.size).toBe(100);
});

test('a file that changes on disk is read again', async () => {
  const cache = createFontFileCache(1024);
  const path = fontFile('b.ttf', 100, 1);
  const first = await cache.read(path);
  writeFileSync(path, new Uint8Array(120).fill(2));
  utimesSync(path, new Date(), new Date(Date.now() + 5000));
  const second = await cache.read(path);
  expect(second).not.toBe(first);
  expect(second.bytes[0]).toBe(2);
  expect(cache.size).toBe(120);
});

test('the least recently used files leave when the budget is full', async () => {
  const cache = createFontFileCache(250);
  const a = fontFile('c.ttf', 100, 1);
  const b = fontFile('d.ttf', 100, 2);
  const c = fontFile('e.ttf', 100, 3);
  const keptA = await cache.read(a);
  await cache.read(b);
  await cache.read(a);
  await cache.read(c);
  expect(cache.size).toBe(200);
  // `a` was used after `b`, so `b` left.
  expect(await cache.read(a)).toBe(keptA);
  const big = fontFile('f.ttf', 300, 4);
  const read = await cache.read(big);
  // A file larger than the budget is read but not kept.
  expect(read.bytes.byteLength).toBe(300);
  expect(cache.size).toBe(200);
});
