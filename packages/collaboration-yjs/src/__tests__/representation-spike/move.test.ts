import { describe, expect, test } from 'bun:test';
import { canonicalOoxmlFingerprint, validateOoxmlPart } from '@docx-editor.dev/core/store';
import type { BackendKind, MoveGateEvidence } from './contract.ts';
import { collectKind, moveFixture, nodeText, runWithText } from './fixtures.ts';
import { moveEvidence } from './gates.ts';
import { insertText, moveRun } from './ops.ts';
import { concurrent, createPair, destroyPair } from './replicas.ts';

const BACKENDS: readonly BackendKind[] = ['xml', 'registry'];
export const moveGateResults: MoveGateEvidence[] = [];

describe('representation spike move and reparent', () => {
  for (const kind of BACKENDS) {
    test(`${kind} move with concurrent descendant text`, () => {
      const pair = createPair(kind, moveFixture());
      try {
        const movedId = runWithText(pair.left.materializer.current(), 'MoveMe').id;
        const result = concurrent(
          pair,
          (replica) => moveRun(replica, pair.left.materializer.current(), 'MoveMe', 'Dest', 1),
          (replica) => insertText(replica, pair.right.materializer.current(), 'MoveMe', 6, '!')
        );
        const left = pair.left.materializer.current();
        const right = pair.right.materializer.current();
        expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
        expect(validateOoxmlPart(left).ok).toBe(true);
        const dest = collectKind(left, 'paragraph').find((paragraph) =>
          nodeText(paragraph).includes('Dest')
        );
        expect(dest).toBeDefined();
        const destText = dest ? nodeText(dest) : '';
        const logicalIdSurvived = Boolean(
          collectKind(left, 'run').some((run) => run.id === movedId)
        );
        const descendantEditSurvived = destText.includes('MoveMe!');
        const evidence = moveEvidence(kind, logicalIdSurvived, descendantEditSurvived);
        moveGateResults.push(evidence);
        expect(result.sizes.updateBytes).toBeGreaterThan(0);
        if (kind === 'registry') {
          expect(evidence.verdict).toBe('pass');
          expect(logicalIdSurvived).toBe(true);
          expect(descendantEditSurvived).toBe(true);
        } else {
          expect(evidence.verdict).toBe('kill');
        }
      } finally {
        destroyPair(pair);
      }
    });

    test(`${kind} reparents a run onto a source sibling while the destination types`, () => {
      const pair = createPair(kind, moveFixture());
      try {
        concurrent(
          pair,
          (replica) => moveRun(replica, pair.left.materializer.current(), 'MoveMe', 'Dest', 1),
          (replica) => insertText(replica, pair.right.materializer.current(), 'Dest', 4, '?')
        );
        const left = pair.left.materializer.current();
        const right = pair.right.materializer.current();
        expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
        const dest = collectKind(left, 'paragraph').find((paragraph) =>
          nodeText(paragraph).includes('Dest')
        );
        expect(dest ? nodeText(dest) : '').toContain('Dest?');
      } finally {
        destroyPair(pair);
      }
    });
  }
});
