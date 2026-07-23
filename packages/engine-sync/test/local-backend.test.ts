// Local backend tests (document-engine task 5.1), running from engine-sync and
// consuming @docx-editor.dev/engine-core across the package boundary.

import { describe, expect, test } from 'bun:test';
import { LocalBackend } from '../src/index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  paragraphText,
  encodeModel,
  isSnapshot,
  isReplicationUpdate,
  isDocOp,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function backendWithEdit(): { backend: LocalBackend; p1: string } {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  const backend = LocalBackend.fromModel('doc-1', model);
  backend.documentStore.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'persisted' }));
  return { backend, p1 };
}

describe('cross-package: engine-sync consumes engine-core', () => {
  test('backend contracts are distinct opaque envelopes', () => {
    const { backend } = backendWithEdit();
    const snap = backend.snapshot();
    const upd = backend.encodeUpdate('u1');
    expect(isSnapshot(snap)).toBe(true);
    expect(isReplicationUpdate(upd)).toBe(true);
    expect(isDocOp(snap)).toBe(false);
  });

  test('snapshot -> restore reproduces authored state and revision', () => {
    const { backend, p1 } = backendWithEdit();
    const restored = LocalBackend.restore(backend.snapshot());
    expect(restored.documentStore.currentRevision).toBe(backend.documentStore.currentRevision);
    expect(paragraphText(restored.documentStore.currentModel, p1)).toBe('persisted');
    expect(JSON.stringify(encodeModel(restored.documentStore.currentModel))).toBe(
      JSON.stringify(encodeModel(backend.documentStore.currentModel)),
    );
  });

  test('restored store keeps editing and undoing correctly', () => {
    const { backend, p1 } = backendWithEdit();
    const restored = LocalBackend.restore(backend.snapshot());
    restored.documentStore.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: '!' }));
    expect(paragraphText(restored.documentStore.currentModel, p1)).toBe('persisted!');
    restored.documentStore.undo();
    expect(paragraphText(restored.documentStore.currentModel, p1)).toBe('persisted');
  });

  test('decodeUpdate rejects a foreign-document envelope', () => {
    const { backend } = backendWithEdit();
    const upd = backend.encodeUpdate('u1');
    const other = LocalBackend.fromModel('doc-OTHER', createEmptyModel());
    expect(() => other.decodeUpdate(upd)).toThrow(/another document/);
  });
});
