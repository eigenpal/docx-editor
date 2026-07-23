// Forward-mapper identity guards (queue item 3, review round 2). A paragraph edit must
// map back to exactly one existing paragraph by semId. A DUPLICATED id (what a naive PM
// split produces), a stale/forged non-null id, or a paragraph claiming a read-only block's
// id all fail closed rather than silently corrupt or drop canonical content. A genuinely
// new paragraph (semId null) is the only append path.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { docSchema, EditorBinding, paragraphNodeToRuns } from '../src/index.ts';
import { DocumentStore, parseDocx, bodyStoryId } from '@docx-editor.dev/engine-core';
import type { Node as PMNode } from 'prosemirror-model';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function twoParagraphBinding() {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    ),
  });
  const r = parseDocx(bytes);
  if (!r.ok) throw new Error(r.reason);
  const store = new DocumentStore(r.model);
  const ids = r.model.stories.get(bodyStoryId(r.model))!.blocks.map((b) => b.id);
  return { store, binding: new EditorBinding(store), ids };
}
const para = (semId: string | null, text: string): PMNode =>
  docSchema.node('paragraph', { semId }, text ? docSchema.text(text) : undefined);

describe('forward-mapper identity guards', () => {
  test('a duplicated paragraph id (naive split) fails closed', () => {
    const { store, binding, ids } = twoParagraphBinding();
    // Two nodes carry ids[0] — what an Enter/splitBlock would produce.
    const doc = docSchema.node('doc', null, [para(ids[0], 'on'), para(ids[0], 'e'), para(ids[1], 'two')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
    expect(store.currentRevision).toBe(0); // no commit
  });

  test('a stale / forged non-null id fails closed (no append+delete)', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const doc = docSchema.node('doc', null, [para(ids[0], 'one'), para('p-nonexistent', 'ghost')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
  });

  test('a genuinely new paragraph (semId null) is the only append path', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const doc = docSchema.node('doc', null, [para(ids[0], 'one'), para(ids[1], 'two'), para(null, 'three')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBeUndefined();
    expect(res.ops.some((o) => o.op === 'appendParagraph')).toBe(true);
    expect(store.currentRevision).toBe(1);
  });

  test('paragraphNodeToRuns still reads plain text (sanity)', () => {
    expect(paragraphNodeToRuns(para('x', 'hi')).map((r) => r.text).join('')).toBe('hi');
  });
});
