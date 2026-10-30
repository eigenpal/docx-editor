/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An East Asian family resolves to the face the host supplies for it: a localized name to the
// face of its English name, and a missing bold or italic to the family's own regular face,
// drawn with a synthesized style. Only a family with no face at all takes the CJK stand-in.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { NOTO_SANS_CJK_JP_URL } from '@docx-editor.dev/fonts-cjk';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { cjkFonts, standInFonts } from '../src/font-provisioning.ts';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const regular = (family: string) => ({ family, weight: 400, style: 'normal' as const });
const bold = (family: string) => ({ family, weight: 700, style: 'normal' as const });

test('a localized name takes the face of its English name', async () => {
  const result = await cjkFonts({
    families: ['メイリオ'],
    defaultFamily: 'Arial',
    resolvedFaces: [regular('Meiryo'), bold('Meiryo')],
  });
  expect(result.sources).toEqual([]);
  expect(result.substitutions).toEqual([
    { from: regular('メイリオ'), to: regular('Meiryo') },
    {
      from: { family: 'メイリオ', weight: 400, style: 'italic' },
      to: regular('Meiryo'),
    },
    { from: bold('メイリオ'), to: bold('Meiryo') },
    {
      from: { family: 'メイリオ', weight: 700, style: 'italic' },
      to: regular('Meiryo'),
    },
  ]);
});

test('a family whose regular face is supplied keeps it for bold and italic', async () => {
  const supplied = [regular('Yu Gothic')];
  const cjk = await cjkFonts({
    families: ['Yu Gothic'],
    defaultFamily: 'Arial',
    resolvedFaces: supplied,
  });
  expect(cjk.substitutions ?? []).toEqual([]);
  const standIn = await standInFonts({
    families: ['Yu Gothic'],
    defaultFamily: 'Arial',
    resolvedFaces: supplied,
  });
  expect(standIn.sources).toEqual([]);
  expect(standIn.substitutions.map((s) => [s.from.weight, s.from.style, s.to])).toEqual([
    [700, 'normal', regular('Yu Gothic')],
    [400, 'italic', regular('Yu Gothic')],
    [700, 'italic', regular('Yu Gothic')],
  ]);
});

test('a family with no face anywhere still takes the CJK face', async () => {
  const result = await cjkFonts({
    families: ['メイリオ', 'Yu Gothic'],
    defaultFamily: 'Arial',
    resolvedFaces: [],
  });
  expect(result.sources.map((source) => source.request.family)).toEqual(['Noto Sans CJK JP']);
  expect(new Set(result.substitutions!.map((s) => s.to.family))).toEqual(
    new Set(['Noto Sans CJK JP'])
  );
});

test('an export draws a localized name and a missing bold face in the supplied faces', async () => {
  const bytes = new Uint8Array(readFileSync(NOTO_SANS_CJK_JP_URL));
  const sources = ['Meiryo', 'Yu Gothic'].map((family) => {
    const made = createFontSource(bytes, regular(family));
    if ('failure' in made) throw new Error(made.failure.reason);
    return made.source;
  });
  const run = (fonts: string, text: string) =>
    `<w:r><w:rPr><w:rFonts ${fonts}/></w:rPr><w:t>${text}</w:t></w:r>`;
  const body =
    `<w:p>${run('w:ascii="メイリオ" w:hAnsi="メイリオ" w:eastAsia="メイリオ"', '日本語')}</w:p>` +
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Yu Gothic" w:hAnsi="Yu Gothic" w:eastAsia="Yu Gothic"/>` +
    '<w:b/></w:rPr><w:t>太字</w:t></w:r></w:p>';
  const result = await exportPdf(docx(body), { fonts: { sources }, useSystemFonts: false });
  const faceOf = (family: string) =>
    result.fontResolution.families.find((entry) => entry.family === family)?.faces;
  expect(new Set(faceOf('メイリオ')?.map((face) => face.sourceFamily))).toEqual(
    new Set(['Meiryo'])
  );
  const boldFaces = faceOf('Yu Gothic')?.filter((face) => face.weight === 700) ?? [];
  expect(boldFaces.length).toBeGreaterThan(0);
  expect(new Set(boldFaces.map((face) => face.sourceFamily))).toEqual(new Set(['Yu Gothic']));
  expect(result.diagnostics.filter((d) => d.code === 'font-substitution')).toEqual([]);
});
