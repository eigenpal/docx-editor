// A two-row vertical merge whose page break falls right after its head row. In compatibility
// mode 15 the merged text is painted beside the continuation row on the next page, but it is
// still the head cell's text, so Markdown keeps it in the head row.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { exportMarkdown } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" ` +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

// Exact 12pt lines and 6pt before each cell paragraph, on a 210pt content box.
const paragraph = (lines: readonly string[], before = 120) =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>` +
  lines
    .map((text, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t>${text}</w:t></w:r>`)
    .join('') +
  '</w:p>';
const cell = (width: number, content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const trPr = '<w:trPr><w:trHeight w:val="560"/></w:trPr>';
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';

const body =
  Array.from({ length: 14 }, (_, index) => paragraph([`F${index + 1}`], 0)).join('') +
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1300"/><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr>${trPr}${cell(1300, paragraph(['HEADA']))}${cell(1500, paragraph(['ROWA']))}` +
  `${cell(3000, paragraph(['M1', 'M2', 'M3', 'M4', 'M5']), RESTART)}</w:tr>` +
  `<w:tr>${trPr}${cell(1300, paragraph(['CELLB']))}${cell(1500, paragraph(['ROWB']))}` +
  `${cell(3000, paragraph([]), CONTINUE)}</w:tr></w:tbl>` +
  paragraph(['TAIL'], 0) +
  '<w:sectPr><w:pgSz w:w="7000" w:h="5000"/>' +
  '<w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="0" w:footer="0"/></w:sectPr>';

const tableRows = (markdown: string) => markdown.split('\n').filter((line) => line.startsWith('|'));

test('merged text painted beside the continuation row stays in its head row', async () => {
  const result = await exportMarkdown(docx(body));
  // The merged text is painted on the second page, beside the second row's own cells.
  expect(result.pages[0]?.markdown).toContain('ROWA');
  expect(result.pages[0]?.markdown).not.toContain('M1');
  expect(result.pages[1]?.markdown).toContain('M1');

  const rows = tableRows(result.markdown);
  const headRow = rows.find((row) => row.includes('ROWA'));
  const nextRow = rows.find((row) => row.includes('ROWB'));
  expect(headRow).toContain('M1');
  expect(headRow).toContain('M5');
  expect(nextRow).not.toContain('M1');
});
