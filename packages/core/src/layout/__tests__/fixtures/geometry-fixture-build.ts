// Build PackageModel instances from declarative geometry-fixture input.

import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
  type TableRecord,
} from '@docx-editor.dev/engine-core';
import type { GeometryFixtureInput } from './geometry-fixtures.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

function insertParagraphText(store: DocumentStore, paragraphId: string, text: string): void {
  if (text.length > 0) {
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId, text }));
  }
}

function appendParagraph(store: DocumentStore, storyId: string): string {
  const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
  return r.ok ? r.modelChange.created[0]! : '';
}

function setRuns(store: DocumentStore, paragraphId: string, runs: readonly string[]): void {
  store.transact(HUMAN, (c) =>
    c.apply({
      op: 'setParagraphRuns',
      paragraphId,
      runs: runs.map((text) => ({ text })),
    }),
  );
}

function makeTable(cellText: string, tableId = 'tbl-fixture'): TableRecord {
  return {
    kind: 'table',
    id: tableId,
    rows: [
      {
        id: 'row-fixture',
        cells: [
          {
            id: 'cell-fixture',
            blocks: [{ kind: 'paragraph', id: 'para-cell', runs: cellText ? [{ text: cellText }] : [] }],
          },
        ],
      },
    ],
  };
}

function withTable(model: PackageModel, table: TableRecord): PackageModel {
  const storyId = bodyStoryId(model);
  const story = model.stories.get(storyId)!;
  return {
    ...model,
    stories: new Map(model.stories).set(storyId, { ...story, blocks: [...story.blocks, table] }),
  };
}

/** Build a canonical model for a geometry fixture input. */
export function modelFromFixtureInput(input: GeometryFixtureInput): PackageModel {
  if (input.atomicImagePlaceholder) {
    return createEmptyModel();
  }

  if (input.paginate) {
    const words = Array.from({ length: input.paginate.wordCount }, (_, i) => `word${i}`).join(' ');
    return modelFromFixtureInput({ paragraphs: [{ text: words }] });
  }

  if (input.structuralTableOnly && input.tableCellParagraph !== undefined) {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const story = base.stories.get(storyId)!;
    return {
      ...base,
      stories: new Map(base.stories).set(storyId, { ...story, blocks: [makeTable(input.tableCellParagraph)] }),
    };
  }

  if (input.tableCellParagraph !== undefined && !input.structuralTableOnly) {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const story = base.stories.get(storyId)!;
    return {
      ...base,
      stories: new Map(base.stories).set(storyId, { ...story, blocks: [makeTable(input.tableCellParagraph)] }),
    };
  }

  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  let firstId = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;

  for (let i = 0; i < (input.leadingEmptyParagraphs ?? 0); i += 1) {
    store.transact(HUMAN, (c) => c.apply({ op: 'insertParagraph', storyId, index: 0, runs: [] }));
    firstId = (store.currentModel.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  }

  const paragraphs = input.paragraphs ?? [{ text: '' }];
  let currentId = firstId;
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (i > 0) currentId = appendParagraph(store, storyId);
    const spec = paragraphs[i]!;
    if (spec.empty) continue;
    if (spec.runs && spec.runs.length > 0) setRuns(store, currentId, spec.runs);
    else if (spec.text !== undefined) insertParagraphText(store, currentId, spec.text);
  }

  for (let i = 0; i < (input.trailingEmptyParagraphs ?? 0); i += 1) {
    appendParagraph(store, storyId);
  }

  return store.currentModel;
}

export function paginateLayoutOptions(input: GeometryFixtureInput) {
  if (!input.paginate) return null;
  return {
    narrowPageWidth: input.paginate.narrowPageWidth ?? 4000,
  };
}
