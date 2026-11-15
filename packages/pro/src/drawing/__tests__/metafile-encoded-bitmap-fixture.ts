/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { emf } from './metafile-fixture.ts';

/** Little-endian bytes as the 32-bit signed values the EMF fixture writes. */
function int32s(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 4 }, (_, index) => view.getInt32(index * 4, true));
}

/** An EMF whose EMF+ records draw one compressed bitmap holding `image`, `w` × `h` pixels. */
export function emfWithBitmap(
  image: Uint8Array,
  w: number,
  h: number,
  target: readonly [number, number, number, number] = [10, 10, 50, 50]
): Uint8Array {
  const records: { type: number; flags: number; data: Uint8Array }[] = [];
  const data = (length: number, write: (view: DataView) => void) => {
    const bytes = new Uint8Array(length);
    write(new DataView(bytes.buffer));
    return bytes;
  };
  // EmfPlusHeader.
  records.push({
    type: 0x4001,
    flags: 0,
    data: data(16, (v) => {
      v.setUint32(0, 0xdbc01002, true);
      v.setUint32(8, 96, true);
      v.setUint32(12, 96, true);
    }),
  });
  // EmfPlusObject: an image in slot 0, a bitmap of compressed image data.
  records.push({
    type: 0x4008,
    flags: 5 << 8,
    data: data(28 + image.length, (v) => {
      // Version, image type 1 (bitmap), then the bitmap: width, height, stride, pixel
      // format, and data type 1 (compressed, an encoded image).
      v.setUint32(0, 0xdbc01002, true);
      v.setUint32(4, 1, true);
      v.setUint32(8, w, true);
      v.setUint32(12, h, true);
      v.setUint32(24, 1, true);
      new Uint8Array(v.buffer).set(image, 28);
    }),
  });
  // EmfPlusDrawImage: image 0, source and destination rectangles as floats, in pixels.
  records.push({
    type: 0x401a,
    flags: 0,
    data: data(40, (v) => {
      v.setUint32(4, 2, true);
      [0, 0, w, h, ...target].forEach((value, index) => v.setFloat32(8 + index * 4, value, true));
    }),
  });
  records.push({ type: 0x4002, flags: 0, data: new Uint8Array(0) });
  const plus = new Uint8Array(records.reduce((sum, record) => sum + 12 + record.data.length, 0));
  const view = new DataView(plus.buffer);
  let at = 0;
  for (const record of records) {
    view.setUint16(at, record.type, true);
    view.setUint16(at + 2, record.flags, true);
    view.setUint32(at + 4, 12 + record.data.length, true);
    view.setUint32(at + 8, record.data.length, true);
    plus.set(record.data, at + 12);
    at += 12 + record.data.length;
  }
  // EMR_COMMENT holding the EMF+ records.
  return emf(
    [0, 0, 100, 100],
    [{ type: 70, ints: [4 + plus.length, 0x2b464d45, ...int32s(plus)] }]
  );
}
