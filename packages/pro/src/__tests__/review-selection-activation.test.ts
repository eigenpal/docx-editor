/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Which card a range selection opens, through the review module a host installs.
//
// A selection opens a comment or a tracked change only when it holds some of its characters.
// A selection that merely touches the item, at either end, leaves it closed. A caret keeps
// its own rule and opens the item at both ends.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(body: string): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

function select(editor: DocxEditorInstance, anchor: number, head: number): void {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
  const paragraphId = fragment.paragraphId;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: anchor },
    head: { paragraphId, offset: head },
  });
}

/** The open card's kind ("comment", or the revision kind), or null. */
function openAfter(editor: DocxEditorInstance, anchor: number, head: number): string | null {
  select(editor, anchor, head);
  const open = editor.getReviewItems().find((item) => item.isActive);
  if (!open) return null;
  return open.kind === 'revision' ? open.revisionKind : open.kind;
}

const activeBands = (container: HTMLElement) =>
  container.querySelectorAll('.docx-comment-band--active, .docx-revision-band--active').length;

// Offsets: "alpha " 0..6, "beta" 6..10, " gamma" 10..16.
const PLAIN = '<w:p><w:r><w:t xml:space="preserve">alpha beta gamma</w:t></w:r></w:p>';

describe('comments and range selections', () => {
  test('a new comment opens over the selection that made it, in either direction', () => {
    for (const [anchor, head] of [
      [6, 10],
      [10, 6],
    ] as const) {
      const { editor, container } = mount(PLAIN);
      select(editor, anchor, head);
      expect(editor.addComment('why this word?').ok).toBe(true);
      const open = editor.getReviewItems().find((item) => item.isActive);
      expect(open?.kind).toBe('comment');
      expect(activeBands(container)).toBeGreaterThan(0);
      editor.destroy();
    }
  });

  test('a selection beside a comment leaves it closed', () => {
    const { editor, container } = mount(PLAIN);
    select(editor, 6, 10);
    expect(editor.addComment('why this word?').ok).toBe(true);
    // The words after the comment, in both directions, and the words before it.
    for (const [anchor, head] of [
      [10, 16],
      [16, 10],
      [0, 6],
      [6, 0],
    ] as const) {
      expect(openAfter(editor, anchor, head)).toBeNull();
      expect(activeBands(container)).toBe(0);
    }
    editor.destroy();
  });

  test('a selection holding part of a comment opens it', () => {
    const { editor } = mount(PLAIN);
    select(editor, 6, 10);
    expect(editor.addComment('why this word?').ok).toBe(true);
    expect(openAfter(editor, 0, 7)).toBe('comment');
    expect(openAfter(editor, 16, 9)).toBe('comment');
    expect(openAfter(editor, 7, 9)).toBe('comment');
    editor.destroy();
  });

  test('a caret at either end of a comment still opens it', () => {
    const { editor } = mount(PLAIN);
    select(editor, 6, 10);
    expect(editor.addComment('why this word?').ok).toBe(true);
    expect(openAfter(editor, 6, 6)).toBe('comment');
    expect(openAfter(editor, 10, 10)).toBe('comment');
    expect(openAfter(editor, 13, 13)).toBeNull();
    editor.destroy();
  });
});

describe('tracked changes and range selections', () => {
  // Offsets: "Prepared by: docx-editor.dev" 0..28, inserted " asdasda" 28..36, "." 36..37.
  const INSERTED =
    '<w:p><w:r><w:t>Prepared by: docx-editor.dev</w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:t xml:space="preserve"> asdasda</w:t></w:r></w:ins>' +
    '<w:r><w:t>.</w:t></w:r></w:p>';

  test('selecting the word before an insertion leaves the insertion closed', () => {
    const { editor, container } = mount(INSERTED);
    // A double-click on "dev" selects 25..28, ending where the insertion starts.
    expect(openAfter(editor, 25, 28)).toBeNull();
    expect(activeBands(container)).toBe(0);
    expect(openAfter(editor, 28, 25)).toBeNull();
    expect(activeBands(container)).toBe(0);
    editor.destroy();
  });

  test('selecting the text after an insertion leaves the insertion closed', () => {
    const { editor, container } = mount(INSERTED);
    expect(openAfter(editor, 36, 37)).toBeNull();
    expect(openAfter(editor, 37, 36)).toBeNull();
    expect(activeBands(container)).toBe(0);
    editor.destroy();
  });

  test('selecting the inserted words opens the insertion', () => {
    const { editor, container } = mount(INSERTED);
    // A double-click on "asdasda", and the whole insertion in both directions.
    expect(openAfter(editor, 29, 36)).toBe('insert');
    expect(activeBands(container)).toBeGreaterThan(0);
    expect(openAfter(editor, 28, 36)).toBe('insert');
    expect(openAfter(editor, 36, 28)).toBe('insert');
    // A selection that starts before the insertion and ends inside it.
    expect(openAfter(editor, 25, 30)).toBe('insert');
    editor.destroy();
  });

  test('moving from the inserted words to the word before closes the insertion', () => {
    const { editor, container } = mount(INSERTED);
    expect(openAfter(editor, 29, 36)).toBe('insert');
    expect(openAfter(editor, 25, 28)).toBeNull();
    expect(activeBands(container)).toBe(0);
    editor.destroy();
  });

  test('accept and reject still act on the change a caret opens', () => {
    const { editor } = mount(INSERTED);
    expect(openAfter(editor, 30, 30)).toBe('insert');
    const card = editor.getReviewItems()[0]!;
    expect(editor.acceptReviewItem(card.key).ok).toBe(true);
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(openAfter(editor, 25, 28)).toBeNull();
    editor.destroy();
  });
});
