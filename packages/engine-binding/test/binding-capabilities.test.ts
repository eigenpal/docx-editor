// Binding capability registry (comprehensive 3.4/3.5). The ProseMirror schema is COMPOSED from
// registered node/mark capabilities, and each block kind projects through its registered projector
// (paragraph editable; every other kind a read-only atom) — modelToDoc has no block.kind switch.

import { describe, expect, test } from 'bun:test';
import { docSchema, modelToDoc, EditorBinding, nodeRole, hasBlockProjector, assertBindingLaneComplete } from '../src/index.ts';
import {
  projectBlock,
  registerBlockProjector,
  isBindingEditableKind,
  snapshotBindingRegistryForTest,
  restoreBindingRegistryForTest,
} from '../src/binding-capabilities.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  registerCoreBlockCapability,
  snapshotBlockRegistryForTest,
  restoreBlockRegistryForTest,
  type Block,
  type PackageModel,
} from '@docx-editor.dev/engine-core';

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

  test('registered block nodes declare reverse-mapping roles (the forward mapper dispatches on them)', () => {
    expect(nodeRole('paragraph')).toBe('paragraph'); // editable text block
    expect(nodeRole('blockEmbed')).toBe('atom'); // read-only projected block
    expect(nodeRole('text')).toBeUndefined(); // structural, not a block target
    expect(nodeRole('doc')).toBeUndefined();
  });

  test('the binding still round-trips an edit through the composed schema', () => {
    const store = new DocumentStore(createEmptyModel());
    const binding = new EditorBinding(store);
    const doc = binding.projectDoc();
    expect(doc.type.name).toBe('doc');
    expect(doc.firstChild!.type.name).toBe('paragraph');
  });
});

describe('binding lane feature-completeness (comprehensive 3.9)', () => {
  test('the built-in surface passes: paragraph is editable and declared binding-editable', () => {
    expect(hasBlockProjector('paragraph')).toBe(true); // first-class editable projection
    expect(isBindingEditableKind('paragraph')).toBe(true); // reverse lane round-trips it
    expect(hasBlockProjector('table')).toBe(false); // read-only, rides the default embed
    expect(isBindingEditableKind('table')).toBe(false);
    expect(() => assertBindingLaneComplete()).not.toThrow();
  });

  test('an editable core kind with no binding projector is rejected (would become uneditable)', () => {
    const snap = snapshotBlockRegistryForTest();
    try {
      // A core kind that is top-level-editable but contributes NO binding projector: it would
      // silently fall back to the read-only embed, so the lane check must reject it.
      registerCoreBlockCapability({
        kind: 'callout' as Block['kind'],
        editPolicy: { topLevelEditable: true },
        semanticOps: ['setParagraphRuns'],
      });
      expect(() => assertBindingLaneComplete()).toThrow(/binding lane incomplete[\s\S]*callout[\s\S]*no binding projector/);
    } finally {
      restoreBlockRegistryForTest(snap);
    }
    expect(() => assertBindingLaneComplete()).not.toThrow(); // restored
  });

  test('an editable core kind with a projector the reverse lane cannot map is still rejected', () => {
    // The soundness case: a projector EXISTS, but the kind is not in the reverse lane's
    // BINDING_EDITABLE_KINDS, so its edits cannot map to DocOps — a projector alone is NOT proof of a
    // round-trip. Editability is an internal reverse-lane fact, never a projector/caller assertion,
    // so we register a projector for a fresh kind AND make it core-editable, then check rejection.
    const coreSnap = snapshotBlockRegistryForTest();
    const bindSnap = snapshotBindingRegistryForTest();
    registerBlockProjector('widget', (block, schema) => schema.node('blockEmbed', { semId: block.id, kind: block.kind }));
    try {
      registerCoreBlockCapability({ kind: 'widget' as Block['kind'], editPolicy: { topLevelEditable: true } });
      expect(isBindingEditableKind('widget')).toBe(false); // never became editable — no caller flag
      expect(() => assertBindingLaneComplete()).toThrow(
        /binding lane incomplete[\s\S]*widget[\s\S]*cannot map its edits to DocOps/,
      );
    } finally {
      restoreBlockRegistryForTest(coreSnap);
      restoreBindingRegistryForTest(bindSnap); // no projector leak into sibling/watch-mode tests
    }
    expect(() => assertBindingLaneComplete()).not.toThrow(); // restored
  });

  test('the version-keyed guard catches a late incomplete editable kind through the real constructor', () => {
    const store = new DocumentStore(createEmptyModel());
    new EditorBinding(store); // first open latches the current registry version (complete)
    const snap = snapshotBlockRegistryForTest();
    try {
      // Registering a late editable kind with no projector bumps blockRegistryVersion, so the NEXT
      // construction re-validates (not skipped by a one-shot latch) and rejects.
      registerCoreBlockCapability({ kind: 'callout' as Block['kind'], editPolicy: { topLevelEditable: true } });
      expect(() => new EditorBinding(store)).toThrow(/binding lane incomplete[\s\S]*callout/);
    } finally {
      restoreBlockRegistryForTest(snap);
    }
    expect(() => new EditorBinding(store)).not.toThrow(); // restored version re-validates clean
  });
});
