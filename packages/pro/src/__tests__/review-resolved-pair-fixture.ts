/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two resolved comments on two paragraphs, for the resolved-card switching tests in both
// adapters.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';

const commented = (id: number, text: string) =>
  `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;

const comment = (id: number, paraId: string, text: string) =>
  `<w:comment w:id="${id}" w:author="Ada">` +
  `<w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;

export const TWO_RESOLVED_COMMENTS = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
      '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>${commented(1, 'first')}${commented(2, 'second')}` +
      '</w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">` +
      comment(1, 'A0000001', 'One.') +
      comment(2, 'A0000002', 'Two.') +
      '</w:comments>'
  ),
  'word/commentsExtended.xml': strToU8(
    `<w15:commentsEx xmlns:w15="${W15}">` +
      '<w15:commentEx w15:paraId="A0000001" w15:done="1"/>' +
      '<w15:commentEx w15:paraId="A0000002" w15:done="1"/>' +
      '</w15:commentsEx>'
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
      `<Relationship Id="rIdCE" Type="${COMMENTS_EXTENDED_REL}" Target="commentsExtended.xml"/>` +
      '</Relationships>'
  ),
});

/**
 * Open the second card from the keyboard while the first is open, as a browser does it:
 * the second `<details>` opens and reports `toggle`; once the rail closes the first, the
 * browser reports that close as a `toggle` too. Happy DOM does not fire either event, so
 * the test dispatches them. `settle` lets the adapter render between the two.
 */
export async function openSecondWhileFirstOpen(
  cards: () => HTMLDetailsElement[],
  settle: () => Promise<void>
): Promise<void> {
  const second = cards()[1]!;
  second.open = true;
  second.dispatchEvent(new Event('toggle'));
  await settle();
  const first = cards()[0]!;
  if (!first.open) first.dispatchEvent(new Event('toggle'));
  await settle();
}
