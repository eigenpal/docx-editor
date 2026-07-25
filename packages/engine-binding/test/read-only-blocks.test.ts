// Editing vertical, read-only-unsupported contract (queue item 3): a document whose
// body mixes paragraphs with non-paragraph blocks (tables, SDTs) must project into
// ProseMirror WITHOUT flattening — non-paragraph blocks become read-only atom nodes that
// carry their authored semId. Editing a paragraph produces one targeted DocOp and leaves
// the non-paragraph blocks untouched in the canonical store (so writeDocx re-emits them
// verbatim). Any structural disturbance of a read-only block fails closed (no commit).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { docSchema, modelToDoc, EditorBinding } from '../src/index.ts';
import { DocumentStore, parseDocx, writeDocx, bodyStoryId } from '@docx-editor.dev/engine-core';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docx(bodyInner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
  });
}
const MIXED =
  '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

function storeFrom(bodyInner: string): DocumentStore {
  const r = parseDocx(docx(bodyInner));
  if (!r.ok) throw new Error(`parse failed: ${r.reason} ${r.detail ?? ''}`);
  return new DocumentStore(r.model);
}
function bodyBlockKinds(store: DocumentStore): string[] {
  const model = store.currentModel;
  return model.stories.get(bodyStoryId(model))!.blocks.map((b) => b.kind);
}

describe('projection preserves non-paragraph blocks as read-only atoms', () => {
  test('a table projects as a read-only blockEmbed atom, not a flattened paragraph', () => {
    const store = storeFrom(MIXED);
    const doc = modelToDoc(store.currentModel);
    const kinds: string[] = [];
    doc.forEach((n) => kinds.push(n.type.name));
    expect(kinds).toEqual(['paragraph', 'blockEmbed', 'paragraph']);
    // The atom is non-editable and carries the block's semId + kind.
    const embed = doc.child(1);
    expect(embed.type.spec.atom).toBe(true);
    expect(embed.attrs.kind).toBe('table');
    const tableId = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[1].id;
    expect(embed.attrs.semId).toBe(tableId);
  });

  test('an unchanged reprojected doc maps to zero ops (table not deleted)', () => {
    const store = storeFrom(MIXED);
    const binding = new EditorBinding(store);
    const before = writeDocx(store.currentModel);
    const res = binding.commitFromDoc(binding.projectDoc());
    expect(res.ops.length).toBe(0);
    expect(bodyBlockKinds(store)).toEqual(['paragraph', 'table', 'paragraph']);
    // Byte-identical save: the table (and everything) survives untouched.
    expect(strFromU8(unzipSync(writeDocx(store.currentModel))['word/document.xml'])).toBe(
      strFromU8(unzipSync(before)['word/document.xml']),
    );
  });

  test('editing a fully-captured body paragraph in a preserved doc patches it; table verbatim', () => {
    // Selective preservation: the edit regenerates only that paragraph in place; the table
    // and every other byte stay verbatim. (The editor still opens table docs read-only at
    // the SESSION level because the whole body must be patchable — covered separately.)
    const store = storeFrom(MIXED);
    const binding = new EditorBinding(store);
    const doc = binding.projectDoc();
    const newParas: import('prosemirror-model').Node[] = [];
    doc.forEach((n, _off, i) => {
      if (i === 0) newParas.push(docSchema.node('paragraph', n.attrs, docSchema.text('BEFORE!')));
      else newParas.push(n);
    });
    const res = binding.commitFromDoc(docSchema.node('doc', null, newParas));
    expect(res.ops.length).toBe(1);
    expect(res.ops[0].op).toBe('setParagraphRuns');
    expect(bodyBlockKinds(store)).toEqual(['paragraph', 'table', 'paragraph']); // table structurally intact
    const out = strFromU8(unzipSync(writeDocx(store.currentModel))['word/document.xml']);
    expect(out).toContain('BEFORE!'); // edited paragraph patched
    expect(out).toContain('cell'); // table cell text preserved verbatim
  });

  test('deleting a read-only atom fails closed (no commit, table preserved)', () => {
    const store = storeFrom(MIXED);
    const binding = new EditorBinding(store);
    const doc = binding.projectDoc();
    // Drop the blockEmbed (index 1), keep the two paragraphs — an illegal structural edit.
    const kept: import('prosemirror-model').Node[] = [];
    doc.forEach((n, _off, i) => {
      if (i !== 1) kept.push(n);
    });
    const mangled = docSchema.node('doc', null, kept);
    const res = binding.commitFromDoc(mangled);
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
    // Store is untouched — the table is still there.
    expect(bodyBlockKinds(store)).toEqual(['paragraph', 'table', 'paragraph']);
  });
});

