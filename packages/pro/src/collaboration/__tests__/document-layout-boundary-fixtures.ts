/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { zipDocument, W, R, REL } from './document-peer-support.ts';

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
const section = (start: number, headers = false) =>
  '<w:sectPr>' +
  (headers
    ? '<w:headerReference w:type="default" r:id="rDefault"/><w:headerReference w:type="even" r:id="rEven"/>'
    : '') +
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
  `<w:pgNumType w:start="${start}"/></w:sectPr>`;

export const restartedSectionBytes = zipDocument(
  `<w:p><w:pPr>${section(0, true)}</w:pPr><w:r><w:t>Opening section</w:t></w:r></w:p>` +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    `<w:tr>${cell('Editable cell')}</w:tr></w:tbl>` +
    paragraph('Closing') +
    section(1, true),
  {
    overrides:
      '<Override PartName="/word/default.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/even.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/><Relationship Id="rDefault" Type="${R}/header" Target="default.xml"/><Relationship Id="rEven" Type="${R}/header" Target="even.xml"/></Relationships>`,
    extraXml: {
      'word/default.xml': `<w:hdr xmlns:w="${W}">${paragraph('Default header')}</w:hdr>`,
      'word/even.xml': `<w:hdr xmlns:w="${W}">${paragraph('Even header')}${paragraph('Second header line')}</w:hdr>`,
      'word/settings.xml': `<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`,
    },
  }
);

const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((side) => `<w:${side} w:val="single" w:sz="8" w:color="000000"/>`)
  .join('');
export const omittedGridCellBytes = zipDocument(
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>' +
    `<w:tblBorders>${borders}</w:tblBorders></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr>${cell('One')}${cell('Two')}${cell('Three')}</w:tr>` +
    '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>' +
    `${cell('Editable cell')}${cell('Following cell')}</w:tr></w:tbl>` +
    paragraph('Closing') +
    section(1)
);
