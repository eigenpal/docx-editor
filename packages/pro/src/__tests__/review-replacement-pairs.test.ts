/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `getReviewItems({ pairReplacements: true })`: a deletion followed by a touching insertion
// from the same author reads as one replacement, and every key-addressed verb acts on both.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type {
  ReviewItemPlacement,
  ReviewItemRevealEvent,
  ReviewRevisionPlacement,
} from '@docx-editor.dev/core/contracts/editor';
import { reviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const del = (id: number, author: string, text: string) =>
  `<w:del w:id="${id}" w:author="${author}" w:date="2026-01-02T03:04:05Z">` +
  `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const ins = (id: number, author: string, text: string) =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="2026-01-02T03:04:06Z">` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (...parts: string[]) => `<w:p>${parts.join('')}</w:p>`;

/** "The old fee applies." with "old" replaced by "new" in one edit. */
const REPLACED = paragraph(
  run('The '),
  del(1, 'Ada', 'old'),
  ins(2, 'Ada', 'new'),
  run(' fee applies.')
);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace',
    modules: [reviewModule()],
  });
  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const PAIRED = { pairReplacements: true } as const;

function summary(items: readonly ReviewItemPlacement[]) {
  return items.map((item) =>
    item.kind === 'revision'
      ? [item.revisionKind, item.text, item.replacedText ?? null]
      : [item.kind, item.text, null]
  );
}

function pairOf(editor: DocxEditorInstance): ReviewRevisionPlacement {
  const [pair] = editor.getReviewItems(PAIRED);
  if (!pair || pair.kind !== 'revision' || pair.revisionKind !== 'replace')
    throw new Error('expected a paired replacement');
  return pair;
}

const bodyText = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();

