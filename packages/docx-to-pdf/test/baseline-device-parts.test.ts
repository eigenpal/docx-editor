/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';
import { paintedBaselineUnits, shiftedBaselinePt } from '../src/baseline-grid.ts';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

// The painted baseline comes from the PARTS of a line rounded to whole device units (0.24pt):
// ascent, descent and slack. Which part gives way when the rounded parts do not fit the
// rounded line decides the unit. The line box itself is the one `w:spacing` asks for
// (ECMA-376 §17.3.1.33); the device rule is measured export behavior, and every expectation
// below is a position measured on a reference export of the same shape.
const GRID = 0.24;

type Line = SemanticSpanVisit['line'];
type Paragraph = SemanticSpanVisit['paragraph'];
interface Face {
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
}
/** Sans face with external leading: the box is 1.1499 em, 0.9380 em of it above the baseline. */
const SANS: Face = { ascent: 1854, descent: -434, lineGap: 67 };
/** Serif face with the same box and a deeper descent. */
const SERIF: Face = { ascent: 1825, descent: -443, lineGap: 87 };
/** Face with no external leading: a 1.2207 em box. */
const WIDE: Face = { ascent: 1950, descent: -550, lineGap: 0 };
const EM = 2048;

interface LineShape {
  readonly face: Face;
  readonly sizePt: number;
  /** Line top from the page top, in points. */
  readonly top: number;
  /** `auto` multiple of single spacing. */
  readonly multiple?: number;
  /** `atLeast` height in points, when it exceeds the single-spaced box. */
  readonly atLeast?: number;
  /** `exact` pitch in points. Layout puts 80% of it above the baseline. */
  readonly exact?: number;
  /** Space above the glyphs that layout reports on an `exact` line: it centers them. */
  readonly centering?: number;
  readonly before?: number;
  readonly after?: number;
  /** Where the line sits in its paragraph fragment. Default: the only line. */
  readonly position?: 'first' | 'middle' | 'last';
  /** False on a fragment that a later page continues. */
  readonly paragraphEnd?: boolean;
  /** True on a fragment whose box does not hold the before-space. */
  readonly continues?: boolean;
}

/** The unit the writer paints a one-line paragraph's baseline on, from the page top. */
function baselineUnits(shape: LineShape): number {
  const { face, sizePt, top } = shape;
  const ascent = ((face.ascent + face.lineGap) / EM) * sizePt;
  const single = ascent + (-face.descent / EM) * sizePt;
  const grown = Math.max(shape.atLeast ?? 0, single);
  const height = shape.atLeast === undefined ? single * (shape.multiple ?? 1) : grown;
  const leading = shape.atLeast === undefined ? 0 : grown - single;
  const before = shape.before ?? 0;
  const after = shape.after ?? 0;
  const line = (
    shape.exact === undefined
      ? {
          box: { x: 0, y: top, width: 400, height },
          baseline: ascent + leading,
          leading,
          trailingSpacing: shape.atLeast === undefined ? height - single : 0,
        }
      : {
          box: { x: 0, y: top, width: 400, height: shape.exact },
          baseline: shape.exact * 0.8,
          leading: shape.centering ?? 0,
          trailingSpacing: 0,
        }
  ) as unknown as Line;
  const other = {} as Line;
  const position = shape.position;
  const lines =
    position === 'first'
      ? [line, other]
      : position === 'middle'
        ? [other, line, other]
        : position === 'last'
          ? [other, line]
          : [line];
  const held = shape.continues ? 0 : before;
  const paragraph = {
    box: { x: 0, y: top - held, width: 400, height: held + line.box.height + after },
    lines,
    paragraphEnd: shape.paragraphEnd ?? true,
    spacing: { before, after },
  } as unknown as Paragraph;
  return paintedBaselineUnits(top, line, { font: face } as never, paragraph);
}

// 12pt in the sans face: ascent 46.90 units, descent 10.60, box 57.50 less a hair. Both
// parts round up and the box rounds down, so one must give way. The descent has the smaller
// fraction and loses the unit: 47 above the baseline, not 46.
test('a single-spaced line gives the unit to the part with the larger fraction', () => {
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 72 })).toBe(300 + 47);
  // The serif face has the same box and a 10.82-unit descent, the larger fraction: 46.
  expect(baselineUnits({ face: SERIF, sizePt: 12, top: 72 })).toBe(300 + 46);
  // 14.5pt sans: ascent 56.67, descent 12.80. The ascent gives way.
  expect(baselineUnits({ face: SANS, sizePt: 14.5, top: 72 })).toBe(300 + 56);
});

