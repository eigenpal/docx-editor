/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One document and editor for the React and Vue `useReview().adopt` tests.

import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ins = (id: number, author: string) =>
  `<w:p><w:ins w:id="${id}" w:author="${author}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Added${id}</w:t></w:r></w:ins></w:p>`;

/** Two changes by `AI` and one by `Grace`. */
function trackedDocument(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${ins(1, 'AI') + ins(2, 'AI') + ins(3, 'Grace')}</w:body></w:document>`
    ),
  });
}

const editors: DocxEditorInstance[] = [];

/** An editor with the review module and, when given, an ambient author. */
export function mountTrackedEditor(author?: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: trackedDocument(),
    ...(author === undefined ? {} : { author }),
    modules: [reviewModule()],
  });
  editors.push(editor);
  return editor;
}

export function destroyTrackedEditors(): void {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
}

/** Revision authors in reading order. */
export function revisionAuthors(
  items: readonly { readonly kind: string; readonly author?: string }[]
): (string | undefined)[] {
  return items.flatMap((item) => (item.kind === 'revision' ? [item.author] : []));
}
