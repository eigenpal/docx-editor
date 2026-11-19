import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { withAuthoredCjkGapMetric } from '../cjk-auto-spacing-metric-port.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const read = (name: string, xml: string) => {
  const result = readOoxmlPart(xml, {
    name: '/word/' + name + '.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};
const measurer = withAuthoredCjkGapMetric(
  {
    measure: (text, style) =>
      [...text].reduce(
        (width, char) =>
          width +
          (' .'.includes(char) ? 3.5 : /\p{Script=Han}/u.test(char) ? 14 : 7) +
          style.characterSpacingPt,
        0
      ),
    lineMetrics: () => ({ height: 16, baseline: 12 }),
  },
  (style) => style.fontSizePt / 4
);
const run = (text: string) =>
  '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="28"/>' +
  `</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> HYPERLINK \\l "Heading" </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const styles = read(
  'styles',
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="SimSun"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
);

for (const balanced of [false, true]) {
  for (const [prefix, flags, split] of [
    ['3.2', '', false],
    ['3.2 ', '', false],
    ['3.2  ', '', true],
    ['AB', '', false],
    ['3.2', '<w:autoSpaceDN w:val="0"/>', false],
    ['AB', '<w:autoSpaceDE w:val="0"/>', false],
    ['3.2&#160;', '', false],
  ] as const) {
    test(`closed hyperlink uses the same CJK spacing as literal text (${balanced}, ${prefix.length}, ${split}, ${flags})`, () => {
      const settings = read(
        'settings',
        `<w:settings xmlns:w="${W}"><w:compat>${balanced ? '<w:balanceSingleByteDoubleByteWidth/>' : ''}</w:compat></w:settings>`
      );
      const content = split ? run(prefix) + run('甲乙') : run(prefix + '甲乙');
      const compare = (body: string) => {
        const doc = read(
          'document',
          `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${flags}</w:pPr>${body}</w:p></w:body></w:document>`
        );
        const source = serializeOoxmlPart(doc);
        const layout = layoutSemanticDocument(doc, 0, {
          measurer,
          styleCascade: buildStyleCascadeTable(styles.root, undefined, settings.root),
        });
        expect(serializeOoxmlPart(doc)).toEqual(source);
        const spans = linesOf(layout)[0]!.spans;
        const heading = spans.find((span) => span.text.includes('甲'))!;
        const offset = heading.text.indexOf('甲');
        return {
          text: spans.map((span) => span.text).join(''),
          x: heading.box.x + measurer.measure(heading.text.slice(0, offset), heading.style),
          ranges: spans.map((span) => [span.range.start, span.range.end]),
        };
      };
      const literal = compare(content);
      const field = compare(begin + content + end);
      expect(field.text).toBe(literal.text);
      expect(field.ranges.every(([start, end]) => start === 0 && end === 1)).toBe(true);
      expect(field.x).toBeCloseTo(literal.x, 6);
    });
  }
}

test('the first TOC entry beside the field opening keeps balanced text spacing', () => {
  const openToc =
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-2" \\h </w:instrText>' +
    '<w:fldChar w:fldCharType="separate"/></w:r>';
  const settings = read(
    'settings',
    `<w:settings xmlns:w="${W}"><w:compat><w:balanceSingleByteDoubleByteWidth/></w:compat></w:settings>`
  );
  const content = run('1 甲乙');
  const literal = `<w:p>${content}</w:p>`;
  const toc = `<w:p>${openToc}${begin}${content}${end}</w:p><w:p>${end}</w:p>`;
  const compare = (body: string) => {
    const doc = read(
      'document',
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    );
    const original = serializeOoxmlPart(doc);
    const result = layoutSemanticDocument(doc, 0, {
      measurer: {
        ...measurer,
        faceCovers: (text, style) => !/\p{Script=Han}/u.test(text) || style.fontFamily === 'SimSun',
      },
      styleCascade: buildStyleCascadeTable(styles.root, undefined, settings.root),
    });
    const spans = linesOf(result)[0]!.spans;
    expect(serializeOoxmlPart(doc)).toEqual(original);
    expect(spans.map((span) => span.text).join('')).toBe('1 甲乙');
    return spans.find((span) => span.text.startsWith('甲'))!.box.x;
  };
  expect(compare(toc)).toBeCloseTo(compare(literal), 6);
});
