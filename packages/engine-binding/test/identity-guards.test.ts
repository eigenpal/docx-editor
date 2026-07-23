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
  test('a CLEAN duplicated-id split (Enter) commits as one splitParagraph', () => {
    const { store, binding, ids } = twoParagraphBinding();
    // Two nodes carry ids[0] with the SAME combined text — exactly what Enter/splitBlock
    // produces. This is a real split: it commits, and the store mints the tail's identity.
    const doc = docSchema.node('doc', null, [para(ids[0], 'on'), para(ids[0], 'e'), para(ids[1], 'two')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([{ op: 'splitParagraph', paragraphId: ids[0], offset: 2 }]);
    const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks;
    expect(blocks.map((b) => b.id)).toHaveLength(3);
    expect(blocks[0].id).toBe(ids[0]); // head keeps identity
    expect(blocks[1].id).not.toBe(ids[0]); // tail gets a fresh id (no duplicate)
  });

  test('a duplicated id whose text does NOT match a clean split fails closed', () => {
    const { store, binding, ids } = twoParagraphBinding();
    // 'on' + 'X' != 'one' — a split combined with an edit is refused (nothing corrupted).
    const doc = docSchema.node('doc', null, [para(ids[0], 'on'), para(ids[0], 'X'), para(ids[1], 'two')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
    expect(store.currentRevision).toBe(0);
  });

  test('a stale / forged non-null id fails closed (no append+delete)', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const doc = docSchema.node('doc', null, [para(ids[0], 'one'), para('p-nonexistent', 'ghost')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
  });

  test('appending a genuinely new paragraph (new content, not a clean split) fails closed', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const doc = docSchema.node('doc', null, [para(ids[0], 'one'), para(ids[1], 'two'), para(null, 'three')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
  });

  test('reordering paragraphs (unchanged text) fails closed', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const doc = docSchema.node('doc', null, [para(ids[1], 'two'), para(ids[0], 'one')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
  });

  test('an in-place text edit of one paragraph maps to exactly one op', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const doc = docSchema.node('doc', null, [para(ids[0], 'ONE!'), para(ids[1], 'two')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toHaveLength(1);
    expect(res.ops[0].op).toBe('setParagraphRuns');
    expect(store.currentRevision).toBe(1);
  });

  test('paragraphNodeToRuns still reads plain text (sanity)', () => {
    expect(paragraphNodeToRuns(para('x', 'hi')).map((r) => r.text).join('')).toBe('hi');
  });
});

describe('adjacent same-format runs are not spuriously rewritten', () => {
  function twoRunBinding() {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>' + // two adjacent plain runs
          '<w:p><w:r><w:t>x</w:t></w:r></w:p>' +
          '</w:body></w:document>',
      ),
    });
    const r = parseDocx(bytes);
    if (!r.ok) throw new Error(r.reason);
    const store = new DocumentStore(r.model);
    const ids = r.model.stories.get(bodyStoryId(r.model))!.blocks.map((b) => b.id);
    return { store, binding: new EditorBinding(store), ids };
  }
  const paraOf = (store: DocumentStore, id: string) =>
    store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.find((b) => b.id === id) as {
      runs: { text: string }[];
    };
  const textOf = (store: DocumentStore, id: string) => paraOf(store, id).runs.map((r) => r.text).join('');

  test('reprojecting (PM coalesces the two runs) commits NOTHING — no spurious rewrite', () => {
    const { store, binding, ids } = twoRunBinding();
    expect(paraOf(store, ids[0]).runs).toHaveLength(2); // authored segmentation on load
    const res = binding.commitFromDoc(binding.projectDoc()); // PM merges "a"+"b" -> "ab"
    expect(res.ops).toHaveLength(0); // the binding does NOT rewrite an unchanged paragraph
    expect(paraOf(store, ids[0]).runs).toHaveLength(2); // no commit -> segmentation intact
  });

  test('editing the OTHER paragraph emits ONE op and never drops the two-run text', () => {
    const { store, binding, ids } = twoRunBinding();
    const doc = docSchema.node('doc', null, [binding.projectDoc().child(0), para(ids[1], 'X!')]);
    const res = binding.commitFromDoc(doc);
    // Exactly one op — the binding does not fabricate an edit for the untouched paragraph.
    expect(res.ops).toHaveLength(1);
    expect(res.ops[0]).toMatchObject({ op: 'setParagraphRuns', paragraphId: ids[1] });
    // The untouched paragraph's TEXT is fully preserved (the store may canonicalize its
    // adjacent identical-format runs — lossless in text and formatting).
    expect(textOf(store, ids[0])).toBe('ab');
    expect(textOf(store, ids[1])).toBe('X!');
  });
});
