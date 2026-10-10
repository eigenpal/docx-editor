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

function commentsOf(editor: DocxEditorInstance) {
  return editor.getReviewItems().filter((item) => item.kind === 'comment');
}

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const W16CID = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
const EXTENDED_REL = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const EXTENDED_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const HEADER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

function commentXml(id: string, paraId: string, text: string, parentId?: string): string {
  const parent = parentId === undefined ? '' : ` w16cid:parentId="${parentId}"`;
  return (
    `<w:comment w:id="${id}" w:author="Ada"${parent}>` +
    `<w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`
  );
}

function nestedSource(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        `<Override PartName="/word/commentsExtended.xml" ContentType="${EXTENDED_CT}"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>root</w:t></w:r>` +
        `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>` +
        `</w:body></w:document>`
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:w16cid="${W16CID}">` +
        commentXml('1', '11111111', 'root') +
        commentXml('2', '22222222', 'reply', '1') +
        commentXml('4', '44444444', 'nested', '2') +
        '</w:comments>'
    ),
    'word/commentsExtended.xml': strToU8(
      `<w15:commentsEx xmlns:w15="${W15}">` +
        `<w15:commentEx w15:paraId="11111111" w15:done="0"/>` +
        `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/>` +
        `<w15:commentEx w15:paraId="44444444" w15:paraIdParent="22222222" w15:done="0"/>` +
        '</w15:commentsEx>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
        `<Relationship Id="rIdE" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>` +
        '</Relationships>'
    ),
  });
}

function duplicateRecordSource(): Uint8Array {
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
        '<w:r><w:commentReference w:id="7"/></w:r></w:p></w:body></w:document>'
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}">` +
        '<w:comment w:id="7" w:author="Ada"><w:p><w:r><w:t>first</w:t></w:r></w:p></w:comment>' +
        '<w:comment w:id="7" w:author="Grace"><w:p><w:r><w:t>dup</w:t></w:r></w:p></w:comment>' +
        '</w:comments>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    ),
  });
}

function bodyAndHeaderMarkersSource(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/header1.xml" ContentType="${HEADER_CT}"/>` +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        '<w:body><w:p><w:commentRangeStart w:id="7"/>' +
        '<w:r><w:t>body</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
        '<w:r><w:commentReference w:id="7"/></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:commentRangeStart w:id="7"/>` +
        '<w:r><w:t>hdr</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
        '<w:r><w:commentReference w:id="7"/></w:r></w:p></w:hdr>'
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}"><w:comment w:id="7" w:author="Ada">` +
        '<w:p><w:r><w:t>shared</w:t></w:r></w:p></w:comment></w:comments>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdH" Type="${HEADER_REL}" Target="header1.xml"/>` +
        `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
        '</Relationships>'
    ),
  });
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

  test('reopens a comment whose commentsExtended uses the transitional content type', async () => {
    const editor = mount(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
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
          `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">` +
            '<w:comment w:id="7" w:author="Ada" w14:paraId="A0000001">' +
            '<w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment></w:comments>'
        ),
        'word/commentsExtended.xml': strToU8(
          `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="A0000001" w15:done="0"/></w15:commentsEx>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}">` +
            `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
            `<Relationship Id="rIdCE" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>` +
            '</Relationships>'
        ),
      })
    );
    expect(editor.setCommentResolved(commentOf(editor).key, true)).toEqual({
      ok: true,
      changed: true,
    });
    expect(commentOf(editor).resolved).toBe(true);
    expect(editor.setCommentResolved(commentOf(editor).key, false)).toEqual({
      ok: true,
      changed: true,
    });
    expect(commentOf(editor).resolved).toBe(false);
    const reopened = mount(new Uint8Array(await editor.save()));
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

  test('nested descendants in both metadata formats resolve, undo, and reopen together', () => {
    const editor = mount(nestedSource());
    const nested = commentsOf(editor).find((item) => item.id === '4');
    expect(nested?.kind).toBe('comment');
    expect(editor.setCommentResolved(nested!.key, true)).toEqual({ ok: true, changed: true });
    expect(commentsOf(editor).every((item) => item.kind === 'comment' && item.resolved)).toBe(true);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(commentsOf(editor).every((item) => item.kind === 'comment' && !item.resolved)).toBe(
      true
    );
    expect(editor.setCommentResolved(commentOf(editor).key, false)).toEqual({
      ok: true,
      changed: false,
    });
  });

  test('duplicate comment records refuse before mutation', () => {
    const editor = mount(duplicateRecordSource());
    const key = commentsOf(editor)[0]?.key;
    expect(key).toBeDefined();
    const refused = editor.setCommentResolved(key!, true);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('ambiguous');
    expect(commentsOf(editor).every((item) => item.kind === 'comment' && !item.resolved)).toBe(
      true
    );
  });

  test('repeated body and header markers for one record remain resolvable', () => {
    const editor = mount(bodyAndHeaderMarkersSource());
    expect(editor.setCommentResolved(commentOf(editor).key, true)).toEqual({
      ok: true,
      changed: true,
    });
    expect(commentOf(editor).resolved).toBe(true);
  });
});
