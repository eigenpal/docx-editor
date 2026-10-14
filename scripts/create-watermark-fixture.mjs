/**
 * Generator for the watermark example documents in `e2e/fixtures/`.
 *
 * Each document is a repository fixture with a watermark written by the engine's own
 * `setWatermark` package operation, so the markup is exactly what the editor writes. Open one
 * in the demo with `?fixture=<name>.docx`. Run with:
 *
 *   bun scripts/create-watermark-fixture.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
} from '../packages/core/src/store/package/ooxml-package.ts';
import { applyHeaderFooterLifecycleOp } from '../packages/core/src/store/package/hf-lifecycle.ts';

const fixtures = path.resolve('e2e/fixtures');

/** A text watermark at the dialog defaults; `box` is the shape size in points. */
const text = (value, box, options = {}) => ({
  kind: 'text',
  text: value,
  fontFamily: 'Calibri',
  fontSizePt: null,
  bold: false,
  italic: false,
  colorHex: 'C0C0C0',
  opacity: 0.5,
  diagonal: true,
  widthPt: box[0],
  heightPt: box[1],
  ...options,
});

/** A 360px round emblem in two blues, so washout visibly lightens it. */
function emblemPng() {
  const size = 360;
  const rows = [];
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x - centre + 0.5, y - centre + 0.5);
      const ring = r < 170 && r > 150;
      const star =
        r < 120 && Math.abs(Math.sin(Math.atan2(y - centre, x - centre) * 2.5)) * 120 > r;
      const inside = r <= 170;
      const [red, green, blue] =
        ring || star ? [31, 78, 121] : inside ? [189, 215, 238] : [255, 255, 255];
      row.push(red, green, blue);
    }
    rows.push(...row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from(rows))),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

const examples = [
  {
    name: 'watermark-text-diagonal.docx',
    base: 'e2e/fixtures/section-inheritance-header-footer.docx',
    watermark: text('DRAFT', [412, 206]),
  },
  {
    name: 'watermark-text-horizontal.docx',
    base: 'e2e/fixtures/editable-sample.docx',
    watermark: text('CONFIDENTIAL', [468, 76], {
      colorHex: 'C00000',
      opacity: 0.35,
      diagonal: false,
      bold: true,
    }),
  },
  {
    name: 'watermark-text-fixed-size.docx',
    base: 'e2e/fixtures/editable-sample.docx',
    watermark: text('DO NOT COPY', [459, 88], { fontSizePt: 72, italic: true }),
  },
  {
    name: 'watermark-picture.docx',
    base: 'e2e/fixtures/editable-sample.docx',
    watermark: {
      kind: 'picture',
      washout: true,
      widthPt: 360,
      heightPt: 360,
      image: { bytes: emblemPng(), mime: 'image/png' },
    },
  },
];

for (const example of examples) {
  const loaded = readOoxmlPackage(new Uint8Array(readFileSync(path.resolve(example.base))));
  if (!loaded.ok) throw new Error(`${example.base}: ${loaded.reason}`);
  const result = applyHeaderFooterLifecycleOp(loaded.package, {
    op: 'setWatermark',
    watermark: example.watermark,
  });
  if (!result.ok) throw new Error(`${example.name}: ${result.reason} ${result.detail ?? ''}`);
  const bytes = writeOoxmlPackage(result.package);
  writeFileSync(path.join(fixtures, example.name), bytes);
  console.log(`Wrote e2e/fixtures/${example.name} (${bytes.byteLength} bytes)`);
}
