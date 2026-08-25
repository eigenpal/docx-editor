import { describe, expect, test } from 'bun:test';
import type { AllocationGateEvidence, BackendKind, MoveGateEvidence } from './contract.ts';
import {
  collectKind,
  countNewReferences,
  moveFixture,
  nodeText,
  runWithText,
  twoParagraphFixture,
} from './fixtures.ts';
import { allocationEvidence, moveEvidence } from './gates.ts';
import { insertText, moveRun } from './ops.ts';
import { concurrent, createPair, destroyPair, syncOne } from './replicas.ts';

const BACKENDS: readonly BackendKind[] = ['xml', 'registry'];

export const recordedAllocationGates: AllocationGateEvidence[] = [];
export const recordedMoveGates: MoveGateEvidence[] = [];

describe('representation spike pass and kill gates', () => {
  for (const kind of BACKENDS) {
    test(`${kind} remote one-character allocation stays under the 3x pass gate`, () => {
      const pair = createPair(kind, twoParagraphFixture());
      try {
        const beforeLeft = pair.left.materializer.current();
        const beforeRight = pair.right.materializer.current();
        insertText(pair.left, beforeLeft, 'Alpha', 5, '!');
        const afterLeft = pair.left.materializer.rebuild();
        const localAllocated = countNewReferences(beforeLeft.root, afterLeft.root);
        syncOne(pair.left, pair.right);
        const afterRight = pair.right.materializer.current();
        const remoteAllocated = countNewReferences(beforeRight.root, afterRight.root);
        const evidence = allocationEvidence(kind, localAllocated, remoteAllocated);
        recordedAllocationGates.push(evidence);
        expect(evidence.verdict).toBe('pass');
        expect(evidence.ratio).toBeLessThan(3);
      } finally {
        destroyPair(pair);
      }
    });

    test(`${kind} move gate records exact pass or kill`, () => {
      const pair = createPair(kind, moveFixture());
      try {
        const movedId = runWithText(pair.left.materializer.current(), 'MoveMe').id;
        concurrent(
          pair,
          (replica) => moveRun(replica, pair.left.materializer.current(), 'MoveMe', 'Dest', 1),
          (replica) => insertText(replica, pair.right.materializer.current(), 'MoveMe', 6, '!')
        );
        const left = pair.left.materializer.current();
        const dest = collectKind(left, 'paragraph').find((paragraph) =>
          nodeText(paragraph).includes('Dest')
        );
        const logicalIdSurvived = collectKind(left, 'run').some((run) => run.id === movedId);
        const descendantEditSurvived = dest ? nodeText(dest).includes('MoveMe!') : false;
        const evidence = moveEvidence(kind, logicalIdSurvived, descendantEditSurvived);
        recordedMoveGates.push(evidence);
        if (kind === 'registry') expect(evidence.verdict).toBe('pass');
        else expect(evidence.verdict).toBe('kill');
      } finally {
        destroyPair(pair);
      }
    });
  }

  test('keeps XML killed and does not select a backend from allocation or move alone', () => {
    const xmlMove = recordedMoveGates.find((row) => row.backend === 'xml');
    const registryMove = recordedMoveGates.find((row) => row.backend === 'registry');
    const xmlAlloc = recordedAllocationGates.find((row) => row.backend === 'xml');
    const registryAlloc = recordedAllocationGates.find((row) => row.backend === 'registry');
    expect(xmlMove?.verdict).toBe('kill');
    expect(registryMove?.verdict).toBe('pass');
    expect(xmlAlloc?.verdict).toBe('pass');
    expect(registryAlloc?.verdict).toBe('pass');
  });
});