// 9.5pt sans: ascent 37.13 and descent 8.39 both round down while the 45.52-unit box rounds
// up. The spare unit goes above the baseline.
test('a single-spaced line puts a spare unit above the baseline', () => {
  expect(baselineUnits({ face: SANS, sizePt: 9.5, top: 72 })).toBe(300 + 38);
});

// The device bottom of a line is its rounded top plus its rounded height, but never below its
// rounded real bottom edge. 8.5pt sans lines advance 40.726 units; the fourth sits one unit
// above where the first line's offset alone would put it.
test('a line never reaches below the rounded position of its bottom edge', () => {
  const pitch = ((SANS.ascent - SANS.descent + SANS.lineGap) / EM) * 8.5;
  const units = [0, 1, 2, 3, 4].map((index) => {
    const top = 72 + index * pitch;
    const ascent = ((SANS.ascent + SANS.lineGap) / EM) * 8.5;
    const line = {
      box: { x: 0, y: top, width: 400, height: pitch },
      baseline: ascent,
      leading: 0,
      trailingSpacing: 0,
    } as unknown as Line;
    const lines = [0, 1, 2, 3, 4].map((at) => (at === index ? line : ({} as Line)));
    const paragraph = {
      box: { x: 0, y: 72, width: 400, height: 5 * pitch },
      lines,
      paragraphEnd: true,
      spacing: { before: 0, after: 0 },
    } as unknown as Paragraph;
    return paintedBaselineUnits(top, line, { font: SANS } as never, paragraph);
  });
  expect(units).toEqual([333, 373, 414, 455, 496]);
});

// A multiple above single spacing leaves slack under the glyphs, and the baseline hangs from
// the line top on the rounded ascent. 18pt in the wide face at 1.0792: ascent 71.41, descent
// 20.14, slack 7.25 round to 71 + 20 + 7, one short of the 99-unit line. The ascent takes it.
test('a line with slack below hangs from its top and takes a missing unit above', () => {
  expect(baselineUnits({ face: WIDE, sizePt: 18, top: 72, multiple: 259 / 240 })).toBe(300 + 72);
  // At 1.15 the parts round to 71 + 20 + 14 and fill the 105-unit line: no unit to take.
  expect(baselineUnits({ face: WIDE, sizePt: 18, top: 72, multiple: 1.15 })).toBe(300 + 71);
  // A surplus comes out of the slack, never out of the ascent: 12pt sans stays on 47.
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 72, multiple: 1.15 })).toBe(300 + 47);
});

// After-spacing under a paragraph's last line is slack below, counted with the line's own.
// 9.5pt sans at 1.15 with 10pt after: 37 + 8 + 48 is one short of the 94-unit frame.
test('after-spacing counts as slack below the last line', () => {
  expect(baselineUnits({ face: SANS, sizePt: 9.5, top: 72, multiple: 1.15, after: 10 })).toBe(
    300 + 38
  );
  expect(baselineUnits({ face: SANS, sizePt: 9.5, top: 72, multiple: 1.15 })).toBe(300 + 37);
});

// Slack above only: the rounded descent stands on the device bottom. 12pt sans under a 15pt
// `atLeast` line keeps all 11 descent units, where the single-spaced line gave one up.
test('a line grown above its glyphs keeps its rounded descent', () => {
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 72, atLeast: 15 })).toBe(300 + 63 - 11);
  expect(baselineUnits({ face: SANS, sizePt: 8, top: 72, atLeast: 15 })).toBe(300 + 63 - 7);
});

// Before-spacing belongs to the first line's frame. With 6pt before, 12pt sans sits 46 units
// under its line top, not the 47 of the same line without the space.
test('before-spacing makes the first line stand on its bottom', () => {
  const top = 72 + 13.798828125 + 6;
  expect(baselineUnits({ face: SANS, sizePt: 12, top, before: 6 })).toBe(428);
  // Before and after together: the frame starts at the paragraph top, and the baseline hangs
  // from it by the rounded before-space plus the rounded ascent.
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 72 + 4, before: 4, after: 6 })).toBe(
    300 + 17 + 47
  );
});

