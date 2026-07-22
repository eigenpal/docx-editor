import { expect, test } from 'bun:test';
import { runFormattingBakeoff } from '../experiments/yjs-formatting-kiss.js';

test('reports deterministic actual Yjs byte metrics and the justified winner', () => {
  const first = runFormattingBakeoff();
  expect(first).toEqual(runFormattingBakeoff());
  expect(first.winner).toBe('mark-contributions');

  for (const candidate of Object.values(first.candidates)) {
    expect(candidate.encodedBytes).toBe(candidate.byteMetric.totalBytes);
    expect(candidate.byteMetric.authoredOperationBytes).toBeGreaterThan(0);
    expect(candidate.byteMetric.historyOperationBytes).toBeGreaterThan(0);
    expect(candidate.byteMetric.terminalSnapshotBytes).toBeGreaterThan(0);
    expect(candidate.byteMetric.totalBytes).toBe(
      candidate.byteMetric.authoredOperationBytes +
        candidate.byteMetric.historyOperationBytes +
        candidate.byteMetric.terminalSnapshotBytes
    );
    expect(candidate.byteMetric.authoredOperationCount).toBeGreaterThan(0);
    expect(candidate.byteMetric.historyOperationCount).toBeGreaterThan(0);
    expect(candidate.byteMetric.terminalSnapshotCount).toBeGreaterThan(0);
    expect(candidate.byteMetric.schedule).toBe(
      'genesis-excluded-source-updates-plus-terminal-snapshots'
    );
    for (const outcome of Object.values(candidate.cases)) {
      expect(outcome.evidence.sourceOperationUpdateCount).toBeGreaterThan(0);
      expect(outcome.evidence.sourceOperationUpdateCount).toBe(
        (outcome.evidence.authoredOperationUpdateCount as number) +
          (outcome.evidence.historyOperationUpdateCount as number)
      );
      expect(outcome.evidence.terminalSnapshotCount).toBeGreaterThan(0);
      expect(outcome.evidence.totalScenarioBytes).toBe(
        (outcome.evidence.sourceOperationBytes as number) +
          (outcome.evidence.terminalSnapshotBytes as number)
      );
      expect(outcome.evidence.byteAccountingMatches).toBe(true);
      const ids = outcome.evidence.clientIds as readonly number[];
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      expect(outcome.evidence.clientIdsCollisionFree).toBe(true);
    }
  }
  expect(first.candidates['native-attributes'].clientIdSchedule).toEqual(
    first.candidates['mark-contributions'].clientIdSchedule
  );
  expect(first.candidates['native-attributes'].clientIdsCollisionFree).toBe(true);
  expect(first.candidates['mark-contributions'].clientIdsCollisionFree).toBe(true);
  expect(first.candidates['native-attributes'].byteMetric.authoredOperationCount).toBe(18);
  expect(first.candidates['native-attributes'].byteMetric.historyOperationCount).toBe(7);
  expect(first.candidates['native-attributes'].byteMetric.terminalSnapshotCount).toBe(13);
  expect(first.candidates['native-attributes'].byteMetric.authoredOperationCount).toBe(
    first.candidates['mark-contributions'].byteMetric.authoredOperationCount
  );
  expect(first.candidates['native-attributes'].byteMetric.historyOperationCount).toBe(
    first.candidates['mark-contributions'].byteMetric.historyOperationCount
  );
  expect(first.candidates['native-attributes'].byteMetric.terminalSnapshotCount).toBe(
    first.candidates['mark-contributions'].byteMetric.terminalSnapshotCount
  );
});

test('rejects native overlap when both actor contributions do not coexist before undo', () => {
  const result = runFormattingBakeoff();
  const native = result.candidates['native-attributes'].cases['overlap-undo'];
  const contributions = result.candidates['mark-contributions'].cases['overlap-undo'];

  expect(native.passed).toBe(false);
  expect(native.evidence.preUndoOwnerCount).toBe(1);
  expect(contributions.passed).toBe(true);
  expect(contributions.evidence.preUndoOwnerCount).toBe(2);
  expect(contributions.evidence.otherActorSurvivedUndo).toBe(true);
});

