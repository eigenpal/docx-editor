// A family with bytes under its own name stands in through its own nearest face for each face
// that it lacks, never through its class fallback or font table alternate. The order is CSS
// font matching over the four static faces, which paint applies to the family's alias.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { FontSource } from '../../contracts/editor.ts';
import {
  applyDocumentFontSubstitutions,
  documentStandInFaces,
  type DocumentFontSubstitutionPlan,
} from '../document-font-substitution.ts';
import { composeFontConfiguration } from '../font-composition.ts';
import { fontRequestKey, sha256FontBytes } from '../font-resource.ts';

type Style = 'normal' | 'italic';
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const source = (family: string, weight: number, style: Style, id = family): FontSource => ({
  request: { family, weight, style },
  id: `${id}-${weight}-${style}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});
/** A plan whose class fallback and font table alternate both reach complete families. */
const plan = (family: string): DocumentFontSubstitutionPlan => ({
  families: [family],
  alternates: new Map([[family.toLowerCase(), 'Alternate']]),
  fallbacks: new Map([[family.toLowerCase(), 'Fallback']]),
  ambiguousFamilies: [],
});
const FACES = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
] as const;
const complete = (family: string) => FACES.map(([weight, style]) => source(family, weight, style));

function standIns(family: string, own: readonly FontSource[]) {
  const configuration = applyDocumentFontSubstitutions(
    composeFontConfiguration({
      sources: [...own, ...complete('Alternate'), ...complete('Fallback')],
    }),
    plan(family)
  );
  const faces = (configuration.substitutions ?? [])
    .filter(({ from }) => from.family === family)
    .map(({ from, to }) => `${from.weight} ${from.style} > ${to.family} ${to.weight} ${to.style}`)
    .sort();
  return { faces, configuration };
}

test('a family with a bold face only draws every face from it', () => {
  expect(standIns('Brand', [source('Brand', 700, 'normal')]).faces).toEqual([
    '400 italic > Brand 700 normal',
    '400 normal > Brand 700 normal',
    '700 italic > Brand 700 normal',
  ]);
});

test('style decides before weight, and the nearest weight follows', () => {
  // Two italic weights: an upright request takes the italic of its own weight.
  expect(
    standIns('Brand', [source('Brand', 400, 'italic'), source('Brand', 700, 'italic')]).faces
  ).toEqual(['400 normal > Brand 400 italic', '700 normal > Brand 700 italic']);
  // A regular and a bold italic face: an italic request takes the bold italic.
  expect(
    standIns('Brand', [source('Brand', 400, 'normal'), source('Brand', 700, 'italic')]).faces
  ).toEqual(['400 italic > Brand 700 italic', '700 normal > Brand 400 normal']);
});

test('a localized name stands in through the faces of its English name', () => {
  expect(standIns('メイリオ', [source('Meiryo', 400, 'normal')]).faces).toEqual([
    '400 italic > Meiryo 400 normal',
    '400 normal > Meiryo 400 normal',
    '700 italic > Meiryo 400 normal',
    '700 normal > Meiryo 400 normal',
  ]);
});

test('a localized name supplies the faces of its English name', () => {
  expect(standIns('Meiryo', [source('メイリオ', 400, 'normal')]).faces).toEqual([
    '400 italic > メイリオ 400 normal',
    '400 normal > メイリオ 400 normal',
    '700 italic > メイリオ 400 normal',
    '700 normal > メイリオ 400 normal',
  ]);
});

test('an own-face stand-in of another style is not an installed face', () => {
  const italic = fontRequestKey({ family: 'Brand', weight: 400, style: 'italic' });
  for (const id of ['Brand', 'embedded:/word/font1']) {
    const { faces, configuration } = standIns('Brand', [source('Brand', 400, 'normal', id)]);
    expect(faces).toContain('400 italic > Brand 400 normal');
    // Measurement still reads it through the regular face (`hasMeasurableFont`).
    expect(documentStandInFaces(configuration).has(italic)).toBe(true);
  }
  // The same face under another name of the font is the face itself.
  const { configuration } = standIns('Meiryo', [source('メイリオ', 400, 'normal')]);
  const regular = fontRequestKey({ family: 'Meiryo', weight: 400, style: 'normal' });
  expect(documentStandInFaces(configuration).has(regular)).toBe(false);
});
