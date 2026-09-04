/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FONT_ASSET_ROOT } from '@docx-editor.dev/fonts';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fontEmbeddingDecision, MAX_TTC_FACES } from '../src/pdf-font-embedding.ts';
import type { PdfAdmittedFont } from '../src/pdf-paint-writer-port.ts';
import { createPdfPaintPlan, pdfBeginPage, pdfTextSpan } from '../src/pdf-paint-types.ts';
import { pdfTextStyleFromResolvedRunStyle } from '../src/pdf-text-style.ts';
import { writePdfPaintPlanToBytes } from '../src/pdfkit-paint-writer.ts';

const carlitoFontBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('Carlito-Regular.ttf', FONT_ASSET_ROOT)))
);
const unicodeFontBytes = new Uint8Array(
  readFileSync(fileURLToPath(import.meta.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')))
);

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value / 0x1000000) & 0xff;
  bytes[offset + 1] = (value >> 16) & 0xff;
  bytes[offset + 2] = (value >> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! * 0x1000000 +
      (bytes[offset + 1]! << 16) +
      (bytes[offset + 2]! << 8) +
      bytes[offset + 3]!) >>>
    0
  );
}

/** Build a TTC from licensed TTF faces by relocating each SFNT table directory. */
function buildTrueTypeCollection(faces: readonly Uint8Array[]): Uint8Array {
  const faceCount = faces.length;
  const headerSize = 12 + faceCount * 4;
  const offsets: number[] = [];
  let cursor = headerSize;
  for (const face of faces) {
    const pad = (4 - (cursor % 4)) % 4;
    cursor += pad;
    offsets.push(cursor);
    cursor += face.byteLength;
  }
  const bytes = new Uint8Array(cursor);
  bytes.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0], 0);
  writeUint32(bytes, 8, faceCount);
  for (let index = 0; index < faceCount; index += 1) {
    writeUint32(bytes, 12 + index * 4, offsets[index]!);
  }
  for (let index = 0; index < faceCount; index += 1) {
    const base = offsets[index]!;
    const face = faces[index]!;
    bytes.set(face, base);
    const tableCount = (face[4]! << 8) | face[5]!;
    for (let table = 0; table < tableCount; table += 1) {
      const record = base + 12 + table * 16;
      writeUint32(bytes, record + 8, readUint32(bytes, record + 8) + base);
    }
  }
  return bytes;
}

function collectionFaceBase(bytes: Uint8Array, faceIndex: number): number {
  return readUint32(bytes, 12 + faceIndex * 4);
}

function os2FsTypeOffsetAt(bytes: Uint8Array, base: number): number {
  const tableCount = (bytes[base + 4]! << 8) | bytes[base + 5]!;
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) !== 'OS/2') continue;
    return readUint32(bytes, record + 8);
  }
  throw new Error('OS/2 table missing');
}

function admittedFont(bytes: Uint8Array, faceIndex: number, family = 'Test Font'): PdfAdmittedFont {
  return Object.freeze({
    id: `test:collection-${faceIndex}`,
    identity: `sha256:collection#${faceIndex}`,
    family,
    request: Object.freeze({ family, weight: 400 as const, style: 'normal' as const }),
    byteLength: bytes.byteLength,
    hash: 'sha256:collection',
    faceIndex,
    bytes,
  });
}

function resolvedStyle(fontFamily: string | null) {
  return pdfTextStyleFromResolvedRunStyle({
    fontFamily,
    fontFamilyEastAsia: null,
    fontSizePt: 12,
    color: '000000',
    bold: false,
    italic: false,
    underline: null,
    strike: false,
    doubleStrike: false,
    highlight: null,
    shading: null,
    verticalAlign: 'baseline',
    baselineShiftPt: 0,
    caps: false,
    smallCaps: false,
    characterSpacingPt: 0,
    horizontalScalePercent: 100,
    kerningMinPt: 0,
    hidden: false,
  });
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const document = await getDocument({ data: bytes.slice() }).promise;
  try {
    const text: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      text.push(...content.items.map((item) => ('str' in item ? item.str : '')));
    }
    return text.join('');
  } finally {
    document.cleanup();
  }
}

