import { strToU8, zipSync } from 'fflate';

// A fixed sample agreement. Each referenced paragraph carries a w14:paraId, which is the
// stable address that a review tool or server stores with its finding.
export const PARA_IDS = {
  payment: '1A2B0001',
  fee: '1A2B0002',
  liability: '1A2B0003',
  law: '1A2B0004',
  header: '1A2B0005',
  // No paragraph in the sample has this ID. It shows the unavailable result.
  missing: '1A2B00FF',
} as const;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006';
const R = `${OFFICE}/relationships`;
const NS = `xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}"`;

function paragraph(text: string, options: { paraId?: string; bold?: boolean } = {}) {
  const id = options.paraId ? ` w14:paraId="${options.paraId}"` : '';
  const bold = options.bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p${id}><w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:r>${bold}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function filler(section: number, title: string) {
  return [
    paragraph(`${section}. ${title}`, { bold: true }),
    paragraph(
      'Each party performs its obligations with reasonable care and skill. ' +
        'Each party keeps records that show how it meets this section.'
    ),
    paragraph(
      'A party gives written notice of any issue under this section. ' +
        'The other party responds within ten business days.'
    ),
  ].join('');
}

function feeTable() {
  const cell = (text: string, paraId?: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${paragraph(text, { paraId })}</w:tc>`;
  const border = '<w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>';
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>
      <w:tblBorders>${border}<w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>
    <w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>
    <w:tr>${cell('Implementation fee')}${cell('USD 8,000, paid once')}</w:tr>
    <w:tr>${cell('Annual support fee')}${cell('USD 12,000 per year', PARA_IDS.fee)}</w:tr>
    </w:tbl>`;
}

function body() {
  return [
    paragraph('Master services agreement', { bold: true }),
    filler(1, 'Definitions'),
    filler(2, 'Services'),
    filler(3, 'Service levels'),
    paragraph('4. Payment terms', { bold: true }),
    paragraph('The Customer pays each undisputed invoice within 30 days of receipt.', {
      paraId: PARA_IDS.payment,
    }),
    paragraph('The Supplier invoices these fees:'),
    feeTable(),
    filler(5, 'Customer responsibilities'),
    filler(6, 'Intellectual property'),
    filler(7, 'Confidentiality'),
    filler(8, 'Data protection'),
    paragraph('9. Liability', { bold: true }),
    paragraph(
      'The Supplier is liable for direct loss up to the fees paid in the prior year. ' +
        'The Supplier is not liable for indirect or consequential loss.',
      { paraId: PARA_IDS.liability }
    ),
    filler(10, 'Insurance'),
    filler(11, 'Term and termination'),
    filler(12, 'Subcontracting'),
    filler(13, 'Notices'),
    paragraph('14. Governing law', { bold: true }),
    paragraph('The laws of the State of New York govern this agreement.', {
      paraId: PARA_IDS.law,
    }),
  ].join('');
}

/** Build the sample DOCX in the browser. The example needs no server. */
export function sampleDocument(): Uint8Array {
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  return zipSync({
    '[Content_Types].xml': strToU8(`<Types
      xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels"
        ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>
      <Override PartName="/word/header1.xml" ContentType="${main}.header+xml"/>
      </Types>`),
    '_rels/.rels': strToU8(`<Relationships
      xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="word/document.xml"
        Type="${R}/officeDocument"/>
      </Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<Relationships
      xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="header1.xml"
        Type="${R}/header"/>
      </Relationships>`),
    'word/header1.xml': strToU8(
      `<w:hdr ${NS}>${paragraph('Draft for review. Not for signature.', {
        paraId: PARA_IDS.header,
      })}</w:hdr>`
    ),
    'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body()}
      <w:sectPr><w:headerReference w:type="default" r:id="rId1"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"
        w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`),
  });
}
