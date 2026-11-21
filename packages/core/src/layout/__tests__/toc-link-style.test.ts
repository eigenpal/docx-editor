import { expect, test } from 'bun:test';
import { readOoxmlPart, type FieldResultsMode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  paragraphFragmentsOf,
  type SemanticLayout,
} from '../index.ts';
import { tocLinkCascader, tocLinkRanges } from '../toc-link-formatting.ts';
import { cascadeRunProperties } from '../style-cascade.ts';
import type { OoxmlProperty } from '../../store/store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LINK_RPR = '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>';

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// A numeric id named Hyperlink is the built-in style. An id spelled Hyperlink with another
// name is an ordinary character style.
const styles = read(
  `<w:styles xmlns:w="${W}">` +
    `<w:style w:type="character" w:styleId="37"><w:name w:val="Hyperlink"/>${LINK_RPR}</w:style>` +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Web link"/>${LINK_RPR}</w:style>` +
    '</w:styles>',
  '/word/styles.xml'
);

const run = (text: string, style = '37') =>
  `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:t>${text}</w:t></w:r>`;
const linkStart =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> HYPERLINK \\l "_TocA" </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r>';
const linkEnd = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const ROWS = [
  `<w:hyperlink w:anchor="_TocA">${run('Element')}</w:hyperlink>`,
  linkStart + run('Field') + linkEnd,
  `<w:fldSimple w:instr=" HYPERLINK \\l &quot;_TocA&quot; ">${run('Simple')}</w:fldSimple>`,
  run('Plain'),
  `<w:hyperlink w:anchor="_TocA">${run('Named', 'Hyperlink')}</w:hyperlink>`,
  `${run('Before')}<w:hyperlink w:anchor="_TocA">${run('Inside')}</w:hyperlink>${run('After')}`,
  // A link field that crosses a paragraph mark.
  linkStart + run('Crossing'),
  run('Continued') + linkEnd + run('Trailing'),
  // A crossing link with a nested field that also crosses: each `end` closes its own field.
  linkStart +
    run('Nested') +
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGEREF _TocA </w:instrText>' +
    '<w:fldChar w:fldCharType="separate"/></w:r>' +
    run('Page'),
  run('Number') + linkEnd + run('Tail') + linkEnd + run('Beyond'),
];

const tocBegin = (switches = ' \\h') =>
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-3"${switches} </w:instrText>` +
  '<w:fldChar w:fldCharType="separate"/></w:r>';
const tocEnd = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function spansOf(switches: string, fieldResults?: FieldResultsMode) {
  const toc =
    `<w:p>${tocBegin(switches)}</w:p>` +
    ROWS.map((row) => `<w:p>${row}</w:p>`).join('') +
    `<w:p>${tocEnd}</w:p>`;
  return stylesOf(toc, fieldResults);
}

function documentOf(toc: string): OoxmlPart {
  const outside = `<w:p><w:hyperlink w:anchor="_TocA">${run('Outside')}</w:hyperlink></w:p>`;
  return read(
    `<w:document xmlns:w="${W}"><w:body>${toc}${outside}</w:body></w:document>`,
    '/word/document.xml'
  );
}

function stylesOf(toc: string, fieldResults?: FieldResultsMode) {
  const layout = layoutSemanticDocument(documentOf(toc), 1, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: buildStyleCascadeTable(styles.root),
    ...(fieldResults ? { fieldResults } : {}),
  });
  return styleLookup(layout);
}

function styleLookup(layout: SemanticLayout) {
  const spans = layout.pages
    .flatMap((page) => paragraphFragmentsOf(page))
    .flatMap((fragment) => fragment.lines)
    .flatMap((line) => line.spans);
  return (text: string) => {
    const span = spans.find((candidate) => candidate.text.includes(text));
    if (!span) throw new Error(`no span for ${text}`);
    return span.style;
  };
}

const KEPT = { color: '0563C1', underline: { variant: 'single' } };
const DROPPED = { color: null, underline: null };

