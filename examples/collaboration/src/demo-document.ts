import { strToU8, zipSync } from 'fflate';

/** Small deterministic DOCX with three stable body paragraph identities. */
export function demoDocumentBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 mc:Ignorable="w14">
  <w:body>
    <w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t>Edit this paragraph together.</w:t></w:r></w:p>
    <w:p w14:paraId="22222222" w14:textId="22222222"><w:r><w:t>Try concurrent insertions and deletions here.</w:t></w:r></w:p>
    <w:p w14:paraId="33333333" w14:textId="33333333"><w:r><w:t>Remote selections appear as overlays.</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`),
    'customXml/item1.xml': strToU8(
      '<proof:opaque xmlns:proof="urn:docx-editor:collaboration">preserved</proof:opaque>'
    ),
  });
}
