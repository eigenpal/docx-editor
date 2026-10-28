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
  for (const body of [run('x', 12) + run('b', 12) + run('y', 12), run('x', 24) + run('b', 24)]) {
    const geometry = layout(body);
    expect({ ascent: ascent(geometry), descent: descent(geometry) }).toEqual(
      itemBoxExtent(geometry)
    );
  }
});

const superscript = (base: string, script: string, controlPoints: number) =>
  `<m:sSup><m:sSupPr><m:ctrlPr><w:rPr><w:sz w:val="${controlPoints * 2}"/></w:rPr></m:ctrlPr>` +
  `</m:sSupPr><m:e>${base}</m:e><m:sup>${script}</m:sup></m:sSup>`;
const subscript = (base: string, script: string, controlPoints: number) =>
  superscript(base, script, controlPoints)
    .replaceAll('sSup', 'sSub')
    .replace('<m:sup>', '<m:sub>')
    .replace('</m:sup>', '</m:sub>');

/** The baseline of `part` below the equation baseline, at any depth. */
function offsetOf(geometry: EquationGeometry, part: (node: EquationGeometry) => boolean): number {
  const walk = (node: EquationGeometry, top: number): number | undefined => {
    if (part(node)) return top + node.baseline - geometry.baseline;
    const children =
      node.kind === 'row'
        ? node.items
        : node.kind === 'script'
          ? [node.base, node.subscript, node.superscript]
          : node.kind === 'fraction'
            ? [node.numerator, node.denominator]
            : [];
    for (const child of children) {
      const found = child && walk(child, top + child.box.y);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const found = walk(geometry, 0);
  if (found === undefined) throw new Error('missing part');
  return found;
}
const textOf = (text: string) => (node: EquationGeometry) =>
  node.kind === 'text' && node.text.normalize('NFKD') === text;

test('a script after the first run takes its offsets from the first run size', () => {
  // A 48pt base after a 12pt run: the superscript sits at most 460/2048 em of 12pt below the
  // base's lowercase top (976/2048 em of 48pt), not 750/2048 em of 48pt above the baseline.
  const raised = layout(run('x', 12) + superscript(run('x', 48), run('2', 48), 48));
  expect(-offsetOf(raised, textOf('2'))).toBeCloseTo(em(976) * 48 - em(460) * 12, 8);
  // A subscript drops until its ink top meets 760/2048 em of 12pt.
  const lowered = layout(run('x', 12) + subscript(run('x', 48), run('2', 48), 48));
  expect(offsetOf(lowered, textOf('2'))).toBeCloseTo(35 * em(1000) - em(760) * 12, 8);
  // A structure that opens the equation keeps its control size.
  const first = layout(superscript(run('x', 48), run('2', 48), 48));
  expect(-offsetOf(first, textOf('2'))).toBeCloseTo(em(750) * 48, 8);
});

test('a fraction after the first run takes its shifts from the first run size', () => {
  const geometry = layout(run('x', 24) + fraction(run('a', 36), run('b', 36), 36));
  expect(-offsetOf(geometry, textOf('a'))).toBeCloseTo(em(1200) * 24, 8);
});

test('script and fraction parts claim their ink and the leading of the smaller size', () => {
  // The 35pt superscript rises over the 12pt first run: its ink and the 12pt leading.
  const raised = layout(run('x', 12) + superscript(run('x', 48), run('2', 48), 48));
  const rise = em(976) * 48 - em(460) * 12;
  expect(ascent(raised)).toBeCloseTo(rise + 35 * em(1000) + 12 * LEADING, 8);
  expect(descent(raised)).toBeCloseTo(12 * DESCENT, 8);
  // After a 48pt run, the leading of the 35pt script is the smaller one.
  const same = layout(run('x', 48) + superscript(run('x', 48), run('2', 48), 48));
  expect(ascent(same)).toBeCloseTo(
    Math.max(48 * ASCENT, em(750) * 48 + 35 * em(1000) + 35 * LEADING),
    8
  );
  // A subscript deepens the equation by its ink alone.
  const lowered = layout(run('x', 12) + subscript(run('x', 48), run('2', 48), 48));
  expect(descent(lowered)).toBeCloseTo(35 * em(1000) - em(760) * 12, 8);
});

test('a structure that opens the equation claims the font box of its size', () => {
  const geometry = layout(superscript(run('x', 12), run('x', 48), 12));
  expect(geometry.kind).toBe('script');
  // The 35pt superscript rises 750/2048 em of 12pt and claims its ink and the 12pt leading.
  expect(ascent(geometry)).toBeCloseTo(em(750) * 12 + 35 * INK.x!.top + 12 * LEADING, 8);
  expect(descent(geometry)).toBeCloseTo(12 * DESCENT, 8);
});

test('runs without measured ink keep their boxes', () => {
  const geometry = layout(run('x', 12) + run('x', 48), fontBox);
  expect(ascent(geometry)).toBeCloseTo(48 * ASCENT, 8);
  expect(descent(geometry)).toBeCloseTo(48 * DESCENT, 8);
});

/** The line of a paragraph with `line` auto spacing, 1pt text, and the equation `body`. */
function lineOf(body: string, line = 240, textPoints = 1) {
  const W = WML_NAMESPACE_URI;
  const M = OFFICE_MATH_NAMESPACE_URI;
  const document = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p><w:pPr>` +
      `<w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr>` +
      `<w:r><w:rPr><w:sz w:val="${textPoints * 2}"/></w:rPr><w:t>a</w:t></w:r>` +
      `<m:oMath>${body}</m:oMath></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!document.ok || !styles.ok) throw new Error('unreadable fixture');
  return linesOf(
    layoutSemanticDocument(document.part, 1, {
      measurer: inked,
      styleCascade: buildStyleCascadeTable(styles.part.root),
    })
  )[0]!;
}

test('the fitted extent sets the height of the line', () => {
  const line = lineOf(run('x', 12) + run('x', 48));
  expect(line.baseline).toBeCloseTo(48 * INK.x!.top + 12 * LEADING, 8);
  expect(line.box.height).toBeCloseTo(48 * INK.x!.top + 12 * LEADING + 12 * DESCENT, 8);
});

test('multiple spacing adds or removes its share of the first run font box', () => {
  const box = (points: number) => points * (ASCENT + DESCENT);
  for (const [body, first] of [
    [run('x', 12) + run('x', 48), 12],
    [run('x', 48) + run('x', 12), 48],
  ] as const) {
    const single = lineOf(body);
    // 1.5 lines: half a font box of the first run goes below the line.
    const wider = lineOf(body, 360);
    expect(wider.box.height).toBeCloseTo(single.box.height + box(first) / 2, 8);
    expect(wider.baseline).toBeCloseTo(single.baseline, 8);
    // 0.8 lines: the line loses a fifth of that box, and its baseline rises by a fifth of
    // the box's ascent.
    const tighter = lineOf(body, 192);
    expect(tighter.box.height).toBeCloseTo(single.box.height - box(first) / 5, 8);
    expect(tighter.baseline).toBeCloseTo(single.baseline - (first * ASCENT) / 5, 8);
  }
  // Text taller than the first run's box scales by its own band instead.
  const single = lineOf(run('x', 12) + run('x', 48), 240, 24);
  const text = lineOf(run('x', 1), 240, 24).box.height;
  expect(lineOf(run('x', 12) + run('x', 48), 360, 24).box.height).toBeCloseTo(
    single.box.height + text / 2,
    8
  );
});
