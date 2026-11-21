import { expect, test } from 'bun:test';
import { readOoxmlPart, type FieldResultsMode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  layoutSemanticDocument,
  paragraphFragmentsOf,
} from '../index.ts';
import { tocAwareRunCascader, tocLinkCascader } from '../toc-link-formatting.ts';

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

function spansOf(switches: string, fieldResults?: FieldResultsMode) {
  const toc =
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-3"${switches} </w:instrText>` +
    '<w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
    ROWS.map((row) => `<w:p>${row}</w:p>`).join('') +
    '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const outside = `<w:p><w:hyperlink w:anchor="_TocA">${run('Outside')}</w:hyperlink></w:p>`;
  const part = read(
    `<w:document xmlns:w="${W}"><w:body>${toc}${outside}</w:body></w:document>`,
    '/word/document.xml'
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: buildStyleCascadeTable(styles.root),
    ...(fieldResults ? { fieldResults } : {}),
  });
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

test('TOC link ranges refuse a cascader that cannot resolve the Hyperlink style', () => {
  const ranges = [{ start: 0, end: 1 }];
  const plain = (inherited: readonly never[]) => inherited;
  expect(() => tocLinkCascader(plain, ranges, () => 0)).toThrow(/tocAwareRunCascader/);
  // Without ranges, any cascader passes through unchanged.
  expect(tocLinkCascader(plain, [], () => 0)).toBe(plain);
  const aware = tocAwareRunCascader(buildStyleCascadeTable(styles.root))!;
  const linked = tocLinkCascader(aware, ranges, () => 0)!;
  const reference = { localName: 'rStyle', attributes: { val: '37' } };
  expect(linked([], [reference] as never)).toEqual(aware([], []));
});
