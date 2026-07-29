import { describe, expect, test } from 'bun:test';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import { createHarfBuzzLayoutOptions } from '../../core/src/layout/__tests__/fixtures/layout-shaping.ts';
import { toDisplayPages } from '../src/display-bridge.ts';

function layoutWith(text: string) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const paragraphId = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(ORIGIN_IDS.mutationHuman, (commands) =>
    commands.apply({ op: 'insertText', paragraphId, text })
  );
  const current = store.currentModel;
  return {
    model: current,
    layout: layoutBody(current, createHarfBuzzLayoutOptions()),
  };
}

describe('ligature shaping geometry', () => {
  test('opaque fi ligature exposes only exact HarfBuzz cluster edges', () => {
    const { layout } = layoutWith('fi');
    const edges = layout.pages
      .flatMap((page) => page.items)
      .filter((item) => item.type === 'caretEdge');
    expect(edges.map((edge) => edge.utf16Offset)).toEqual([0, 2]);
    expect(edges.every((edge) => edge.navigable && edge.horizontalNavigable)).toBe(true);
  });

  test('display bridge never invents an interior semantic cluster', () => {
    const { model, layout } = layoutWith('fi');
    const bridged = toDisplayPages(model, layout.pages);
    const item = bridged.display
      .flatMap((page) => page.items)
      .find((candidate) => candidate.kind === 'text');
    if (item?.kind !== 'text') throw new Error('expected text display item');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]).toMatchObject({ graphemeFrom: 0, graphemeTo: 2 });
  });

  test('combining sequences retain one hit-test and caret interval', () => {
    const { layout } = layoutWith('x\u0301');
    const item = layout.pages[0]!.items.find((candidate) => candidate.type === 'text');
    if (item?.type !== 'text') throw new Error('expected text item');
    expect(item.shapedRun.clusters.map(({ textStart, textEnd }) => [textStart, textEnd])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    const edges = layout.pages[0]!.items.filter((candidate) => candidate.type === 'caretEdge');
    expect(edges.map((edge) => edge.utf16Offset)).toEqual([0, 2]);
  });
});
