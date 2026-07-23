// Bounded local edits avoid whole-document hot paths (document-engine perf spec
// "Bounded edits avoid whole-document hot paths"; task 13.5 core). A single-
// paragraph edit MUST NOT clone/rebuild untouched paragraphs or stories — proven
// here by object-reference identity of the unchanged content after a commit.

import { describe, expect, test } from 'bun:test';
import { DocumentStore } from '../src/store/index.ts';
import { createEmptyModel, bodyStoryId, appendParagraph, type ParagraphRecord, type Story } from '../src/model/index.ts';
import { ORIGIN_IDS } from '../src/registry/frozen-ids.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

function modelWithParagraphs(n: number) {
  let model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const ids: string[] = [(model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id];
  for (let i = 1; i < n; i++) {
    const r = appendParagraph(model, storyId);
    model = r.model;
    ids.push(r.paragraphId);
  }
  // Add a second (header) story to prove cross-story references are preserved too.
  const header: Story = { id: 'st-h', kind: 'header', blocks: [{ kind: 'paragraph', id: 'hp', runs: [] }] };
  const stories = new Map(model.stories);
  stories.set('st-h', header);
  return { model: { ...model, stories }, storyId, ids };
}

describe('bounded edit reference preservation', () => {
  test('editing one paragraph leaves every OTHER paragraph object identical', () => {
    const { model, storyId, ids } = modelWithParagraphs(50);
    const store = new DocumentStore(model);
    const before = store.currentModel.stories.get(storyId)!.blocks;

    // Edit the paragraph near the end.
    const target = ids[40];
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: target, text: 'x' }));

    const after = store.currentModel.stories.get(storyId)!.blocks;
    let rebuilt = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) rebuilt++;
    }
    // Exactly one paragraph object changed; the other 49 are the same references.
    expect(rebuilt).toBe(1);
  });

  test('an untouched sibling story keeps its exact object reference', () => {
    const { model, storyId, ids } = modelWithParagraphs(10);
    const store = new DocumentStore(model);
    const headerBefore = store.currentModel.stories.get('st-h');
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: ids[0], text: 'y' }));
    // The body changed; the header story object is untouched (===).
    expect(store.currentModel.stories.get('st-h')).toBe(headerBefore);
    void storyId;
  });

  test("normalization does not rebuild a paragraph it doesn't change", () => {
    const { model, storyId, ids } = modelWithParagraphs(5);
    const store = new DocumentStore(model);
    // Commit a no-op-normalization edit on one paragraph; others stay identical.
    const p0 = store.currentModel.stories.get(storyId)!.blocks[0];
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: ids[3], text: 'z' }));
    expect(store.currentModel.stories.get(storyId)!.blocks[0]).toBe(p0);
  });
});
