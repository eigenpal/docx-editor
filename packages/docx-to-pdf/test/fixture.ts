/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
export function docx(body: string, extras: Record<string, string | Uint8Array> = {}): Uint8Array {
  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`,
    ...extras,
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])
    )
  );
}
export function paragraph(text: string, properties = ''): string {
  return `<w:p><w:r>${properties}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

// Format defaults, pinned so a fixture does not take the application defaults for omitted docDefaults.
export const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

const STYLES_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/**
 * {@link docx} with a related styles part. A fixture that supplies no `word/styles.xml` gets one
 * holding only {@link FORMAT_DOC_DEFAULTS}; the content type and relationship are added once.
 */
export function formatDefaultsDocx(
  body: string,
  extras: Record<string, string | Uint8Array> = {}
): Uint8Array {
  const files = unzipSync(docx(body, extras));
  files['word/styles.xml'] ??= strToU8(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `${FORMAT_DOC_DEFAULTS}</w:styles>`
  );
  const types = strFromU8(files['[Content_Types].xml']!);
  if (!types.includes('PartName="/word/styles.xml"'))
    files['[Content_Types].xml'] = strToU8(
      types.replace(
        '</Types>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
      )
    );
  const rels = files['word/_rels/document.xml.rels'];
  const relsXml = rels ? strFromU8(rels) : '';
  const relationshipTypes = Array.from(relsXml.matchAll(/\bType="([^"]*)"/g), ([, type]) => type);
  if (!relationshipTypes.includes(STYLES_TYPE)) {
    const stylesRel = `<Relationship Id="rIdFormatStyles" Type="${STYLES_TYPE}" Target="styles.xml"/>`;
    files['word/_rels/document.xml.rels'] = strToU8(
      relsXml
        ? relsXml.replace('</Relationships>', `${stylesRel}</Relationships>`)
        : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${stylesRel}</Relationships>`
    );
  }
  return zipSync(files);
}
