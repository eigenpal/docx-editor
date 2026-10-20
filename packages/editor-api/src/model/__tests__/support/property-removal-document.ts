/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { docx, p } from './documents.ts';
export const PROPERTY_PARTS = ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml'];
export function propertyRemovalDocument(): Uint8Array {
  const files = unzipSync(docx(p('Retain private body text')));
  const parts = [
    [
      'docProps/core.xml',
      'application/vnd.openxmlformats-package.core-properties+xml',
      'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Original author</dc:creator><dc:title>Title</dc:title><cp:lastModifiedBy>Last editor</cp:lastModifiedBy><cp:revision>12</cp:revision></cp:coreProperties>',
    ],
    [
      'docProps/app.xml',
      'application/vnd.openxmlformats-officedocument.extended-properties+xml',
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Private company</Company><Manager>Private manager</Manager></Properties>',
    ],
    [
      'docProps/custom.xml',
      'application/vnd.openxmlformats-officedocument.custom-properties+xml',
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Private"><vt:lpwstr>Private custom value</vt:lpwstr></property></Properties>',
    ],
  ];
  let types = strFromU8(files['[Content_Types].xml']!);
  let rels = strFromU8(files['_rels/.rels']!);
  for (const [index, [name, type, relationship, xml]] of parts.entries()) {
    files[name!] = strToU8(xml!);
    types = types.replace(
      '</Types>',
      `<Override PartName="/${name}" ContentType="${type}"/></Types>`
    );
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="property${index}" Type="${relationship}" Target="${name}"/></Relationships>`
    );
  }
  files['[Content_Types].xml'] = strToU8(types);
  files['_rels/.rels'] = strToU8(rels);
  files['word/media/retained.bin'] = new Uint8Array([1, 2, 3, 4]);
  return zipSync(files);
}
