import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const oracleDir = join(import.meta.dir, '..', 'oracles');
const names = [
  'yjs-schema.v2.json',
  'binding-oracle.v2.json',
  'history-oracle.v2.json',
  'comparator-contracts.v2.json',
] as const;
type Json = Record<string, any>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Json).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function read(name: (typeof names)[number]): Json {
  return JSON.parse(readFileSync(join(oracleDir, name), 'utf8')) as Json;
}

function integrityHash(artifact: Json): string {
  const copy = structuredClone(artifact);
  delete copy.integrityHash.value;
  return createHash('sha256').update(canonical(copy)).digest('hex');
}

describe('task 2.5 lean v2 contract artifacts', () => {
  const schema = read(names[0]);
  const binding = read(names[1]);
  const history = read(names[2]);
  const comparators = read(names[3]);
  const artifacts = [schema, binding, history, comparators];

  test('self-hashes are integrity checks and schema references are reproducible', () => {
    for (const artifact of artifacts) {
      expect(artifact.integrityHash).toMatchObject({
        algorithm: 'sha256',
        purpose: 'drift-detection-only',
      });
      expect(integrityHash(artifact)).toBe(artifact.integrityHash.value);
    }
    for (const artifact of [binding, history, comparators]) {
      expect(artifact.schemaVersion).toBe(schema.version);
      expect(artifact.schemaIntegritySha256).toBe(schema.integrityHash.value);
    }
  });

  test('winner root and record schemas are exact and closed', () => {
    expect(schema.version).toBe('engine-core-spike-yjs/2.1.0');
    expect(schema.formattingWinner).toBe('mark-contributions');
    expect(Object.keys(schema.root.keys).sort()).toEqual([
      'allocator',
      'audit',
      'capsules',
      'markContributions',
      'meta',
      'stories',
      'storyOrder',
    ]);
    expect(schema.markContributions.add.closedFields).toEqual([
      'kind',
      'markKind',
      'storyId',
      'actorId',
      'commitId',
      'relativeStart',
      'relativeEnd',
      'proposedSemanticMarkId',
    ]);
    expect(schema.markContributions.remove.closedFields).toEqual([
      'kind',
      'markKind',
      'storyId',
      'actorId',
      'commitId',
      'relativeStart',
      'relativeEnd',
      'targetAddContributionIds',
    ]);
    expect(schema.markContributions.remove).toMatchObject({
      noWildcard: true,
      targetMustMatchStoryAndKind: true,
      targetsMax: 256,
      subtraction: 'intersection-of-remove-range-with-each-target-add-range-only',
    });
    expect(schema.markContributions.remove.rejectTargetCases).toEqual([
      'missing',
      'duplicate',
      'unobserved',
      'wrong-story',
      'wrong-kind',
      'non-add',
      'over-limit',
    ]);
    expect(schema.boundaryEmbed.closedFields).toContain('authoredProperties');
    expect(schema.plainJson.maxNesting).toBe(4);
    expect(schema.relativeEndpoint.closedFields).toEqual([
      'envelopeVersion',
      'documentId',
      'schemaVersion',
      'backendVersion',
      'checkpoint',
      'storySequenceCreationId',
      'relativePositionBase64Url',
      'assoc',
      'affinity',
    ]);
  });

  test('hash derivations, repair closure, and atomic effects are exact', () => {
    expect(schema.hashing).toMatchObject({
      algorithm: 'sha256',
      componentEncoding: 'UTF-8',
      framing: 'each component is uint32be byte-length followed by bytes',
      digestEncoding: 'lowercase-hex',
    });
    expect(schema.hashing.normalizedMarkId.components.at(-1)).toBe('zeroBasedSegmentOrdinal');
    expect(schema.hashing.authoredIntentFingerprint.components[0]).toBe('authored-intent-v2');
    expect(schema.hashing.repairKey.components).toEqual([
      'repair-v2',
      'repairKind',
      'proposedSemanticId',
      'sortedInvolvedCreationIds',
    ]);
    expect(schema.hashing.loserId.result).toBe('derived-{64-lowercase-hex-digest}');
    expect(schema.repairEvidence.recordClosedFields).toEqual([
      'repairEvidenceVersion',
      'repairKind',
      'proposedSemanticId',
      'involvedCreationIds',
      'selectedSurvivorCreationId',
      'derivedMappings',
      'actorId',
      'commitId',
      'normalizationVersion',
    ]);
    expect(schema.atomicRejectionEffects).toEqual([
      'no-live-yjs-commit',
      'no-canonical-revision',
      'no-repair-evidence',
      'no-journal-append',
      'no-history-stack-change',
      'no-model-change-notification',
      'no-audit-cursor-change',
      'no-emitted-update',
    ]);
  });

  test('closed limits remain exact', () => {
    expect(schema.limits).toEqual({
      reconstructionJournalEvents: 64,
      retainedJournalHorizon: 48,
      undoEntriesPerActorSession: 32,
      redoEntriesPerActorSession: 32,
      actorSessionsPerDocument: 16,
      replicationUpdateBytes: 262144,
      genesisPayloadBytes: 4194304,
      aggregateReplayBytes: 4194304,
      snapshotBytes: 8388608,
      bodySequenceUtf16Units: 262144,
      boundaryEmbedCount: 4096,
      formattingSourceRecords: 8192,
      removeTargets: 256,
      repairEvidenceRecords: 4096,
      boundaryEmbedCanonicalBytes: 4096,
      plainJsonNesting: 4,
      relativePositionEncodedCharacters: 349526,
      relativePositionDecodedBytes: 262144,
    });
  });

  test('binding catalog carries exact fixtures and implementation ownership', () => {
    expect(binding.implementationStatus).toBe('catalog-only-no-runtime-claims');
    expect(binding.ownership['2.7']).toContain('UTF-16-sequence-mapping');
    expect(binding.ownership['2.8']).toContain('manager-stack-group-boundaries');
    expect(binding.ownership['3.3']).toContain('IME-state-machine');
    expect(binding.ime.fixtures.map((fixture: Json) => [fixture.id, fixture.commitText])).toEqual([
      ['ime-remote-insert-during-compose', '!helloni'],
      ['ime-remote-delete-intersecting-compose', 'aXef'],
    ]);
    expect(binding.selection.affinityPairs).toEqual([
      [-1, 'before'],
      [0, 'after'],
    ]);
  });

  test('all proof scenarios have concrete actions, assertions, and owners', () => {
    expect(history.scenarios.map((scenario: Json) => scenario.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `G-v2-${index + 1}`)
    );
    for (const scenario of history.scenarios as Json[]) {
      expect(scenario.ownerTask ?? scenario.ownerTasks).toBeDefined();
      expect(scenario.actions.length).toBeGreaterThan(0);
      expect(scenario.assertions.length).toBeGreaterThan(0);
    }
    const gate = (id: string) => history.scenarios.find((scenario: Json) => scenario.id === id);
    expect(gate('G-v2-1').assertions).toContain('redo-stack-empty-after-redo');
    expect(gate('G-v2-3').assertions).toContain('four-boundaries-observable');
    expect(gate('G-v2-4').actions).toContain('stop-capturing:A');
    expect(gate('G-v2-5').actions).toContain('A:undo-remove');
    expect(gate('G-v2-6').actions).toContain('submit-unknown-lineage-envelope');
    expect(gate('G-v2-8').actions).toContain('insert-different-record-at-same-key');
    expect(gate('G-v2-9').assertions).toContain('no-frozen-output-in-this-catalog');
    expect(gate('G-v2-10').assertions).toContain('redo-pop-order-group-31-then-32');
  });

  test('comparators freeze concrete inputs, never implementation outputs', () => {
    expect(comparators.frozenOutputs).toEqual([]);
    expect(Object.keys(comparators.comparators).sort()).toEqual([
      'atomicRejection',
      'canonicalAuthoredState',
      'decodedSequence',
      'formattingEvidence',
      'identityProvenanceIntent',
      'localYjsParity',
      'managerStacks',
      'repairEvidence',
    ]);
    expect(comparators.comparators.atomicRejection.acceptedRejectionValue).toEqual({
      yjsCommitDelta: 0,
      canonicalRevisionDelta: 0,
      repairEvidenceDelta: 0,
      journalDelta: 0,
      historyDelta: 0,
      notificationDelta: 0,
      auditCursorDelta: 0,
      emittedUpdateDelta: 0,
    });
  });

  test('catalog has no placeholders, fake state fingerprints, loser leakage, or runtime imports', () => {
    const serialized = artifacts.map((artifact) => JSON.stringify(artifact)).join('\n');
    expect(serialized).not.toMatch(/canonicalSemanticFingerprint|expectedFingerprint|TODO|TBD|placeholder/i);
    expect(serialized).not.toMatch(/formattingMetadata|native-attributes|native-format|toDelta/);
    expect(readFileSync(import.meta.path, 'utf8')).not.toMatch(/from ['"]\.\.\/src/);
  });
});
