// EditorBinding tests (document-engine section 6): projection (6.2), forward
// mapping with identity preservation (6.3, 6.4), reverse reconciliation (6.5),
// and loop prevention (6.9). Runs headless — no EditorView, no DOM.

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { EditorBinding, docSchema, paragraphNodeToRuns } from '../index.ts';
import {
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  paragraphText,
  parseDocx,
  writeDocx,
  assessBodyEditability,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function seeded(): { binding: EditorBinding; store: DocumentStore; p1: string } {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  const store = new DocumentStore(model);
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'Hello' }));
  return { binding: new EditorBinding(store), store, p1 };
}

describe('projection (6.2)', () => {
  test('body story projects to a PM doc with semId-tagged paragraphs', () => {
    const { binding, p1 } = seeded();
    const doc = binding.projectDoc();
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).attrs.semId).toBe(p1);
    expect(doc.child(0).textContent).toBe('Hello');
  });
});

describe('forward mapping (6.3, 6.4)', () => {
  test('typing in a plain run preserves neighboring authored formatting capsules and props', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          '<w:r><w:t>AV</w:t></w:r>' +
          '<w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="C00000"/></w:rPr><w:t>Bold</w:t></w:r>' +
          '<w:r><w:rPr><w:i/><w:sz w:val="22"/><w:color w:val="0066CC"/></w:rPr><w:t>Italic</w:t></w:r>' +
          '</w:p></w:body></w:document>'
      ),
    });
    const parsed = parseDocx(bytes, { preserveAll: true });
    if (!parsed.ok) throw new Error(parsed.reason);
    const paragraph = parsed.model.stories.get(bodyStoryId(parsed.model))!
      .blocks[0] as ParagraphRecord;
    const originalRuns = paragraph.runs;
    const store = new DocumentStore(parsed.model);
    const binding = new EditorBinding(store);
    const state = binding.createState();

    const result = binding.commitFromDoc(state.tr.insertText('X', 2).doc);

    expect(result.result?.ok).toBe(true);
    expect(
      (
        store.currentModel.stories.get(bodyStoryId(store.currentModel))!
          .blocks[0] as ParagraphRecord
      ).runs
    ).toEqual([
      { text: 'AXV' },
      { ...originalRuns[1], text: 'Bold' },
      { ...originalRuns[2], text: 'Italic' },
    ]);
  });

  test('editing a paragraph maps to setParagraphRuns and preserves identity', () => {
    const { binding, store, p1 } = seeded();
    // Build an edited PM doc: same paragraph (same semId) with new text.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello world')]),
    ]);
    const { ops, result } = binding.commitFromDoc(edited);
    expect(ops).toEqual([
      { op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'Hello world' }] },
    ]);
    expect(result?.ok).toBe(true);
    expect(paragraphText(store.currentModel, p1)).toBe('Hello world');
    // Identity preserved: same id still present.
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0].id).toBe(p1);
  });

  test('a clean SPLIT (Enter) maps to one splitParagraph and keeps the head id', () => {
    const { binding, store, p1 } = seeded(); // p1 = 'Hello'
    // Enter after "Hel": head keeps p1, tail is a new (null-semId) paragraph.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hel')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('lo')]),
    ]);
    const { ops, result } = binding.commitFromDoc(edited);
    expect(ops).toEqual([{ op: 'splitParagraph', paragraphId: p1, offset: 3 }]);
    expect(result?.ok).toBe(true);
    const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBe(p1); // head keeps identity
    expect(paragraphText(store.currentModel, p1)).toBe('Hel');
    expect((blocks[1] as ParagraphRecord).runs.map((r) => r.text).join('')).toBe('lo');
  });

  test('a clean JOIN (Backspace at boundary) maps to one joinParagraphs', () => {
    const { binding, store, p1 } = seeded(); // p1 = 'Hello'
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) })
    );
    const p2 = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[1].id;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'World' }));
    // Join: the survivor keeps p1 and carries both texts; p2 is gone.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('HelloWorld')]),
    ]);
    const { ops, result } = binding.commitFromDoc(edited);
    expect(ops).toEqual([{ op: 'joinParagraphs', firstId: p1, secondId: p2 }]);
    expect(result?.ok).toBe(true);
    const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks;
    expect(blocks).toHaveLength(1);
    expect(paragraphText(store.currentModel, p1)).toBe('HelloWorld');
  });

  test('inserting a new paragraph after an existing one maps to insertParagraph', () => {
    const { binding, store, p1 } = seeded();
    const storyId = bodyStoryId(store.currentModel);
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('second')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([
      { op: 'insertParagraph', storyId, index: 1, runs: [{ text: 'second' }] },
    ]);
    const blocks = store.currentModel.stories.get(storyId)!.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBe(p1); // the existing paragraph keeps its identity
    expect((blocks[1] as ParagraphRecord).runs.map((r) => r.text).join('')).toBe('second');
  });

  test('DELETING a whole non-empty paragraph fails closed (its content would be lost)', () => {
    const { binding, store, p1 } = seeded();
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) })
    );
    const p2 = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[1].id;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'World' }));
    // The survivor still reads only 'Hello' — 'World' vanished: NOT a clean join.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBe(true);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks).toHaveLength(2);
  });

  test('a multi-paragraph paste (two new blocks) maps to two insertParagraph ops in order', () => {
    const { binding, store, p1 } = seeded();
    const storyId = bodyStoryId(store.currentModel);
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('a')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('b')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([
      { op: 'insertParagraph', storyId, index: 1, runs: [{ text: 'a' }] },
      { op: 'insertParagraph', storyId, index: 2, runs: [{ text: 'b' }] },
    ]);
    const blocks = store.currentModel.stories.get(storyId)!.blocks;
    expect(blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))).toEqual([
      'Hello',
      'a',
      'b',
    ]);
  });

  test('a mid-paragraph paste (edit P + new paragraphs after it) maps to setParagraphRuns + inserts', () => {
    const { binding, store, p1 } = seeded(); // p1 = 'Hello'
    const storyId = bodyStoryId(store.currentModel);
    // What ProseMirror produces pasting 'AAA\nBBB\nCCC' at offset 5 of 'Hello': the paragraph
    // keeps its id with the paste head appended, then two new paragraphs.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('HelloAAA')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('BBB')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('CCC')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([
      { op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'HelloAAA' }] },
      { op: 'insertParagraph', storyId, index: 1, runs: [{ text: 'BBB' }] },
      { op: 'insertParagraph', storyId, index: 2, runs: [{ text: 'CCC' }] },
    ]);
    const blocks = store.currentModel.stories.get(storyId)!.blocks;
    expect(blocks[0].id).toBe(p1); // the pasted-into paragraph keeps its identity
    expect(blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))).toEqual([
      'HelloAAA',
      'BBB',
      'CCC',
    ]);
  });

  test('a mid-paragraph paste that would split a surrogate pair fails closed', () => {
    const { binding, store } = seeded();
    const storyId = bodyStoryId(store.currentModel);
    const p = store.currentModel.stories.get(storyId)!.blocks[0].id;
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'setParagraphRuns', paragraphId: p, runs: [{ text: 'a😀b' }] })
    );
    // A crafted doc whose paste boundary lands between the emoji's surrogates — the halves would
    // each keep a lone surrogate and corrupt on UTF-8 save.
    const doc = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p }, [docSchema.text('a\uD83D')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('mid')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('\uDE00b')]),
    ]);
    const res = binding.commitFromDoc(doc);
    expect(res.rejected).toBe(true);
    expect(store.currentModel.stories.get(storyId)!.blocks).toHaveLength(1);
  });

  test('an edit to a paragraph NOT at the insertion boundary + an insert fails closed', () => {
    const { binding, store, p1 } = seeded(); // one paragraph
    const p2 = (() => {
      store.transact(HUMAN, (c) =>
        c.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) })
      );
      return store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[1].id;
    })();
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'Two' }));
    // Edit p1 AND insert a new paragraph after p2 — the edited paragraph is not adjacent to the
    // new one, so it is not a mid-paragraph paste; fail closed rather than guess.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('EDITED')]),
      docSchema.node('paragraph', { semId: p2 }, [docSchema.text('Two')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('new')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBe(true);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks).toHaveLength(2);
  });

  test('marks round-trip through projection and forward mapping', () => {
    const { binding, store, p1 } = seeded();
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [
        docSchema.text('bold', [docSchema.marks.bold.create()]),
      ]),
    ]);
    binding.commitFromDoc(edited);
    const runs = (
      store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0] as ParagraphRecord
    ).runs;
    expect(runs).toEqual([{ text: 'bold', props: { bold: true } }]);
  });
});

