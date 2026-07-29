// Yjs backend + two-client convergence (document-engine tasks 5.2, 5.4, 5.10).
// Verifies snapshot round-trip, and that concurrent/conflicting ops delivered in
// different orders converge to equivalent normalized authored state with
// deterministic semantic-id repair.

import { describe, expect, test } from 'bun:test';
import { YjsBackend } from '../index.ts';
import { createEmptyModel, encodeModel, fingerprint, type ParagraphRecord } from '@docx-editor.dev/core-contract/store';

const BODY = 'st-1';
const P1 = 'p-1';

function fp(backend: YjsBackend): string {
  return fingerprint('authoredState', encodeModel(backend.deriveModel()));
}

describe('Yjs backend round-trip', () => {
  test('deriveModel reproduces the seeded model', () => {
    const model = createEmptyModel();
    const backend = YjsBackend.fromModel('doc', 'a', model);
    const derived = backend.deriveModel();
    expect(derived.stories.get(BODY)!.blocks.map((b) => (b as ParagraphRecord).id)).toEqual([P1]);
  });
  test('insertText is visible in the derived model', () => {
    const backend = YjsBackend.empty('doc', 'a');
    backend.insertText(P1, 'hello');
    const p = backend.deriveModel().stories.get(BODY)!.blocks[0] as ParagraphRecord;
    expect(p.runs.map((r) => r.text).join('')).toBe('hello');
  });
});

describe('two-client convergence', () => {
  function converge(deliverForward: boolean): { a: YjsBackend; b: YjsBackend } {
    const a = YjsBackend.fromModel('doc', 'a', createEmptyModel());
    const b = YjsBackend.join('doc', 'b', a.snapshot());

    // Concurrent edits, including a conflicting semantic-id allocation (both p-2).
    a.insertText(P1, 'AAA');
    a.appendParagraph(BODY, 'p-2');
    b.insertText(P1, 'BBB');
    b.appendParagraph(BODY, 'p-2');

    const ua = a.encodeUpdate('ua');
    const ub = b.encodeUpdate('ub');
    if (deliverForward) {
      b.applyUpdate(ua);
      a.applyUpdate(ub);
    } else {
      // Delivery order swapped on each replica.
      a.applyUpdate(ub);
      b.applyUpdate(ua);
    }
    return { a, b };
  }

  test('concurrent conflicting ops converge to equal authored state', () => {
    const { a, b } = converge(true);
    expect(fp(a)).toBe(fp(b));
  });

  test('different delivery order still converges to the same state', () => {
    const forward = converge(true);
    const swapped = converge(false);
    // Both replicas of each run agree...
    expect(fp(swapped.a)).toBe(fp(swapped.b));
    // ...and the converged state is independent of delivery order.
    expect(fp(forward.a)).toBe(fp(swapped.a));
  });

  test('conflicting semantic ids are repaired deterministically (no loss)', () => {
    const { a } = converge(true);
    const ids = a.deriveModel().stories.get(BODY)!.blocks.map((x) => (x as ParagraphRecord).id);
    // Both p-2 candidates survive: one keeps p-2, the other is repaired.
    expect(ids.filter((id) => id === 'p-2')).toHaveLength(1);
    expect(ids.some((id) => id.startsWith('p-2~'))).toBe(true);
  });
});
