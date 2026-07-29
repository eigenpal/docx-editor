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
    expect(Object.keys(docSchema.marks).sort()).toEqual(['bold', 'italic', 'rawRunProps', 'underline']);
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

  test('applying bold to a capsule run REMOVES the capsule and materializes bold (edit wins visibly)', () => {
    const capsule = docSchema.marks.rawRunProps.create({ rpr: '<w:rPr><w:color w:val="FF0000"/></w:rPr>' });
    const bold = docSchema.marks.bold.create();
    // bold excludes rawRunProps, so adding it removes the opaque capsule.
    expect(bold.addToSet([capsule]).map((m) => m.type.name).sort()).toEqual(['bold']);
  });

  test('two different rawRunProps capsules cannot coexist (self-exclusion) — the newer replaces', () => {
    const a = docSchema.marks.rawRunProps.create({ rpr: '<w:rPr><w:b/></w:rPr>' });
    const b = docSchema.marks.rawRunProps.create({ rpr: '<w:rPr><w:i/></w:rPr>' });
    const set = b.addToSet([a]);
    expect(set.length).toBe(1);
    expect(set[0].attrs.rpr).toBe('<w:rPr><w:i/></w:rPr>');
  });

  test('a capsule can only come from the model projection, never from DOM bytes (security)', () => {
    // The invariant is NOT "there is no parseDOM" — that version silently DROPPED the
    // capsule whenever ProseMirror re-parsed a dirty mark view, which is exactly what a
    // delegated word-delete across a run boundary does, losing the run's authored w:rPr on
    // save. What must hold is that capsule BYTES never travel through the DOM: the DOM
    // carries an opaque ref, resolved through a registry the model projection alone fills.
    const rule = docSchema.marks.rawRunProps.spec.parseDOM?.[0];
    expect(rule?.tag).toBe('span[data-raw-rpr-ref]');
    const attrsOf = (attrs: Record<string, string>) =>
      rule!.getAttrs!({ getAttribute: (n: string) => attrs[n] ?? null } as never);

    // Forged ref → no capsule. The text pastes plain, as before.
    expect(attrsOf({ 'data-raw-rpr-ref': 'not-a-real-ref' })).toBe(false);
    // Raw bytes in the DOM → no capsule: nothing reads them, and the rule needs a ref.
    expect(attrsOf({ 'data-raw-rpr': '<w:rPr><w:object/></w:rPr>' })).toBe(false);

    // A ref minted by projecting the MODEL resolves to exactly the authored bytes.
    const rpr = '<w:rPr><w:i/></w:rPr>';
    const dom = docSchema.marks.rawRunProps.create({ rpr }).type.spec.toDOM!(
      docSchema.marks.rawRunProps.create({ rpr }),
      true,
    ) as [string, Record<string, string>, number];
    const ref = dom[1]['data-raw-rpr-ref'];
    expect(ref).toBeTruthy();
    expect(attrsOf({ 'data-raw-rpr-ref': ref })).toEqual({ rpr });
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

// A capsule must survive ProseMirror RE-PARSING the DOM, which is what a delegated
// native word/line delete causes (the browser edits, PM's observer reconciles). Before
// the ref registry the mark was dropped and the run's authored w:rPr was lost on save.
test('a capsule survives a DOM round-trip through the schema', async () => {
  await import('./dom-setup.ts');
  const { DOMParser: PMDOMParser, DOMSerializer } = await import('prosemirror-model');
  const rpr = '<w:rPr><w:color w:val="FF0000"/><w:sz w:val="48"/></w:rPr>';
  const paragraph = docSchema.node('paragraph', { semId: 'p-1' }, [
    docSchema.text('styled text', [docSchema.marks.rawRunProps.create({ rpr })]),
  ]);
  const doc = docSchema.node('doc', null, [paragraph]);

  // Serialize to DOM and parse straight back, exactly as PM's observer does.
  const host = document.createElement('div');
  host.append(DOMSerializer.fromSchema(docSchema).serializeFragment(doc.content));
  const reparsed = PMDOMParser.fromSchema(docSchema).parse(host);

  const text = reparsed.firstChild!.firstChild!;
  expect(text.text).toBe('styled text');
  expect(text.marks.map((m) => m.type.name)).toEqual(['rawRunProps']);
  expect(text.marks[0].attrs.rpr).toBe(rpr);
});

// Cross-document capsule bleed (independent security review of a05381a2).
//
// The registry was module-level with sequential ids and no teardown, so a ref minted
// while an ATTACKER's document was open still resolved after a VICTIM document replaced
// it — and `isRunPropertiesCapsule` only checks "lone balanced w:rPr", so the payload
// could carry w:object/OLE into the victim's package. Both legs are covered here.
test('a capsule ref cannot be guessed, and does not survive the document that minted it', async () => {
  const { releaseCapsuleRefs, resolveCapsuleRef } = await import('../src/schema.ts');
  const rpr = '<w:rPr><w:rFonts w:ascii="PWNED"/></w:rPr>';
  const dom = docSchema.marks.rawRunProps.spec.toDOM!(
    docSchema.marks.rawRunProps.create({ rpr }),
    true,
  ) as [string, Record<string, string>, number];
  const ref = dom[1]['data-raw-rpr-ref'];

  // Not craftable offline: the id is not a projection-order counter.
  expect(ref).not.toBe('c1');
  expect(ref).toMatch(/^[a-z0-9]{9,}-\d+$/);
  expect(resolveCapsuleRef(ref)).toBe(rpr);

  // And it dies with the document that minted it, which is what surface.destroy() does.
  releaseCapsuleRefs();
  expect(resolveCapsuleRef(ref)).toBeUndefined();
  // A ref minted afterwards is in a different namespace, so the old string stays dead.
  const next = (
    docSchema.marks.rawRunProps.spec.toDOM!(
      docSchema.marks.rawRunProps.create({ rpr }),
      true,
    ) as [string, Record<string, string>, number]
  )[1]['data-raw-rpr-ref'];
  expect(next).not.toBe(ref);
  expect(resolveCapsuleRef(ref)).toBeUndefined();
});
