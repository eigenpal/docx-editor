/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { docx, p } from './documents.ts';

export function styledTableDocument(): Uint8Array {
  const parts = unzipSync(docx(p('Keep this paragraph')));
  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    )
  );
  parts['word/_rels/document.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  );
  parts['word/styles.xml'] = strToU8(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="table" w:styleId="ActualTableId"><w:name w:val="Contract table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style></w:styles>'
  );
  return zipSync(parts);
}
