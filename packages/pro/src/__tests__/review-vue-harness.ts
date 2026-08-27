/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { h } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { flush, mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { DocxEditorReview } from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { trackVueWarnings, assertNoRefOwnerWarnings } from './vue-runtime-audit.ts';

import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

export { flush, trackVueWarnings, assertNoRefOwnerWarnings };

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

export function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

export const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

export const TRACKED = docx(
  '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
);

export const COMMENTED_SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="7"/>` +
      '<w:r><w:t>hello</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
      '<w:r><w:commentReference w:id="7"/></w:r></w:p></w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      '<w:comment w:id="7" w:author="Ada" w14:paraId="A0000001"><w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment>' +
      '</w:comments>'
  ),
  'word/commentsExtended.xml': strToU8(
    `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="A0000001" w15:done="0"/></w15:commentsEx>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
      `<Relationship Id="rIdCE" Type="${COMMENTS_EXTENDED_REL}" Target="commentsExtended.xml"/>` +
      '</Relationships>'
  ),
});

export const FORMAT_AND_INSERT = docx(
  '<w:p><w:r><w:rPr>' +
    '<w:rPrChange w:id="3" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z"><w:b/></w:rPrChange>' +
    '<w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:t>added text</w:t></w:r></w:ins></w:p>'
);

export async function waitFor(
  predicate: () => boolean,
  attempts = 30,
  delayMs = 50
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, delayMs));
    await flush();
  }
}

export async function selectAllWithPlacement(editor: DocxEditorInstance): Promise<void> {
  editor.surface!.focus();
  editor.surface!.selectAll();
  await flush();
  await waitFor(() => editor.getSelectionPlacement()?.anchorY != null, 60, 50);
}

export function mountReview(
  source: Uint8Array = SOURCE,
  reviewProps: Record<string, unknown> = {},
  rootProps: Record<string, unknown> = {}
) {
  const mounted = mountEditorTree(
    () => [],
    source,
    () => [h(DocxEditorReview, reviewProps)],
    [reviewModule()],
    rootProps
  );
  const warnings = trackVueWarnings(mounted.app);
  return { ...mounted, warnings };
}