describe('pairing replacements in the review queue', () => {
  test('pairing is off by default and lists both halves', () => {
    const editor = mount(REPLACED);
    expect(summary(editor.getReviewItems())).toEqual([
      ['delete', 'old', null],
      ['insert', 'new', null],
    ]);
  });

  test('a paired query lists one replacement with both texts', () => {
    const editor = mount(REPLACED);
    expect(summary(editor.getReviewItems(PAIRED))).toEqual([['replace', 'new', 'old']]);
    const pair = pairOf(editor);
    expect(pair.author).toBe('Ada');
    expect(pair.readOnly).toBe(false);
    expect(pair.activatable).toBe(true);
    expect(pair.item.replacedRangeCount).toBe(1);
    // Stable across reads, so a host can keep it between renders.
    expect(pairOf(editor).key).toBe(pair.key);
  });

  test('a deletion and an insertion that do not touch stay separate', () => {
    const editor = mount(
      paragraph(run('The '), del(1, 'Ada', 'old'), run(' '), ins(2, 'Ada', 'new'), run('.'))
    );
    expect(summary(editor.getReviewItems(PAIRED))).toEqual([
      ['delete', 'old', null],
      ['insert', 'new', null],
    ]);
  });

  test('halves from different authors stay separate', () => {
    const editor = mount(paragraph(run('The '), del(1, 'Ada', 'old'), ins(2, 'Alan', 'new')));
    expect(summary(editor.getReviewItems(PAIRED))).toEqual([
      ['delete', 'old', null],
      ['insert', 'new', null],
    ]);
  });

  test('an insertion followed by a deletion does not pair', () => {
    const editor = mount(paragraph(run('The '), ins(2, 'Ada', 'new'), del(1, 'Ada', 'old')));
    expect(summary(editor.getReviewItems(PAIRED))).toEqual([
      ['insert', 'new', null],
      ['delete', 'old', null],
    ]);
  });

  test('accepting a pair resolves both halves in one undo step', () => {
    const editor = mount(REPLACED);
    expect(editor.acceptReviewItem(pairOf(editor).key)).toEqual({ ok: true, changed: true });
    expect(bodyText(editor)).toBe('The new fee applies.');
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(summary(editor.getReviewItems())).toEqual([
      ['delete', 'old', null],
      ['insert', 'new', null],
    ]);
  });

  test('rejecting a pair restores the deleted words in one undo step', () => {
    const editor = mount(REPLACED);
    expect(editor.rejectReviewItem(pairOf(editor).key)).toEqual({ ok: true, changed: true });
    expect(bodyText(editor)).toBe('The old fee applies.');
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(summary(editor.getReviewItems(PAIRED))).toEqual([['replace', 'new', 'old']]);
  });

  test('deleting a pair rejects both halves', () => {
    const editor = mount(REPLACED);
    expect(editor.deleteReviewItem(pairOf(editor).key).ok).toBe(true);
    expect(bodyText(editor)).toBe('The old fee applies.');
  });

  test('a bulk resolution selects both halves through the pair key', () => {
    const editor = mount(REPLACED);
    const result = editor.exec({
      type: 'resolveAllReviewChanges',
      action: 'accept',
      keys: [pairOf(editor).key],
    });
    expect(result.ok).toBe(true);
    expect(bodyText(editor)).toBe('The new fee applies.');
  });

  test('a bulk resolution takes several pair keys and plain keys in one call', () => {
    const editor = mount(
      paragraph(run('The '), del(1, 'Ada', 'old'), ins(2, 'Ada', 'new'), run(' fee.')) +
        paragraph(run('A '), del(3, 'Ada', 'short'), ins(4, 'Ada', 'long'), run(' term.')) +
        paragraph(run('Pay '), ins(5, 'Ada', 'promptly'), run('.'))
    );
    const items = editor.getReviewItems(PAIRED);
    const pairs = items.filter(
      (item) => item.kind === 'revision' && item.revisionKind === 'replace'
    );
    expect(pairs).toHaveLength(2);
    const plain = items.find((item) => item.kind === 'revision' && item.revisionKind === 'insert')!;
    const result = editor.exec({
      type: 'resolveAllReviewChanges',
      action: 'accept',
      keys: [pairs[0]!.key, plain.key, pairs[1]!.key],
    });
    expect(result.ok).toBe(true);
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(bodyText(editor)).toBe('The new fee.\nA long term.\nPay promptly.');
  });

  test('a pair key returns the painted bands of both halves', () => {
    const editor = mount(REPLACED);
    const [deletion, insertion] = editor.getReviewItems();
    const both = editor.getReviewItemRects(pairOf(editor).key);
    const halves =
      editor.getReviewItemRects(deletion!.key).length +
      editor.getReviewItemRects(insertion!.key).length;
    expect(both.length).toBe(halves);
  });

  test('activating a pair opens it, and either half keeps it active', () => {
    const editor = mount(REPLACED);
    const pair = pairOf(editor);
    expect(editor.setActiveReviewItem(pair.key, { reveal: false }).ok).toBe(true);
    expect(pairOf(editor).isActive).toBe(true);
    const [deletion, insertion] = editor.getReviewItems();
    expect(deletion!.isActive).toBe(true);
    expect(editor.setActiveReviewItem(insertion!.key, { reveal: false }).ok).toBe(true);
    expect(pairOf(editor).isActive).toBe(true);
  });

  test('a reply to a pair anchors over the inserted words and lists under the pair', () => {
    const editor = mount(REPLACED);
    expect(editor.replyToReviewItem(pairOf(editor).key, 'Why the change?').ok).toBe(true);
    const items = editor.getReviewItems(PAIRED);
    const pair = items.find((item) => item.kind === 'revision')!;
    const reply = items.find((item) => item.kind === 'comment');
    expect(reply?.kind === 'comment' ? reply.parentRevisionId : null).toBe(pair.id);
    expect(pair.replyIds).toEqual([reply!.id]);
    const insertion = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'insert')!;
    expect(insertion.replyIds).toEqual([reply!.id]);
  });

  test('excluded kinds leave before pairing, and excluding replace drops pairs', () => {
    const editor = mount(REPLACED);
    expect(summary(editor.getReviewItems({ ...PAIRED, excludeRevisionKinds: ['delete'] }))).toEqual(
      [['insert', 'new', null]]
    );
    expect(editor.getReviewItems({ ...PAIRED, excludeRevisionKinds: ['replace'] })).toEqual([]);
    expect(summary(editor.getReviewItems({ excludeRevisionKinds: ['replace'] }))).toEqual([
      ['delete', 'old', null],
      ['insert', 'new', null],
    ]);
  });

  test('an unknown pair key is refused', () => {
    const editor = mount(REPLACED);
    const key = `${pairOf(editor).key}-missing`;
    expect(editor.acceptReviewItem(key).ok).toBe(false);
    expect(editor.setActiveReviewItem(key).ok).toBe(false);
  });
});

