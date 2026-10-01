/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  zipDocument,
  W,
  R,
  REL,
} from '../../../../pro/src/collaboration/__tests__/document-peer-support';
export function noteFixture() {
  return zipDocument(
    '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="2"/><w:endnoteReference w:id="1"/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:tc></w:tr></w:tbl>',
    {
      overrides:
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>',
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="f" Type="${R}/footnotes" Target="footnotes.xml"/><Relationship Id="e" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`,
      extraXml: {
        'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:t>Cell note</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>Body note</w:t></w:r></w:p></w:footnote></w:footnotes>`,
        'word/endnotes.xml': `<w:endnotes xmlns:w="${W}"><w:endnote w:id="1"><w:p><w:r><w:t>End note</w:t></w:r></w:p></w:endnote></w:endnotes>`,
      },
    }
  );
}
