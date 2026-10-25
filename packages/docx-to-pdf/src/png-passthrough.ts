/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A PNG without transparency as a PDF image, without decoding it. PNG image data is a zlib
// stream of filtered scanlines, which a PDF Flate filter with PNG predictors reads as it is.
// The general PNG path decodes every pixel to RGB and compresses it again, which for a 1-bit
// scanned page is many times the data.
import { PDFDocument, PDFImage, PngEmbedder, type PDFContext, type PDFRef } from 'pdf-lib';

/** The PNG facts the pass-through needs, or null when the PNG needs the general path. */
interface PlainPng {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colours: 1 | 3;
  readonly data: Uint8Array;
}

function readPlainPng(bytes: Uint8Array): PlainPng | null {
  if (bytes.length < 33) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = bytes[24]!;
  const colourType = bytes[25]!;
  // Grey (any depth up to 8) or 8-bit RGB, deflate, adaptive filtering, not interlaced.
  const colours = colourType === 0 ? 1 : colourType === 2 && depth === 8 ? 3 : null;
  if (colours === null || depth > 8 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) {
    return null;
  }
  if (!(width > 0 && height > 0)) return null;
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(
      bytes[at + 4]!,
      bytes[at + 5]!,
      bytes[at + 6]!,
      bytes[at + 7]!
    );
    if (at + 12 + length > bytes.length) return null;
    // Transparency, a gamma or a colour profile changes how the pixels look; leave those to
    // the general path, which knows them.
    if (type === 'tRNS' || type === 'gAMA' || type === 'iCCP' || type === 'sRGB') return null;
    if (type === 'IDAT') {
      parts.push(bytes.subarray(at + 8, at + 8 + length));
      total += length;
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  if (total === 0) return null;
  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return { width, height, depth, colours, data };
}

/**
 * The PNG embedded in `doc` as a PDF image whose data is the PNG's own compressed stream, or
 * null when the PNG has transparency, colour management, interlacing or a palette.
 */
export async function embedPlainPng(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  const png = readPlainPng(bytes);
  if (!png) return null;
  // The image API accepts only its own embedder class; this one keeps that prototype and
  // writes the stream itself.
  const embedder = Object.assign(Object.create(PngEmbedder.prototype) as object, {
    width: png.width,
    height: png.height,
    bitsPerComponent: png.depth,
    colorSpace: png.colours === 1 ? 'DeviceGray' : 'DeviceRGB',
    async embedIntoContext(context: PDFContext, ref?: PDFRef): Promise<PDFRef> {
      const stream = context.stream(png.data, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: png.width,
        Height: png.height,
        BitsPerComponent: png.depth,
        ColorSpace: png.colours === 1 ? 'DeviceGray' : 'DeviceRGB',
        Filter: 'FlateDecode',
        DecodeParms: {
          Predictor: 15,
          Colors: png.colours,
          BitsPerComponent: png.depth,
          Columns: png.width,
        },
      });
      if (ref) {
        context.assign(ref, stream);
        return ref;
      }
      return context.register(stream);
    },
  });
  const image = PDFImage.of(
    doc.context.nextRef(),
    doc,
    embedder as unknown as Parameters<typeof PDFImage.of>[2]
  );
  await image.embed();
  return image;
}
