import { expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  projectOmmlEquation,
  readOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { equationInk } from '../equation-ink.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const fixed = createFixedMeasurer(6, 14);
/** Reports glyph ink: lowercase-height letters and digits, with a descender for g, j, y. */
const inked: TextMeasurer = {
  ...fixed,
  textOutline: (text, style) => ({
    path: null,
    ink: {
      left: 0,
      top: -style.fontSizePt * (/[0-9bdhkl]/u.test(text.normalize('NFKD')) ? 0.7 : 0.48),
      right: fixed.measure(text, style),
      bottom: style.fontSizePt * (/[gjy]/u.test(text.normalize('NFKD')) ? 0.21 : 0),
    },
  }),
};
const em = (units: number) => units / 2048;
const run = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;
const fraction = (numerator: string, denominator: string) =>
  `<m:f><m:num>${numerator}</m:num><m:den>${denominator}</m:den></m:f>`;

function layout(body: string, sizePt = 11): EquationGeometry {
  const read = readOoxmlPart(
    `<m:oMath xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">${body}</m:oMath>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const projection = projectOmmlEquation(read.part.root as OoxmlGenericElementNode);
  if (!projection) throw new Error('missing projection');
  const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: sizePt });
  return layoutEquation(projection, inked, style).geometry;
}

function stack(geometry: EquationGeometry) {
  if (geometry.kind !== 'fraction') throw new Error(`expected a fraction, got ${geometry.kind}`);
  return geometry;
}

/** How far a part's baseline sits above (positive) the fraction baseline. */
const shift = (whole: EquationGeometry, part: EquationGeometry) =>
  whole.baseline - (part.box.y + part.baseline);

test('centres the rule on the math axis with the math rule thickness', () => {
  const geometry = stack(layout(fraction(run('2'), run('3'))));
  expect(geometry.bar.height).toBeCloseTo(em(133) * 11, 9);
  expect(geometry.baseline - (geometry.bar.y + geometry.bar.height / 2)).toBeCloseTo(
    em(585) * 11,
    9
  );
});

test('places the parts at the inline shifts of the fraction size', () => {
  const geometry = stack(layout(fraction(run('2'), run('3'))));
  expect(shift(geometry, geometry.numerator)).toBeCloseTo(em(1200) * 11, 9);
  expect(-shift(geometry, geometry.denominator)).toBeCloseTo(em(1030) * 11, 9);
});

test('reaches the typographic extents of its parts, not their font boxes', () => {
  const geometry = stack(layout(fraction(run('2'), run('3'))));
  // The parts draw at 8 pt: 73 percent of 11 pt, rounded down to a half point.
  expect(geometry.baseline).toBeCloseTo(em(1200) * 11 + em(1593) * 8, 9);
  expect(geometry.box.height - geometry.baseline).toBeCloseTo(em(1030) * 11 + em(455) * 8, 9);
  expect(geometry.numerator.box.y).toBeGreaterThanOrEqual(0);
});

test('is as wide as its wider part, with the rule across it', () => {
  const geometry = stack(layout(fraction(run('2'), run('345'))));
  expect(geometry.box.width).toBeCloseTo(geometry.denominator.box.width, 9);
  expect(geometry.bar.x).toBe(0);
  expect(geometry.bar.width).toBeCloseTo(geometry.box.width, 9);
  expect(geometry.numerator.box.x).toBeCloseTo(
    (geometry.box.width - geometry.numerator.box.width) / 2,
    9
  );
});

test('moves a deep numerator up to keep the least gap above the rule', () => {
  const geometry = stack(layout(fraction(fraction(run('a'), run('y')), run('c'))));
  const numerator = geometry.numerator;
  const inkBelow = equationInk(numerator, inked).descent;
  expect(shift(geometry, numerator)).toBeCloseTo(
    em(585) * 11 + em(133) * 11 * 0.5 + em(133) * 11 + inkBelow,
    9
  );
  expect(shift(geometry, numerator)).toBeGreaterThan(em(1200) * 11);
});

test('moves a tall denominator down to keep the least gap below the rule', () => {
  const geometry = stack(layout(fraction(run('a'), fraction(run('b'), run('c')))));
  const denominator = geometry.denominator;
  const inkAbove = equationInk(denominator, inked).ascent;
  expect(-shift(geometry, denominator)).toBeCloseTo(
    em(133) * 11 + em(133) * 11 * 0.5 - em(585) * 11 + inkAbove,
    9
  );
});