describe('the activated key of a paired replacement', () => {
  test('matches the pair key under the pairing query, and the half key without it', () => {
    const editor = mount(REPLACED);
    const pair = editor
      .getReviewItems({ placement: false, pairReplacements: true })
      .find((item) => item.kind === 'revision' && item.revisionKind === 'replace')!;
    const deletion = editor
      .getReviewItems({ placement: false })
      .find((item) => item.kind === 'revision' && item.revisionKind === 'delete')!;
    const revealed: string[] = [];
    editor.on('reviewItemReveal', ({ key }) => revealed.push(key));
    expect(editor.setActiveReviewItem(pair.key, { announce: true }).ok).toBe(true);
    // The reveal names the pair, and so does the getter under the same query.
    expect(revealed).toEqual([pair.key]);
    expect(editor.getActivatedReviewItemKey({ pairReplacements: true })).toBe(pair.key);
    // Read without the pairing query, it names the half the caret is in.
    expect(editor.getActivatedReviewItemKey()).toBe(deletion.key);
  });

  test('a host call with a pair key reports the pair key in both fields', () => {
    const editor = mount(REPLACED);
    const pair = pairOf(editor);
    const events: ReviewItemRevealEvent[] = [];
    editor.on('reviewItemReveal', (event) => events.push(event));
    expect(editor.setActiveReviewItem(pair.key, { announce: true }).ok).toBe(true);
    expect(events).toEqual([{ key: pair.key, pairKey: pair.key, source: 'host' }]);
  });
});

describe('the pair key of a revealed replacement half', () => {
  test('Next Change on a replacement half reports the pair key', () => {
    const editor = mount(REPLACED);
    const pair = pairOf(editor);
    const halves = editor
      .getReviewItems({ placement: false })
      .filter((item) => item.kind === 'revision')
      .map((item) => item.key);
    const events: ReviewItemRevealEvent[] = [];
    editor.on('reviewItemReveal', (event) => events.push(event));
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(events).toHaveLength(1);
    // The key names the half that navigation stepped to; pairKey names the listed pair.
    expect(halves).toContain(events[0]!.key);
    expect(events[0]!.key).not.toBe(pair.key);
    expect(events[0]).toMatchObject({ pairKey: pair.key, source: 'navigate' });
  });

  test('Previous Change on the other half reports the same pair key', () => {
    const editor = mount(REPLACED);
    const pair = pairOf(editor);
    const events: ReviewItemRevealEvent[] = [];
    editor.on('reviewItemReveal', (event) => events.push(event));
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'previous' }).ok).toBe(true);
    expect(events).toHaveLength(3);
    const [first, second, back] = events;
    // Next steps from one half to the other; Previous returns to the first half.
    expect(second!.key).not.toBe(first!.key);
    expect(back!.key).toBe(first!.key);
    for (const event of events) expect(event.pairKey).toBe(pair.key);
    expect(back!.source).toBe('navigate');
  });

  test('a change that is not part of a replacement reports no pair key', () => {
    const editor = mount(paragraph(run('The fee '), ins(3, 'Ada', 'now '), run('applies.')));
    const [insertion] = editor.getReviewItems({ placement: false });
    const events: ReviewItemRevealEvent[] = [];
    editor.on('reviewItemReveal', (event) => events.push(event));
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(events).toEqual([{ key: insertion!.key, source: 'navigate' }]);
    expect(editor.setActiveReviewItem(insertion!.key, { announce: true }).ok).toBe(true);
    expect(events[1]).toEqual({ key: insertion!.key, source: 'host' });
  });
});
