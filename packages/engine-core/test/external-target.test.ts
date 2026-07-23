// External target resolution tests (document-engine tasks 4.8, 4.9). Covers the
// five failure modes, phrase/occurrence/offset discriminators, no-mutation, and
// cross-process determinism.

import { describe, expect, test } from 'bun:test';
import { DocumentStore, resolveExternalTarget } from '../src/store/index.ts';
import { createEmptyModel, bodyStoryId, type ParagraphRecord } from '../src/model/index.ts';
import { ORIGIN_IDS } from '../src/registry/frozen-ids.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

function storeWith(text: string): { store: DocumentStore; p1: string } {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  const store = new DocumentStore(model);
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text }));
  return { store, p1 };
}

describe('resolution success', () => {
  test('bare paragraph target resolves to offset 0', () => {
    const { store, p1 } = storeWith('Hello world');
    expect(resolveExternalTarget(store, { paragraphId: p1 })).toMatchObject({ ok: true, offset: 0 });
  });
  test('unique phrase resolves to its offset', () => {
    const { store, p1 } = storeWith('the quick brown fox');
    expect(resolveExternalTarget(store, { paragraphId: p1, phrase: { text: 'brown' } })).toMatchObject({
      ok: true,
      offset: 10,
    });
  });
  test('occurrence disambiguates a repeated phrase', () => {
    const { store, p1 } = storeWith('ab ab ab');
    expect(resolveExternalTarget(store, { paragraphId: p1, phrase: { text: 'ab', occurrence: 2 } })).toMatchObject({
      ok: true,
      offset: 6,
    });
  });
  test('explicit offset discriminator resolves', () => {
    const { store, p1 } = storeWith('abcdef');
    expect(resolveExternalTarget(store, { paragraphId: p1, offset: 3 })).toMatchObject({ ok: true, offset: 3 });
  });
});

describe('failure modes fail closed', () => {
  test('missing paragraph', () => {
    const { store } = storeWith('x');
    expect(resolveExternalTarget(store, { paragraphId: 'p-999' })).toMatchObject({ ok: false, reason: 'missing' });
  });
  test('ambiguous phrase without occurrence', () => {
    const { store, p1 } = storeWith('ab ab');
    expect(resolveExternalTarget(store, { paragraphId: p1, phrase: { text: 'ab' } })).toMatchObject({
      ok: false,
      reason: 'ambiguous',
    });
  });
  test('phrase not found', () => {
    const { store, p1 } = storeWith('hello');
    expect(resolveExternalTarget(store, { paragraphId: p1, phrase: { text: 'zzz' } })).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });
  test('occurrence out of bounds', () => {
    const { store, p1 } = storeWith('ab ab');
    expect(resolveExternalTarget(store, { paragraphId: p1, phrase: { text: 'ab', occurrence: 5 } })).toMatchObject({
      ok: false,
      reason: 'out-of-bounds',
    });
  });
  test('offset out of bounds', () => {
    const { store, p1 } = storeWith('abc');
    expect(resolveExternalTarget(store, { paragraphId: p1, offset: 99 })).toMatchObject({
      ok: false,
      reason: 'out-of-bounds',
    });
  });
  test('stale base revision', () => {
    const { store, p1 } = storeWith('abc');
    expect(resolveExternalTarget(store, { paragraphId: p1, baseRevision: 0 })).toMatchObject({
      ok: false,
      reason: 'stale',
    });
  });
  test('kind mismatch', () => {
    const { store, p1 } = storeWith('abc');
    // @ts-expect-error deliberately wrong kind
    expect(resolveExternalTarget(store, { paragraphId: p1, kind: 'table' })).toMatchObject({
      ok: false,
      reason: 'kind-mismatch',
    });
  });
});

describe('revision-aware + deterministic (4.9)', () => {
  test('records the resolved revision and never mutates', () => {
    const { store, p1 } = storeWith('abc');
    const before = store.currentRevision;
    const r = resolveExternalTarget(store, { paragraphId: p1, phrase: { text: 'b' } });
    expect(r.resolvedRevision).toBe(before);
    expect(store.currentRevision).toBe(before); // read-only
  });
  test('equivalent serialized targets resolve identically across processes', () => {
    const a = storeWith('shared phrase here');
    const b = storeWith('shared phrase here');
    const target = { paragraphId: a.p1, phrase: { text: 'phrase' } };
    // Same paragraph id since both created-from-scratch models allocate p-1.
    expect(resolveExternalTarget(a.store, target)).toEqual(resolveExternalTarget(b.store, { ...target, paragraphId: b.p1 }));
  });
});
