import { expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  projectOmmlEquation,
  readOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { buildStyleCascadeTable, layoutSemanticDocument, linesOf } from '../index.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const em = (units: number) => units / 2048;
/** Font box of the math face: ascender 1946 and descender 455 font units. */
const ASCENT = em(1946);
const DESCENT = em(455);
/** The math leading above later ink, in ems of the first atom size. */
const LEADING = em(300);
/** Ink of the test glyphs, in ems: x reaches the lowercase top, b ascends, y descends. */
const INK: Record<string, { top: number; bottom: number }> = {
  x: { top: em(973), bottom: 0 },
  b: { top: em(1430), bottom: 0 },
  y: { top: em(972), bottom: em(436) },
  a: { top: em(973), bottom: 0 },
};

function inkOf(text: string) {
  let top = 0;
  let bottom = 0;
  for (const char of text.normalize('NFKD')) {
    const ink = INK[char.toLowerCase()] ?? { top: em(1000), bottom: 0 };
    top = Math.max(top, ink.top);
    bottom = Math.max(bottom, ink.bottom);
  }
  return { top, bottom };
}

const fontBox: TextMeasurer = {
  measure: (text, style) => Array.from(text).length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({
    height: style.fontSizePt * (ASCENT + DESCENT),
    baseline: style.fontSizePt * ASCENT,
  }),
};
const inked: TextMeasurer = {
  ...fontBox,
  textOutline: (text, style) => {
    const ink = inkOf(text);
    return {
      path: null,
      ink: {
        left: 0,
        top: -style.fontSizePt * ink.top,
        right: fontBox.measure(text, style),
        bottom: style.fontSizePt * ink.bottom,
      },
    };
  },
};

const run = (text: string, points: number) =>
  `<m:r><w:rPr><w:sz w:val="${points * 2}"/></w:rPr><m:t>${text}</m:t></m:r>`;
const fraction = (numerator: string, denominator: string, controlPoints: number) =>
  `<m:f><m:fPr><m:ctrlPr><w:rPr><w:sz w:val="${controlPoints * 2}"/></w:rPr></m:ctrlPr></m:fPr>` +
  `<m:num>${numerator}</m:num><m:den>${denominator}</m:den></m:f>`;

function project(body: string) {
  const read = readOoxmlPart(
    `<m:oMath xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">${body}</m:oMath>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const projection = projectOmmlEquation(read.part.root as OoxmlGenericElementNode);
  if (!projection) throw new Error('missing projection');
  return projection;
}

const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: 12 });
const layout = (body: string, measurer: TextMeasurer = inked): EquationGeometry =>
  layoutEquation(project(body), measurer, style).geometry;
const ascent = (geometry: EquationGeometry) => geometry.baseline;
const descent = (geometry: EquationGeometry) => geometry.box.height - geometry.baseline;

test('a larger later run raises the equation by its ink and the leading of the first run', () => {
  const geometry = layout(run('x', 12) + run('x', 48));
  expect(ascent(geometry)).toBeCloseTo(48 * INK.x!.top + 12 * LEADING, 8);
  // The later run has no descender, so the first run's font box sets the depth.
  expect(descent(geometry)).toBeCloseTo(12 * DESCENT, 8);
  expect(layout(run('x', 12) + run('b', 48)).baseline).toBeCloseTo(
    48 * INK.b!.top + 12 * LEADING,
    8
  );
});

test('a larger later run deepens the equation by its ink alone', () => {
  const geometry = layout(run('x', 12) + run('y', 48));
  expect(descent(geometry)).toBeCloseTo(48 * INK.y!.bottom, 8);
  expect(descent(layout(run('x', 28) + run('y', 48)))).toBeCloseTo(48 * INK.y!.bottom, 8);
});

test('the leading above later ink follows the size of the first run', () => {
  const small = layout(run('x', 12) + run('x', 96));
  const large = layout(run('x', 36) + run('x', 96));
  expect(ascent(large) - ascent(small)).toBeCloseTo(24 * LEADING, 8);
});

test('the first run keeps its font box when later runs are smaller or their ink is lower', () => {
  const geometry = layout(run('x', 24) + run('x', 12) + run('x', 36));
  expect(ascent(geometry)).toBeCloseTo(24 * ASCENT, 8);
  expect(descent(geometry)).toBeCloseTo(24 * DESCENT, 8);
  // Every glyph still sits on one baseline inside the fitted row.
  if (geometry.kind !== 'row') throw new Error(`expected a row, got ${geometry.kind}`);
  for (const item of geometry.items) {
    expect(item.box.y + item.baseline).toBeCloseTo(geometry.baseline, 8);
  }
});

test('places later glyphs above a fitted row when their font box reaches past it', () => {
  const geometry = layout(run('x', 12) + run('x', 48));
  if (geometry.kind !== 'row') throw new Error(`expected a row, got ${geometry.kind}`);
  const [first, later] = geometry.items;
  expect(first!.box.y + first!.baseline).toBeCloseTo(geometry.baseline, 8);
  expect(later!.box.y + later!.baseline).toBeCloseTo(geometry.baseline, 8);
  expect(later!.box.y).toBeLessThan(0);
});

test('a larger later run that draws nothing claims no height', () => {
  for (const measurer of [inked, fontBox]) {
    const geometry = layout(run('x', 12) + run(' ', 48) + run('x', 12), measurer);
    expect(ascent(geometry)).toBeCloseTo(12 * ASCENT, 8);
    expect(descent(geometry)).toBeCloseTo(12 * DESCENT, 8);
  }
});

test('a first structure leads with its control size', () => {
  const geometry = layout(fraction(run('a', 12), run('b', 12), 12) + run('x', 48));
  expect(ascent(geometry)).toBeCloseTo(48 * INK.x!.top + 12 * LEADING, 8);
  const larger = layout(fraction(run('a', 12), run('b', 12), 24) + run('x', 96));
  expect(ascent(larger)).toBeCloseTo(96 * INK.x!.top + 24 * LEADING, 8);
});

/** The extent a row has without fitting: the highest and deepest box among its items. */
function itemBoxExtent(geometry: EquationGeometry) {
  if (geometry.kind !== 'row') throw new Error(`expected a row, got ${geometry.kind}`);
  return {
    ascent: Math.max(...geometry.items.map((item) => item.baseline)),
    descent: Math.max(...geometry.items.map((item) => item.box.height - item.baseline)),
  };
}

test('equations whose runs share one size keep their font boxes', () => {
  for (const body of [
    run('x', 12) + run('b', 12) + run('y', 12),
    run('x', 24) + run('b', 24),
    run('x', 12) + fraction(run('a', 12), run('b', 12), 12),
  ]) {
    const geometry = layout(body);
    expect({ ascent: ascent(geometry), descent: descent(geometry) }).toEqual(
      itemBoxExtent(geometry)
    );
  }
});

test('later structures and runs without measured ink keep their boxes', () => {
  const structure = layout(run('x', 12) + fraction(run('a', 24), run('b', 24), 24));
  expect({ ascent: ascent(structure), descent: descent(structure) }).toEqual(
    itemBoxExtent(structure)
  );
  expect(ascent(structure)).toBeGreaterThan(12 * ASCENT);
  const geometry = layout(run('x', 12) + run('x', 48), fontBox);
  expect(ascent(geometry)).toBeCloseTo(48 * ASCENT, 8);
  expect(descent(geometry)).toBeCloseTo(48 * DESCENT, 8);
});

test('the fitted extent sets the height of the line', () => {
  const W = WML_NAMESPACE_URI;
  const M = OFFICE_MATH_NAMESPACE_URI;
  const document = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p><w:pPr>` +
      '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
      `<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t>a</w:t></w:r>` +
      `<m:oMath>${run('x', 12)}${run('x', 48)}</m:oMath></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!document.ok || !styles.ok) throw new Error('unreadable fixture');
  const [line] = linesOf(
    layoutSemanticDocument(document.part, 1, {
      measurer: inked,
      styleCascade: buildStyleCascadeTable(styles.part.root),
    })
  );
  expect(line!.baseline).toBeCloseTo(48 * INK.x!.top + 12 * LEADING, 8);
  expect(line!.box.height).toBeCloseTo(48 * INK.x!.top + 12 * LEADING + 12 * DESCENT, 8);
});
