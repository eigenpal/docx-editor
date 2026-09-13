/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import {
  createFixedMeasurer,
  prepareLayoutFontConfiguration,
  sha256FontBytes,
} from '@docx-editor.dev/core/layout';
import { acquireSharedExportShaping } from '@docx-editor.dev/core/export';
import { docx, mainXmlOf } from './support/documents.ts';

const field = '<w:fldSimple w:instr="PAGE"><w:r><w:t>0</w:t></w:r></w:fldSimple>';

test('PAGE locates its own line when a single paragraph spans physical pages', async () => {
  const runtime = await DocxEditor.createServer(
    docx(
      `<w:p><w:r><w:t>${'long paragraph words '.repeat(500)}</w:t></w:r>${field}</w:p>` +
        '<w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="300" w:bottom="300" w:left="300" w:right="300"/></w:sectPr>'
    ),
    { pagination: { measurer: createFixedMeasurer(6, 14) } }
  );
  await runtime.run(async (context) => {
    const current = context.document.body.fields.getFirst();
    await context.sync();
    current.updateResult();
    await context.sync();
  });
  const xml = await mainXmlOf(runtime);
  const cached = xml.match(/<w:fldSimple[^>]*>[\s\S]*?<w:t[^>]*>(\d+)<\/w:t>/)?.[1];
  expect(Number(cached)).toBeGreaterThan(1);
  runtime.dispose();
});

test('PAGE uses section numbering with actual font-backed pagination', async () => {
  const bytes = new Uint8Array(
    await Bun.file(
      new URL(
        '../../../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
        import.meta.url
      )
    ).arrayBuffer()
  );
  const fonts = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
        id: 'field-pagination-font',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
  });
  const shaping = await acquireSharedExportShaping(fonts);
  const runtime = await DocxEditor.createServer(
    docx(`<w:p>${field}</w:p><w:sectPr><w:pgNumType w:start="4" w:fmt="upperRoman"/></w:sectPr>`),
    { pagination: { measurer: shaping.createMeasurer(), producer: shaping.producer } }
  );
  await runtime.run(async (context) => {
    const current = context.document.body.fields.getFirst();
    await context.sync();
    current.updateResult();
    await context.sync();
    context.document.body.load('text');
    await context.sync();
    expect(context.document.body.text).toBe('IV');
  });
  expect(await mainXmlOf(runtime)).toContain('>IV<');
  runtime.dispose();
});
