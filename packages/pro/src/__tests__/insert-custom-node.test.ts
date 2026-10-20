/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The write half of the custom-node contract: `insertCustomNode` authors a
// run-level SDT that is recognized BY CONSTRUCTION, locked by default, lossless
// through save/reopen, and one undo unit.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  customNodesModule,
  defineCustomNode,
  insertCustomNode,
  recognizeCustomNodes,
  removeCustomNode,
  updateCustomNode,
} from '../index.ts';
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

const citation = defineCustomNode({ name: 'citation', tagPrefix: 'acme' });

function mount(body: string, review = false): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    author: 'Demo Reviewer',
    modules: [customNodesModule({ nodes: [citation] }), ...(review ? [reviewModule()] : [])],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function firstParagraphId(editor: DocxEditorInstance): string {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  return fragment.paragraphId;
}

describe('insertCustomNode', () => {
  test('inserts a recognized-by-construction node at an offset', () => {
    const editor = mount('<w:p><w:r><w:t>before after</w:t></w:r></w:p>');
    const result = insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3', locator: 'p.42' },
      text: '(Smith 2024, p. 42)',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.attrs).toEqual({ sourceId: 'src_9f3', locator: 'p.42' });
    expect(node?.text).toBe('(Smith 2024, p. 42)');
    expect(editor.surface!.session.bodyText()).toContain('(Smith 2024, p. 42)');
  });

  test('writes contentLocked by default and survives save/reopen', async () => {
    const editor = mount('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 4 },
    });
    const saved = new Uint8Array(await editor.save());
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    expect(xml).toContain('<w:sdt>');
    expect(xml).toContain('w:lock');
    expect(xml).toContain('w:lock w:val="contentLocked"');
    expect(xml).toContain('acme:citation?sourceId=s1');
    // Word writes `w:id` on every control; Word Online DROPS an id-less control on
    // resave, so the id is part of surviving a cloud round-trip.
    expect(xml).toMatch(/<w:id w:val="\d+"\/><w:lock/);

    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: saved,
      modules: [customNodesModule({ nodes: [citation] })],
    });
    const [node] = recognizeCustomNodes(reopened.surface!.session.part(), [citation]);
    expect(node?.attrs['sourceId']).toBe('s1');
  });

  test('one undo removes the whole node', () => {
    const editor = mount('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const bodyBefore = editor.surface!.session.bodyText();
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 4 },
    });
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.surface!.session.bodyText()).toBe(bodyBefore);
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toEqual([]);
  });

  test('typing at the chip edge stays OUTSIDE the control', () => {
    const editor = mount('<w:p><w:r><w:t>before after</w:t></w:r></w:p>');
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'LABEL',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    // Caret right after the label's last character = the control's outer edge.
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraphId(editor), offset: 12 },
      head: { paragraphId: firstParagraphId(editor), offset: 12 },
    });
    editor.surface!.type(' ');
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    // The space landed BESIDE the control, never inside it (ledger 4.6).
    expect(node?.text).toBe('LABEL');
  });

  test('typing after a locked chip that ENDS the paragraph lands beside it', () => {
    const editor = mount('<w:p><w:r><w:t>before </w:t></w:r></w:p>');
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'LABEL',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    // "before LABEL" — the chip is the LAST thing in the paragraph. The caret at its
    // outer edge must type BESIDE the locked chip, not be refused for a write that was
    // never going into it.
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraphId(editor), offset: 12 },
      head: { paragraphId: firstParagraphId(editor), offset: 12 },
    });
    editor.surface!.type('x');
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.text).toBe('LABEL');
    expect(editor.surface!.session.bodyText()).toContain('LABELx');
  });

  test('typing at the chip LEFT edge lands before the chip, never in its locked label', () => {
    // A locked chip takes no typing, so its leading edge belongs to the text before it.
    const editor = mount('<w:p><w:r><w:t>before </w:t></w:r></w:p>');
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'LABEL',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraphId(editor), offset: 7 },
      head: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    editor.surface!.type('x');
    editor.surface!.type('y');
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.text).toBe('LABEL');
    expect(editor.surface!.session.bodyText()).toBe('before xyLABEL');
    expect(editor.surface!.state().lastRejection).toBeNull();
  });

  // #1121: a chip at the very start of a paragraph left no position before it that accepted a
  // keystroke, because the only caret there was the chip's own leading edge.
  test('typing before a chip at the start of a paragraph lands before it', () => {
    const editor = mount('<w:p/>');
    const paragraphId = firstParagraphId(editor);
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'LABEL',
      at: { paragraphId, offset: 0 },
    });
    const at = { paragraphId: firstParagraphId(editor), offset: 0 };
    editor.surface!.setSelection({ anchor: at, head: at });
    editor.surface!.type('S');
    editor.surface!.type('o');
    expect(editor.surface!.state().lastRejection).toBeNull();
    expect(editor.surface!.session.bodyText()).toBe('SoLABEL');
    expect(editor.surface!.state().selection.head.offset).toBe(2);
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.text).toBe('LABEL');
    // Undoing the keystrokes restores the paragraph and leaves the chip whole.
    editor.surface!.undo();
    editor.surface!.undo();
    expect(editor.surface!.session.bodyText()).toBe('LABEL');
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])[0]?.text).toBe('LABEL');
  });

  test('typing between two adjacent chips lands between them', () => {
    const editor = mount('<w:p/>');
    const paragraphId = firstParagraphId(editor);
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'a' },
      text: 'AAA',
      at: { paragraphId, offset: 0 },
    });
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'b' },
      text: 'BBB',
      at: { paragraphId: firstParagraphId(editor), offset: 3 },
    });
    const at = { paragraphId: firstParagraphId(editor), offset: 3 };
    editor.surface!.setSelection({ anchor: at, head: at });
    editor.surface!.type(' ');
    expect(editor.surface!.state().lastRejection).toBeNull();
    expect(editor.surface!.session.bodyText()).toBe('AAA BBB');
    const texts = recognizeCustomNodes(editor.surface!.session.part(), [citation]).map(
      (n) => n.text
    );
    expect(texts).toEqual(['AAA', 'BBB']);
  });

  test('Backspace after the chip selects the WHOLE node, a second Backspace deletes it', () => {
    const editor = mount('<w:p><w:r><w:t>before after</w:t></w:r></w:p>');
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'LABEL',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    // Caret at the chip's outer right edge — the atomic half of ledger 4.6: the key takes
    // the node as one unit, not one letter of a locked label.
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraphId(editor), offset: 12 },
      head: { paragraphId: firstParagraphId(editor), offset: 12 },
    });
    editor.surface!.deleteBackward();
    // The first press selects the node and deletes nothing.
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toHaveLength(1);
    expect(editor.surface!.state().selection.anchor.offset).toBe(12);
    expect(editor.surface!.state().selection.head.offset).toBe(7);
    editor.surface!.deleteBackward();
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toEqual([]);
    expect(editor.surface!.session.bodyText()).toBe('before after');
    // The caret lands where the node began.
    expect(editor.surface!.state().selection.head.offset).toBe(7);
    // One undo brings the whole node back.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toHaveLength(1);
  });

  test('Delete before the chip selects, then removes, the whole node too', () => {
    const editor = mount('<w:p><w:r><w:t>before after</w:t></w:r></w:p>');
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'LABEL',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraphId(editor), offset: 7 },
      head: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    editor.surface!.deleteForward();
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toHaveLength(1);
    editor.surface!.deleteForward();
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toEqual([]);
    expect(editor.surface!.session.bodyText()).toBe('before after');
  });

  test('typing INSIDE the node is refused — the label only changes through the edit flow', () => {
    const editor = mount('<w:p><w:r><w:t>before after</w:t></w:r></w:p>');
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'LABEL',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    // Caret in the middle of the label: `contentLocked` refuses the edit, so the
    // label cannot drift out of sync with the attrs by inline typing.
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraphId(editor), offset: 9 },
      head: { paragraphId: firstParagraphId(editor), offset: 9 },
    });
    editor.surface!.type('x');
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.text).toBe('LABEL');
  });

  test('a tag past the Word cap is refused with the data-part hint', () => {
    const editor = mount('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const result = insertCustomNode(editor, citation, {
      attrs: { payload: 'x'.repeat(80) },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('64');
  });

  test('an XML-hostile attr value round-trips escaped, never as markup', async () => {
    const editor = mount('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const hostile = '"&<x>';
    const inserted = insertCustomNode(editor, citation, {
      attrs: { q: hostile },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 0 },
    });
    expect(inserted.ok).toBe(true);
    const saved = new Uint8Array(await editor.save());
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    // URL-encoding covers most of it; whatever survives to the attribute is
    // escaped by the serializer. Either way: no raw markup in the part…
    expect(xml).not.toContain('<x>');
    // …and the value comes back byte-identical through a reopen.
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: saved,
      modules: [customNodesModule({ nodes: [citation] })],
    });
    const [node] = recognizeCustomNodes(reopened.surface!.session.part(), [citation]);
    expect(node?.attrs['q']).toBe(hostile);
  });

  test('a node inserted into a paragraph without one appears in the review list at once', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx('<w:p><w:r><w:t>before after</w:t></w:r></w:p>'),
      author: 'Demo Reviewer',
      modules: [customNodesModule({ nodes: [citation] }), reviewModule()],
    });
    const customItems = () => editor.getReviewItems().filter((item) => item.kind === 'custom');
    // Read first, so the next read starts from a cached list.
    expect(customItems()).toHaveLength(0);
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    expect(customItems()).toHaveLength(1);
    // Typing beside it keeps the item.
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraphId(editor), offset: 0 },
      head: { paragraphId: firstParagraphId(editor), offset: 0 },
    });
    editor.surface!.type('x');
    expect(customItems()).toHaveLength(1);
  });

  test('typing inside a block-level node updates its review card', () => {
    const block = defineCustomNode({
      name: 'block',
      tagPrefix: 'acme',
      reviewCard: ({ text }) => ({ title: text }),
    });
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(
        '<w:sdt><w:sdtPr><w:tag w:val="acme:block"/></w:sdtPr><w:sdtContent>' +
          '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>abc</w:t></w:r></w:p>' +
          '</w:sdtContent></w:sdt><w:p><w:r><w:t>after</w:t></w:r></w:p>'
      ),
      author: 'Demo Reviewer',
      modules: [customNodesModule({ nodes: [block] }), reviewModule()],
    });
    const cardText = () =>
      JSON.stringify(editor.getReviewItems().filter((item) => item.kind === 'custom'));
    expect(cardText()).toContain('abc');
    const second = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: second, offset: 1 },
      head: { paragraphId: second, offset: 1 },
    });
    editor.surface!.type('Z');
    expect(cardText()).toContain('aZbc');
  });

  test('typing that changes a node so its card appears updates the review list', () => {
    const flagged = defineCustomNode({
      name: 'flagged',
      tagPrefix: 'acme',
      reviewCard: ({ text }) => (text.includes('Z') ? { title: text } : null),
    });
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx('<w:p><w:r><w:t>before after</w:t></w:r></w:p>'),
      author: 'Demo Reviewer',
      modules: [customNodesModule({ nodes: [flagged] }), reviewModule()],
    });
    const customItems = () => editor.getReviewItems().filter((item) => item.kind === 'custom');
    insertCustomNode(editor, flagged, {
      attrs: {},
      text: 'abc',
      lock: false,
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
    });
    expect(customItems()).toHaveLength(0);
    const inside = { paragraphId: firstParagraphId(editor), offset: 9 };
    editor.surface!.setSelection({ anchor: inside, head: inside });
    editor.surface!.type('Z');
    expect(customItems()).toHaveLength(1);
  });

  test('in suggesting mode the node is proposed as a tracked insertion', async () => {
    const editor = mount('<w:p><w:r><w:t>text</w:t></w:r></w:p>', true);
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    const result = insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 4 },
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).toMatch(/<w:ins w:author="Demo Reviewer" w:date="[^"]+" w:id="\d+"><w:sdt>/);
    const revisions = editor.getReviewItems().filter((item) => item.kind === 'revision');
    expect(revisions).toHaveLength(1);

    // A proposed node cannot be rewritten in place: the rewrite would land untracked.
    const [proposed] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(updateCustomNode(editor, citation, proposed!.nodeId, { text: 'M' }).ok).toBe(false);

    const rejected = editor.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(rejected).toMatchObject({ committed: true });
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toEqual([]);
    expect(editor.surface!.session.bodyText()).toBe('text');
  });

  test('removing a proposed node removes the proposal with it', async () => {
    const editor = mount('<w:p><w:r><w:t>text</w:t></w:r></w:p>', true);
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 4 },
    });
    const [proposed] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(removeCustomNode(editor, proposed!.nodeId).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).not.toContain('<w:ins');
    expect(editor.getReviewItems().filter((item) => item.kind === 'revision')).toHaveLength(0);
  });

  test('typing after a node at the end of a paragraph takes the text formatting', async () => {
    // The node keeps its own style, bold, which text typed after it must not copy.
    const node =
      '<w:sdt><w:sdtPr><w:tag w:val="acme:citation"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>[1]</w:t></w:r></w:sdtContent></w:sdt>';
    for (const suggesting of [false, true]) {
      const editor = mount(
        `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>see</w:t></w:r>${node}</w:p>`,
        true
      );
      if (suggesting) expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const end = { paragraphId: firstParagraphId(editor), offset: 6 };
      editor.surface!.setSelection({ anchor: end, head: end });
      expect(editor.snapshot().formatting).toMatchObject({ bold: false, italic: true });
      editor.surface!.type('X');
      const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
      expect(xml).toMatch(/<\/w:sdt>(?:<w:ins [^>]*>)?<w:r><w:rPr><w:i\/><\/w:rPr><w:t>X<\/w:t>/);
      expect(xml.includes('<w:ins ')).toBe(suggesting);
    }
  });

  test('the toolbar beside a node at a paragraph start, or alone, shows what typing writes', async () => {
    const node =
      '<w:sdt><w:sdtPr><w:tag w:val="acme:citation"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>[1]</w:t></w:r></w:sdtContent></w:sdt>';
    const start = mount(`<w:p>${node}<w:r><w:rPr><w:i/></w:rPr><w:t>more</w:t></w:r></w:p>`);
    const atStart = { paragraphId: firstParagraphId(start), offset: 0 };
    start.surface!.setSelection({ anchor: atStart, head: atStart });
    expect(start.snapshot().formatting).toMatchObject({ bold: false, italic: true });
    const alone = mount(`<w:p>${node}</w:p>`);
    const after = { paragraphId: firstParagraphId(alone), offset: 3 };
    alone.surface!.setSelection({ anchor: after, head: after });
    expect(alone.snapshot().formatting?.bold).not.toBe(true);
    alone.surface!.type('X');
    const xml = strFromU8(unzipSync(new Uint8Array(await alone.save()))['word/document.xml']!);
    expect(xml).toContain('</w:sdt><w:r><w:t>X</w:t></w:r>');
  });
});
