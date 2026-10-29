/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Style documents shared by the style listing and style setter tests.

import { strToU8, zipSync } from 'fflate';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

/** A document with this styles part. `body` replaces the two plain paragraphs when given. */
export function withStyles(
  styles: string,
  body = '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>'
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/styles.xml" ContentType="${STYLES_CT}"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` + body + '</w:body></w:document>'
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
  });
}

export const STYLED = withStyles(
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading1Char"/></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="ClauseText"><w:name w:val="Clause Text"/>' +
    '<w:basedOn w:val="Normal"/></w:style>' +
    '<w:style w:type="character" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/>' +
    '<w:link w:val="Heading1"/></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>' +
    '<w:style w:type="numbering" w:styleId="Outline"><w:name w:val="Outline List"/></w:style>' +
    // Not listed: no name, an unknown kind, a later duplicate, an empty name.
    '<w:style w:type="paragraph" w:styleId="Nameless"/>' +
    '<w:style w:type="mystery" w:styleId="Mystery"><w:name w:val="Mystery"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Duplicate"><w:name w:val="HEADING 1"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Blank"><w:name w:val="  "/></w:style>' +
    // A file-supplied name that would be a dangerous object key stays plain data.
    '<w:style w:type="paragraph" w:styleId="Proto"><w:name w:val="__proto__"/></w:style>'
);
