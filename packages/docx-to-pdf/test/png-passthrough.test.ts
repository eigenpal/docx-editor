/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A grey or RGB PNG without transparency embeds its own compressed data, undecoded.
import { expect, test } from 'bun:test';
import { deflateSync, crc32 } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { embedPlainPng } from '../src/png-passthrough.ts';

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(depth: number, colourType: number, raw: Uint8Array, extra?: Buffer): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(10, 0);
  header.writeUInt32BE(1, 4);
  header[8] = depth;
  header[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...(extra ? [extra] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

test('a 1-bit grey PNG embeds its data with PNG predictors', async () => {
  const doc = await PDFDocument.create();
  const data = deflateSync(Buffer.from([0, 0b10111111, 0b11000000]));
  const image = await embedPlainPng(doc, png(1, 0, Buffer.from([0, 0b10111111, 0b11000000])));
  expect(image).not.toBeNull();
  const stream = doc.context.lookup(image!.ref);
  if (!(stream instanceof PDFRawStream)) throw new Error('no image stream');
  expect(stream.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
  expect(stream.dict.get(PDFName.of('BitsPerComponent'))?.toString()).toBe('1');
  expect(stream.dict.get(PDFName.of('DecodeParms'))?.toString()).toContain('/Predictor 15');
  expect(Buffer.from(stream.contents)).toEqual(data);
  expect([image!.width, image!.height]).toEqual([10, 1]);
});

test('transparency and palettes take the decoding path', async () => {
  const doc = await PDFDocument.create();
  const rgba = Buffer.alloc(1 + 40);
  expect(await embedPlainPng(doc, png(8, 6, rgba))).toBeNull();
  const grey = Buffer.alloc(1 + 10);
  expect(await embedPlainPng(doc, png(8, 0, grey, chunk('tRNS', Buffer.from([0, 0]))))).toBeNull();
  expect(await embedPlainPng(doc, png(8, 3, grey))).toBeNull();
});
