// Canonical tree <-> ProseMirror binding (tasks 6.1, 6.2, 6.3).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, TreeDocumentStore, type OoxmlPart } from '@docx-editor.dev/engine-core';
import { treeSchema } from '../src/tree-schema.ts';
import { bodyParagraphs, docToTreeOps, reconcileDoc, treeToDoc } from '../src/tree-binding.ts';
import { paragraphTextOf, ORIGIN_IDS } from '@docx-editor.dev/engine-core';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const SIMPLE = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>';

/** Apply the mapped ops through the store, the way a host would. */
function commit(part: OoxmlPart, doc: ReturnType<typeof treeToDoc>): OoxmlPart {
  const mapped = docToTreeOps(part, doc);
  if (!mapped.ok) throw new Error(`${mapped.reason}: ${mapped.detail ?? ''}`);
  const store = new TreeDocumentStore(part);
  const result = store.transact((ctx) => {
    for (const op of mapped.ops) ctx.apply(op);
  });
  if (!result.ok) throw new Error(result.reason);
  return store.part;
}

describe('projection (task 6.1)', () => {
  test('paragraphs project with their tree node id', () => {
    const part = load(SIMPLE);
    const doc = treeToDoc(part);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).attrs.nodeId).toBe(bodyParagraphs(part)[0]!.id);
    expect(doc.child(0).textContent).toBe('Hello world');
  });

  test('authored whitespace, tab and hard break project as content', () => {
    const part = load(
      '<w:p><w:r><w:t xml:space="preserve">  a </w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>'
    );
    const doc = treeToDoc(part);
    const kinds: string[] = [];
    doc.child(0).forEach((child) => kinds.push(child.isText ? 'text' : child.type.name));
    expect(kinds).toEqual(['text', 'tab', 'text', 'hardBreak', 'text']);
    expect(doc.child(0).child(0).text).toBe('  a ');
  });

  test('the accepted run property boundary projects as one mark', () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:b/><w:u w:val="double"/></w:rPr><w:t>styled</w:t></w:r></w:p>'
    );
    const text = treeToDoc(part).child(0).child(0);
    const mark = text.marks.find((candidate) => candidate.type.name === 'runProps');
    expect(mark).toBeDefined();
    expect(mark!.attrs.props).toEqual([
      { localName: 'b' },
      { localName: 'u', attributes: { val: 'double' } },
    ]);
  });

  test('paragraph properties project on the paragraph node', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
    );
    expect(treeToDoc(part).child(0).attrs.props).toEqual([
      { localName: 'jc', attributes: { val: 'center' } },
    ]);
  });

  test('unknown content projects as an inert positional atom, never dropped', () => {
    const part = load(
      '<w:p><w:r><w:t>before </w:t></w:r>' +
        '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
        '<w:r><w:t>after</w:t></w:r></w:p>'
    );
    const paragraph = treeToDoc(part).child(0);
    const kinds: string[] = [];
    paragraph.forEach((child) => kinds.push(child.isText ? 'text' : child.type.name));
    // The clipart run keeps its POSITION between the two text runs. The legacy projection
    // dropped it entirely, which is how a picture became invisible in the editor.
    expect(kinds).toEqual(['text', 'unknownInline', 'text']);
    expect(paragraph.textContent).toBe('before after');
  });

  test('an empty body still projects an editable paragraph', () => {
    expect(treeToDoc(load('')).childCount).toBe(1);
  });
});

