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
} from '../index.ts';

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

function mount(body: string): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    author: 'Demo Reviewer',
    modules: [customNodesModule({ nodes: [citation] })],
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
    expect(result).toEqual({ ok: true, changed: true });
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

  test('typing at the chip LEFT edge is refused — the caret would enter the locked label', () => {
    // Word's rule: at a control's leading edge the insertion enters the control, and the
    // content lock refuses it. One caret-step left types normally.
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
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.text).toBe('LABEL');
    expect(editor.surface!.session.bodyText()).toBe('before LABEL');
  });

  test('Backspace after the chip deletes the WHOLE node', () => {
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
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toEqual([]);
    expect(editor.surface!.session.bodyText()).toBe('before after');
    // The caret lands where the node began.
    expect(editor.surface!.state().selection.head.offset).toBe(7);
    // One undo brings the whole node back.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toHaveLength(1);
  });

  test('Delete before the chip removes the whole node too', () => {
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
});
