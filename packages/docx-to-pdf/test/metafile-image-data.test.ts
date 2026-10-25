/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An image in a metafile picture whose data does not decode is left out of the picture, and a
// replay that fails outright declines the picture. Neither fails the export.
import { afterEach, expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import type { FontBackedExportCapabilities, MetafileReplay } from '@docx-editor.dev/core/export';
import { installDrawingRenderers } from '@docx-editor.dev/core/store';
import { Work } from '../src/context.ts';
import { MetafileForms } from '../src/metafile-pdf.ts';

/** A PNG with a valid signature and header, and a zlib stream that does not inflate. */
function corruptPng(): Uint8Array {
  const chunk = (type: string, data: readonly number[]) => [
    0,
    0,
    0,
    data.length,
    ...[...type].map((char) => char.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk('IHDR', [0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]),
    ...chunk('IDAT', [0x78, 0x9c, 0xff, 0xff, 0xff, 0xff, 0x00, 0x01]),
    ...chunk('IEND', []),
  ]);
}

const METAFILE = { mime: 'image/x-emf', bytes: new Uint8Array([1]) } as const;

function install(replay: () => Promise<MetafileReplay | null>): void {
  installDrawingRenderers({ metafile: { replay } });
}

async function drawForm(): Promise<{ drawn: boolean; codes: string[] }> {
  const doc = await PDFDocument.create();
  const work = new Work(new AbortController().signal);
  const forms = new MetafileForms(doc, {} as FontBackedExportCapabilities, work);
  const form = await forms.form('/word/media/image1.emf', METAFILE, 0);
  await doc.save();
  return { drawn: form !== null, codes: work.diagnostics.map((diagnostic) => diagnostic.code) };
}

afterEach(() => installDrawingRenderers({ metafile: undefined }));

test('an encoded image whose data does not decode is left out and reported', async () => {
  install(async () => ({
    complete: true,
    drawing: {
      width: 10,
      height: 10,
      commands: [
        {
          kind: 'image',
          matrix: [10, 0, 0, 10, 0, 0],
          raster: { kind: 'encoded', mime: 'image/png', width: 2, height: 2, bytes: corruptPng() },
        },
        {
          kind: 'fill',
          evenOdd: false,
          paint: { r: 0, g: 0, b: 255, alpha: 1 },
          path: [
            { op: 'M', x: 0, y: 0 },
            { op: 'L', x: 10, y: 0 },
            { op: 'L', x: 10, y: 10 },
            { op: 'Z' },
          ],
        },
      ],
    },
  }));
  // The rest of the picture still draws.
  expect(await drawForm()).toEqual({ drawn: true, codes: ['metafile-image'] });
});

test('a replay that throws declines the picture instead of the export', async () => {
  install(async () => {
    throw new Error('malformed record');
  });
  expect(await drawForm()).toEqual({ drawn: false, codes: [] });
});
