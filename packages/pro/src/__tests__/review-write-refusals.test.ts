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
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { EditorDiagnostic } from '@docx-editor.dev/core/contracts/editor';
import { reviewModule } from '../review/review-module.ts';
import {
  REFRESH_WRITE_REFUSAL,
  setRefreshWriteGuard,
} from '../../../core/src/editor/refresh-write-guard.ts';
import {
  stubCollaborationModule,
  stubCollaborationSession,
} from '../../../core/src/editor/__tests__/collaboration-test-module.ts';

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

function docx(body = BODY, comments = COMMENTS): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/comments.xml': strToU8(`<w:comments xmlns:w="${W}">${comments}</w:comments>`),
  });
}

type Cause = 'viewing' | 'refresh';

function refusedEditor(cause: Cause, beforeRefusal?: (editor: DocxEditorInstance) => void) {
  const container = document.createElement('div');
  const diagnostics: EditorDiagnostic[] = [];
  const editor = createDocxEditor({
    container,
    document: docx(),
    author: 'Grace Hopper',
    modules: [
      reviewModule(),
      { id: 'observer', onDiagnostic: (event: EditorDiagnostic) => diagnostics.push(event) },
    ],
  });
  const items = editor.getReviewItems({ pairReplacements: false });
  const comment = items.find((item) => item.kind === 'comment')!.key;
  const revision = items.find((item) => item.kind === 'revision')!.key;
  editor.surface!.selectAll();
  beforeRefusal?.(editor);
  if (cause === 'viewing') editor.setEditingMode('viewing');
  else setRefreshWriteGuard(container, true);
  return {
    editor,
    comment,
    revision,
    diagnostics,
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
const DIAGNOSTIC: Record<Cause, string> = {
  viewing: 'edit.read-only',
  refresh: 'edit.refresh-in-progress',
};

describe.each(['viewing', 'refresh'] as const)('review writes refused by %s', (cause) => {
  test.each(WRITES)('%s names the cause and changes nothing', (_name, write) => {
    const state = refusedEditor(cause);
    try {
      const revision = state.editor.surface!.session.packageRevision();
      state.diagnostics.length = 0;
      expect(write(state)).toMatchObject({ ok: false, ...EXPECTED[cause] });
      expect(state.editor.surface!.session.packageRevision()).toBe(revision);
      // Reported exactly once, under the cause's own code.
      const rejected = state.diagnostics.filter((event) => event.kind === 'edit.rejected');
      const codes: unknown[] = rejected.map((event) => ('code' in event ? event.code : null));
      expect(codes).toEqual([DIAGNOSTIC[cause]]);
    } finally {
      state.close();
    }
  });
});

describe('a refused review write leaves the reader where they were', () => {
  test('a refused delete keeps the open card, and the draft in it, open', () => {
    let opened = '';
    const state = refusedEditor('refresh', (editor) => {
      opened = editor.getReviewItems({ pairReplacements: false })[0]!.key;
      editor.setActiveReviewItem(opened);
    });
    try {
      expect(state.editor.deleteReviewItem(opened)).toMatchObject({ ok: false });
      const active = state.editor
        .getReviewItems({ pairReplacements: false })
        .find((item) => item.isActive);
      expect(active?.key).toBe(opened);
    } finally {
      state.close();
    }
  });

  test('an accept refused by the refresh reports the refresh, not an unsupported revision', () => {
    const state = refusedEditor('refresh');
    try {
      state.editor.acceptReviewItem(state.revision);
      const kinds = state.diagnostics.map((event) => event.kind);
      expect(kinds).not.toContain('review.skipped');
      expect(state.diagnostics.find((event) => event.kind === 'edit.rejected')).toMatchObject({
        code: 'edit.refresh-in-progress',
      });
    } finally {
      state.close();
    }
  });
});

describe('a collaboration session that is not ready', () => {
  test.each(WRITES.filter(([name]) => name !== 'resolveAllReviewChanges'))(
    '%s names the session state and reports it once',
    (_name, write) => {
      const diagnostics: EditorDiagnostic[] = [];
      const session = stubCollaborationSession({
        gateOperations: () => 'collaboration-session-not-ready',
      });
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: docx(),
        author: 'Grace Hopper',
        modules: [
          reviewModule(),
          stubCollaborationModule(session),
          { id: 'observer', onDiagnostic: (event: EditorDiagnostic) => diagnostics.push(event) },
        ],
      });
      try {
        const items = editor.getReviewItems({ pairReplacements: false });
        const state = {
          editor,
          comment: items.find((item) => item.kind === 'comment')!.key,
          revision: items.find((item) => item.kind === 'revision')!.key,
          diagnostics,
          close: () => undefined,
        };
        editor.surface!.selectAll();
        const revision = editor.surface!.session.packageRevision();
        diagnostics.length = 0;
        expect(write(state)).toMatchObject({
          ok: false,
          code: 'unsupported',
          reason: 'collaboration-session-not-ready',
        });
        expect(editor.surface!.session.packageRevision()).toBe(revision);
        const rejected = diagnostics.filter((event) => event.kind === 'edit.rejected');
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toMatchObject({ code: 'edit.collaboration-not-ready' });
      } finally {
        editor.destroy();
      }
    }
  );
});

