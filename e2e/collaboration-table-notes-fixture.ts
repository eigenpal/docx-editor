import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { collaborationTableWidthFixture } from './collaboration-table-width-fixture.ts';

/** A later footnote stays outside the table row edited by the two participants. */
export function collaborationTableNotesFixture(): Buffer {
  const parts = unzipSync(collaborationTableWidthFixture());
  const update = (name: string, before: string, after: string) => {
    parts[name] = strToU8(strFromU8(parts[name]!).replace(before, after));
  };
  update(
    'word/document.xml',
    '<w:t>Row70Cell1</w:t>',
    '<w:t>Row70Cell1</w:t><w:footnoteReference w:id="1"/>'
  );
  update(
    '[Content_Types].xml',
    '</Types>',
    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
  );
  update(
    'word/_rels/document.xml.rels',
    '</Relationships>',
    '<Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>'
  );
  parts['word/footnotes.xml'] = strToU8(
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Shared note text</w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>'
  );
  return Buffer.from(zipSync(parts));
}

export function footnotesXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/footnotes.xml']!);
}