describe('reverse mapping (task 6.2)', () => {
  test('typing maps to a minimal insertText at the edited offset', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('Hello brave world')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([
      { op: 'insertText', paragraphId: id, offset: 6, text: 'brave ' },
    ]);
    expect(paragraphTextOf(commit(part, doc), id)).toBe('Hello brave world');
  });

  test('deleting maps to a minimal deleteText', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('Hello')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'deleteText', paragraphId: id, start: 5, end: 11 }]);
  });

  test('replacing a selection maps to a delete plus an insert at the same offset', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('Hello there')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([
      { op: 'deleteText', paragraphId: id, start: 6, end: 11 },
      { op: 'insertText', paragraphId: id, offset: 6, text: 'there' },
    ]);
    expect(paragraphTextOf(commit(part, doc), id)).toBe('Hello there');
  });

  test('a typed tab and hard break map to content-token ops, not characters', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('a'),
        treeSchema.node('tab'),
        treeSchema.node('hardBreak'),
        treeSchema.text('b'),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([
      { op: 'insertTab', paragraphId: id, offset: 1 },
      { op: 'insertHardBreak', paragraphId: id, offset: 2 },
    ]);
    expect(paragraphTextOf(commit(part, doc), id)).toBe('a\t\nb');
  });

  test('a run property change maps to setRunProperties over the affected range', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('Hello', [treeSchema.marks.runProps.create({ props: [{ localName: 'b' }] })]),
        treeSchema.text(' world'),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([
      {
        op: 'setRunProperties',
        paragraphId: id,
        start: 0,
        end: 5,
        properties: [{ localName: 'b', attributes: {} }],
      },
    ]);
  });

  test('a paragraph property change maps to setParagraphProperties', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node(
        'paragraph',
        { nodeId: id, props: [{ localName: 'jc', attributes: { val: 'center' } }] },
        [treeSchema.text('Hello world')]
      ),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops[0]!.op).toBe('setParagraphProperties');
  });

  test('property ORDER inside a run is not a change', () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>styled</w:t></w:r></w:p>'
    );
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('styled', [
          treeSchema.marks.runProps.create({ props: [{ localName: 'i' }, { localName: 'b' }] }),
        ]),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([]);
  });

  test('an unchanged projection maps to ZERO ops (no feedback loop)', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>a</w:t></w:r><w:r><w:tab/><w:t>b</w:t></w:r></w:p>'
    );
    const mapped = docToTreeOps(part, treeToDoc(part));
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([]);
  });

  test('Enter maps to splitParagraph at the right offset', () => {
    const part = load(SIMPLE);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('Hello')]),
      treeSchema.node('paragraph', { nodeId: null, props: [] }, [treeSchema.text(' world')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'splitParagraph', paragraphId: id, offset: 5 }]);
    expect(bodyParagraphs(commit(part, doc))).toHaveLength(2);
  });

  test('Backspace at a paragraph start maps to joinParagraphs', () => {
    const part = load(
      '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>'
    );
    const [a, b] = bodyParagraphs(part);
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: a!.id, props: [] }, [treeSchema.text('firstsecond')]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'joinParagraphs', firstId: a!.id, secondId: b!.id }]);
  });

  test('a full round trip through the projection changes nothing', () => {
    const part = load(
      '<w:p><w:r><w:t>before </w:t></w:r>' +
        '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>after</w:t></w:r></w:p>'
    );
    const mapped = docToTreeOps(part, treeToDoc(part));
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([]);
  });
});