// An `exact` pitch has no slack and no face: its parts are the two shares of the pitch. 13pt
// lines are 54.17 units, 43.33 above the baseline and 10.83 below: 43 + 11 fill the 54-unit
// box, and the fourth line starts on a half unit, which rounds down the page.
test('an exact pitch stands on its bottom whatever the face', () => {
  for (const face of [SANS, SERIF, WIDE]) {
    const units = [0, 1, 2, 3, 4, 5].map((index) =>
      baselineUnits({ face, sizePt: 12, top: 72 + index * 13, exact: 13 })
    );
    expect(units).toEqual([343, 397, 451, 506, 560, 614]);
  }
  // The space layout reports above centered glyphs is not slack: the unit does not move.
  expect(baselineUnits({ face: SANS, sizePt: 9, top: 72 + 39, exact: 13, centering: 1.96 })).toBe(
    506
  );
});

// 14pt exact: 46.67 above and 11.67 below both round up, one more than the 58-unit box, and
// the fractions are equal. The descent loses the unit. 16pt exact: 53.33 and 13.33 both round
// down, one less than the 67-unit box, and the spare unit goes above the baseline.
test('an exact pitch with equal fractions takes the unit from the descent', () => {
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 72, exact: 14 })).toBe(300 + 47);
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 72, exact: 16 })).toBe(300 + 54);
});

// Paragraph spacing joins the frame of an `exact` line as it does for any other line.
test('an exact pitch counts paragraph spacing as slack', () => {
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 72, exact: 14.5 })).toBe(348);
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 86.5, exact: 14.5, after: 6 })).toBe(408);
  expect(
    baselineUnits({ face: SANS, sizePt: 12, top: 158, exact: 14.5, before: 4, after: 6 })
  ).toBe(707);
});

// Slack above from both sources: a 15pt `atLeast` line under 4pt of before-spacing. The frame
// starts at the paragraph top and the rounded descent stands on its bottom.
test('before-spacing and growth above share one frame', () => {
  expect(baselineUnits({ face: WIDE, sizePt: 10, top: 220, atLeast: 15, before: 4 })).toBe(968);
});

// Paragraph spacing counts only where it sits beside the line. A fragment that continues a
// paragraph holds no before-space; a fragment that a later page continues holds no
// after-space; a middle line holds neither.
test('paragraph spacing counts only on the line it touches', () => {
  const plain = baselineUnits({ face: SANS, sizePt: 12, top: 85.8 });
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 85.8, before: 6, continues: true })).toBe(
    plain
  );
  expect(
    baselineUnits({ face: SANS, sizePt: 12, top: 85.8, before: 6, after: 10, position: 'middle' })
  ).toBe(plain);
  expect(baselineUnits({ face: SANS, sizePt: 12, top: 85.8, before: 6, position: 'last' })).toBe(
    plain
  );
  const multiple = { face: SANS, sizePt: 9.5, top: 72, multiple: 1.15 } as const;
  expect(baselineUnits({ ...multiple, after: 10, paragraphEnd: false })).toBe(300 + 37);
  expect(baselineUnits({ ...multiple, after: 10, position: 'first' })).toBe(300 + 37);
  expect(baselineUnits({ ...multiple, after: 10, position: 'last' })).toBe(300 + 38);
});

// A shifted run sits a whole number of units from the baseline of its line. 3pt is 12.5
// units, and the half rounds toward the page top: 13 units up, wherever the line falls.
test('a raised run moves a whole number of units from its line', () => {
  expect(shiftedBaselinePt(416, 3) / GRID).toBeCloseTo(403, 9);
  expect(shiftedBaselinePt(417, 3) / GRID).toBeCloseTo(404, 9);
  expect(shiftedBaselinePt(416, 0) / GRID).toBeCloseTo(416, 9);
  expect(shiftedBaselinePt(416, -2.4) / GRID).toBeCloseTo(426, 9);
});

// The face matters only where the box is that face's own single-spaced box. An `exact` line
// with a face whose own split is near the 80/20 of the pitch still takes the pitch shares.
test('an exact pitch does not take its descent from the face', () => {
  const quarter: Face = { ascent: 1638, descent: -410, lineGap: 0 };
  expect(baselineUnits({ face: quarter, sizePt: 14, top: 72, exact: 14 })).toBe(300 + 47);
});

