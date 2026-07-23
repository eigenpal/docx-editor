// Snapshot payload + atomic restore (document-engine task 5.6). Restore reproduces
// the authored-state FINGERPRINT (not a revision sequence), preserves the id
// allocator, and rejects an unsupported schema before building any state.

import { describe, expect, test } from 'bun:test';
import { LocalBackend, SNAPSHOT_SCHEMA_VERSION } from '../src/index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  utf8ToHex,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function edited(): LocalBackend {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  const backend = LocalBackend.fromModel('doc', model);
  backend.documentStore.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'snap me' }));
  backend.documentStore.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId: bodyStoryId(model) }));
  return backend;
}

describe('snapshot -> restore', () => {
  test('reproduces the authored-state fingerprint and revision', () => {
    const backend = edited();
    const restored = LocalBackend.restore(backend.snapshot());
    // Fingerprint equality is the acceptance criterion, not the revision path.
    expect(restored.stateFingerprint()).toBe(backend.stateFingerprint());
    expect(restored.documentStore.currentRevision).toBe(backend.documentStore.currentRevision);
  });

  test('preserves the id allocator so new ids do not collide after restore', () => {
    const backend = edited();
    const restored = LocalBackend.restore(backend.snapshot());
    const before = restored.stateFingerprint();
    // A new append on the restored store allocates a fresh, non-colliding id.
    const r = restored.documentStore.transact(HUMAN, (c) =>
      c.apply({ op: 'appendParagraph', storyId: bodyStoryId(restored.documentStore.currentModel) }),
    );
    expect(r.ok).toBe(true);
    const ids = restored.documentStore.currentModel.stories
      .get(bodyStoryId(restored.documentStore.currentModel))!
      .blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    expect(restored.stateFingerprint()).not.toBe(before);
  });

  test('an unsupported snapshot schema is rejected before any state is built', () => {
    const good = LocalBackend.fromModel('doc', createEmptyModel()).snapshot();
    // Forge a future schema version into the payload.
    const forged = {
      ...good,
      bytesHex: utf8ToHex(
        JSON.stringify({ schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1, normalizationVersion: 1, model: { contentTypes: { defaults: [], overrides: [] }, relationships: [], stories: [], styles: [], numbering: [], parts: [], identity: { cursors: {} } }, revision: 0 }),
      ),
    };
    expect(() => LocalBackend.restore(forged)).toThrow(/unsupported snapshot schema/);
  });
});
