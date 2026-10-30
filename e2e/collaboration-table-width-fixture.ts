import { strToU8, zipSync } from 'fflate';

/** Anonymous AutoFit table with merged repeated headers and a page-count footer. */
export function collaborationTableWidthFixture(numericCells = false): Buffer {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const paragraph = (text: string) =>
    '<w:p><w:pPr><w:widowControl w:val="0"/>' +
    (numericCells && /^[0-9]+$/.test(text) ? '<w:ind w:left="-15"/>' : '') +
    '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>' +
    `</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (text: string, props = '') =>
    `<w:tc><w:tcPr>${props}</w:tcPr>${paragraph(text)}</w:tc>`;
  const headers =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    cell('Header', '<w:vMerge w:val="restart"/>') +
    cell('A') +
    cell('B') +
    '</w:tr>' +
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    cell('', '<w:vMerge/>') +
    cell('C') +
    cell('D') +
    '</w:tr>';
  const rows = Array.from(
    { length: 80 },
    (_, row) =>
      `<w:tr>${[0, 1, 2]
        .map((column) =>
          cell(
            numericCells && column === 2
              ? '123456789012345678901234567890123456789012345678'
              : `Row${row}Cell${column}`
          )
        )
        .join('')}</w:tr>`
  ).join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${rel}"><Relationship Id="doc" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${rel}"><Relationship Id="footer" Type="${r}/footer" Target="footer1.xml"/></Relationships>`
      ),
      'word/footer1.xml': strToU8(
        `<w:ftr xmlns:w="${w}"><w:p><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body>` +
          `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders>` +
          '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/>' +
          '<w:left w:w="60" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
          `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${headers}${rows}</w:tbl>` +
          '<w:sectPr><w:footerReference w:type="default" r:id="footer"/>' +
          '<w:pgSz w:w="8200" w:h="6000"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:footer="400"/>' +
          '</w:sectPr></w:body></w:document>'
      ),
    })
  );
}
