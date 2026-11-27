/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A face that the converter draws from another face of its own family is a synthesized style.
// The report shows the family as partial, as the editor's own resolution does, and a strict
// export refuses it.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const regular = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
function fontSource(family: string) {
  const created = createFontSource(regular, { family, weight: 400, style: 'normal' });
  if ('failure' in created) throw new Error(JSON.stringify(created.failure));
  return created.source;
}
const run = (family: string, rPr: string, text: string) =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:eastAsia="${family}"/>${rPr}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;

test('a face drawn from another face of its family leaves the family partial', async () => {
  const input = docx(run('Brand', '', 'Regular text') + run('Brand', '<w:b/>', 'Bold text'));
  const fonts = { sources: [fontSource('Brand')] };
  const result = await exportPdf(input, { useSystemFonts: false, fonts });
  const brand = result.fontResolution.families.find(({ family }) => family === 'Brand')!;
  // Every face draws from the regular face, but only the regular face covers the family.
  expect(
    brand.faces.map(({ weight, style, sourceFamily }) => `${weight} ${style} ${sourceFamily}`)
  ).toEqual(['400 normal Brand', '700 normal Brand', '400 italic Brand', '700 italic Brand']);
  expect(brand.coverage).toBe('partial');
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'incomplete-font', severity: 'information' })
  );
  const refused = await exportPdf(input, { useSystemFonts: false, fonts, fontPolicy: 'strict' })
    .then(() => undefined)
    .catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(ExportResourceError);
  expect((refused as Error).message).toMatch(/incomplete families: (.*, )?Brand(,|$)/);
});

test('an English family name finds the faces supplied under its localized name', async () => {
  const input = docx(run('Meiryo', '', 'Regular text'));
  const result = await exportPdf(input, {
    useSystemFonts: false,
    fonts: { sources: [fontSource('メイリオ')] },
  });
  const meiryo = result.fontResolution.families.find(({ family }) => family === 'Meiryo')!;
  expect(meiryo.faces.map(({ sourceFamily }) => sourceFamily)).toEqual([
    'メイリオ',
    'メイリオ',
    'メイリオ',
    'メイリオ',
  ]);
  // The regular face is the font itself; the other faces are synthesized from it.
  expect(meiryo.coverage).toBe('partial');
  expect(result.diagnostics.map(({ code }) => code)).not.toContain('font-substitution');
});