for (const fieldResults of ['atomic', 'editable'] as const) {
  for (const switches of [' \\h', '']) {
    test(`TOC links drop the Hyperlink style by name: mode=${fieldResults}, switches="${switches}"`, () => {
      const style = spansOf(switches, fieldResults);
      for (const text of [
        'Element',
        'Field',
        'Simple',
        'Inside',
        'Crossing',
        'Continued',
        'Nested',
        'Tail',
      ]) {
        expect({ text, ...style(text) }).toMatchObject({ text, ...DROPPED });
      }
      // Text outside a link, a differently named style, and links outside the TOC keep it.
      for (const text of ['Plain', 'Named', 'Before', 'After', 'Trailing', 'Beyond', 'Outside']) {
        expect(style(text)).toMatchObject(KEPT);
      }
    });
  }
}

for (const fieldResults of ['atomic', 'editable'] as const) {
  test(`TOC boundary paragraphs that hold rows drop the style only on links: mode=${fieldResults}`, () => {
    // The first row shares the TOC begin paragraph, and the last row shares the TOC end.
    const toc =
      `<w:p>${tocBegin()}${run('Lead')}${linkStart}${run('First')}${linkEnd}</w:p>` +
      `<w:p>${linkStart}${run('Middle')}${linkEnd}</w:p>` +
      `<w:p>${linkStart}${run('Last')}${linkEnd}${run('Close')}${tocEnd}</w:p>`;
    const style = stylesOf(toc, fieldResults);
    for (const text of ['First', 'Middle', 'Last']) {
      expect({ text, ...style(text) }).toMatchObject({ text, ...DROPPED });
    }
    for (const text of ['Lead', 'Close', 'Outside']) {
      expect({ text, ...style(text) }).toMatchObject({ text, ...KEPT });
    }
  });
}

test('a TOC in one paragraph is one unit, so its plain text drops the style too', () => {
  const toc = `<w:p>${tocBegin()}${run('Lone')}${linkStart}${run('Link')}${linkEnd}${tocEnd}</w:p>`;
  const style = stylesOf(toc, 'editable');
  for (const text of ['Lone', 'Link']) {
    expect({ text, ...style(text) }).toMatchObject({ text, ...DROPPED });
  }
  expect(style('Outside')).toMatchObject(KEPT);
});

test('deep open fields across TOC rows stay bounded and keep later links', () => {
  // Many unclosed fields cross every row; only a few levels keep their instruction.
  const opened = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'.repeat(200);
  const closed = linkEnd.repeat(200);
  const rows = Array.from({ length: 200 }, (_, index) => `<w:p>${run(`Row${index}`)}</w:p>`);
  const toc =
    `<w:p>${tocBegin()}</w:p><w:p>${opened}${run('Open')}</w:p>` +
    rows.join('') +
    `<w:p>${run('Shut')}${closed}${linkStart}${run('Later')}${linkEnd}</w:p><w:p>${tocEnd}</w:p>`;
  const style = stylesOf(toc);
  expect(style('Row150')).toMatchObject(KEPT);
  expect(style('Later')).toMatchObject(DROPPED);
});

test('a renamed Hyperlink style relays out the TOC links with a warm cache', () => {
  const part = documentOf(
    `<w:p>${tocBegin()}</w:p><w:p>${linkStart}${run('Row')}${linkEnd}</w:p><w:p>${tocEnd}</w:p>`
  );
  const renamed = read(
    `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="37">` +
      `<w:name w:val="Plain link"/>${LINK_RPR}</w:style></w:styles>`,
    '/word/styles.xml'
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<never>();
  const lay = (root: OoxmlPart['root'], revision: number) =>
    styleLookup(
      layoutSemanticDocument(part, revision, {
        measurer: createFixedMeasurer(6, 14),
        styleCascade: buildStyleCascadeTable(root),
        cache: cache as never,
        session,
      })
    );
  expect(lay(styles.root, 1)('Row')).toMatchObject(DROPPED);
  expect(lay(renamed.root, 2)('Row')).toMatchObject(KEPT);
  expect(lay(styles.root, 3)('Row')).toMatchObject(DROPPED);
});

test('the Hyperlink id counts first, so earlier decoy styles cannot hide it', () => {
  const decoys = Array.from(
    { length: 6 },
    (_, index) =>
      `<w:style w:type="character" w:styleId="D${index}"><w:name w:val="Hyperlink"/>${LINK_RPR}</w:style>`
  ).join('');
  const table = read(
    `<w:styles xmlns:w="${W}">${decoys}` +
      `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>${LINK_RPR}</w:style>` +
      '</w:styles>',
    '/word/styles.xml'
  );
  const part = documentOf(
    `<w:p>${tocBegin()}</w:p><w:p><w:hyperlink w:anchor="_TocA">${run('Real', 'Hyperlink')}</w:hyperlink></w:p><w:p>${tocEnd}</w:p>`
  );
  const style = styleLookup(
    layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      styleCascade: buildStyleCascadeTable(table.root),
    })
  );
  expect(style('Real')).toMatchObject(DROPPED);
});

