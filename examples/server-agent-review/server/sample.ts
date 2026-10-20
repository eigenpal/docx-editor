import { strToU8, zipSync } from 'fflate';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const paragraph = (text: string, style = 'Normal') =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
export function sampleDocument(): Uint8Array {
  const content = [
    paragraph('NORTHSTAR  /  STUDIO AGREEMENTS', 'Subtitle'),
    paragraph('A better working agreement.', 'Title'),
    paragraph('Services agreement  ·  Draft for collaborative review', 'Subtitle'),
    paragraph(
      'This agreement is between Northstar Studio (the Supplier) and Cedar & Co. (the Client). It describes how we will work together on the Client’s new identity and website.'
    ),
    paragraph('01  Scope of work', 'Heading1'),
    paragraph(
      'The Supplier will deliver a visual identity, a five-page website, and a handover guide. The Client will provide content and feedback within five business days.'
    ),
    paragraph('02  Fees and payment', 'Heading1'),
    paragraph(
      'The total project fee is $24,000. Invoices are payable within 7 days. The Supplier may change the fees at any time without notice.'
    ),
    paragraph('03  Timing and changes', 'Heading1'),
    paragraph(
      'Work begins on October 1 and is expected to finish within eight weeks. Any additional work will be agreed in writing before it begins.'
    ),
    paragraph('04  Ending the agreement', 'Heading1'),
    paragraph(
      'The Supplier may terminate immediately. The Client must pay all remaining fees even if the services have not been delivered.'
    ),
    paragraph('05  Ownership and confidentiality', 'Heading1'),
    paragraph(
      'Upon full payment, the Client owns the final deliverables. Both parties will keep confidential information private during the project.'
    ),
    paragraph('REVIEW NOTE', 'Heading1'),
    paragraph(
      'This fictional draft contains deliberately one-sided terms. Invite a colleague and ask the review agent to make it clearer and more balanced.',
      'Subtitle'
    ),
  ].join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1200" w:bottom="1080" w:left="1200"/></w:sectPr></w:body></w:document>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="26332F"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="180" w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="52"/><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="19"/><w:color w:val="6C7872"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="260" w:after="120"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style></w:styles>`
    ),
  });
}
