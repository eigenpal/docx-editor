/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A review write the surface refuses names its cause.
//
// Comment and revision commands commit through `commitReviewOps`, which refuses a write for
// viewing, a collaboration gate, or an external refresh before the write runs. Each command used
// to answer those with one generic sentence ("the reply could not be committed"), so a host could
// not tell "the document is open for viewing" from a real failure.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module.ts';
import {
  REFRESH_WRITE_REFUSAL,
  setRefreshWriteGuard,
} from '../../../core/src/editor/refresh-write-guard.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

const BODY =
  `<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>commented words</w:t></w:r>` +
  `<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>` +
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">` +
  `<w:r><w:t>added text</w:t></w:r></w:ins></w:p>`;
const COMMENTS =
  `<w:comment w:id="7" w:author="Ada Lovelace" w:initials="AL" w:date="2026-03-04T05:06:07Z">` +
  `<w:p><w:r><w:t>Is this the right clause?</w:t></w:r></w:p></w:comment>`;

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
    'word/comments.xml': strToU8(`<w:comments xmlns:w="${W}">${COMMENTS}</w:comments>`),
  });
}

type Cause = 'viewing' | 'refresh';

function refusedEditor(cause: Cause) {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  const items = editor.getReviewItems({ pairReplacements: false });
  const comment = items.find((item) => item.kind === 'comment')!.key;
  const revision = items.find((item) => item.kind === 'revision')!.key;
  editor.surface!.selectAll();
  if (cause === 'viewing') editor.setEditingMode('viewing');
  else setRefreshWriteGuard(container, true);
  return {
    editor,
    comment,
    revision,
    close() {
      setRefreshWriteGuard(container, false);
      editor.destroy();
    },
  };
}

type State = ReturnType<typeof refusedEditor>;

const WRITES = [
  ['addComment', ({ editor }: State) => editor.addComment('Note')],
  ['replyToReviewItem', ({ editor, comment }: State) => editor.replyToReviewItem(comment, 'Re')],
  ['deleteReviewItem', ({ editor, comment }: State) => editor.deleteReviewItem(comment)],
  ['setCommentResolved', ({ editor, comment }: State) => editor.setCommentResolved(comment, true)],
  ['acceptReviewItem', ({ editor, revision }: State) => editor.acceptReviewItem(revision)],
  [
    'resolveAllReviewChanges',
    ({ editor }: State) => editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }),
  ],
] as const;

const EXPECTED: Record<Cause, { readonly code: string; readonly reason: string }> = {
  viewing: { code: 'locked', reason: 'the document is open for viewing' },
  refresh: { code: 'unsupported', reason: REFRESH_WRITE_REFUSAL },
};

describe.each(['viewing', 'refresh'] as const)('review writes refused by %s', (cause) => {
  test.each(WRITES)('%s names the cause and changes nothing', (_name, write) => {
    const state = refusedEditor(cause);
    try {
      const revision = state.editor.surface!.session.packageRevision();
      expect(write(state)).toMatchObject({ ok: false, ...EXPECTED[cause] });
      expect(state.editor.surface!.session.packageRevision()).toBe(revision);
    } finally {
      state.close();
    }
  });
});
