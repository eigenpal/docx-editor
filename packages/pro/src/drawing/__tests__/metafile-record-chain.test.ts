/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A metafile whose records stop before the end replays as incomplete, with the reason, so an
// exporter reports the partial picture instead of placing it as if it drew in full.

import { expect, test } from 'bun:test';
import { metafileRecordChain } from '../metafile-record-chain.ts';
import { replayMetafile } from '../metafile-replay.ts';
import { colorWords, emf, wmf } from './metafile-fixture.ts';

const measureText = () => 0;
const LIMIT = 200_000;
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
  expect(metafileRecordChain(emf([0, 0, 40, 20], [RECTANGLE]), 'image/x-emf', LIMIT)).toBe(
    'intact'
  );
  expect(metafileRecordChain(wmf(40, 20, WMF_RECTANGLE), 'image/x-wmf', LIMIT)).toBe('intact');
});

test('a record past the end, or one too small to step over, breaks the chain', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE]);
  expect(metafileRecordChain(patched(picture, 92, 0x7fffffff), 'image/x-emf', LIMIT)).toBe(
    'malformed-record'
  );
  expect(metafileRecordChain(patched(picture, 92, 4), 'image/x-emf', LIMIT)).toBe(
    'malformed-record'
  );
  // The rectangle record cut short.
  expect(metafileRecordChain(picture.subarray(0, picture.length - 24), 'image/x-emf', LIMIT)).toBe(
    'malformed-record'
  );
  const vector = wmf(40, 20, WMF_RECTANGLE);
  // The first record after the 22-byte placeable header and the 18-byte header.
  expect(metafileRecordChain(patched(vector, 40, 0x7fffffff), 'image/x-wmf', LIMIT)).toBe(
    'malformed-record'
  );
});

test('a stream that ends after its last record without an end record is intact', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE]);
  // Drop the 20-byte end record.
  expect(metafileRecordChain(picture.subarray(0, picture.length - 20), 'image/x-emf', LIMIT)).toBe(
    'intact'
  );
});

test('a replay that stops at a malformed record is incomplete', async () => {
  const whole = emf([0, 0, 40, 20], [RECTANGLE]);
  const intact = await replayMetafile(whole, 'image/x-emf', { textAdvance: measureText });
  expect(intact).toMatchObject({ complete: true });
  expect(intact?.stop).toBeUndefined();
  const broken = patched(whole, 92, 0x7fffffff);
  const replay = await replayMetafile(broken, 'image/x-emf', { textAdvance: measureText });
  expect(replay).toMatchObject({ complete: false, stop: 'malformed-record' });
});

test('a replay that stops at the record limit names the resource bound', async () => {
  const records = Array.from({ length: LIMIT }, () => ({ fn: 0x012d, words: [0] }));
  const replay = await replayMetafile(wmf(40, 20, [...WMF_RECTANGLE, ...records]), 'image/x-wmf', {
    textAdvance: measureText,
  });
  expect(replay).toMatchObject({ complete: false, stop: 'resource-bound' });
});

test('padding too short for a record after the last record is intact', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE]);
  // No end record, then 3 bytes of padding.
  const padded = new Uint8Array(picture.length - 20 + 3);
  padded.set(picture.subarray(0, picture.length - 20));
  expect(metafileRecordChain(padded, 'image/x-emf', LIMIT)).toBe('intact');
});

test('a chain longer than the record limit is not read in full', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE, RECTANGLE, RECTANGLE]);
  // The header, three rectangles and the end record.
  expect(metafileRecordChain(picture, 'image/x-emf', 4)).toBe('record-limit');
  expect(metafileRecordChain(picture, 'image/x-emf', 5)).toBe('intact');
});

test('an end record is the end, whatever size it declares or however short it is cut', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE]);
  const eof = picture.length - 20;
  expect(metafileRecordChain(patched(picture, eof + 4, 0x7fffffff), 'image/x-emf', LIMIT)).toBe(
    'intact'
  );
  expect(metafileRecordChain(picture.subarray(0, picture.length - 4), 'image/x-emf', LIMIT)).toBe(
    'intact'
  );
  const vector = wmf(40, 20, WMF_RECTANGLE);
  // The WMF end record is 3 words: size 3, function 0.
  expect(metafileRecordChain(vector.subarray(0, vector.length - 2), 'image/x-wmf', LIMIT)).toBe(
    'intact'
  );
});

test('a zero-filled tail after the last record is padding', () => {
  const picture = emf([0, 0, 40, 20], [RECTANGLE]);
  const padded = new Uint8Array(picture.length - 20 + 16);
  padded.set(picture.subarray(0, picture.length - 20));
  expect(metafileRecordChain(padded, 'image/x-emf', LIMIT)).toBe('intact');
  padded[padded.length - 1] = 1;
  expect(metafileRecordChain(padded, 'image/x-emf', LIMIT)).toBe('malformed-record');
});
