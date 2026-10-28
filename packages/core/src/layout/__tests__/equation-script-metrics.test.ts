import { expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  projectOmmlEquation,
  readOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import {
  layoutEquation,
  type EquationGeometry,
  type EquationTextGeometry,
} from '../equation-layout.ts';
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

const run = (text: string, halfPoints?: number) =>
  `<m:r>${halfPoints ? `<w:rPr><w:sz w:val="${halfPoints}"/></w:rPr>` : ''}<m:t>${text}</m:t></m:r>`;

function layout(body: string, sizePt: number, measurer: TextMeasurer = fixed): EquationGeometry {
  const read = readOoxmlPart(
    `<m:oMath xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">${body}</m:oMath>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const projection = projectOmmlEquation(read.part.root as OoxmlGenericElementNode);
  if (!projection) throw new Error('missing projection');
  const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: sizePt });
  return layoutEquation(projection, measurer, style).geometry;
}

function script(geometry: EquationGeometry) {
  if (geometry.kind !== 'script') throw new Error(`expected a script, got ${geometry.kind}`);
  return geometry;
}

function text(geometry: EquationGeometry | undefined): EquationTextGeometry {
  if (geometry?.kind !== 'text') throw new Error('expected text');
  return geometry;
}

/** How far the baseline of `part` sits above the script baseline. */
const rise = (whole: EquationGeometry, part: EquationGeometry) =>
  whole.baseline - (part.box.y + part.baseline);

test.each([
  [8, 5.5],
  [10, 7],
  [12, 8.5],
  [14, 10],
  [18, 13],
  [24, 17.5],
  [36, 26],
])(
  'a structure of %d pt draws its scripts at 73 percent in whole half points',
  (size, expected) => {
    const geometry = script(
      layout(`<m:sSup><m:e>${run('x')}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`, size)
    );
    expect(text(geometry.superscript).fontSizePt).toBe(expected);
  }
);

test('fraction parts draw at the script size', () => {
  const geometry = layout(
    `<m:f><m:num>${run('p', 36)}</m:num><m:den>${run('q', 20)}</m:den></m:f>`,
    12
  );
  if (geometry.kind !== 'fraction') throw new Error('expected a fraction');
  expect(text(geometry.numerator).fontSizePt).toBe(13);
  expect(text(geometry.denominator).fontSizePt).toBe(7);
});

test.each([10, 12, 24])('a superscript in a structure of %d pt rises 750/2048 em', (size) => {
  for (const base of ['x', 'b']) {
    const geometry = script(
      layout(`<m:sSup><m:e>${run(base)}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`, size)
    );
    expect(rise(geometry, geometry.superscript!) / size).toBeCloseTo(750 / 2048, 6);
    expect(geometry.base.box.y + geometry.base.baseline).toBeCloseTo(geometry.baseline, 6);
  }
});

test('a superscript on a larger base stays near the top of its lowercase letters', () => {
  // A 24 pt base in a 12 pt structure: the rise follows the base, less a fixed drop.
  const geometry = script(
    layout(`<m:sSup><m:e>${run('x', 48)}</m:e><m:sup>${run('2', 48)}</m:sup></m:sSup>`, 12)
  );
  expect(rise(geometry, geometry.superscript!)).toBeCloseTo(
    (976 / 2048) * 24 - (460 / 2048) * 12,
    6
  );
});

test('the superscript size does not change its rise', () => {
  const small = script(
    layout(`<m:sSup><m:e>${run('y', 24)}</m:e><m:sup>${run('n', 16)}</m:sup></m:sSup>`, 12)
  );
  const large = script(
    layout(`<m:sSup><m:e>${run('y', 24)}</m:e><m:sup>${run('n', 36)}</m:sup></m:sSup>`, 12)
  );
  expect(rise(small, small.superscript!)).toBeCloseTo(rise(large, large.superscript!), 6);
});

test('scripts of one base keep an ink gap, moving the superscript up first', () => {
  const size = 12;
  const both = script(
    layout(
      `<m:sSubSup><m:e>${run('x')}</m:e><m:sub>${run('k')}</m:sub><m:sup>${run('3')}</m:sup></m:sSubSup>`,
      size,
      inked
    )
  );
  const sup = both.superscript!;
  const sub = both.subscript!;
  const supBottom = rise(both, sup) - equationInk(sup, inked).descent;
  const subTop = rise(both, sub) + equationInk(sub, inked).ascent;
  expect(supBottom - subTop).toBeCloseTo((300 / 2048) * size, 6);
  // The superscript rose to its limit before the subscript dropped below a fifth of an em.
  expect(supBottom).toBeCloseTo((765 / 2048) * size, 6);
  expect(-rise(both, sub)).toBeGreaterThan(size * 0.2);
});

test('scripts with enough ink gap keep their own positions', () => {
  const size = 12;
  const both = script(
    layout(
      `<m:sSubSup><m:e>${run('x')}</m:e><m:sub>${run('n', 16)}</m:sub><m:sup>${run('2')}</m:sup></m:sSubSup>`,
      size,
      inked
    )
  );
  expect(rise(both, both.superscript!) / size).toBeCloseTo(750 / 2048, 6);
  expect(-rise(both, both.subscript!) / size).toBeCloseTo(0.2, 6);
});

function bar(geometry: EquationGeometry) {
  if (geometry.kind !== 'bar') throw new Error(`expected a bar, got ${geometry.kind}`);
  return geometry;
}

const barred = (position: 'top' | 'bot', body: string, size: number) =>
  bar(
    layout(
      `<m:bar><m:barPr><m:pos m:val="${position}"/></m:barPr><m:e>${run(body)}</m:e></m:bar>`,
      size,
      inked
    )
  );

test.each([12, 24])('a bar in a structure of %d pt strokes 133/2048 em', (size) => {
  for (const position of ['top', 'bot'] as const) {
    expect(barred(position, 'xa', size).bar.height / size).toBeCloseTo(133 / 2048, 6);
  }
});

test.each(['xa', 'bk', 'yg'])('an upper bar keeps 345/2048 em above the ink of %s', (body) => {
  const size = 12;
  const geometry = barred('top', body, size);
  const inkTop = geometry.baseline - equationInk(geometry.body, inked).ascent;
  expect((inkTop - (geometry.bar.y + geometry.bar.height)) / size).toBeCloseTo(345 / 2048, 6);
});

test.each(['xa', 'bk', 'yg'])('a lower bar keeps 345/2048 em below the ink of %s', (body) => {
  const size = 12;
  const geometry = barred('bot', body, size);
  const inkBottom = geometry.baseline + equationInk(geometry.body, inked).descent;
  expect((geometry.bar.y - inkBottom) / size).toBeCloseTo(345 / 2048, 6);
  expect(geometry.box.height).toBeGreaterThanOrEqual(geometry.bar.y + geometry.bar.height);
});

test('an upper bar over short letters fits in the font box of its body', () => {
  const geometry = barred('top', 'xa', 12);
  expect(geometry.box.height).toBeCloseTo(geometry.body.box.height, 6);
  expect(geometry.baseline).toBeCloseTo(geometry.body.baseline, 6);
});

test('a bar beyond the font box reserves one more stroke of space outside it', () => {
  const size = 12;
  // The fixed measurer reports no ink, so the bar clears the whole font box.
  const geometry = bar(
    layout(`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${run('x')}</m:e></m:bar>`, size)
  );
  expect(geometry.bar.y / size).toBeCloseTo(133 / 2048, 6);
  expect(geometry.body.box.y - (geometry.bar.y + geometry.bar.height)).toBeCloseTo(
    (345 / 2048) * size,
    6
  );
});
