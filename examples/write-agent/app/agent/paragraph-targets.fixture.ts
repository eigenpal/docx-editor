import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { seedDocx } from '../seed-document';

/** Imported stories without optional paragraph identity attributes. */
export function anonymousStories(): Uint8Array {
  const parts = unzipSync(seedDocx());
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const p = (text: string, list = false) =>
    `<w:p>${list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']!)
      .replace('<w:document ', `<w:document xmlns:r="${r}" `)
      .replace(
        '<w:sectPr>',
        '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/>'
      )
  );
  parts['word/header1.xml'] = strToU8(
    `<w:hdr xmlns:w="${w}">${p('Draft header')}${p('Repeated')}${p('Repeated')}` +
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('One')}</w:tc><w:tc>${p('Two')}</w:tc></w:tr></w:tbl>` +
      `${p('First', true)}${p('Second', true)}</w:hdr>`
  );
  parts['word/footer1.xml'] = strToU8(`<w:ftr xmlns:w="${w}">${p('2026')}</w:ftr>`);
  parts['word/numbering.xml'] = strToU8(
    `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
  );
  let rels = strFromU8(parts['word/_rels/document.xml.rels']!);
  let types = strFromU8(parts['[Content_Types].xml']!);
  for (const [id, name, type] of [
    ['header', 'header1', 'header'],
    ['footer', 'footer1', 'footer'],
    ['numbering', 'numbering', 'numbering'],
  ]) {
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${id}" Type="${r}/${type}" Target="${name}.xml"/></Relationships>`
    );
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/></Types>`
    );
  }
  parts['word/_rels/document.xml.rels'] = strToU8(rels);
  parts['[Content_Types].xml'] = strToU8(types);
  return zipSync(parts);
}