const collectionBytes = buildTrueTypeCollection([carlitoFontBytes, unicodeFontBytes]);

describe('font collection embedding', () => {
  test('keeps standalone TTF embedding unchanged', () => {
    const font = admittedFont(carlitoFontBytes, 0);
    expect(fontEmbeddingDecision(font)).toEqual({ kind: 'embed', collectionSelector: null });
  });

  test('refuses a nonzero faceIndex on a standalone sfnt', () => {
    expect(fontEmbeddingDecision(admittedFont(carlitoFontBytes, 1))).toEqual({
      kind: 'refuse',
      reason: 'A nonzero faceIndex requires a TrueType collection resource',
    });
  });

  test('refuses a truncated collection header', () => {
    const bytes = new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0]);
    expect(fontEmbeddingDecision(admittedFont(bytes, 0))).toEqual({
      kind: 'refuse',
      reason: 'The admitted font collection header is truncated',
    });
  });

  test('refuses an unsupported collection version', () => {
    const bytes = new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 3, 0, 0, 0, 0, 0, 1]);
    expect(fontEmbeddingDecision(admittedFont(bytes, 0))).toEqual({
      kind: 'refuse',
      reason: 'The admitted font collection has an unsupported TTC version',
    });
  });

  test('refuses a collection with no faces', () => {
    const bytes = new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(fontEmbeddingDecision(admittedFont(bytes, 0))).toEqual({
      kind: 'refuse',
      reason: 'The admitted font collection has no faces',
    });
  });

  test('refuses a collection above the face-count cap without scanning offsets', () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0]);
    writeUint32(bytes, 8, MAX_TTC_FACES + 1);
    expect(fontEmbeddingDecision(admittedFont(bytes, 0))).toEqual({
      kind: 'refuse',
      reason: `The admitted font collection exceeds the ${MAX_TTC_FACES} face limit`,
    });
  });

  test('refuses a truncated collection face directory', () => {
    const bytes = new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 2]);
    expect(fontEmbeddingDecision(admittedFont(bytes, 0))).toEqual({
      kind: 'refuse',
      reason: 'The admitted font collection face directory is truncated',
    });
  });

  test('refuses an out-of-range collection faceIndex', () => {
    expect(fontEmbeddingDecision(admittedFont(collectionBytes, 2))).toEqual({
      kind: 'refuse',
      reason: 'The admitted font collection faceIndex 2 is out of range for 2 faces',
    });
  });

  test('refuses a collection face offset that points into the header', () => {
    const bytes = collectionBytes.slice();
    writeUint32(bytes, 12, 8);
    expect(fontEmbeddingDecision(admittedFont(bytes, 0))).toEqual({
      kind: 'refuse',
      reason: 'The admitted font collection face offset is invalid',
    });
  });

  test('refuses an unrelocated TTF payload copied after a TTC header', () => {
    const bytes = new Uint8Array(carlitoFontBytes.byteLength + 16);
    bytes.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 16]);
    bytes.set(carlitoFontBytes, 16);
    const decision = fontEmbeddingDecision(admittedFont(bytes, 0));
    expect(decision.kind).toBe('refuse');
  });

  test('selects faceIndex 0 and faceIndex 1 with distinct PostScript names', () => {
    const face0 = fontEmbeddingDecision(admittedFont(collectionBytes, 0));
    const face1 = fontEmbeddingDecision(admittedFont(collectionBytes, 1));
    expect(face0).toMatchObject({ kind: 'embed' });
    expect(face1).toMatchObject({ kind: 'embed' });
    if (face0.kind !== 'embed' || face1.kind !== 'embed') return;
    expect(face0.collectionSelector).toEqual(expect.any(String));
    expect(face1.collectionSelector).toEqual(expect.any(String));
    expect(face0.collectionSelector).not.toBe(face1.collectionSelector);
  });

  test('applies OS/2 fsType to the selected face directory, not byte zero', () => {
    const restrictedFace0 = collectionBytes.slice();
    const face0Os2 = os2FsTypeOffsetAt(restrictedFace0, collectionFaceBase(restrictedFace0, 0));
    restrictedFace0[face0Os2 + 8] = 0;
    restrictedFace0[face0Os2 + 9] = 0x02;

    const restrictedFace1 = collectionBytes.slice();
    const face1Os2 = os2FsTypeOffsetAt(restrictedFace1, collectionFaceBase(restrictedFace1, 1));
    restrictedFace1[face1Os2 + 8] = 0;
    restrictedFace1[face1Os2 + 9] = 0x02;

    expect(fontEmbeddingDecision(admittedFont(restrictedFace0, 1))).toMatchObject({
      kind: 'embed',
    });
    expect(fontEmbeddingDecision(admittedFont(restrictedFace0, 0))).toEqual({
      kind: 'refuse',
      reason: 'The OS/2 fsType forbids font embedding',
    });
    expect(fontEmbeddingDecision(admittedFont(restrictedFace1, 0))).toMatchObject({
      kind: 'embed',
    });
    expect(fontEmbeddingDecision(admittedFont(restrictedFace1, 1))).toEqual({
      kind: 'refuse',
      reason: 'The OS/2 fsType forbids font embedding',
    });
  });

  test('embeds the selected collection face for Slovak text and extracts it through PDF.js', async () => {
    const text = 'ľščťžýáíé';
    const font = admittedFont(collectionBytes, 1);
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 200, height: 12 },
          688,
          text,
          resolvedStyle('Test Font')
        ),
      ]),
      { admittedFonts: [font] }
    );

    expect(Buffer.from(result.bytes).toString('latin1')).toContain('/FontFile2');
    expect(await extractPdfText(result.bytes)).toContain(text);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ feature: 'shaped-glyph-run', recordId: font.identity })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ feature: 'font-embedding-permission' })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ feature: 'standard-font-encoding' })
    );
  });

  test('uses cmap coverage from the selected collection face, not face zero', async () => {
    const uncovered = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 40, height: 12 },
          688,
          '😀',
          resolvedStyle('Test Font')
        ),
      ]),
      { admittedFonts: [admittedFont(collectionBytes, 0)] }
    );
    const covered = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 40, height: 12 },
          688,
          '😀',
          resolvedStyle('Test Font')
        ),
      ]),
      { admittedFonts: [admittedFont(collectionBytes, 1)] }
    );

    expect(await extractPdfText(uncovered.bytes)).toBe('');
    expect(uncovered.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'font-cmap-coverage',
        recordId: 'sha256:collection#0',
        reason: expect.stringContaining('U+1F600'),
      })
    );
    expect(await extractPdfText(covered.bytes)).toContain('😀');
    expect(covered.diagnostics).not.toContainEqual(
      expect.objectContaining({ feature: 'font-cmap-coverage' })
    );
  });

  test('falls back when a restricted selected collection face cannot encode WinAnsi-unsafe text', async () => {
    const restricted = collectionBytes.slice();
    const os2 = os2FsTypeOffsetAt(restricted, collectionFaceBase(restricted, 1));
    restricted[os2 + 8] = 0;
    restricted[os2 + 9] = 0x02;
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 200, height: 12 },
          688,
          'ľščťž',
          resolvedStyle('Test Font')
        ),
      ]),
      { admittedFonts: [admittedFont(restricted, 1)] }
    );

    expect(Buffer.from(result.bytes).toString('latin1')).not.toContain('/FontFile2');
    expect(await extractPdfText(result.bytes)).toBe('');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'font-embedding-permission',
        reason: 'The OS/2 fsType forbids font embedding',
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ feature: 'standard-font-encoding' })
    );
  });
});