test('proves observed disable targets all observed intersecting adds but not unseen adds', () => {
  const result = runFormattingBakeoff();
  const native = result.candidates['native-attributes'].cases['observed-disable'].evidence;
  const contributions =
    result.candidates['mark-contributions'].cases['observed-disable'].evidence;
  expect(native.observedIntersectingCount).toBe(2);
  expect(native.observedIntersectingIds).toEqual(['alice:observed', 'bob:observed']);
  expect(contributions.observedIntersectingCount).toBe(2);
  expect(contributions.observedIntersectingIds).toEqual([
    'alice:observed',
    'bob:observed',
  ]);
  expect(contributions.observedDisabled).toBe(true);
  expect(contributions.unseenPreserved).toBe(true);
  expect(contributions.targetsFromYjsState).toBe(true);
  expect(contributions.creationOnlyRecords).toBe(true);
});

test('directly proves independent marks, provenance, omission, intent, and non-destructive projection', () => {
  const result = runFormattingBakeoff();
  for (const candidate of Object.values(result.candidates)) {
    const evidence = candidate.cases['mark-independence'].evidence;
    expect(evidence.boldItalicIndependent).toBe(true);
    expect(evidence.semanticMarkIdPreserved).toBe(true);
    expect(evidence.actorCommitProvenancePreserved).toBe(true);
    expect(evidence.explicitRawLexicalValue).toBe('w:val="1"');
    expect(evidence.omittedRecordHasRawValue).toBe(false);
    expect(evidence.formattingRawIntentPreservedAcrossSyncProjectionUndoRedo).toBe(true);
    expect(evidence.normalizationWasReadOnly).toBe(true);
  }
  const contributionEvidence =
    result.candidates['mark-contributions'].cases['mark-independence'].evidence;
  expect(contributionEvidence.plainImmutableRecords).toBe(true);
  expect(contributionEvidence.canonicalBase64urlEndpoints).toBe(true);
});

test('uses concurrent branches and both delivery orders for endpoint, split, join, and convergence', () => {
  const result = runFormattingBakeoff();
  for (const candidate of Object.values(result.candidates)) {
    const endpoint = candidate.cases['endpoint-affinity'].evidence;
    const split = candidate.cases['split-tail'].evidence;
    const endpointVectors = endpoint.branchStateVectors as readonly string[];
    const splitVectors = split.branchStateVectors as readonly string[];
    expect(endpoint.concurrentFromSameBase).toBe(true);
    expect(endpointVectors).toHaveLength(2);
    expect(endpointVectors[0]).toBe(endpointVectors[1]);
    expect(endpoint.bothDeliveryOrdersConverged).toBe(true);
    expect(endpoint.terminalStatesEqual).toBe(true);
    expect(endpoint.boundaryInsertionExcluded).toBe(true);
    expect(split.concurrentFromSameBase).toBe(true);
    expect(splitVectors).toHaveLength(2);
    expect(splitVectors[0]).toBe(splitVectors[1]);
    expect(split.bothDeliveryOrdersConverged).toBe(true);
    expect(split.terminalStatesEqual).toBe(true);
    expect(split.textInsertPreserved).toBe(true);
    expect(split.splitTailPreserved).toBe(true);
    expect(split.joinPreserved).toBe(true);
  }
});

test('restores snapshot and reconstructs formatting undo and redo with identity parity', () => {
  const result = runFormattingBakeoff();
  for (const candidate of Object.values(result.candidates)) {
    const reopen = candidate.cases['reopen-history'].evidence;
    expect(reopen.persistedSnapshotBytes).toBeGreaterThan(0);
    expect(reopen.journalEntries).toBeLessThanOrEqual(4);
    expect(reopen.undoParity).toBe(true);
    expect(reopen.redoParity).toBe(true);
    expect(reopen.distinctClientIds).toBe(true);
    expect(reopen.historyItemKind).toBe('format-disable');
    expect(reopen.undoRestoredContributionId).toBe('alice:reopen');
    expect(reopen.undoRestoredCoverage).toBe('abc');
    expect(reopen.redoRemovedCoverage).toBe('');
    expect(reopen.contributionIdentityParity).toBe(true);
    expect(reopen.managerStackParity).toBe(true);
    expect(candidate.cases['reopen-history'].passed).toBe(true);
    expect(candidate.cases['split-tail'].evidence.recordCountWithinBound).toBe(true);
    expect(candidate.cases['split-tail'].evidence.encodedBytesWithinBound).toBe(true);
  }
});
