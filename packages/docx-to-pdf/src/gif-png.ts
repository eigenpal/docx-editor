/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A GIF picture as PNG bytes, which the PDF writer embeds: the first frame, as a document
// shows it, with its transparent colour kept as alpha.
//
// The bytes come from the document, so every size is bounded before anything is allocated,
// the LZW code stream is read with fixed table limits, and a malformed file yields null.

import { deflateSync } from 'node:zlib';

/** The largest frame converted, in pixels; a larger picture stays unembedded. */
const MAX_PIXELS = 25_000_000;
const MAX_CODE_SIZE = 12;

class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  byte(): number {
    if (this.at >= this.bytes.length) throw new RangeError('truncated GIF');
    return this.bytes[this.at++]!;
  }
  word(): number {
    return this.byte() | (this.byte() << 8);
  }
  skip(count: number): void {
    if (this.at + count > this.bytes.length) throw new RangeError('truncated GIF');
    this.at += count;
  }
  /** The bytes of a chain of data sub-blocks, joined. */
  blocks(): Uint8Array {
    const parts: Uint8Array[] = [];
    let length = 0;
    for (let size = this.byte(); size > 0; size = this.byte()) {
      if (this.at + size > this.bytes.length) throw new RangeError('truncated GIF');
      parts.push(this.bytes.subarray(this.at, this.at + size));
      this.at += size;
      length += size;
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/** Decode `pixelCount` colour indices from a GIF LZW stream. */
function lzw(data: Uint8Array, minimumCodeSize: number, pixelCount: number): Uint8Array {
  if (minimumCodeSize < 2 || minimumCodeSize > 8) throw new RangeError('bad LZW code size');
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  const out = new Uint8Array(pixelCount);
  for (let code = 0; code < clear; code++) {
    prefix[code] = -1;
    suffix[code] = code;
    first[code] = code;
  }
  let codeSize = minimumCodeSize + 1;
  let next = end + 1;
  let previous = -1;
  let bits = 0;
  let buffer = 0;
  let written = 0;
  for (let index = 0; index < data.length && written < pixelCount; ) {
    while (bits < codeSize && index < data.length) {
      buffer |= data[index++]! << bits;
      bits += 8;
    }
    if (bits < codeSize) break;
    const code = buffer & ((1 << codeSize) - 1);
    buffer >>>= codeSize;
    bits -= codeSize;
    if (code === clear) {
      codeSize = minimumCodeSize + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    let entry = code;
    let depth = 0;
    if (code >= next) {
      // The code being defined: the previous string plus its own first value.
      if (previous < 0 || code > next) throw new RangeError('bad LZW code');
      stack[depth++] = first[previous]!;
      entry = previous;
    }
    while (entry >= 0) {
      if (depth >= stack.length) throw new RangeError('bad LZW chain');
      stack[depth++] = suffix[entry]!;
      entry = prefix[entry]!;
    }
    const head = stack[depth - 1]!;
    while (depth > 0 && written < pixelCount) out[written++] = stack[--depth]!;
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = head;
      first[next] = first[previous]!;
      next++;
      if (next === 1 << codeSize && codeSize < MAX_CODE_SIZE) codeSize++;
    }
    previous = code;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) crc = CRC_TABLE[(crc ^ out[i]!) & 0xff]! ^ (crc >>> 8);
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}

function png(width: number, height: number, rgba: Uint8Array, alpha: boolean): Uint8Array {
  const channels = alpha ? 4 : 3;
  const raw = new Uint8Array(height * (1 + width * channels));
  for (let y = 0, at = 0; y < height; y++) {
    raw[at++] = 0;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      raw[at++] = rgba[source]!;
      raw[at++] = rgba[source + 1]!;
      raw[at++] = rgba[source + 2]!;
      if (alpha) raw[at++] = rgba[source + 3]!;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function colorTable(reader: Reader, flags: number): Uint8Array | null {
  if (!(flags & 0x80)) return null;
  const size = 3 * (1 << ((flags & 7) + 1));
  const table = reader.bytes.slice(reader.at, reader.at + size);
  reader.skip(size);
  return table;
}

const converted = new WeakMap<Uint8Array, Uint8Array | null>();

/**
 * The first frame of `bytes` as PNG bytes, or null when it is not a readable GIF. One
 * conversion per byte array.
 */
export function gifToPng(bytes: Uint8Array): Uint8Array | null {
  if (!converted.has(bytes)) converted.set(bytes, convert(bytes));
  return converted.get(bytes)!;
}

function convert(bytes: Uint8Array): Uint8Array | null {
  try {
    const reader = new Reader(bytes);
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
    reader.skip(6);
    const width = reader.word(),
      height = reader.word();
    if (width === 0 || height === 0 || width * height > MAX_PIXELS) return null;
    const flags = reader.byte();
    reader.skip(2);
    const global = colorTable(reader, flags);
    let transparent = -1;
    for (;;) {
      const introducer = reader.byte();
      if (introducer === 0x3b) return null;
      if (introducer === 0x21) {
        const label = reader.byte();
        const data = reader.blocks();
        // A graphic control extension names the transparent colour index.
        if (label === 0xf9 && data.length >= 4 && data[0]! & 1) transparent = data[3]!;
        continue;
      }
      if (introducer !== 0x2c) return null;
      const left = reader.word(),
        top = reader.word(),
        frameWidth = reader.word(),
        frameHeight = reader.word();
      const frameFlags = reader.byte();
      const table = colorTable(reader, frameFlags) ?? global;
      if (!table || left + frameWidth > width || top + frameHeight > height) return null;
      return decodeFrame(
        reader,
        { left, top, width: frameWidth, height: frameHeight, interlaced: !!(frameFlags & 0x40) },
        { width, height, table, transparent }
      );
    }
  } catch {
    return null;
  }
}

function decodeFrame(
  reader: Reader,
  frame: { left: number; top: number; width: number; height: number; interlaced: boolean },
  image: { width: number; height: number; table: Uint8Array; transparent: number }
): Uint8Array {
  const minimumCodeSize = reader.byte();
  const indices = lzw(reader.blocks(), minimumCodeSize, frame.width * frame.height);
  // Pixels outside the first frame are the empty canvas: transparent.
  const rgba = new Uint8Array(image.width * image.height * 4);
  const rows: number[] = [];
  if (frame.interlaced) {
    for (const [start, step] of [
      [0, 8],
      [4, 8],
      [2, 4],
      [1, 2],
    ] as const)
      for (let y = start; y < frame.height; y += step) rows.push(y);
  } else {
    for (let y = 0; y < frame.height; y++) rows.push(y);
  }
  let alpha = frame.width !== image.width || frame.height !== image.height;
  rows.forEach((y, row) => {
    for (let x = 0; x < frame.width; x++) {
      const index = indices[row * frame.width + x]!;
      const at = ((frame.top + y) * image.width + frame.left + x) * 4;
      if (index === image.transparent || index * 3 + 2 >= image.table.length) {
        alpha = true;
        continue;
      }
      rgba[at] = image.table[index * 3]!;
      rgba[at + 1] = image.table[index * 3 + 1]!;
      rgba[at + 2] = image.table[index * 3 + 2]!;
      rgba[at + 3] = 255;
    }
  });
  return png(image.width, image.height, rgba, alpha);
}