describe('unsupported transactions are refused without canonical effects (task 6.3)', () => {
  const part = load(
    '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>'
  );
  const [a, b] = bodyParagraphs(part);
  const paragraph = (nodeId: string | null, text: string) =>
    treeSchema.node('paragraph', { nodeId, props: [] }, text ? [treeSchema.text(text)] : []);

  test('a reorder is refused', () => {
    const doc = treeSchema.node('doc', null, [paragraph(b!.id, 'two'), paragraph(a!.id, 'one')]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('paragraph-reordered');
  });

  test('a multi-paragraph paste is refused rather than approximated', () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'one'),
      paragraph(null, 'pasted A'),
      paragraph(null, 'pasted B'),
      paragraph(b!.id, 'two'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('paragraph-count-unexplained');
  });

  test('a split combined with an edit elsewhere is refused', () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'o'),
      paragraph(null, 'ne'),
      paragraph(b!.id, 'EDITED'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('split-not-clean');
  });

  test("a split whose halves do not concatenate to the source is refused", () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'o'),
      paragraph(null, 'XX'),
      paragraph(b!.id, 'two'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('split-not-clean');
  });

  test("a split tail forging another paragraph's id is refused", () => {
    const doc = treeSchema.node('doc', null, [
      paragraph(a!.id, 'o'),
      paragraph(b!.id, 'ne'),
      paragraph(b!.id, 'two'),
    ]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('split-not-clean');
  });

  test('a join whose result is not the concatenation is refused', () => {
    const doc = treeSchema.node('doc', null, [paragraph(a!.id, 'oneTWO')]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('join-not-clean');
  });

  test('deleting unknown content through the projection is refused', () => {
    const withClip = load(
      '<w:p><w:r><w:t>x</w:t></w:r><w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r></w:p>'
    );
    const id = bodyParagraphs(withClip)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [treeSchema.text('x')]),
    ]);
    const mapped = docToTreeOps(withClip, doc);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.reason).toBe('unknown-content-moved');
  });

  test('reordering unknown content is refused', () => {
    const withClip = load(
      '<w:p><w:r><w:t>x</w:t></w:r><w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r></w:p>'
    );
    const source = bodyParagraphs(withClip)[0]!;
    const projected = treeToDoc(withClip).child(0);
    const inline: ReturnType<typeof treeSchema.text>[] = [];
    projected.forEach((child) => inline.push(child as never));
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: source.id, props: [] }, [...inline].reverse()),
    ]);
    const mapped = docToTreeOps(withClip, doc);
    expect(mapped.ok).toBe(false);
  });

  test('a refused mapping produces no ops at all, so nothing can be half-applied', () => {
    const doc = treeSchema.node('doc', null, [paragraph(b!.id, 'two'), paragraph(a!.id, 'one')]);
    const mapped = docToTreeOps(part, doc);
    expect(mapped.ok).toBe(false);
    expect('ops' in mapped).toBe(false);
  });
});

describe('incremental reconciliation with a projection-only origin (task 6.4)', () => {
  const source =
    '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>three</w:t></w:r></w:p>';

  test('a text edit reuses every untouched paragraph node by reference', () => {
    const part = load(source);
    const before = treeToDoc(part);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[1]!.id;
    const result = store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: target, offset: 3, text: '!' })
    );
    if (!result.ok || !result.change) throw new Error('expected a change');

    const after = reconcileDoc(before, store.part, result.change);

    // Untouched paragraphs are the SAME objects, so ProseMirror redraws neither.
    expect(after.child(0)).toBe(before.child(0));
    expect(after.child(2)).toBe(before.child(2));
    // The dirty one is rebuilt and carries the edit.
    expect(after.child(1)).not.toBe(before.child(1));
    expect(after.child(1).textContent).toBe('two!');
  });

  test('a reconciled doc maps to ZERO ops, so reconciliation cannot loop', () => {
    const part = load(source);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[0]!.id;
    const result = store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: target, offset: 0, text: 'X' })
    );
    if (!result.ok || !result.change) throw new Error('expected a change');

    const reconciled = reconcileDoc(treeToDoc(part), store.part, result.change);
    const mapped = docToTreeOps(store.part, reconciled);
    if (!mapped.ok) throw new Error(mapped.reason);
    // The loop this prevents: reconcile -> map -> commit -> reconcile -> ...
    expect(mapped.ops).toEqual([]);
  });

  test('a structural change falls back to a full projection', () => {
    const part = load(source);
    const before = treeToDoc(part);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[0]!.id;
    const result = store.transact((ctx) =>
      ctx.apply({ op: 'splitParagraph', paragraphId: target, offset: 1 })
    );
    if (!result.ok || !result.change) throw new Error('expected a change');

    const after = reconcileDoc(before, store.part, result.change);
    expect(after.childCount).toBe(4);
    expect(docToTreeOps(store.part, after)).toEqual({ ok: true, ops: [] });
  });

  test('no change evidence means a full projection, never a partial patch', () => {
    const part = load(source);
    const before = treeToDoc(part);
    const store = new TreeDocumentStore(part);
    store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: bodyParagraphs(part)[2]!.id, offset: 0, text: 'Z' })
    );
    const after = reconcileDoc(before, store.part, null);
    expect(after.child(2).textContent).toBe('Zthree');
  });

  test('reconciliation runs on a projection origin and records no history entry', () => {
    const part = load(source);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[1]!.id;
    store.transact(
      (ctx) => ctx.apply({ op: 'insertText', paragraphId: target, offset: 0, text: 'R' }),
      { origin: ORIGIN_IDS.projection }
    );
    expect(store.revision).toBe(1);
    // Reconciling the view with the model is not a user intent (task 5.6).
    expect(store.historyDepth).toBe(0);
    expect(docToTreeOps(store.part, treeToDoc(store.part))).toEqual({ ok: true, ops: [] });
  });

  test('undo reconciles back to a doc that also maps to zero ops', () => {
    const part = load(source);
    const store = new TreeDocumentStore(part);
    const target = bodyParagraphs(part)[0]!.id;
    store.transact((ctx) => ctx.apply({ op: 'insertText', paragraphId: target, offset: 0, text: 'A' }));
    store.undo();
    const reconciled = treeToDoc(store.part);
    expect(reconciled.child(0).textContent).toBe('one');
    expect(docToTreeOps(store.part, reconciled)).toEqual({ ok: true, ops: [] });
  });
});

