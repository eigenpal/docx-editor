/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A document with tracked changes in several places, for range-scoped revision reads and the
// review-key bridge: a paired replacement, a lone insertion, a table cell, a nested change, a
// comment spanning two paragraphs, and a header with a change of its own.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

export const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
export const ins = (id: number, text: string, author = 'Ada'): string =>
  `<w:ins w:id="${id}" w:author="${author}">${run(text)}</w:ins>`;
export const del = (id: number, text: string, author = 'Ada'): string =>
  `<w:del w:id="${id}" w:author="${author}"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
export const para = (...parts: string[]): string => `<w:p>${parts.join('')}</w:p>`;

const BODY =
  para(
    '<w:commentRangeStart w:id="9"/>',
    run('keep '),
    del(1, 'gone'),
    ins(2, 'added'),
    run(' tail')
  ) +
  para(
    run('second '),
    ins(3, 'inserted'),
    '<w:commentRangeEnd w:id="9"/>',
    '<w:r><w:commentReference w:id="9"/></w:r>',
    run('.')
  ) +
  para(run('plain paragraph')) +
  '<w:tbl><w:tr><w:tc>' +
  para(run('cell '), ins(4, 'cellins')) +
  '</w:tc></w:tr></w:tbl>' +
  para(
    run('nested '),
    '<w:ins w:id="5" w:author="Ada"><w:del w:id="6" w:author="Grace">' +
      '<w:r><w:delText>both</w:delText></w:r></w:del></w:ins>'
  );

/** The review fixture: body changes, a two-paragraph comment, and a header insertion. */
export const REVIEW_DOCUMENT: Uint8Array = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="${MAIN_CT}.document.main+xml"/>` +
      `<Override PartName="/word/header1.xml" ContentType="${MAIN_CT}.header+xml"/>` +
      `<Override PartName="/word/comments.xml" ContentType="${MAIN_CT}.comments+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdH" Type="${OFFICE}/header" Target="header1.xml"/>` +
      `<Relationship Id="rIdC" Type="${OFFICE}/comments" Target="comments.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${OFFICE}"><w:body>${BODY}` +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
  ),
  'word/header1.xml': strToU8(
    `<w:hdr xmlns:w="${W}">${para(run('header '), ins(7, 'headins', 'Linus'))}</w:hdr>`
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}"><w:comment w:id="9" w:author="Grace" w:initials="G">` +
      `${para(run('Check both paragraphs.'))}</w:comment></w:comments>`
  ),
});
