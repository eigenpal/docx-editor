/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A family with some faces covered draws each other face from its nearest covered face.
import { expect, test } from 'bun:test';
import { standInFonts } from '../src/font-provisioning.ts';

type Style = 'normal' | 'italic';
const face = (weight: number, style: Style) => ({ family: 'Brand', weight, style });

async function standInsFor(covered: readonly (readonly [number, Style])[]) {
  const result = await standInFonts({
    families: ['Brand'],
    defaultFamily: 'Arial',
    resolvedFaces: covered.map(([weight, style]) => face(weight, style)),
  });
  expect(result.sources).toEqual([]);
  return result.substitutions
    .map(({ from, to }) => `${from.weight} ${from.style} > ${to.family} ${to.weight} ${to.style}`)
    .sort();
}

test('a family that ships in bold only draws every face from its bold face', async () => {
  expect(await standInsFor([[700, 'normal']])).toEqual([
    '400 italic > Brand 700 normal',
    '400 normal > Brand 700 normal',
    '700 italic > Brand 700 normal',
  ]);
});

test('a missing bold italic takes the covered italic before the covered bold', async () => {
  expect(
    await standInsFor([
      [400, 'normal'],
      [400, 'italic'],
    ])
  ).toEqual(['700 italic > Brand 400 italic', '700 normal > Brand 400 normal']);
  expect(
    await standInsFor([
      [400, 'normal'],
      [700, 'normal'],
    ])
  ).toEqual(['400 italic > Brand 400 normal', '700 italic > Brand 700 normal']);
});

test('a family that ships in italic only draws its upright faces from the italic', async () => {
  expect(await standInsFor([[400, 'italic']])).toEqual([
    '400 normal > Brand 400 italic',
    '700 italic > Brand 400 italic',
    '700 normal > Brand 400 italic',
  ]);
});
