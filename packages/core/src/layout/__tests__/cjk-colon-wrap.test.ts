import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { compressCjkPieces } from '../cjk-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { createLayoutSession } from '../layout-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const policy = {
  ...DEFAULT_CJK_TYPOGRAPHY,
  settings: { compression: 'compressPunctuation' as const, strict: false, before: {}, after: {} },
};
// Hiragino Mincho ProN W3 gives these characters 1000-unit advances. Its colon ink
// reaches 570 units, so retaining a half-em colon at a line edge crosses the margin.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    text.length *
    ((style.fontSizePt * style.horizontalScalePercent) / 100 + style.characterSpacingPt),
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};
function part(xml: string) {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
const doc = part(
  `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Hiragino Mincho ProN" w:eastAsia="Hiragino Mincho ProN"/><w:sz w:val="24"/></w:rPr><w:t>甲甲甲甲：【乙丙丁</w:t></w:r></w:p></w:body></w:document>`
);
const settings = part(
  `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
);
const cascade = buildStyleCascadeTable(null, undefined, settings.root);
function layout(width: number, session = createLayoutSession(), enabled = true) {
  return layoutSemanticDocument(doc, 0, {
    measurer,
    session,
    styleCascade: enabled ? cascade : buildStyleCascadeTable(null),
    geometry: {
      width: width + 20,
      height: 500,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
}

test.each([30, 42, 54, 66, 78])('compressed colon ink stays within a %s pt line', (width) => {
  const result = layout(width);
  for (const line of linesOf(result))
    for (const [index, span] of line.spans.entries()) {
      if (!span.text.includes('：')) continue;
      const at = span.text.indexOf('：');
      const inkEnd = span.box.x + measurer.measure(span.text.slice(0, at), span.style) + 12 * 0.57;
      expect(inkEnd).toBeLessThanOrEqual(width);
      if (span.glyphOffsetPt === 0) expect(line.spans[index + 1]?.text.startsWith('【')).toBe(true);
    }
});

test('a separated colon retries with natural advances and remains stable in the layout cache', () => {
  const session = createLayoutSession();
  const textLines = (width: number, enabled = true) =>
    linesOf(layout(width, session, enabled)).map((line) =>
      line.spans.map((span) => span.text).join('')
    );
  const natural = textLines(54, false);
  expect(natural).toEqual(['甲甲甲', '甲：【乙', '丙丁']);
  expect(textLines(54)).toEqual(natural);
  expect(textLines(54)).toEqual(natural);
  expect(textLines(78)).toEqual(['甲甲甲甲：【乙', '丙丁']);
  expect(textLines(54)).toEqual(natural);
});

test('a centered colon retains the complete band for highlight and shading', () => {
  for (const decoration of [{ shading: '000000' }, { highlight: 'yellow' as const }]) {
    const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 12, color: 'FFFFFF', ...decoration };
    const pieces = [
      { text: '：', start: 0, end: 1, props: [], style },
      {
        text: '【甲',
        start: 1,
        end: 3,
        props: [],
        style: { ...DEFAULT_RUN_STYLE, fontSizePt: 12 },
      },
    ];
    const compressed = compressCjkPieces(pieces, policy, measurer);
    expect(compressed[0]).toBe(pieces[0]);
    expect(measurer.measure(compressed[0]!.text, compressed[0]!.style)).toBe(12);
  }
});
