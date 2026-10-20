/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
  createNodeImageDecodePort,
  openDocumentForExport as openCore,
} from '@docx-editor.dev/core/export';
import { exportMarkdownFrom } from '../../docx-to-markdown/src/index.ts';
import {
  openDocumentForExport,
  exportPdfFrom,
  exportPdf,
  defineFontResolver,
  PdfFidelityError,
  type PdfExportSession,
  type PdfProjectionOptions,
  type OpenPdfDocumentForExportOptions,
} from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const source = docx(
  paragraph('Shared export') +
    '<w:p><w:del w:id="1"><w:r><w:delText>Removed</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>Inserted</w:t></w:r></w:ins></w:p>'
);

test('one session supplies cached layout to both converters and owns its lifetime', async () => {
  let calls = 0;
  const opened = await openDocumentForExport(source, {
    useSystemFonts: false,
    displayMode: 'original',
    fonts: defineFontResolver(() => {
      calls++;
      return { sources: [] };
    }),
  });
  if (!opened.ok) throw new Error(opened.reason);
  const session = opened.session;
  try {
    await expect(
      exportPdfFrom(session, { fonts: [] } as unknown as PdfProjectionOptions)
    ).rejects.toBeInstanceOf(TypeError);
    const layout = await session.layout();
    const markdown = await exportMarkdownFrom(session);
    const first = await exportPdfFrom(session);
    const expected = first.bytes.slice();
    first.bytes[0] = 0;
    const second = await exportPdfFrom(session);
    expect(second.bytes).toEqual(expected);
    expect(second.timings.openMs).toBe(0);
    expect(second.displayMode).toBe(markdown.pagination.displayMode);
    expect(second.pageCount).toBe(markdown.pages.length);
    expect(await session.layout()).toBe(layout);
    expect(calls).toBe(1);
    const projected = await exportPdfFrom(session, { displayMode: 'proposed' });
    expect(projected.displayMode).toBe('proposed');
    expect(projected.bytes).toEqual(
      (await exportPdf(source, { useSystemFonts: false, displayMode: 'proposed' })).bytes
    );
    expect(projected.bytes).not.toEqual(expected);
    expect((await session.layout()).displayMode).toBe('original');
    await expect(
      exportPdfFrom(session, { signal: AbortSignal.abort('stop') })
    ).rejects.toMatchObject({ code: 'aborted', cause: 'stop' });
    expect((await exportPdfFrom(session)).bytes).toEqual(expected);
  } finally {
    session.dispose();
  }
  session.dispose();
  await expect(exportPdfFrom(session)).rejects.toMatchObject({ code: 'disposed' });
});

test('a strict refusal does not dispose a caller-owned session', async () => {
  const opened = await openDocumentForExport(
    docx(paragraph('Underline', '<w:rPr><w:u w:val="unsupported"/></w:rPr>')),
    { useSystemFonts: false }
  );
  if (!opened.ok) throw new Error(opened.reason);
  try {
    await expect(exportPdfFrom(opened.session)).rejects.toBeInstanceOf(PdfFidelityError);
    expect((await exportPdfFrom(opened.session, { fidelityPolicy: 'best-effort' })).pageCount).toBe(
      1
    );
  } finally {
    opened.session.dispose();
  }
});

test('open refuses bad inputs and misplaced options without creating an incompatible session', async () => {
  expect(await openDocumentForExport(new Uint8Array([1]))).toMatchObject({ ok: false });
  expect(await openDocumentForExport(source, { signal: AbortSignal.abort() })).toEqual({
    ok: false,
    reason: 'aborted',
  });
  await expect(
    openDocumentForExport(source, { maxPages: 1 } as OpenPdfDocumentForExportOptions)
  ).rejects.toBeInstanceOf(TypeError);
  const core = openCore(source);
  if (!core.ok) throw new Error(core.reason);
  try {
    await expect(exportPdfFrom(core.session as PdfExportSession)).rejects.toBeInstanceOf(TypeError);
    expect((await core.session.layout()).pages.length).toBe(1);
  } finally {
    core.session.dispose();
  }
});

test('a projection deadline stops waiting without disposing shared image resources', async () => {
  const input = new Uint8Array(
    await readFile(new URL('../../../e2e/fixtures/images-crop.docx', import.meta.url))
  );
  const decoder = createNodeImageDecodePort();
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const opened = await openDocumentForExport(input, {
    useSystemFonts: false,
    imageDecodePort: {
      async decode(...args) {
        ready();
        await gate;
        return decoder.decode(...args);
      },
    },
  });
  if (!opened.ok) throw new Error(opened.reason);
  const pending = opened.session.layout();
  try {
    await started;
    await expect(exportPdfFrom(opened.session, { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timedOut',
    });
    release();
    await pending;
    expect((await exportPdfFrom(opened.session)).pageCount).toBeGreaterThan(0);
  } finally {
    release();
    await pending.catch(() => {});
    opened.session.dispose();
  }
});
