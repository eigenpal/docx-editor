import { expect, test } from 'bun:test';
import { runFormattingBakeoff } from '../experiments/yjs-formatting-kiss.js';

test('reports deterministic actual Yjs byte metrics and the justified winner', () => {
  const first = runFormattingBakeoff();
  expect(first).toEqual(runFormattingBakeoff());
  expect(first.winner).toBe('mark-contributions');

  for (const candidate of Object.values(first.candidates)) {
    expect(candidate.encodedBytes).toBe(candidate.byteMetric.totalBytes);
    expect(candidate.byteMetric.snapshotBytes).toBeGreaterThan(0);
    expect(candidate.byteMetric.updateBytes).toBeGreaterThan(0);
    expect(candidate.byteMetric.schedule).toBe('snapshot-plus-captured-updates');
  }
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
  for (const candidate of Object.values(result.candidates)) {
    const evidence = candidate.cases['observed-disable'].evidence;
    expect(evidence.observedIntersectingCount).toBe(2);
    expect(evidence.observedDisabled).toBe(true);
    expect(evidence.unseenPreserved).toBe(true);
  }
  expect(result.candidates['mark-contributions'].cases['observed-disable'].evidence.targetsFromYjsState).toBe(
    true
  );
  expect(result.candidates['mark-contributions'].cases['observed-disable'].evidence.creationOnlyRecords).toBe(
    true
  );
});

test('directly proves independent marks, provenance, omission, intent, and non-destructive projection', () => {
  const result = runFormattingBakeoff();
  for (const candidate of Object.values(result.candidates)) {
    const evidence = candidate.cases['mark-independence'].evidence;
    expect(evidence.boldItalicIndependent).toBe(true);
    expect(evidence.semanticMarkIdPreserved).toBe(true);
    expect(evidence.actorCommitProvenancePreserved).toBe(true);
    expect(evidence.authoredOmissionPreserved).toBe(true);
    expect(evidence.rawIntentPreserved).toBe(true);
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
    expect(endpoint.concurrentFromSameBase).toBe(true);
    expect(endpoint.bothDeliveryOrdersConverged).toBe(true);
    expect(endpoint.boundaryInsertionExcluded).toBe(true);
    expect(split.concurrentFromSameBase).toBe(true);
    expect(split.bothDeliveryOrdersConverged).toBe(true);
    expect(split.textInsertPreserved).toBe(true);
    expect(split.splitTailPreserved).toBe(true);
    expect(split.joinPreserved).toBe(true);
  }
});

test('restores snapshot and proves reconstructed undo and redo parity within bounds', () => {
  const result = runFormattingBakeoff();
  for (const candidate of Object.values(result.candidates)) {
    const reopen = candidate.cases['reopen-history'].evidence;
    expect(reopen.persistedSnapshotBytes).toBeGreaterThan(0);
    expect(reopen.journalEntries).toBeLessThanOrEqual(4);
    expect(reopen.undoParity).toBe(true);
    expect(reopen.redoParity).toBe(true);
    expect(reopen.distinctClientIds).toBe(true);
    expect(candidate.cases['reopen-history'].passed).toBe(true);
    expect(candidate.cases['split-tail'].evidence.recordCountWithinBound).toBe(true);
    expect(candidate.cases['split-tail'].evidence.encodedBytesWithinBound).toBe(true);
  }
});
