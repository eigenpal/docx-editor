// Per-block semantic chunks are reused across layouts (incremental bridge phase).
//
// A one-character edit changes ONE paragraph, but the semantic index was rebuilt whole on
// every keystroke: a caret stop per grapheme in the document, an ownership region per
// whitespace run, and a word segmentation per paragraph. None of that depends on where the
// block sits on a page. These pin that an untouched paragraph contributes the SAME frozen
// arrays it contributed last layout, and that a touched one does not.

import { describe, expect, test } from 'bun:test';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
} from '@docx-editor.dev/core-contract/store';
import { buildSemanticIndex } from '../semantic-index.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

function storeWith(texts: readonly string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' })
  );
  const ids = [first];
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
    ids.push(pid);
  }
  return { store, ids, storyId };
}

const stopsFor = (index: ReturnType<typeof buildSemanticIndex>, blockId: string) =>
  index.caretStops.filter((s) => s.target.kind === 'text' && s.target.identity.blockId === blockId);

const segmentsFor = (index: ReturnType<typeof buildSemanticIndex>, blockId: string) =>
  index.stories[0]!.blocks.find((b) => b.identity.blockId === blockId)!.wordSegments;

const regionsFor = (index: ReturnType<typeof buildSemanticIndex>, blockId: string) =>
  index.ownershipRegions.filter((r) => r.identity.blockId === blockId);

describe('semantic index reuses per-block chunks', () => {
  test('editing one paragraph leaves every other block chunk identical by reference', () => {
    const { store, ids } = storeWith(['alpha beta gamma', 'delta epsilon', 'zeta eta theta']);
    const before = buildSemanticIndex(store.currentModel);

    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[1]!, offset: 0, text: 'x' })
    );
    const after = buildSemanticIndex(store.currentModel);

    for (const id of [ids[0]!, ids[2]!]) {
      // Same ARRAY objects, not merely equal contents.
      expect(segmentsFor(after, id)).toBe(segmentsFor(before, id));
      expect(stopsFor(after, id)[0]).toBe(stopsFor(before, id)[0]);
      expect(regionsFor(after, id)[0]).toBe(regionsFor(before, id)[0]);
    }
    // The edited block is rebuilt.
    expect(segmentsFor(after, ids[1]!)).not.toBe(segmentsFor(before, ids[1]!));
    expect(stopsFor(after, ids[1]!)[0]).not.toBe(stopsFor(before, ids[1]!)[0]);
  });

  test('reused chunks are frozen, so a publication freeze walk stops at them', () => {
    const { store, ids } = storeWith(['alpha beta']);
    const index = buildSemanticIndex(store.currentModel);
    expect(Object.isFrozen(segmentsFor(index, ids[0]!))).toBe(true);
    for (const stop of stopsFor(index, ids[0]!)) expect(Object.isFrozen(stop)).toBe(true);
    for (const region of regionsFor(index, ids[0]!)) expect(Object.isFrozen(region)).toBe(true);
  });

  test('orderIndex follows position even when the chunk is reused', () => {
    // orderIndex is NOT part of a chunk: inserting a block ahead of another must renumber
    // it while still reusing its caret stops and segments.
    const { store, ids, storyId } = storeWith(['first', 'second']);
    const before = buildSemanticIndex(store.currentModel);
    expect(before.stories[0]!.blocks.find((b) => b.identity.blockId === ids[1]!)!.orderIndex).toBe(
      1
    );

    store.transact(HUMAN, (c) => c.apply({ op: 'insertParagraph', storyId, index: 0, runs: [] }));
    const after = buildSemanticIndex(store.currentModel);
    expect(after.stories[0]!.blocks.find((b) => b.identity.blockId === ids[1]!)!.orderIndex).toBe(
      2
    );
    expect(segmentsFor(after, ids[1]!)).toBe(segmentsFor(before, ids[1]!));
  });

  test('changing text invalidates the chunk it belongs to', () => {
    // Derive the expectation from the resulting text rather than hardcoding offsets, so the
    // test pins invalidation rather than one insertion's arithmetic.
    const whitespaceRanges = (text: string) =>
      [...text.matchAll(/\s+/gu)].map((m) => ({
        graphemeFrom: m.index!,
        graphemeTo: m.index! + m[0].length,
      }));
    const textOf = (model: PackageModel, blockId: string) => {
      for (const story of model.stories.values())
        for (const b of story.blocks)
          if (b.kind === 'paragraph' && b.id === blockId)
            return (b as ParagraphRecord).runs.map((r) => r.text).join('');
      throw new Error('block');
    };

    const { store, ids } = storeWith(['alpha  beta']);
    const before = buildSemanticIndex(store.currentModel);
    const beforeRegions = regionsFor(before, ids[0]!).filter((r) => r.kind === 'lineWhitespace');
    expect(
      beforeRegions.map((r) => ({ graphemeFrom: r.graphemeFrom, graphemeTo: r.graphemeTo }))
    ).toEqual(whitespaceRanges(textOf(store.currentModel, ids[0]!)));

    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'zz ' })
    );
    const after = buildSemanticIndex(store.currentModel);
    const afterRegions = regionsFor(after, ids[0]!).filter((r) => r.kind === 'lineWhitespace');
    // Rebuilt, not served from the cache...
    expect(afterRegions[0]).not.toBe(beforeRegions[0]);
    // ...and correct for the NEW text.
    expect(
      afterRegions.map((r) => ({ graphemeFrom: r.graphemeFrom, graphemeTo: r.graphemeTo }))
    ).toEqual(whitespaceRanges(textOf(store.currentModel, ids[0]!)));
  });
});