// A line that takes its box from a taller face gets the same unit from every face on it,
// here a 12pt sans box painted with the serif and the wide face.
test('a face that does not own the box does not move the baseline', () => {
  const ascent = ((SANS.ascent + SANS.lineGap) / EM) * 12;
  const height = ascent + (-SANS.descent / EM) * 12;
  const line = {
    box: { x: 0, y: 72, width: 400, height },
    baseline: ascent,
    leading: 0,
    trailingSpacing: 0,
  } as unknown as Line;
  const paragraph = {
    box: { x: 0, y: 72, width: 400, height },
    lines: [line],
    paragraphEnd: true,
    spacing: { before: 0, after: 0 },
  } as unknown as Paragraph;
  for (const face of [SANS, SERIF, WIDE])
    expect(paintedBaselineUnits(72, line, { font: face } as never, paragraph)).toBe(300 + 47);
});

// A line with nothing under its baseline keeps the authored offset: the rounded top plus the
// rounded baseline offset, under the bottom clamp.
test('a line with no room under the baseline keeps its authored offset', () => {
  const line = {
    box: { x: 0, y: 72, width: 400, height: 10 },
    baseline: 10,
    leading: 0,
    trailingSpacing: 0,
  } as unknown as Line;
  const paragraph = {
    box: { x: 0, y: 72, width: 400, height: 10 },
    lines: [line],
    paragraphEnd: true,
    spacing: { before: 0, after: 0 },
  } as unknown as Paragraph;
  expect(paintedBaselineUnits(72, line, { font: SANS } as never, paragraph)).toBe(300 + 42);
});

const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"' +
  ' w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

const stylesOf = (family: string, halfPoints: number): string =>
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/>` +
  `<w:sz w:val="${halfPoints}"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;

