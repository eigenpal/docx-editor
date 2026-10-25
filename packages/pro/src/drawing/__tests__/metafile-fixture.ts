/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Synthetic WMF files for metafile replay tests.

/** One WMF record: function number and 16-bit parameter words. */
export interface WmfRecord {
  readonly fn: number;
  readonly words: readonly number[];
}

/** A placeable WMF spanning `width` × `height` logical units at 96 units per inch. */
export function wmf(width: number, height: number, records: readonly WmfRecord[]): Uint8Array {
  const body: number[] = [];
  const all = [...records, { fn: 0, words: [] }];
  let largest = 3;
  for (const record of all) {
    const size = 3 + record.words.length;
    largest = Math.max(largest, size);
    body.push(size & 0xffff, size >>> 16, record.fn, ...record.words);
  }
  const header = [1, 9, 0x0300, 0, 0, 0, 0, 0, 0];
  const total = header.length + body.length;
  header[3] = total & 0xffff;
  header[4] = total >>> 16;
  header[5] = 1;
  header[6] = largest & 0xffff;
  header[7] = largest >>> 16;
  const bytes = new Uint8Array(22 + total * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x9ac6cdd7, true);
  view.setInt16(6, 0, true);
  view.setInt16(8, 0, true);
  view.setInt16(10, width, true);
  view.setInt16(12, height, true);
  view.setUint16(14, 96, true);
  let checksum = 0;
  for (let at = 0; at < 20; at += 2) checksum ^= view.getUint16(at, true);
  view.setUint16(20, checksum, true);
  [...header, ...body].forEach((word, index) =>
    view.setUint16(22 + index * 2, word & 0xffff, true)
  );
  return bytes;
}

/** A 24-bit bottom-up DIB from rows of RGB triples, top row first, as 16-bit words. */
export function dibWords(rows: readonly (readonly [number, number, number])[][]): number[] {
  const height = rows.length;
  const width = rows[0]!.length;
  const stride = Math.ceil((width * 3) / 4) * 4;
  const bytes = new Uint8Array(40 + stride * height + ((stride * height) % 2));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 40, true);
  view.setInt32(4, width, true);
  view.setInt32(8, height, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, 24, true);
  rows.forEach((row, index) => {
    const at = 40 + (height - 1 - index) * stride;
    row.forEach(([r, g, b], column) => {
      bytes[at + column * 3] = b;
      bytes[at + column * 3 + 1] = g;
      bytes[at + column * 3 + 2] = r;
    });
  });
  const words: number[] = [];
  for (let at = 0; at < bytes.length; at += 2) words.push(bytes[at]! | (bytes[at + 1]! << 8));
  return words;
}

/** COLORREF as two words. */
export function colorWords(r: number, g: number, b: number): [number, number] {
  return [r | (g << 8), b];
}

/** One EMF record: type and 32-bit signed parameters. */
export interface EmfRecord {
  readonly type: number;
  readonly ints: readonly number[];
}

/** An EMF whose header bounds are `bounds` (left, top, right, bottom) in device pixels. */
export function emf(
  bounds: readonly [number, number, number, number],
  records: readonly EmfRecord[]
): Uint8Array {
  const all = [...records, { type: 14, ints: [0, 16, 20] }];
  const size = 88 + all.reduce((sum, record) => sum + 8 + record.ints.length * 4, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 88, true);
  bounds.forEach((value, index) => view.setInt32(8 + index * 4, value, true));
  // The frame in 0.01 mm at 0.3125 mm per device pixel.
  bounds.forEach((value, index) => view.setInt32(24 + index * 4, value * 31.25, true));
  view.setUint32(40, 0x464d4520, true);
  view.setUint32(44, 0x10000, true);
  view.setUint32(48, size, true);
  view.setUint32(52, all.length + 1, true);
  view.setUint16(56, 2, true);
  [1024, 768, 320, 240].forEach((value, index) => view.setInt32(72 + index * 4, value, true));
  let at = 88;
  for (const record of all) {
    view.setUint32(at, record.type, true);
    view.setUint32(at + 4, 8 + record.ints.length * 4, true);
    record.ints.forEach((value, index) => view.setInt32(at + 8 + index * 4, value, true));
    at += 8 + record.ints.length * 4;
  }
  return bytes;
}