test('many styles named Hyperlink stay bounded to the first few', () => {
  const many = read(
    `<w:styles xmlns:w="${W}">` +
      Array.from(
        { length: 50 },
        (_, index) =>
          `<w:style w:type="character" w:styleId="L${index}"><w:name w:val="Hyperlink"/>${LINK_RPR}</w:style>`
      ).join('') +
      '</w:styles>',
    '/word/styles.xml'
  );
  const part = documentOf(
    `<w:p>${tocBegin()}</w:p><w:p><w:hyperlink w:anchor="_TocA">${run('Early', 'L0')}${run('Late', 'L49')}</w:hyperlink></w:p><w:p>${tocEnd}</w:p>`
  );
  const style = styleLookup(
    layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      styleCascade: buildStyleCascadeTable(many.root),
    })
  );
  expect(style('Early')).toMatchObject(DROPPED);
  expect(style('Late')).toMatchObject(KEPT);
});

test('many links in one TOC row join into one searchable range', () => {
  const links = Array.from(
    { length: 20_000 },
    () => `<w:hyperlink w:anchor="_TocA">${run('x')}</w:hyperlink>`
  ).join('');
  const nested = `${linkStart}<w:hyperlink w:anchor="_TocA">${run('Nested')}</w:hyperlink>${linkEnd}`;
  const part = documentOf(
    `<w:p>${tocBegin()}</w:p><w:p>${links}${run('Gap')}${nested}</w:p><w:p>${tocEnd}</w:p>`
  );
  const ranges = [...tocLinkRanges(part, buildStyleCascadeTable(styles.root)).values()];
  // Touching links join. "Gap" is plain text; the link nested in a link field overlaps and
  // joins into the field unit.
  expect(ranges.map((list) => list.map(({ start, end }) => [start, end]))).toEqual([
    [
      [0, 20_000],
      [20_003, 20_004],
    ],
  ]);
});

test('a TOC inside a table cell keeps the Hyperlink style until cell TOC detection exists', () => {
  // TOC detection reads body paragraphs only. Update this test when it enters table cells.
  const cell =
    `<w:p>${tocBegin()}</w:p><w:p>${linkStart}${run('CellRow')}${linkEnd}</w:p>` +
    `<w:p>${tocEnd}</w:p>`;
  const style = stylesOf(
    '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
      `<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl>`
  );
  expect(style('CellRow')).toMatchObject(KEPT);
});

test('any run cascader drops the Hyperlink style ids a TOC range carries', () => {
  const table = buildStyleCascadeTable(styles.root);
  const cascade = (inherited: readonly OoxmlProperty[], direct: readonly OoxmlProperty[]) =>
    cascadeRunProperties(inherited, direct, table);
  const ranges = [{ start: 0, end: 1, styleIds: ['37'] }];
  expect(tocLinkCascader(cascade, [], () => 0)).toBe(cascade);
  const linked = tocLinkCascader(cascade, ranges, () => 0)!;
  const reference = (val: string): OoxmlProperty => ({ localName: 'rStyle', attributes: { val } });
  expect(linked([], [reference('37')])).toEqual(cascade([], []));
  // Another style, and a position outside the range, keep the reference.
  expect(linked([], [reference('Hyperlink')])).toEqual(cascade([], [reference('Hyperlink')]));
  const outside = tocLinkCascader(cascade, ranges, () => 1)!;
  expect(outside([], [reference('37')])).toEqual(cascade([], [reference('37')]));
});
