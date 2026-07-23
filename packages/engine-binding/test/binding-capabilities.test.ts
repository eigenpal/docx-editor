// Binding capability registry (comprehensive 3.4/3.5). The ProseMirror schema is COMPOSED from
// registered node/mark capabilities, and each block kind projects through its registered projector
// (paragraph editable; every other kind a read-only atom) — modelToDoc has no block.kind switch.

import { describe, expect, test } from 'bun:test';
import { docSchema, modelToDoc, EditorBinding } from '../src/index.ts';
import { projectBlock } from '../src/binding-capabilities.ts';
import { createEmptyModel, bodyStoryId, DocumentStore, type Block, type PackageModel } from '@docx-editor.dev/engine-core';

describe('composed schema + per-kind projection', () => {
  test('the composed schema has exactly the registered nodes and marks', () => {
    expect(Object.keys(docSchema.nodes).sort()).toEqual(['blockEmbed', 'doc', 'paragraph', 'text']);
    expect(Object.keys(docSchema.marks).sort()).toEqual(['bold', 'italic']);
    expect(docSchema.topNodeType.name).toBe('doc'); // doc registered first stays the top node
  });

  test('projectBlock dispatches a paragraph to a paragraph node carrying its semId', () => {
    const p: Block = { kind: 'paragraph', id: 'p-7', runs: [{ text: 'hi', props: { bold: true } }] };
    const node = projectBlock(p, docSchema);
    expect(node.type.name).toBe('paragraph');
    expect(node.attrs.semId).toBe('p-7');
    expect(node.textContent).toBe('hi');
    expect(node.firstChild!.marks.some((m) => m.type.name === 'bold')).toBe(true);
  });

  test('projectBlock dispatches a non-paragraph kind to a read-only blockEmbed atom', () => {
    const table: Block = { kind: 'table', id: 't-3', rows: [] };
    const node = projectBlock(table, docSchema);
    expect(node.type.name).toBe('blockEmbed');
    expect(node.attrs).toMatchObject({ semId: 't-3', kind: 'table' });
    expect(node.type.isAtom).toBe(true);
  });

  test('modelToDoc projects a mixed body through the capabilities (paragraphs + read-only atoms)', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    const blocks: Block[] = [
      { kind: 'paragraph', id: 'a', runs: [{ text: 'A' }] },
      { kind: 'table', id: 'tbl', rows: [] },
      { kind: 'sdt', id: 's', props: {}, blocks: [] },
    ];
    const model: PackageModel = { ...base, stories: new Map(base.stories).set(sid, { ...base.stories.get(sid)!, blocks }) };
    const doc = modelToDoc(model);
    expect([...Array(doc.childCount).keys()].map((i) => doc.child(i).type.name)).toEqual([
      'paragraph',
      'blockEmbed',
      'blockEmbed',
    ]);
  });

  test('the binding still round-trips an edit through the composed schema', () => {
    const store = new DocumentStore(createEmptyModel());
    const binding = new EditorBinding(store);
    const doc = binding.projectDoc();
    expect(doc.type.name).toBe('doc');
    expect(doc.firstChild!.type.name).toBe('paragraph');
  });
});