// --- The join lane (independent security review, High 1) ----------------------------
//
// Every reverse lane validates the block it touches against the read-only policy. The
// JOIN lane did not, and a join DELETES its second block — so a read-only paragraph
// could be removed from the canonical store outright. Delegation makes it reachable
// without any special client: a native `deleteWordBackward` at the start of the
// paragraph after a read-only block lets the browser remove the block itself, and
// ProseMirror reconciles a doc with one fewer top-level node straight into this lane.
//
// The paragraph below is the dangerous shape: read-only, but with NO text runs, so the
// "join combined with an edit" check passes (survivor runs === X's runs + nothing) and
// every kind/alignment check passes too. Nothing else stood in the way.
describe('the join lane honors the read-only policy', () => {
  const EMPTY_MIDDLE =
    '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Locked"/></w:pPr></w:p>' +
    '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

  function joinAwayMiddle(store: DocumentStore, readOnly: readonly string[]) {
    const binding = new EditorBinding(store);
    binding.setReadOnlyBlockIds(new Set(readOnly));
    const doc = binding.projectDoc();
    const kept: import('prosemirror-model').Node[] = [];
    doc.forEach((n, _off, i) => {
      if (i !== 1) kept.push(n);
    });
    return binding.commitFromDoc(docSchema.node('doc', null, kept));
  }

  test('joining away a read-only paragraph is rejected and the block survives', () => {
    const store = storeFrom(EMPTY_MIDDLE);
    const ids = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.map((b) => b.id);
    const res = joinAwayMiddle(store, [ids[1]]);
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
    // The canonical store still holds all three paragraphs.
    expect(bodyBlockKinds(store)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  test('the same join is allowed when no block is read-only', () => {
    // The control. Without it, "rejected" could mean this join shape never maps at all,
    // which would make the assertion above true for the wrong reason.
    const store = storeFrom(EMPTY_MIDDLE);
    const res = joinAwayMiddle(store, []);
    expect(res.ops).toEqual([
      { op: 'joinParagraphs', firstId: expect.any(String), secondId: expect.any(String) },
    ]);
    expect(bodyBlockKinds(store)).toEqual(['paragraph', 'paragraph']);
  });
});

// --- The reverse mapper's policy checks (independent correctness review, High 3) -----
//
// Both read-only branches in the reverse mapper shipped with NO regression guard: they
// could be disabled together and the whole engine suite stayed green. The join-lane hole
// found next door was reachable from a plain native delete, so an unguarded fix here is a
// live risk, not hygiene. These two tests pin each branch.
describe('the reverse mapper validates both directions against the policy', () => {
  const THREE = '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>';

  test('editing a paragraph the policy locks is rejected, not committed', () => {
    // binding.ts: `edit targets a read-only block`. Without it the store commits
    // setParagraphRuns for content with no lossless patch path, and the failure surfaces
    // at SAVE with the model already mutated.
    const store = storeFrom(THREE);
    const binding = new EditorBinding(store);
    const locked = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0].id;
    // Project FIRST (unlocked), so the doc holds an editable paragraph node for the block
    // the policy locks a moment later — exactly the disagreement the branch exists for.
    const doc = binding.projectDoc();
    binding.setReadOnlyBlockIds(new Set([locked]));
    const edited: import('prosemirror-model').Node[] = [];
    doc.forEach((n, _off, i) => {
      edited.push(i === 0 ? n.type.create(n.attrs, docSchema.text('EDITED')) : n);
    });
    const res = binding.commitFromDoc(docSchema.node('doc', null, edited));
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0]).toMatchObject({
      runs: [{ text: 'one' }],
    });
  });

  test('an atom naming a block the policy says is editable is rejected', () => {
    // binding.ts: `read-only atom names an editable block`. Projection and policy
    // disagreeing must fail closed rather than silently freezing a paragraph.
    const store = storeFrom(THREE);
    const binding = new EditorBinding(store);
    const ids = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.map((b) => b.id);
    binding.setReadOnlyBlockIds(new Set([ids[0]]));
    const doc = binding.projectDoc(); // block 0 projects as an atom
    binding.setReadOnlyBlockIds(new Set()); // …and the policy now says it is editable
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(res.ops.length).toBe(0);
  });
});
