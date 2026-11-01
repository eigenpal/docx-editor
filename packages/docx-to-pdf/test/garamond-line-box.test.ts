/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Garamond has no packaged face. Its stand-in draws the glyphs, and its lines keep Garamond's
// own 1.125 em box, so the export breaks lines and pages where the editor does.
import { expect, test } from 'bun:test';
import { linesOf } from '@docx-editor.dev/core/layout';
import { standInFonts } from '../src/font-provisioning.ts';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

const GARAMOND_LINE = { heightEm: 2304 / 2048, baselineEm: 1765 / 2048 };

test('the Garamond stand-in keeps the family line box', async () => {
  const result = await standInFonts({ families: ['Garamond'], defaultFamily: 'Arial' });
  expect(result.substitutions).toHaveLength(4);
  for (const substitution of result.substitutions) {
    expect(substitution.to.family).toBe('Liberation Serif');
    expect(substitution.lineMetrics).toEqual(GARAMOND_LINE);
  }
});

test('single-spaced Garamond lines are 1.125 em tall in the export', async () => {
  const paragraph = (font: string) =>
    '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
    `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="24"/></w:rPr>` +
    '<w:t>Line of text</w:t></w:r></w:p>';
  const opened = await openExportSession(docx(paragraph('Garamond') + paragraph('Georgia')), {
    useSystemFonts: false,
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const [garamond, other] = linesOf(await opened.session.layout()).map((l) => l.box.height);
    expect(garamond).toBeCloseTo(12 * GARAMOND_LINE.heightEm, 2);
    // Another missing serif keeps the box of the face that draws it.
    expect(other).not.toBeCloseTo(12 * GARAMOND_LINE.heightEm, 2);
  } finally {
    opened.session.dispose();
  }
});
