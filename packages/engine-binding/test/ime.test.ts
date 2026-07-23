// IME composition state machine (document-engine task 6.8).

import { describe, expect, test } from 'bun:test';
import { ImeSession } from '../src/index.ts';
import { DocumentStore, createEmptyModel, bodyStoryId, paragraphText, ORIGIN_IDS, type ModelChange, type ParagraphRecord } from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function store(): { store: DocumentStore; p1: string } {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  return { store: new DocumentStore(model), p1 };
}

function fakeInbound(rev: number): ModelChange {
  return {
    change: 'model-change', fromRevision: rev - 1, toRevision: rev, commitId: `c${rev}`, origin: ORIGIN_IDS.mutationRemote,
    dirty: [], deleted: [], created: [], moves: [], splitJoin: [], dependencyKeys: [], normalized: false,
  };
}

describe('composition lifecycle', () => {
  test('commit inserts the composed text as one history group', () => {
    const { store: s, p1 } = store();
    const ime = new ImeSession();
    ime.start(p1, s.currentRevision);
    ime.update('に');
    ime.update('にほん'); // composition evolves
    const { result } = ime.commit(s);
    expect(result.ok).toBe(true);
    expect(ime.status).toBe('committed');
    expect(paragraphText(s.currentModel, p1)).toBe('にほん');
    expect(s.currentRevision).toBe(1); // ONE commit for the whole composition
  });

  test('cancel discards the composition with no store change', () => {
    const { store: s, p1 } = store();
    const ime = new ImeSession();
    ime.start(p1, s.currentRevision);
    ime.update('half');
    ime.cancel();
    expect(ime.status).toBe('cancelled');
    expect(s.currentRevision).toBe(0);
    expect(paragraphText(s.currentModel, p1)).toBe('');
  });
});

describe('inbound ordering', () => {
  test('inbound changes buffered during composition flush in revision order', () => {
    const { store: s, p1 } = store();
    const ime = new ImeSession();
    ime.start(p1, s.currentRevision);
    ime.receiveInbound(fakeInbound(3));
    ime.receiveInbound(fakeInbound(1));
    ime.receiveInbound(fakeInbound(2));
    ime.update('x');
    const { flush } = ime.commit(s);
    expect(flush.map((f) => f.revision)).toEqual([1, 2, 3]);
  });

  test('receiving inbound or updating after commit throws', () => {
    const { store: s, p1 } = store();
    const ime = new ImeSession();
    ime.start(p1, s.currentRevision);
    ime.commit(s);
    expect(() => ime.update('y')).toThrow(/not composing/);
    expect(() => ime.receiveInbound(fakeInbound(1))).toThrow(/not composing/);
  });
});