/** The marked text items (`L0`, `R2`, ...) of one page with the unit each is painted on. */
async function itemsOf(
  input: Uint8Array,
  pageNumber = 1
): Promise<{ text: string; units: number }[]> {
  const result = await exportPdf(input, { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const height = page.view[3]!;
    const content = await page.getTextContent();
    return content.items
      .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
      .filter((item) => /^[A-Z]\d$/.test(item.str.trim()))
      .map((item) => ({
        text: item.str.trim(),
        units: Math.round(Number((height - item.transform[5]!).toFixed(4)) / GRID),
      }))
      .sort((a, b) => a.units - b.units || a.text.localeCompare(b.text));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const paintedItems = (
  body: string,
  family: string,
  halfPoints: number
): Promise<{ text: string; units: number }[]> =>
  itemsOf(docx(`${body}${SECTION}`, { 'word/styles.xml': stylesOf(family, halfPoints) }));

async function baselines(body: string, family: string, halfPoints: number): Promise<number[]> {
  return (await paintedItems(body, family, halfPoints)).map((item) => item.units);
}

const SINGLE = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
const lines = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) => `<w:r>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">L${i}</w:t></w:r>`
  ).join('');

// End to end, on the faces the package ships. Five single-spaced 12pt lines from a 72pt
// margin: the first baseline is 47 units under the margin, and the lines advance 57.495.
test('single-spaced 12pt sans lines paint on the measured units', async () => {
  const body = `<w:p><w:pPr>${SINGLE}</w:pPr>${lines(5)}</w:p>`;
  const tops = await baselines(body, 'Liberation Sans', 24);
  expect(tops).toEqual([347, 404, 462, 519, 577]);
});

// Control: the serif face at the same size has the same line box and stays on 46 units.
test('single-spaced 12pt serif lines keep their units', async () => {
  const body = `<w:p><w:pPr>${SINGLE}</w:pPr>${lines(5)}</w:p>`;
  const tops = await baselines(body, 'Liberation Serif', 24);
  expect(tops).toEqual([346, 403, 461, 518, 576]);
});

// Control: a 1.15 multiple at 12pt sans paints where it did, on the rounded ascent.
test('a 1.15 multiple keeps the rounded ascent', async () => {
  const body =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/></w:pPr>' +
    `${lines(3)}</w:p>`;
  const tops = await baselines(body, 'Liberation Sans', 24);
  expect(tops).toEqual([347, 413, 479]);
});

// Two faces on one line share one baseline. 10.5pt sans and serif runs side by side: the line
// takes its ascent from the sans face and its descent from the serif face.
test('two faces on one line paint on one baseline', async () => {
  const serif = '<w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/>';
  const runs = [0, 1, 2, 3]
    .map(
      (i) =>
        `<w:r>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">L${i} </w:t></w:r>` +
        `<w:r><w:rPr>${serif}</w:rPr><w:t>R${i}</w:t></w:r>`
    )
    .join('');
  const items = await paintedItems(
    `<w:p><w:pPr>${SINGLE}</w:pPr>${runs}</w:p>`,
    'Liberation Sans',
    21
  );
  const units = (prefix: string): number[] =>
    items.filter((item) => item.text.startsWith(prefix)).map((item) => item.units);
  expect(units('L')).toEqual([342, 392, 443, 493]);
  expect(units('R')).toEqual([342, 392, 443, 493]);
});

// A run raised 3pt (`w:position`, CT_SignedHpsMeasure, ECMA-376 §17.3.2.24) paints 13 units above the baseline of
// its line. The line grows to hold the raised and the lowered run.
test('a raised run paints a whole number of units above its line', async () => {
  const shifted = (text: string, halfPoints: number): string =>
    `<w:r><w:rPr><w:position w:val="${halfPoints}"/></w:rPr><w:t>${text}</w:t></w:r>`;
  const body =
    `<w:p><w:pPr>${SINGLE}</w:pPr>` +
    '<w:r><w:t xml:space="preserve">L0</w:t></w:r>' +
    '<w:r><w:br/><w:t xml:space="preserve">L1 </w:t></w:r>' +
    shifted('U1', 6) +
    '<w:r><w:t xml:space="preserve"> mid </w:t></w:r>' +
    shifted('D1', -5) +
    '</w:p>';
  const items = await paintedItems(body, 'Liberation Sans', 24);
  const unit = (text: string): number | undefined =>
    items.find((item) => item.text === text)?.units;
  expect(unit('L0')).toBe(347);
  expect(unit('L1')).toBe(416);
  expect(unit('U1')).toBe(403);
});

const paragraphOf = (spacing: string, text: string, count = 1): string =>
  `<w:p><w:pPr><w:spacing ${spacing}/></w:pPr>${lines(count).replaceAll('>L', `>${text}`)}</w:p>`;

// The same rules end to end, on real layout records.
test('exact, minimum, and spaced lines paint on the measured units', async () => {
  const exact = paragraphOf('w:before="0" w:after="0" w:line="260" w:lineRule="exact"', 'L', 6);
  expect(await baselines(exact, 'Liberation Sans', 24)).toEqual([343, 397, 451, 506, 560, 614]);
  const atLeast = paragraphOf('w:before="0" w:after="0" w:line="300" w:lineRule="atLeast"', 'L', 5);
  expect(await baselines(atLeast, 'Liberation Sans', 24)).toEqual([352, 414, 477, 539, 602]);
  // 6pt before the second paragraph: its line stands on its bottom, 46 units under its top.
  const before =
    paragraphOf('w:before="0" w:after="0" w:line="240" w:lineRule="auto"', 'A') +
    paragraphOf('w:before="120" w:after="0" w:line="240" w:lineRule="auto"', 'B');
  expect(await baselines(before, 'Liberation Sans', 24)).toEqual([347, 428]);
  // 10pt after a 9.5pt line at 1.15: the frame leaves the ascent one more unit.
  const after = paragraphOf('w:before="0" w:after="200" w:line="276" w:lineRule="auto"', 'L');
  expect(await baselines(after, 'Liberation Sans', 19)).toEqual([338]);
});

// A header line is one record painted on every page. Each page paints it on the same unit:
// 36pt from the page top is 150 units, and 12pt sans sits 47 units under its line top.
test('a repeated header line paints on one unit on every page', async () => {
  const header =
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:p><w:pPr>${SINGLE}</w:pPr><w:r><w:t>H1</w:t></w:r></w:p></w:hdr>`;
  const section = SECTION.replace(
    '<w:sectPr>',
    '<w:sectPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:headerReference w:type="default" r:id="rIdHeader"/>'
  );
  const body =
    `<w:p><w:pPr>${SINGLE}</w:pPr><w:r><w:t>L0</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pageBreakBefore/>${SINGLE}</w:pPr><w:r><w:t>L1</w:t></w:r></w:p>`;
  const input = docx(`${body}${section}`, {
    'word/styles.xml': stylesOf('Liberation Sans', 24),
    'word/header1.xml': header,
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdHeader" Target="header1.xml"' +
      ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"/>' +
      '</Relationships>',
  });
  for (const pageNumber of [1, 2]) {
    const items = await itemsOf(input, pageNumber);
    expect(items.find((item) => item.text === 'H1')?.units).toBe(150 + 47);
  }
});
