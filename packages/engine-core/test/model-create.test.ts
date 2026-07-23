// Tests for create-from-scratch + minimal authored edits (document-engine task
// 2.9). Verifies the created model is a valid minimal OPC package AND is
// semantically editable before any serializer is invoked.

import { describe, expect, test } from 'bun:test';
import {
  createEmptyModel,
  bodyStoryId,
  appendParagraph,
  insertTextIntoParagraph,
  paragraphText,
  type ParagraphRecord,
} from '../src/model/index.ts';
import {
  buildContentTypeIndex,
  resolveContentType,
  buildRelationshipSet,
  resolveRelationship,
} from '../src/package/index.ts';

describe('createEmptyModel produces a valid minimal package', () => {
  const model = createEmptyModel();

  test('content types resolve the document/styles/numbering parts', () => {
    const idx = buildContentTypeIndex(model.contentTypes);
    expect(idx.ok).toBe(true);
    if (!idx.ok) return;
    expect(resolveContentType(idx.index, '/word/document.xml')).toMatchObject({
      ok: true,
      source: 'override',
    });
    // The .rels/.xml defaults resolve too.
    expect(resolveContentType(idx.index, '/customXml/x.xml').ok).toBe(true);
  });

  test('root relationship points at the main document part', () => {
    const set = buildRelationshipSet(model.relationships);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const root = set.byOwner.get('/')!;
    expect(root).toHaveLength(1);
    const resolved = resolveRelationship(root[0]);
    expect(resolved).toMatchObject({ mode: 'Internal' });
    if (resolved.mode === 'Internal') {
      expect(resolved.target).toEqual({ ok: true, partName: '/word/document.xml' });
    }
  });

  test('body has one empty paragraph and identity state is present', () => {
    const body = model.stories.get(bodyStoryId(model))!;
    expect(body.blocks).toHaveLength(1);
    expect((body.blocks[0] as ParagraphRecord).runs).toEqual([]);
    expect(model.identity.cursors.story).toBe(1);
    expect(model.identity.cursors.paragraph).toBe(1);
  });

  test('document part is bound to the body story', () => {
    const doc = model.parts.get('/word/document.xml');
    expect(doc).toMatchObject({ kind: 'xml', storyId: bodyStoryId(model) });
  });
});

describe('the created model is editable before serialization', () => {
  test('append paragraph and insert text mutate authored state; ids stay monotonic', () => {
    const model0 = createEmptyModel();
    const storyId = bodyStoryId(model0);

    const { model: model1, paragraphId } = appendParagraph(model0, storyId);
    expect(model1.stories.get(storyId)!.blocks).toHaveLength(2);
    expect(paragraphId).not.toBe((model0.stories.get(storyId)!.blocks[0] as ParagraphRecord).id);
    expect(model1.identity.cursors.paragraph).toBe(2);

    const model2 = insertTextIntoParagraph(model1, paragraphId, 'Hello');
    expect(paragraphText(model2, paragraphId)).toBe('Hello');

    // Authored omission preserved: the run carries no resolved props.
    const para = model2.stories.get(storyId)!.blocks[1] as ParagraphRecord;
    expect(para.runs[0]).toEqual({ text: 'Hello' });
    expect(para.runs[0].props).toBeUndefined();

    // Original model is untouched (edits are non-mutating).
    expect(model0.stories.get(storyId)!.blocks).toHaveLength(1);
  });

  test('editing a missing paragraph or story fails without mutation', () => {
    const model = createEmptyModel();
    expect(() => appendParagraph(model, 'st-999')).toThrow(/unknown story/);
    expect(() => insertTextIntoParagraph(model, 'p-999', 'x')).toThrow(/not found/);
  });
});
