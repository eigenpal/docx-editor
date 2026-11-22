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

const noSettings = read('settings', `<w:settings xmlns:w="${W}"/>`);
const lineLayout = (body: string) => {
  const doc = read('document', `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  const source = serializeOoxmlPart(doc);
  const layout = layoutSemanticDocument(doc, 0, {
    measurer,
    styleCascade: buildStyleCascadeTable(styles.root, undefined, noSettings.root),
  });
  expect(serializeOoxmlPart(doc)).toEqual(source);
  return linesOf(layout);
};
const lastRight = (body: string) => {
  const spans = lineLayout(body)[0]!.spans;
  const last = spans.at(-1)!;
  return { text: spans.map((span) => span.text).join(''), right: last.box.x + last.box.width };
};
const field = (instruction: string, ...result: string[]) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  result.join('') +
  end;
const T = '中文ABC中文123中文';

for (const [name, body] of [
  ['MERGEFIELD', field('MERGEFIELD Name', run(T))],
  ['QUOTE', field('QUOTE "x"', run(T))],
  ['REF without a link switch', field('REF target', run(T))],
  [
    'nested field result',
    field('HYPERLINK \\l "x"', run('中文'), field('QUOTE "ABC"', run('ABC')), run('中文123中文')),
  ],
  [
    'simple HYPERLINK',
    `<w:fldSimple w:instr=" HYPERLINK \\l &quot;x&quot; ">${run(T)}</w:fldSimple>`,
  ],
  ['simple MERGEFIELD', `<w:fldSimple w:instr=" MERGEFIELD Name ">${run(T)}</w:fldSimple>`],
  [
    'field result between literal text',
    run('中文') + field('MERGEFIELD Name', run('ABC')) + run('中文123中文'),
  ],
  [
    'legacy text input',
    '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/><w:enabled/><w:textInput/></w:ffData></w:fldChar></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      run(T) +
      end,
  ],
] as const) {
  test(`every field result takes automatic spacing like literal text (${name})`, () => {
    const literal = lastRight(`<w:p>${run(T)}</w:p>`);
    const result = lastRight(`<w:p>${body}</w:p>`);
    expect(result.text).toBe(literal.text);
    expect(result.right).toBeCloseTo(literal.right, 6);
    const off = lastRight(
      `<w:p><w:pPr><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr>${body}</w:p>`
    );
    expect(off.right).toBeLessThan(literal.right - 1);
  });
}

test('a page number takes automatic spacing from the text around it', () => {
  const literal = lastRight(`<w:p>${run('中文1中文')}</w:p>`);
  const page = lastRight(`<w:p>${run('中文')}${field('PAGE', run('1'))}${run('中文')}</w:p>`);
  expect(page.text).toBe(literal.text);
  expect(page.right).toBeCloseTo(literal.right, 6);
});

test('a field result that continues into the next paragraph takes automatic spacing', () => {
  for (const instruction of ['HYPERLINK \\l "x"', 'MERGEFIELD Name']) {
    const literal = lineLayout(`<w:p>${run('中文ABC中文')}</w:p>`)[0]!.spans;
    const lines = lineLayout(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('中文ABC中文')}</w:p><w:p>${run('123中文')}${end}</w:p>`
    );
    const spans = lines[0]!.spans;
    const right = (all: typeof spans) => all.at(-1)!.box.x + all.at(-1)!.box.width;
    expect(right(spans)).toBeCloseTo(right(literal), 6);
    // Its slices keep their own model offsets.
    expect(spans.map((span) => [span.range.start, span.range.end])).toEqual(
      literal.map((span) => [span.range.start, span.range.end])
    );
  }
});

test('an auto-fit cell prices the spacing inside a field result, so the result does not wrap', () => {
  const table = (content: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>' +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${content}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${run('X')}</w:p></w:tc></w:tr></w:tbl><w:p/>`;
  const cell = (content: string) => {
    const lines = lineLayout(table(content));
    const first = lines.filter((line) => line.spans.some((span) => /[中AB1]/.test(span.text)));
    return {
      lines: first.length,
      width: first[0]!.spans.at(-1)!.box.x + first[0]!.spans.at(-1)!.box.width,
    };
  };
  const literal = cell(run(T));
  const hyperlink = cell(field('HYPERLINK \\l "x"', run(T)));
  expect(literal.lines).toBe(1);
  expect(hyperlink.lines).toBe(1);
  expect(hyperlink.width).toBeCloseTo(literal.width, 6);
});

test('an editable saved result takes automatic spacing at its own offsets', () => {
  const doc = read(
    'document',
    `<w:document xmlns:w="${W}"><w:body><w:p>${field('MERGEFIELD Name', run(T))}</w:p><w:p>${run(T)}</w:p></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(doc, 0, {
    measurer,
    fieldResults: 'editable',
    styleCascade: buildStyleCascadeTable(styles.root, undefined, noSettings.root),
  });
  const [result, literal] = linesOf(layout);
  const geometry = (line: typeof result) =>
    line!.spans.map((span) => [span.text, span.range.start, span.range.end, span.box.x]);
  expect(geometry(result)).toEqual(geometry(literal));
});

test('an auto-fit cell prices no gap inside a page number, which line layout keeps whole', () => {
  const lines = lineLayout(
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${field('PAGE \\# "甲0乙"', '<w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/></w:rPr><w:t>甲1乙</w:t></w:r>')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${run('X')}</w:p></w:tc></w:tr></w:tbl><w:p/>`
  );
  const page = lines.find((line) => line.spans.some((span) => span.fieldAtom?.pageField))!;
  const x = lines.find((line) => line.spans.some((span) => span.text === 'X'))!;
  const last = page.spans.at(-1)!;
  expect(x.spans[0]!.box.x).toBeCloseTo(last.box.x + last.box.width, 6);
});
