/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Segoe UI resolves to the packaged Selawik faces, which carry its advance widths, and its
// lines keep Segoe UI's own 2724/2048 em box rather than Selawik's 1.2 em.
import { expect, test } from 'bun:test';
import { linesOf } from '@docx-editor.dev/core/layout';
import { exportPdf } from '../src/index.ts';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

const SEGOE_LINE_EM = 2724 / 2048;

const paragraph = (rPr: string) =>
  '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
  `<w:r><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/>${rPr}<w:sz w:val="24"/></w:rPr>` +
  '<w:t>Shape of the layout</w:t></w:r></w:p>';

test('single-spaced Segoe UI lines take the Segoe UI line box in every style', async () => {
  const opened = await openExportSession(
    docx(paragraph('') + paragraph('<w:b/>') + paragraph('<w:i/>')),
    { useSystemFonts: false }
  );
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const lines = linesOf(await opened.session.layout());
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.box.height).toBeCloseTo(12 * SEGOE_LINE_EM, 2);
  } finally {
    opened.session.dispose();
  }
});

test('the export resolves Segoe UI without a stand-in', async () => {
  const result = await exportPdf(docx(paragraph('') + paragraph('<w:i/>')), {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
  });
  const messages = (result.diagnostics ?? []).map((entry) => entry.message);
  expect(messages.some((message) => message.includes('Segoe UI is not available'))).toBe(false);
});
