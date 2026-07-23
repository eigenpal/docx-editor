// Forward-mapper identity guards (queue item 3, review round 2). A paragraph edit must
// map back to exactly one existing paragraph by semId. A DUPLICATED id (what a naive PM
// split produces), a stale/forged non-null id, or a paragraph claiming a read-only block's
// id all fail closed rather than silently corrupt or drop canonical content. A genuinely
// new paragraph (semId null) is the only append path.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { docSchema, EditorBinding, paragraphNodeToRuns } from '../src/index.ts';
import { DocumentStore, parseDocx, bodyStoryId, ORIGIN_IDS } from '@docx-editor.dev/engine-core';
import type { Node as PMNode } from 'prosemirror-model';

const HUMAN = ORIGIN_IDS.mutationHuman;

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

  test('a split COMBINED with an edit to another paragraph fails closed (no dropped edit)', () => {
    const { store, binding, ids } = twoParagraphBinding(); // ids[0]='one', ids[1]='two'
    // Split ids[0] ('on'+'e'='one', a clean split) but ALSO change ids[1] to 'EDITED'. The
    // second edit must not be silently dropped: the whole transaction fails closed.
    const doc = docSchema.node('doc', null, [para(ids[0], 'on'), para(ids[0], 'e'), para(ids[1], 'EDITED')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
    expect(store.currentRevision).toBe(0);
  });

  test('a JOIN combined with an edit BEFORE the joined pair fails closed', () => {
    const { store, binding, ids } = twoParagraphBinding(); // ids[0]='one', ids[1]='two'
    store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) }));
    const ids2 = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.map((b) => b.id);
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: ids2[2], text: 'three' }));
    // Join ids[1]+ids2[2] ('two'+'three') cleanly, but ALSO edit ids[0] 'one'->'EDIT'. The
    // pre-survivor edit must not be dropped: fail closed.
    const doc = docSchema.node('doc', null, [para(ids[0], 'EDIT'), para(ids[1], 'twothree')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
  });

  test('a split that also changes FORMATTING (not just text) fails closed', () => {
    const { store, binding, ids } = twoParagraphBinding(); // ids[0]='one'
    // Same text ('on'+'e'='one') but the head is now bold — a formatting edit rides the split.
    const doc = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: ids[0] }, [docSchema.text('on', [docSchema.marks.bold.create()])]),
      docSchema.node('paragraph', { semId: ids[0] }, [docSchema.text('e')]),
      para(ids[1], 'two'),
    ]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
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

  test("a split whose TAIL forges another block's id fails closed", () => {
    const { store, binding, ids } = twoParagraphBinding(); // ids[0]='one', ids[1]='two'
    // Head keeps ids[0] and text concatenates cleanly, but the tail claims ids[1] (a real other
    // block) instead of null-or-copied — reject rather than corrupt identities.
    const doc = docSchema.node('doc', null, [para(ids[0], 'on'), para(ids[1], 'e'), para(ids[1], 'two')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
  });

  test('a split BETWEEN a surrogate pair fails closed (would corrupt the astral char)', () => {
    // Model paragraph "😀X" (😀 = 😀). A split whose boundary lands between the
    // surrogates recombines under normalization (so the clean-split check passes) but the store
    // would slice at code-unit 1, leaving lone surrogates that become U+FFFD on UTF-8 save.
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>😀X</w:t></w:r></w:p></w:body></w:document>`),
    });
    const r = parseDocx(bytes);
    if (!r.ok) throw new Error(r.reason);
    const store = new DocumentStore(r.model);
    const binding = new EditorBinding(store);
    const id = r.model.stories.get(bodyStoryId(r.model))!.blocks[0].id;
    const doc = docSchema.node('doc', null, [para(id, '\uD83D'), para(id, '\uDE00X')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
    // A split AFTER the whole emoji (offset 2) is fine — the astral char stays whole.
    const ok = docSchema.node('doc', null, [para(id, '😀'), para(id, 'X')]);
    expect(binding.commitFromDoc(ok).ops).toEqual([{ op: 'splitParagraph', paragraphId: id, offset: 2 }]);
  });

  test('splitting at the START of a paragraph (empty head, copied id) commits cleanly', () => {
    const { store, binding, ids } = twoParagraphBinding(); // ids[1]='two'
    // Enter at the start of the 2nd paragraph: [one, ''(two-id), 'two'(two-id)] — a valid split.
    const doc = docSchema.node('doc', null, [para(ids[0], 'one'), para(ids[1], ''), para(ids[1], 'two')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([{ op: 'splitParagraph', paragraphId: ids[1], offset: 0 }]);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks).toHaveLength(3);
  });

  test('a stale / forged non-null id fails closed (no append+delete)', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const doc = docSchema.node('doc', null, [para(ids[0], 'one'), para('p-nonexistent', 'ghost')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
  });

  test('appending a genuinely new paragraph at the end maps to insertParagraph', () => {
    const { store, binding, ids } = twoParagraphBinding();
    const storyId = bodyStoryId(store.currentModel);
    const doc = docSchema.node('doc', null, [para(ids[0], 'one'), para(ids[1], 'two'), para(null, 'three')]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([{ op: 'insertParagraph', storyId, index: 2, runs: [{ text: 'three' }] }]);
    expect(store.currentRevision).toBe(1);
    expect(store.currentModel.stories.get(storyId)!.blocks).toHaveLength(3);
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

describe('read-only atoms are matched by kind, not just id', () => {
  function tableBinding() {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:r><w:t>p</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
          '</w:body></w:document>',
      ),
    });
    const r = parseDocx(bytes);
    if (!r.ok) throw new Error(r.reason);
    const store = new DocumentStore(r.model);
    return { store, binding: new EditorBinding(store), doc: new EditorBinding(store).projectDoc() };
  }

  test('an atom RETYPED (kind changed) fails closed rather than committing zero ops', () => {
    const { store, binding, doc } = tableBinding();
    const embed = doc.child(1);
    expect(embed.type.name).toBe('blockEmbed');
    expect(embed.attrs.kind).toBe('table');
    // Forge the atom's kind to 'sdt' while keeping its id — the view would diverge from the model.
    const forged = docSchema.node('doc', null, [
      doc.child(0),
      docSchema.node('blockEmbed', { semId: embed.attrs.semId, kind: 'sdt' }),
    ]);
    const res = binding.commitFromDoc(forged);
    expect(res.rejected).toBe(true);
    expect(store.currentRevision).toBe(0);
  });

  test('the untouched table projection commits nothing', () => {
    const { binding, doc } = tableBinding();
    expect(binding.commitFromDoc(doc).ops).toHaveLength(0);
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
