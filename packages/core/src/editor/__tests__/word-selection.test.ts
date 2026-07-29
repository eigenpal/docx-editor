// Word and block selection resolution (interactive-paginated-editing 5.3).

import { describe, expect, test } from 'bun:test';
import { buildSemanticIndex } from '../semantic-index.ts';
import {
  blockSelectionFromHit,
  endpointsOnGraphemeBoundaries,
  resolveWordRangeAtHit,
  wordSelectionFromHit,
} from '../word-selection.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;
const SCOPE = { kind: 'body' as const };

function modelWithParagraphs(texts: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  if (texts[0] !== undefined) {
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: first, text: texts[0]! })
    );
  }
  let lastId = first;
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    lastId = r.ok ? r.modelChange.created[0]! : lastId;
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: lastId, text: texts[i]! })
    );
  }
  return store.currentModel;
}

function modelWithRunSplit(parts: readonly string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({
      op: 'setParagraphRuns',
      paragraphId: first,
      runs: parts.map((text) => ({ text })),
    })
  );
  return store.currentModel;
}

function textHit(
  storyId: string,
  blockId: string,
  graphemeOffset: number,
  affinity: 'upstream' | 'downstream' = 'upstream'
) {
  return {
    kind: 'text' as const,
    scope: SCOPE,
    identity: { storyId, blockId },
    graphemeOffset,
    affinity,
  };
}

describe('word selection resolution (task 5.3)', () => {
  test('boundary affinity chooses preceding or following segment deterministically', () => {
    const model = modelWithParagraphs(['foo,bar']);
    const index = buildSemanticIndex(model);
    const block = index.stories[0]!.blocks[0]!;
    const boundary = 4;

    const upstream = resolveWordRangeAtHit(
      block.wordSegments,
      boundary,
      'upstream',
      block.graphemeCount
    );
    const downstream = resolveWordRangeAtHit(
      block.wordSegments,
      boundary,
      'downstream',
      block.graphemeCount
    );
    expect(upstream).toEqual({ graphemeFrom: 3, graphemeTo: 4 });
    expect(downstream).toEqual({ graphemeFrom: 4, graphemeTo: 7 });
    expect(
      endpointsOnGraphemeBoundaries(block.graphemeCount, upstream.graphemeFrom, upstream.graphemeTo)
    ).toBe(true);
  });

  test('end-of-paragraph hits choose the preceding word segment', () => {
    const model = modelWithParagraphs(['tail']);
    const block = buildSemanticIndex(model).stories[0]!.blocks[0]!;
    const end = resolveWordRangeAtHit(
      block.wordSegments,
      block.graphemeCount,
      'downstream',
      block.graphemeCount
    );
    expect(end).toEqual({ graphemeFrom: 0, graphemeTo: block.graphemeCount });
  });

  test('run-split paragraphs share one canonical word index', () => {
    const model = modelWithRunSplit(['hel', 'lo']);
    const block = buildSemanticIndex(model).stories[0]!.blocks[0]!;
    const range = resolveWordRangeAtHit(block.wordSegments, 2, 'upstream', block.graphemeCount);
    expect(range).toEqual({ graphemeFrom: 0, graphemeTo: 5 });
  });

  test('triple-click block selection spans only the hit paragraph', () => {
    const model = modelWithParagraphs(['one', 'two']);
    const index = buildSemanticIndex(model);
    const second = index.stories[0]!.blocks[1]!;
    const hit = textHit(index.stories[0]!.storyId, second.identity.blockId, 1, 'upstream');
    const { anchor, head } = blockSelectionFromHit(hit, second.graphemeCount);
    expect(anchor.graphemeOffset).toBe(0);
    expect(head.graphemeOffset).toBe(second.graphemeCount);
    expect(anchor.identity.blockId).toBe(second.identity.blockId);
  });

  test('empty paragraph triple-click remains collapsed 0..0', () => {
    const model = modelWithParagraphs(['']);
    const index = buildSemanticIndex(model);
    const block = index.stories[0]!.blocks[0]!;
    const hit = textHit(index.stories[0]!.storyId, block.identity.blockId, 0, 'downstream');
    const { anchor, head } = blockSelectionFromHit(hit, block.graphemeCount);
    expect(anchor.graphemeOffset).toBe(0);
    expect(head.graphemeOffset).toBe(0);
  });

  test('wordSelectionFromHit never splits grapheme clusters for emoji punctuation hits', () => {
    const model = modelWithParagraphs(['a😀b']);
    const index = buildSemanticIndex(model);
    const block = index.stories[0]!.blocks[0]!;
    const hit = textHit(index.stories[0]!.storyId, block.identity.blockId, 2, 'upstream');
    const { anchor, head } = wordSelectionFromHit(hit, block.wordSegments, block.graphemeCount);
    expect(anchor.graphemeOffset).toBe(1);
    expect(head.graphemeOffset).toBe(2);
  });
});