describe('deleting a comment that another comment covers', () => {
  const NESTED =
    `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t xml:space="preserve">outer </w:t></w:r>` +
    `<w:commentRangeStart w:id="2"/><w:r><w:t>inner</w:t></w:r><w:commentRangeEnd w:id="2"/>` +
    `<w:r><w:commentReference w:id="2"/></w:r><w:commentRangeEnd w:id="1"/>` +
    `<w:r><w:commentReference w:id="1"/></w:r></w:p>`;
  const NESTED_COMMENTS =
    `<w:comment w:id="1" w:author="Ada" w:date="2026-03-04T05:06:07Z"><w:p><w:r><w:t>Outer</w:t></w:r></w:p></w:comment>` +
    `<w:comment w:id="2" w:author="Ada" w:date="2026-03-04T05:06:08Z"><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:comment>`;

  test('leaves the covering card free to open', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(NESTED, NESTED_COMMENTS),
      author: 'Grace Hopper',
      modules: [reviewModule()],
    });
    try {
      const comments = () =>
        editor
          .getReviewItems({ pairReplacements: false })
          .filter((item) => item.kind === 'comment');
      const inner = comments().find((item) => item.kind === 'comment' && item.text === 'Inner')!;
      const outer = comments().find((item) => item.kind === 'comment' && item.text === 'Outer')!;
      expect(editor.setActiveReviewItem(inner.key).ok).toBe(true);
      expect(editor.deleteReviewItem(inner.key)).toEqual({ ok: true, changed: true });
      // The caret is still inside the outer comment, which nobody dismissed.
      expect(comments().map((item) => item.key)).toEqual([outer.key]);
      expect(comments()[0]!.isActive).toBe(true);
    } finally {
      editor.destroy();
    }
  });
});

describe('deleting the open comment', () => {
  test('closes its card, and undo brings the comment and its open card back', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(),
      author: 'Grace Hopper',
      modules: [reviewModule()],
    });
    try {
      const active = () =>
        editor.getReviewItems({ pairReplacements: false }).filter((item) => item.isActive);
      const comment = editor
        .getReviewItems({ pairReplacements: false })
        .find((item) => item.kind === 'comment')!;
      expect(editor.setActiveReviewItem(comment.key).ok).toBe(true);
      expect(editor.deleteReviewItem(comment.key)).toEqual({ ok: true, changed: true });
      // Activation reads the live queue, so a deleted card is not left open with no item.
      expect(active()).toEqual([]);
      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
      // Nothing was dismissed, so the restored comment opens where the reader left it.
      expect(active().map((item) => item.key)).toEqual([comment.key]);
    } finally {
      editor.destroy();
    }
  });
});
