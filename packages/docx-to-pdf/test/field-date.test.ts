/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `fieldDate` on the PDF converter: a DATE field with a `\@` picture (ECMA-376 Part 1,
// 17.16.5.13, 17.16.4.1) lays out that moment, as the editor shows it. Without the option the
// field keeps its saved result.
import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { forEachSemanticSpan, type SemanticLayout } from '@docx-editor.dev/core/layout';
import {
  defineFontResolver,
  exportPdf,
  exportPdfFrom,
  openDocumentForExport,
} from '../src/index.ts';
import { docx } from './fixture.ts';

/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);
const source = docx(
  '<w:p>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> DATE \\@ "d MMMM yyyy" </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1 January 2020</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '</w:p>'
);

function spanText(layout: SemanticLayout): string {
  const parts: string[] = [];
  forEachSemanticSpan(layout, ({ span }) => parts.push(span.text));
  return parts.join('');
}

async function laidOut(fieldDate?: Date): Promise<string> {
  const opened = await openDocumentForExport(source, {
    useSystemFonts: false,
    ...(fieldDate ? { fieldDate } : {}),
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
  try {
    return spanText(await opened.session.layout());
  } finally {
    opened.session.dispose();
  }
}

test('fieldDate lays out the date; the default keeps the saved result', async () => {
  expect(await laidOut()).toBe('1 January 2020');
  expect(await laidOut(MOMENT)).toBe('5 March 2026');
});

test('exportPdf accepts fieldDate, also a Date from another realm', async () => {
  const result = await exportPdf(source, { useSystemFonts: false, fieldDate: MOMENT });
  expect(result.pageCount).toBe(1);
  const foreign = runInNewContext('new Date(2026, 2, 5, 14, 7)') as Date;
  expect(foreign instanceof Date).toBe(false);
  expect(await laidOut(foreign)).toBe('5 March 2026');
  await expect(
    exportPdf(source, { useSystemFonts: false, fieldDate: foreign })
  ).resolves.toBeDefined();
});

test('exportPdfFrom refuses fieldDate: the session sets it when it opens', async () => {
  const opened = await openDocumentForExport(source, { useSystemFonts: false });
  if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
  try {
    await expect(
      exportPdfFrom(opened.session, { fieldDate: MOMENT } as Parameters<typeof exportPdfFrom>[1])
    ).rejects.toThrow('fieldDate must be configured when opening the PDF session');
  } finally {
    opened.session.dispose();
  }
});

test('a Date the caller changes while fonts resolve does not change the session', async () => {
  const date = new Date(MOMENT.getTime());
  const fonts = defineFontResolver(() => {
    date.setFullYear(2031);
    return { sources: [] };
  });
  const opened = await openDocumentForExport(source, {
    useSystemFonts: false,
    fonts,
    fieldDate: date,
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
  try {
    expect(date.getFullYear()).toBe(2031);
    expect(spanText(await opened.session.layout())).toBe('5 March 2026');
  } finally {
    opened.session.dispose();
  }
});
