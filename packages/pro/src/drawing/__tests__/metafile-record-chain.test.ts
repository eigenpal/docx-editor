/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A metafile whose records stop before the end replays as incomplete, so an exporter reports
// the partial picture instead of placing it as if it drew in full.

import { expect, test } from 'bun:test';
import { metafileRecordsIntact } from '../metafile-record-chain.ts';
import { replayMetafile } from '../metafile-replay.ts';
import { colorWords, emf, wmf } from './metafile-fixture.ts';

const measureText = () => 0;
const RECTANGLE = { type: 43, ints: [0, 0, 40, 20] };
const WMF_RECTANGLE = [
  { fn: 0x02fc, words: [0, ...colorWords(255, 0, 0), 0] },
  { fn: 0x012d, words: [0] },
  { fn: 0x041b, words: [20, 40, 0, 0] },
];

/** The bytes with the 32-bit value at `at` replaced. */
function patched(bytes: Uint8Array, at: number, value: number): Uint8Array {
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint32(at, value, true);
  return copy;
}

test('whole EMF and WMF record chains are intact', () => {
  expect(metafileRecordsIntact(emf([0, 0, 40, 20], [RECTANGLE]), 'image/x-emf')).toBe(true);
  expect(metafileRecordsIntact(wmf(40, 20, WMF_RECTANGLE), 'image/x-wmf')).toBe(true);
});

test('a record past the end, or one too small to step over, breaks the chain', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE]);
  expect(metafileRecordsIntact(patched(picture, 92, 0x7fffffff), 'image/x-emf')).toBe(false);
  expect(metafileRecordsIntact(patched(picture, 92, 4), 'image/x-emf')).toBe(false);
  expect(metafileRecordsIntact(picture.subarray(0, picture.length - 4), 'image/x-emf')).toBe(false);
  const vector = wmf(40, 20, WMF_RECTANGLE);
  // The first record after the 22-byte placeable header and the 18-byte header.
  expect(metafileRecordsIntact(patched(vector, 40, 0x7fffffff), 'image/x-wmf')).toBe(false);
});

test('a stream that ends after its last record without an end record is intact', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE]);
  // Drop the 20-byte end record.
  expect(metafileRecordsIntact(picture.subarray(0, picture.length - 20), 'image/x-emf')).toBe(true);
});

test('a replay that stops at a malformed record is incomplete', async () => {
  const whole = emf([0, 0, 40, 20], [RECTANGLE]);
  expect(await replayMetafile(whole, 'image/x-emf', { textAdvance: measureText })).toMatchObject({
    complete: true,
  });
  const broken = patched(whole, 92, 0x7fffffff);
  const replay = await replayMetafile(broken, 'image/x-emf', { textAdvance: measureText });
  expect(replay?.complete ?? false).toBe(false);
});
