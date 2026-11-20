import { expect, test } from 'bun:test';
import { readOoxmlPart, type FieldResultsMode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  layoutSemanticDocument,
  paragraphFragmentsOf,
} from '../index.ts';

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
const fieldLink = (inner: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> HYPERLINK \\l "_TocA" </w:instrText>' +
  `<w:fldChar w:fldCharType="separate"/></w:r>${inner}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const ROWS = [
  `<w:hyperlink w:anchor="_TocA">${run('Element')}</w:hyperlink>`,
  fieldLink(run('Field')),
  `<w:fldSimple w:instr=" HYPERLINK \\l &quot;_TocA&quot; ">${run('Simple')}</w:fldSimple>`,
  run('Plain'),
  `<w:hyperlink w:anchor="_TocA">${run('Named', 'Hyperlink')}</w:hyperlink>`,
  `${run('Before')}<w:hyperlink w:anchor="_TocA">${run('Inside')}</w:hyperlink>${run('After')}`,
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
      // An atomic `w:fldSimple` reads its style one offset past its unit, so only the editable
      // mode covers it here.
      const linked = [
        'Element',
        'Field',
        'Inside',
        ...(fieldResults === 'editable' ? ['Simple'] : []),
      ];
      for (const text of linked) {
        expect({ text, ...style(text) }).toMatchObject({ text, ...DROPPED });
      }
      // Text outside a link, a differently named style, and links outside the TOC keep it.
      for (const text of ['Plain', 'Named', 'Before', 'After', 'Outside']) {
        expect(style(text)).toMatchObject(KEPT);
      }
    });
  }
}
