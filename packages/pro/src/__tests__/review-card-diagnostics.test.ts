/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Accepting or rejecting one change from a review card does not go through `exec`. A change the
// engine cannot resolve must still reach telemetry, with the same anonymous detail as a bulk
// accept, and without the author or the text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const SECRET_TEXT = 'Confidential settlement terms';
const SECRET_AUTHOR = 'client-matter-4471';

function source(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

test('a review card accept the engine cannot resolve reports the change kind and the reason', () => {
  const events: EditorDiagnostic[] = [];
  // A formatting change with no author: the review queue lists it read-only.
  const body =
    '<w:p><w:pPr><w:rPr><w:b/>' +
    '<w:rPrChange w:id="7" w:date="2026-01-02T00:00:00Z"><w:rPr/></w:rPrChange>' +
    '</w:rPr></w:pPr>' +
    `<w:ins w:id="9" w:author="${SECRET_AUTHOR}" w:date="2026-01-01T00:00:00Z">` +
    `<w:r><w:t>${SECRET_TEXT}</w:t></w:r></w:ins></w:p>`;
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: source(body),
    author: 'Grace Hopper',
    modules: [
      reviewModule(),
      { id: 'observer', onDiagnostic: (event: EditorDiagnostic) => events.push(event) },
    ],
  });
  try {
    const format = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'format');
    expect(format).toBeDefined();
    expect(editor.acceptReviewItem(format!.key).ok).toBe(false);
    expect(events.filter((event) => event.kind === 'review.skipped')).toEqual([
      expect.objectContaining({
        code: 'review.revision-unsupported',
        count: 1,
        operation: 'accept',
        changeKind: 'format',
        formattingKind: 'rPrChange',
        part: 'main-document',
        cause: 'unaddressed',
      }),
    ]);
    const text = JSON.stringify(events);
    for (const secret of [SECRET_TEXT, SECRET_AUTHOR, 'document.xml'])
      expect(text).not.toContain(secret);
  } finally {
    editor.destroy();
  }
});

test('a review card accept keeps the misplaced-marker cause apart from unaddressed', () => {
  const events: EditorDiagnostic[] = [];
  // An insertion marker inside a run, where only run content can be.
  const body =
    `<w:p><w:r><w:ins w:id="5" w:author="${SECRET_AUTHOR}" w:date="2026-01-01T00:00:00Z">` +
    `<w:t>${SECRET_TEXT}</w:t></w:ins></w:r></w:p>`;
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: source(body),
    author: 'Grace Hopper',
    modules: [
      reviewModule(),
      { id: 'observer', onDiagnostic: (event: EditorDiagnostic) => events.push(event) },
    ],
  });
  try {
    const revision = editor.getReviewItems().find((item) => item.kind === 'revision');
    expect(revision).toBeDefined();
    expect(editor.acceptReviewItem(revision!.key).ok).toBe(false);
    expect(events.filter((event) => event.kind === 'review.skipped')).toEqual([
      expect.objectContaining({
        code: 'review.revision-unsupported',
        operation: 'accept',
        cause: 'misplaced-marker',
      }),
    ]);
    const text = JSON.stringify(events);
    for (const secret of [SECRET_TEXT, SECRET_AUTHOR]) expect(text).not.toContain(secret);
  } finally {
    editor.destroy();
  }
});
