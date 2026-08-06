/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The write story's second half: `updateCustomNode` rewrites an existing node's attrs and
// text at its own span (one transaction, one undo), `removeCustomNode` deletes it whole.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  customNodesModule,
  defineCustomNode,
  insertCustomNode,
  recognizeCustomNodes,
  removeCustomNode,
  updateCustomNode,
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

function mountWithChip(): { editor: DocxEditorInstance; nodeId: string } {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx('<w:p><w:r><w:t>before after</w:t></w:r></w:p>'),
    author: 'A',
    modules: [customNodesModule({ nodes: [citation] })],
  });
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  insertCustomNode(editor, citation, {
    attrs: { sourceId: 's1', locator: 'p.1' },
    text: 'OLD',
    at: { paragraphId: fragment.paragraphId, offset: 7 },
  });
  const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
  return { editor, nodeId: node!.nodeId };
}

describe('updateCustomNode', () => {
  test('rewrites attrs and text in place, one undo step', () => {
    const { editor, nodeId } = mountWithChip();
    const result = updateCustomNode(editor, citation, nodeId, {
      attrs: { sourceId: 's2', locator: 'p.9' },
      text: 'NEW',
      alias: 'Citation',
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.attrs).toEqual({ sourceId: 's2', locator: 'p.9' });
    expect(node?.text).toBe('NEW');
    // In place: same position in the paragraph text.
    expect(editor.surface!.session.bodyText()).toBe('before NEWafter');
    // ONE undo restores the old node whole.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const [restored] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(restored?.text).toBe('OLD');
    expect(restored?.attrs['sourceId']).toBe('s1');
  });

  test('answers the id of the control it authored, which is not the one it replaced', () => {
    const { editor, nodeId } = mountWithChip();
    const result = updateCustomNode(editor, citation, nodeId, { text: 'NEW' });
    if (!result.ok) console.log('UPDATE REFUSED:', JSON.stringify(result));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The rewrite replaces the control, so anything the host attached to `nodeId` has to
    // follow this id instead.
    expect(result.nodeId).toBeDefined();
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(result.nodeId).toBe(node!.nodeId);
  });

  test('an unknown node id is refused, not silently inserted', () => {
    const { editor } = mountWithChip();
    const result = updateCustomNode(editor, citation, 'no-such-node', { text: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('notFound');
  });
});

describe('removeCustomNode', () => {
  test('deletes the node — wrapper and label — as one unit', () => {
    const { editor, nodeId } = mountWithChip();
    expect(removeCustomNode(editor, nodeId)).toMatchObject({ ok: true, changed: true });
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toEqual([]);
    expect(editor.surface!.session.bodyText()).toBe('before after');
  });
});

// The write lane, not the tag codec: which STORY a write lands in, and whether it lands at
// all. Both were wrong in ways that reported success or blamed the wrong thing — a chip in a
// header could not be found, and a document open for viewing was edited anyway because these
// writes go through the store, below the surface's editing-mode gate.
describe('custom-node writes respect the story and the mode', () => {
  function docxWithHeader(): Uint8Array {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>header text</w:t></w:r></w:p></w:hdr>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>body text</w:t></w:r></w:p>` +
          `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>` +
          `</w:body></w:document>`
      ),
    });
  }

  /** An editor with a chip inserted INSIDE the open header. */
  function mountWithHeaderChip(): { editor: DocxEditorInstance; nodeId: string } {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docxWithHeader(),
      author: 'A',
      modules: [customNodesModule({ nodes: [citation] })],
    });
    const entered = editor.surface!.enterHeaderFooter!({ rId: 'rIdH', kind: 'header' });
    if (!entered) throw new Error('could not open the header');
    const headerPart = editor.surface!.session.partFor({ kind: 'headerFooter', rId: 'rIdH' })!;
    const paragraphId = editor.surface!.session.paragraphIdsIn({
      kind: 'headerFooter',
      rId: 'rIdH',
    })[0]!;
    const inserted = insertCustomNode(editor, citation, {
      attrs: { sourceId: 's1' },
      text: 'CHIP',
      at: { paragraphId, offset: 0 },
    });
    if (!inserted.ok) throw new Error(`insert refused: ${inserted.reason}`);
    const refreshed = editor.surface!.session.partFor({ kind: 'headerFooter', rId: 'rIdH' })!;
    void headerPart;
    const [node] = recognizeCustomNodes(refreshed, [citation]);
    if (!node?.nodeId) throw new Error('the chip was not recognized in the header');
    return { editor, nodeId: node.nodeId };
  }

  test('removing a chip in an open header removes it, rather than reporting notFound', () => {
    const { editor, nodeId } = mountWithHeaderChip();
    expect(removeCustomNode(editor, nodeId).ok).toBe(true);
    const headerPart = editor.surface!.session.partFor({ kind: 'headerFooter', rId: 'rIdH' })!;
    expect(recognizeCustomNodes(headerPart, [citation])).toHaveLength(0);
  });

  test('updating a chip in an open header finds it, rather than looking in the body', () => {
    const { editor, nodeId } = mountWithHeaderChip();
    const result = updateCustomNode(editor, citation, nodeId, { text: 'NEW' });
    expect(result.ok).toBe(true);
    const headerPart = editor.surface!.session.partFor({ kind: 'headerFooter', rId: 'rIdH' })!;
    const [node] = recognizeCustomNodes(headerPart, [citation]);
    expect(node?.text).toBe('NEW');
  });

  test('a document open for viewing refuses both writes instead of performing them', () => {
    // These go through the STORE, below the surface's editing-mode gate, so without an
    // explicit refusal the context menu deleted a chip in a read-only document and reported
    // success.
    const { editor, nodeId } = mountWithChip();
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);

    const removed = removeCustomNode(editor, nodeId);
    expect(removed.ok).toBe(false);
    const updated = updateCustomNode(editor, citation, nodeId, { text: 'NEW' });
    expect(updated.ok).toBe(false);

    // And the document is untouched: the chip is still there with its original label.
    const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
    expect(node?.text).toBe('OLD');
  });
});
