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
  insertCustomNode(editor, citation, { sourceId: 's1', locator: 'p.1' }, 'OLD', {
    at: { paragraphId: fragment.paragraphId, offset: 7 },
  });
  const [node] = recognizeCustomNodes(editor.surface!.session.part(), [citation]);
  return { editor, nodeId: node!.nodeId };
}

describe('updateCustomNode', () => {
  test('rewrites attrs and text in place, one undo step', () => {
    const { editor, nodeId } = mountWithChip();
    const result = updateCustomNode(
      editor,
      citation,
      nodeId,
      { sourceId: 's2', locator: 'p.9' },
      'NEW',
      { alias: 'Citation' }
    );
    expect(result).toEqual({ ok: true, changed: true });
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

  test('an unknown node id is refused, not silently inserted', () => {
    const { editor } = mountWithChip();
    const result = updateCustomNode(editor, citation, 'no-such-node', {}, 'X');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('notFound');
  });
});

describe('removeCustomNode', () => {
  test('deletes the node — wrapper and label — as one unit', () => {
    const { editor, nodeId } = mountWithChip();
    expect(removeCustomNode(editor, nodeId)).toEqual({ ok: true, changed: true });
    expect(recognizeCustomNodes(editor.surface!.session.part(), [citation])).toEqual([]);
    expect(editor.surface!.session.bodyText()).toBe('before after');
  });
});
