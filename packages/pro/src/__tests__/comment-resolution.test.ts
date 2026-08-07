/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

function source(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="7"/>` +
        '<w:r><w:t>commented words</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
        '<w:r><w:commentReference w:id="7"/></w:r>' +
        '<w:ins w:id="8" w:author="Ada"><w:r><w:t> added</w:t></w:r></w:ins></w:p>' +
        '</w:body></w:document>'
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}"><w:comment w:id="7" w:author="Ada">` +
        '<w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment></w:comments>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    ),
  });
}

function mount(bytes = source()): DocxEditorInstance {
  return createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
}

function commentOf(editor: DocxEditorInstance) {
  const item = editor.getReviewItems().find((candidate) => candidate.kind === 'comment');
  if (!item || item.kind !== 'comment') throw new Error('expected a comment');
  return item;
}

describe('public comment resolution', () => {
  test('resolves and reopens idempotently without moving the active selection', () => {
    const editor = mount();
    const comment = commentOf(editor);
    editor.setActiveReviewItem(comment.key);
    const selection = editor.surface!.state().selection;

    expect(editor.setCommentResolved(comment.key, true)).toEqual({ ok: true, changed: true });
    expect(commentOf(editor).resolved).toBe(true);
    expect(editor.surface!.state().selection).toEqual(selection);
    expect(editor.setCommentResolved(comment.key, true)).toEqual({ ok: true, changed: false });

    // The repeated no-op allocated no history entry: one Undo reaches the actual state change.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(commentOf(editor).resolved).toBe(false);
    expect(editor.setCommentResolved(comment.key, false)).toEqual({ ok: true, changed: false });
  });

  test('preserves resolved state through save and reopen', async () => {
    const editor = mount();
    expect(editor.setCommentResolved(commentOf(editor).key, true).ok).toBe(true);

    const reopened = mount(new Uint8Array(await editor.save()));
    expect(commentOf(reopened).resolved).toBe(true);
    expect(reopened.setCommentResolved(commentOf(reopened).key, false)).toEqual({
      ok: true,
      changed: true,
    });
    expect(commentOf(reopened).resolved).toBe(false);
  });

  test('refuses stale, non-comment and viewing-mode resolutions with typed reasons', () => {
    const editor = mount();
    const revision = editor.getReviewItems().find((item) => item.kind === 'revision')!;

    const stale = editor.setCommentResolved('comment-missing', true);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('notFound');
    const wrongKind = editor.setCommentResolved(revision.key, true);
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.code).toBe('kindMismatch');

    editor.setEditingMode('viewing');
    expect(editor.setCommentResolved(commentOf(editor).key, true)).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the document is open for viewing',
    });
    expect(commentOf(editor).resolved).toBe(false);
  });

  test('allows resolution in suggesting mode without creating a revision', () => {
    const editor = mount();
    const revisionCount = editor.getReviewItems().filter((item) => item.kind === 'revision').length;
    editor.setEditingMode('suggesting');
    expect(editor.setCommentResolved(commentOf(editor).key, true).ok).toBe(true);
    expect(editor.getReviewItems().filter((item) => item.kind === 'revision')).toHaveLength(
      revisionCount
    );
    expect(commentOf(editor).resolved).toBe(true);
  });
});
