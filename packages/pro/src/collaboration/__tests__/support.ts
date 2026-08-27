/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strToU8, zipSync } from 'fflate';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export function collaborationDocx(firstParagraph = 'Alpha paragraph'): Uint8Array {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 mc:Ignorable="w14">
  <w:body>
    <w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t>${firstParagraph}</w:t></w:r></w:p>
    <w:p w14:paraId="22222222" w14:textId="22222222"><w:r><w:t>Bravo paragraph</w:t></w:r></w:p>
    <w:p w14:paraId="33333333" w14:textId="33333333"><w:r><w:t>Charlie paragraph</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(document),
    'customXml/item1.xml': strToU8(
      '<demo:opaque xmlns:demo="urn:docx-editor:poc">keep-me</demo:opaque>'
    ),
  });
}

export function storeAndPort(bytes: Uint8Array, documentId = 'collaboration-test-room') {
  const opened = readOoxmlPackage(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const main = opened.package.parts.get(opened.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  const store = new TreePackageStore(opened.package, normalizeParagraphIdentity(main));
  const port = createCollaborationDocumentPort(store, { documentId });
  return { store, port };
}

export function applyLocal(
  store: TreePackageStore,
  op: TreeDocOp,
  actorId: string,
  operationId: string
): void {
  const result = store.transact({ kind: 'body' }, (context) => context.apply(op), {
    actorId,
    operationId,
    recordsHistory: false,
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}
