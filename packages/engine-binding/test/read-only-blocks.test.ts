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

  test('a preserved (table) document is read-only: a body-paragraph edit still saves fail-closed', () => {
    // The forward mapper WILL produce a targeted op (the store is not the boundary), but a
    // preserved document cannot regenerate an edited top-level paragraph — writeDocx fails
    // closed. This is exactly why the editor opens documents with tables/SDTs read-only.
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
    // Saving the edited preserved document fails closed rather than dropping content.
    expect(() => writeDocx(store.currentModel)).toThrow();
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
