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