describe('reverse reconciliation + loop prevention (6.5, 6.9)', () => {
  test('a non-PM commit is reflected by reprojection', () => {
    const { binding, store, p1 } = seeded();
    // Simulate a remote/agent edit straight to the store.
    store.transact(ORIGIN_IDS.mutationAgent, (c) =>
      c.apply({ op: 'insertText', paragraphId: p1, text: '!' })
    );
    const doc = binding.reconcileDoc();
    expect(doc.child(0).textContent).toBe('Hello!');
  });

  test('a reconciled doc maps to ZERO ops (no feedback loop)', () => {
    const { binding } = seeded();
    const reconciled = binding.reconcileDoc();
    expect(binding.mapDocToOps(reconciled)).toEqual([]);
  });

  test('paragraphNodeToRuns drops empty text nodes', () => {
    const node = docSchema.node('paragraph', { semId: 'x' }, [docSchema.text('a')]);
    expect(paragraphNodeToRuns(node)).toEqual([{ text: 'a' }]);
  });
});

describe('underline projects as a mark (tasks 6.1/6.2)', () => {
  function underlined() {
    const model = createEmptyModel();
    const store = new DocumentStore(model);
    const id = model.stories.get(bodyStoryId(model))!.blocks[0].id;
    store.transact(HUMAN, (c) =>
      c.apply({
        op: 'setParagraphRuns',
        paragraphId: id,
        runs: [{ text: 'plain' }, { text: 'under', props: { underline: { val: 'single' } } }],
      })
    );
    return { store, binding: new EditorBinding(store), id };
  }

  test('an underlined run projects with the underline mark', () => {
    const { binding } = underlined();
    const paragraph = binding.projectDoc().child(0);
    expect(paragraph.child(0).marks.map((m) => m.type.name)).toEqual([]);
    expect(paragraph.child(1).marks.map((m) => m.type.name)).toEqual(['underline']);
  });

  test('the underline mark maps back to props.underline', () => {
    const node = docSchema.node('paragraph', { semId: 'x' }, [
      docSchema.text('u', [docSchema.marks.underline.create()]),
    ]);
    expect(paragraphNodeToRuns(node)).toEqual([
      { text: 'u', props: { underline: { val: 'single' } } },
    ]);
  });

  test('reprojecting an underlined paragraph maps to ZERO ops', () => {
    const { binding } = underlined();
    expect(binding.mapDocToOps(binding.reconcileDoc())).toEqual([]);
  });

  test('an underlined paragraph is editable, and the underline survives the edit', () => {
    const { store, binding, id } = underlined();
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: id }, [
        docSchema.text('plain'),
        docSchema.text('underX', [docSchema.marks.underline.create()]),
      ]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBeFalsy();
    expect(res.result?.ok).toBe(true);
    const runs = (
      store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0] as ParagraphRecord
    ).runs;
    expect(runs).toEqual([
      { text: 'plain' },
      { text: 'underX', props: { underline: { val: 'single' } } },
    ]);
  });

  test('toggling underline OFF removes it from the canonical run', () => {
    const { store, binding, id } = underlined();
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: id }, [docSchema.text('plainunder')]),
    ]);
    expect(binding.commitFromDoc(edited).result?.ok).toBe(true);
    const runs = (
      store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0] as ParagraphRecord
    ).runs;
    expect(runs).toEqual([{ text: 'plainunder' }]);
  });
  test('an underlined edit round-trips to w:u and reopens editable', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:body></w:document>`
      ),
    });
    const parsed = parseDocx(bytes, { preserveAll: true });
    if (!parsed.ok) throw new Error(parsed.reason);
    const store = new DocumentStore(parsed.model);
    const binding = new EditorBinding(store);
    const id = parsed.model.stories.get(bodyStoryId(parsed.model))!.blocks[0].id;

    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: id }, [
        docSchema.text('plain', [docSchema.marks.underline.create()]),
      ]),
    ]);
    expect(binding.commitFromDoc(edited).result?.ok).toBe(true);

    const document = strFromU8(unzipSync(writeDocx(store.currentModel))['word/document.xml']);
    expect(document).toContain('<w:u w:val="single"/>');

    // And the saved bytes reopen as a modeled underline that is still editable, not as a
    // locked paragraph — the condition that used to make any underline read-only.
    const reopened = parseDocx(writeDocx(store.currentModel), { preserveAll: true });
    if (!reopened.ok) throw new Error(reopened.reason);
    const runs = (
      reopened.model.stories.get(bodyStoryId(reopened.model))!.blocks[0] as ParagraphRecord
    ).runs;
    expect(runs[0]!.props?.underline).toEqual({ val: 'single' });
    expect(assessBodyEditability(reopened.model).mode).toBe('full');
  });
  test('an authored variant and colour survive projection and re-serialization', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          '<w:r><w:rPr><w:u w:val="double" w:color="FF0000"/></w:rPr><w:t>wavy</w:t></w:r>' +
          '</w:p></w:body></w:document>'
      ),
    });
    const parsed = parseDocx(bytes, { preserveAll: true });
    if (!parsed.ok) throw new Error(parsed.reason);
    const paragraph = parsed.model.stories.get(bodyStoryId(parsed.model))!
      .blocks[0] as ParagraphRecord;
    expect(paragraph.runs[0]!.props?.underline).toEqual({ val: 'double', color: 'FF0000' });

    // The run carries an rPr capsule too, so it projects through the capsule and its exact
    // bytes are what a TEXT edit re-emits.
    const store = new DocumentStore(parsed.model);
    const binding = new EditorBinding(store);
    const state = binding.createState();
    expect(binding.commitFromDoc(state.tr.insertText('X', 1).doc).result?.ok).toBe(true);
    expect(
      strFromU8(unzipSync(writeDocx(store.currentModel))['word/document.xml'])
    ).toContain('<w:u w:val="double" w:color="FF0000"/>');
  });

  test('a variant-carrying mark re-serializes its own variant, not a downgraded single', () => {
    const model = createEmptyModel();
    const store = new DocumentStore(model);
    const id = model.stories.get(bodyStoryId(model))!.blocks[0].id;
    const binding = new EditorBinding(store);
    const doc = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: id }, [
        docSchema.text('w', [docSchema.marks.underline.create({ val: 'wave', color: '00FF00' })]),
      ]),
    ]);
    expect(binding.commitFromDoc(doc).result?.ok).toBe(true);
    const runs = (
      store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0] as ParagraphRecord
    ).runs;
    expect(runs).toEqual([{ text: 'w', props: { underline: { val: 'wave', color: '00FF00' } } }]);
  });

  test('a forged variant or colour falls back instead of reaching w:u', () => {
    const model = createEmptyModel();
    const store = new DocumentStore(model);
    const id = model.stories.get(bodyStoryId(model))!.blocks[0].id;
    const binding = new EditorBinding(store);
    const doc = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: id }, [
        docSchema.text('x', [
          docSchema.marks.underline.create({ val: 'single"/><w:object', color: 'red;' }),
        ]),
      ]),
    ]);
    expect(binding.commitFromDoc(doc).result?.ok).toBe(true);
    const runs = (
      store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0] as ParagraphRecord
    ).runs;
    expect(runs).toEqual([{ text: 'x', props: { underline: { val: 'single' } } }]);
  });
  test('a capsule run still DISPLAYS its modeled formatting', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          '<w:r><w:rPr><w:b/><w:i/><w:u w:val="wave" w:color="0070C0"/></w:rPr><w:t>fancy</w:t></w:r>' +
          '</w:p></w:body></w:document>'
      ),
    });
    const parsed = parseDocx(bytes, { preserveAll: true });
    if (!parsed.ok) throw new Error(parsed.reason);
    const binding = new EditorBinding(new DocumentStore(parsed.model));
    const text = binding.projectDoc().child(0).child(0);

    // The capsule is still the ONE mark (it keeps serialization authority)...
    expect(text.marks.map((m) => m.type.name)).toEqual(['rawRunProps']);
    // ...but it now carries the display flags, so the run does not render as plain text.
    // Every parsed run with formatting carries a capsule, so without these the whole
    // document showed unformatted.
    const [mark] = text.marks;
    expect(mark!.attrs.bold).toBe(true);
    expect(mark!.attrs.italic).toBe(true);
    expect(mark!.attrs.u).toEqual({ val: 'wave', color: '0070C0' });
  });

  test('the capsule display flags never reach the reverse mapping', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          '<w:r><w:rPr><w:u w:val="double"/></w:rPr><w:t>keep</w:t></w:r>' +
          '</w:p></w:body></w:document>'
      ),
    });
    const parsed = parseDocx(bytes, { preserveAll: true });
    if (!parsed.ok) throw new Error(parsed.reason);
    const store = new DocumentStore(parsed.model);
    const binding = new EditorBinding(store);

    // Editing the TEXT of a capsule run re-emits the capsule verbatim: the authored
    // `double` must not be downgraded to the `single` a modeled toggle would write.
    expect(binding.commitFromDoc(binding.createState().tr.insertText('X', 1).doc).result?.ok).toBe(
      true
    );
    expect(
      strFromU8(unzipSync(writeDocx(store.currentModel))['word/document.xml'])
    ).toContain('<w:u w:val="double"/>');
  });
});
