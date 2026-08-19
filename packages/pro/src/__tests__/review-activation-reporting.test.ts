/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Whether activation ANSWERS, and whether the queue says so before it is asked.
//
// `setActiveReviewItem` used to return nothing, and a refusal was indistinguishable from a
// success: asking for a kind the host's rail excluded moved the caret, opened no card, and
// reported nothing at all. A host stepping through its own queue with next/previous controls
// saw the viewport jump and the active key stay put, with no way to learn it should skip on.
// The same shape as the accept/reject `ExecResult` hole — an API that names an outcome and
// delivers part of it.
//
// Separate from `review-facade.test.ts` because that file is at its line cap.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule as testReviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
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
      `<w:document xmlns:w="${W}" xmlns:w15="${W15}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace Hopper',
    modules: [testReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const INSERTION =
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">` +
  `<w:r><w:t>added text</w:t></w:r></w:ins></w:p>`;

/** A format change the rail hides by default, plus an insertion it shows. */
const FORMAT_AND_INSERT =
  `<w:p><w:r><w:rPr>` +
  `<w:rPrChange w:id="3" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z"><w:b/></w:rPrChange>` +
  `<w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>` +
  INSERTION;

describe('activation reports what it did', () => {
  test('a key the queue does not hold is refused rather than ignored', () => {
    const editor = mount(INSERTION);
    const refused = editor.setActiveReviewItem('no-such-key');
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.code).toBe('notFound');

    // A real one lands. `changed: false` — opening a card moves the caret and nothing else,
    // so a host must not mark its document dirty for it.
    const card = editor.getReviewItems()[0]!;
    expect(editor.setActiveReviewItem(card.key)).toEqual({ ok: true, changed: false });
    expect(editor.setActiveReviewItem(null)).toEqual({ ok: true, changed: false });
    editor.destroy();
  });

  test('an excluded kind is refused OUT LOUD, and the queue says so before it is asked', () => {
    const editor = mount(FORMAT_AND_INSERT);
    const format = editor
      .getReviewItems()
      .find((card) => card.kind === 'revision' && card.revisionKind === 'format')!;
    expect(format).toBeDefined();
    expect(format.activatable).toBe(true);

    editor.setReviewActivationExclusions(['format', 'structural']);

    // The queue still LISTS the card — `getReviewItems` answers what the document holds —
    // and now says it is not clickable, so a host can render it disabled rather than
    // discovering the refusal on click.
    const excluded = editor.getReviewItems().find((card) => card.key === format.key)!;
    expect(excluded).toBeDefined();
    expect(excluded.activatable).toBe(false);

    const refused = editor.setActiveReviewItem(format.key);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toContain('format');

    // A kind the rail DOES show is untouched by the filter.
    const insert = editor
      .getReviewItems()
      .find((card) => card.kind === 'revision' && card.revisionKind === 'insert')!;
    expect(insert.activatable).toBe(true);
    expect(editor.setActiveReviewItem(insert.key).ok).toBe(true);
    editor.destroy();
  });

  test('the flag and the verb cannot disagree', () => {
    // One predicate behind both, so a rail is never told an item is clickable by the queue
    // and then refused by the call — which is the only way a host can trust the flag.
    const editor = mount(FORMAT_AND_INSERT);
    editor.setReviewActivationExclusions(['format']);
    const cards = editor.getReviewItems();
    expect(cards.length).toBeGreaterThan(1);
    for (const card of cards) {
      expect(editor.setActiveReviewItem(card.key).ok).toBe(card.activatable);
    }
    editor.destroy();
  });

  test('clearing the filter makes an excluded card clickable again', () => {
    const editor = mount(FORMAT_AND_INSERT);
    const format = editor
      .getReviewItems()
      .find((card) => card.kind === 'revision' && card.revisionKind === 'format')!;

    editor.setReviewActivationExclusions(['format']);
    expect(editor.getReviewItems().find((c) => c.key === format.key)!.activatable).toBe(false);

    editor.setReviewActivationExclusions(null);
    expect(editor.getReviewItems().find((c) => c.key === format.key)!.activatable).toBe(true);
    expect(editor.setActiveReviewItem(format.key).ok).toBe(true);
    editor.destroy();
  });
});

describe('activation takes an alignment', () => {
  /** A document long enough that a far item is genuinely off screen. */
  const LONG = mount(
    Array.from(
      { length: 200 },
      (_, i) =>
        `<w:p><w:r><w:t>line ${i}</w:t></w:r>` +
        (i === 180
          ? `<w:ins w:id="9" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">` +
            `<w:r><w:t>far change</w:t></w:r></w:ins>`
          : '') +
        `</w:p>`
    ).join('')
  );

  test('reveal: false opens the item without moving the viewport', () => {
    const editor = LONG;
    const card = editor.getReviewItems().find((c) => c.kind === 'revision')!;
    expect(card).toBeDefined();

    const landed = editor.setActiveReviewItem(card.key, { reveal: false });
    expect(landed.ok).toBe(true);
    // The SELECTION still moved — turning the scroll off must not turn activation off.
    const selection = editor.surface!.state().selection;
    const item = card.item;
    if (item.kind !== 'revision') throw new Error('expected a revision item');
    expect(selection.head.paragraphId).toBe(item.ranges[0]!.start.paragraphId);
    editor.destroy();
  });

  test('an explicit alignment is accepted and still reports', () => {
    const editor = mount(INSERTION);
    const card = editor.getReviewItems()[0]!;
    for (const reveal of ['start', 'center', 'centerIfNeeded', 'nearest'] as const) {
      expect(editor.setActiveReviewItem(card.key, { reveal }).ok).toBe(true);
    }
    // A refusal is still a refusal whatever the alignment says.
    expect(editor.setActiveReviewItem('no-such-key', { reveal: 'center' }).ok).toBe(false);
    editor.destroy();
  });
});