describe('split and join at every position (regression: end-of-paragraph Enter)', () => {
  const threeParagraphs = () =>
    load(
      '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>three</w:t></w:r></w:p>'
    );

  const paragraph = (nodeId: string | null, text: string) =>
    treeSchema.node('paragraph', { nodeId, props: [] }, text ? [treeSchema.text(text)] : []);

  test('Enter at the END of a paragraph splits, leaving an empty tail', () => {
    // The head is IDENTICAL to the source here, so a first-divergence scan walks past the
    // split point and refuses it. This is the most common Enter there is.
    const part = threeParagraphs();
    const ids = bodyParagraphs(part).map((p) => p.id);
    for (const [index, id] of ids.entries()) {
      const docs = ids.map((other, i) =>
        paragraph(other, ['one', 'two', 'three'][i]!)
      );
      docs.splice(index + 1, 0, paragraph(null, ''));
      const mapped = docToTreeOps(part, treeSchema.node('doc', null, docs));
      if (!mapped.ok) throw new Error(`${index}: ${mapped.reason}`);
      expect(mapped.ops).toEqual([
        { op: 'splitParagraph', paragraphId: id, offset: ['one', 'two', 'three'][index]!.length },
      ]);
    }
  });

  test('Enter at the START of a paragraph splits at offset 0', () => {
    const part = threeParagraphs();
    const ids = bodyParagraphs(part).map((p) => p.id);
    const docs = [
      paragraph(ids[0]!, 'one'),
      paragraph(ids[1]!, ''),
      paragraph(null, 'two'),
      paragraph(ids[2]!, 'three'),
    ];
    const mapped = docToTreeOps(part, treeSchema.node('doc', null, docs));
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.ops).toEqual([{ op: 'splitParagraph', paragraphId: ids[1]!, offset: 0 }]);
  });

  test('a join is found at every adjacent pair', () => {
    const part = threeParagraphs();
    const ids = bodyParagraphs(part).map((p) => p.id);
    const texts = ['one', 'two', 'three'];
    for (let index = 0; index + 1 < ids.length; index += 1) {
      const docs: ReturnType<typeof paragraph>[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        if (i === index) docs.push(paragraph(ids[i]!, texts[i]! + texts[i + 1]!));
        else if (i !== index + 1) docs.push(paragraph(ids[i]!, texts[i]!));
      }
      const mapped = docToTreeOps(part, treeSchema.node('doc', null, docs));
      if (!mapped.ok) throw new Error(`${index}: ${mapped.reason}`);
      expect(mapped.ops).toEqual([
        { op: 'joinParagraphs', firstId: ids[index]!, secondId: ids[index + 1]! },
      ]);
    }
  });
});
