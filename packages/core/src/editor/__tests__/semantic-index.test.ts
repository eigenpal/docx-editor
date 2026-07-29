// Model-derived semantic index tests (interactive-paginated-editing 3.2–3.4).

import { describe, expect, test } from 'bun:test';
import {
  buildSemanticIndex,
  caretAffinity,
  paragraphEditableInLane,
} from '../semantic-index.ts';
import { createBoundedFallbackWordBoundary } from '@docx-editor.dev/core-contract/layout';
import { deepFreezeValue } from '../interaction-frame.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
  type TableRecord,
} from '@docx-editor.dev/core-contract/store';

const HUMAN = ORIGIN_IDS.mutationHuman;

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

function withTableCell(cellText: string) {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const table: TableRecord = {
    kind: 'table',
    id: 'tbl-1',
    rows: [
      {
        id: 'row-1',
        cells: [
          {
            id: 'cell-1',
            blocks: [{ kind: 'paragraph', id: 'p-cell', runs: [{ text: cellText }] }],
          },
        ],
      },
    ],
  };
  return {
    ...base,
    stories: new Map(base.stories).set(storyId, { ...story, blocks: [story.blocks[0]!, table] }),
  };
}

describe('semantic position index', () => {
  test('table-cell paragraphs are read-only with ownership but no editable caret stops', () => {
    const index = buildSemanticIndex(withTableCell('cell'));
    const cellBlock = index.stories[0]!.blocks.find((b) => b.identity.blockId === 'p-cell');
    expect(cellBlock?.readOnly).toBe(true);
    expect(
      index.caretStops.some(
        (s) => s.target.kind === 'text' && s.target.identity.blockId === 'p-cell'
      )
    ).toBe(false);
    expect(
      index.ownershipRegions.some((r) => r.kind === 'paragraph' && r.identity.blockId === 'p-cell')
    ).toBe(true);
  });

  test('top-level body flow is editable; nested table cells are not', () => {
    expect(paragraphEditableInLane({ inTopLevelBodyFlow: true, inTableCell: false })).toBe(true);
    expect(paragraphEditableInLane({ inTopLevelBodyFlow: true, inTableCell: true })).toBe(false);
    expect(paragraphEditableInLane({ inTopLevelBodyFlow: false, inTableCell: false })).toBe(false);
  });

  test('mixed paragraphs emit explicit whitespace ownership subranges without boxes', () => {
    const index = buildSemanticIndex(modelWithParagraphs(['hello world']));
    const block = index.stories[0]!.blocks[0]!;
    const ws = index.ownershipRegions.filter(
      (r) => r.kind === 'lineWhitespace' && r.identity.blockId === block.identity.blockId
    );
    expect(ws).toHaveLength(1);
    expect(ws[0]!.utf16From).toBe(5);
    expect(ws[0]!.utf16To).toBe(6);
    expect(ws[0]!.graphemeFrom).toBe(5);
    expect(ws[0]!.graphemeTo).toBe(6);
    expect(ws[0]!.box).toBeUndefined();
  });

  test('caret affinity uses full paragraph grapheme count for edge ties', () => {
    expect(caretAffinity(0, 3)).toBe('downstream');
    expect(caretAffinity(3, 3)).toBe('downstream');
    expect(caretAffinity(2, 3)).toBe('upstream');
  });

  test('block records include model-derived word segments with grapheme-safe endpoints', () => {
    const index = buildSemanticIndex(modelWithParagraphs(["don't a😀b"]));
    const block = index.stories[0]!.blocks[0]!;
    expect(block.wordSegments.length).toBeGreaterThan(0);
    for (const seg of block.wordSegments) {
      expect(seg.graphemeFrom).toBeLessThan(seg.graphemeTo);
      expect(seg.graphemeTo).toBeLessThanOrEqual(block.graphemeCount);
    }
  });

  test('buildSemanticIndex accepts injected word boundary for fallback segmentation', () => {
    const model = modelWithParagraphs(['a—b']);
    const intl = buildSemanticIndex(model);
    const fallback = buildSemanticIndex(
      model,
      { kind: 'body' },
      createBoundedFallbackWordBoundary()
    );
    expect(
      intl.stories[0]!.blocks[0]!.wordSegments.some(
        (s) => s.wordLike && s.graphemeTo - s.graphemeFrom === 1
      )
    ).toBe(true);
    expect(fallback.stories[0]!.blocks[0]!.wordSegments).toEqual([
      { graphemeFrom: 0, graphemeTo: 1, wordLike: true },
      { graphemeFrom: 1, graphemeTo: 2, wordLike: false },
      { graphemeFrom: 2, graphemeTo: 3, wordLike: true },
    ]);
  });

  test('deep-frozen semanticIndex rejects mutation', () => {
    const index = deepFreezeValue(buildSemanticIndex(createEmptyModel()));
    expect(Object.isFrozen(index)).toBe(true);
    expect(() => {
      (index.caretStops as unknown[]).push({});
    }).toThrow();
  });
});
