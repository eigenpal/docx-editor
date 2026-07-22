import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORACLE_DIR = join(import.meta.dir, '..', 'oracles');

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Independent canonicalizer — must not import harness src. */
function canonicalize(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError(`reject ${typeof value}`);
  if (ancestors.has(value as object)) throw new TypeError('cycle');
  ancestors.add(value as object);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((child) => canonicalize(child, ancestors)).join(',')}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('non-plain object');
    }
    const keys = Object.keys(value as Record<string, unknown>).sort(codeUnitCompare);
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], ancestors)}`
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value as object);
  }
}

function oracleHash(value: Record<string, unknown>): string {
  const clone = structuredClone(value);
  if (clone.oracleHash && typeof clone.oracleHash === 'object') {
    delete (clone.oracleHash as Record<string, unknown>).value;
  }
  return createHash('sha256').update(canonicalize(clone)).digest('hex');
}

function readOracle<T extends Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(ORACLE_DIR, name), 'utf8')) as T;
}

function gateFingerprint(expected: Record<string, unknown>): string {
  const clone = { ...expected };
  delete clone.canonicalSemanticFingerprint;
  return createHash('sha256').update(canonicalize(clone)).digest('hex');
}

const LOSER_PATTERNS = [
  'formattingMetadata',
  'native-attributes',
  'native-format',
  'engine-core-spike-native-format-v2',
  'Candidate A',
  'Candidate B',
  'toDelta',
  '"blocks"',
  '"texts"',
  '"marks"',
];

describe('v2 reviewed oracle artifacts (task 2.5)', () => {
  const schema = readOracle<Record<string, unknown>>('yjs-schema.v2.json');
  const binding = readOracle<Record<string, unknown>>('binding-oracle.v2.json');
  const history = readOracle<Record<string, unknown>>('history-oracle.v2.json');
  const comparators = readOracle<Record<string, unknown>>('comparator-contracts.v2.json');

  test('artifacts exist with independent SHA-256 oracle hashes', () => {
    for (const artifact of [schema, binding, history, comparators]) {
      const hash = (artifact.oracleHash as { value: string }).value;
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(oracleHash(artifact)).toBe(hash);
    }
  });

  test('cross-artifact versions and references align', () => {
    expect(schema.formattingWinner).toBe('mark-contributions');
    expect(schema.version).toBe('engine-core-spike-yjs/2.0.0');
    expect(binding.version).toBe('engine-core-spike-binding-oracle/2.0.0');
    expect(history.version).toBe('engine-core-spike-history-oracle/2.0.0');
    expect(comparators.version).toBe('engine-core-spike-comparators/2.0.0');
    const refs = schema.artifactReferences as Record<string, string>;
    expect(refs.bindingOracle).toBe(binding.version as string);
    expect(refs.historyOracle).toBe(history.version as string);
    expect(refs.comparatorContracts).toBe(comparators.version as string);
    expect((binding.artifactReferences as Record<string, string>).yjsSchema).toBe(
      schema.version as string
    );
    expect((history.artifactReferences as Record<string, string>).yjsSchema).toBe(
      schema.version as string
    );
    expect((comparators.artifactReferences as Record<string, string>).yjsSchema).toBe(
      schema.version as string
    );
  });

  test('winner-only root topology with markContributions and one bodySequence', () => {
    const keys = Object.keys((schema.root as { keys: Record<string, unknown> }).keys).sort();
    expect(keys).toEqual(['allocator', 'audit', 'capsules', 'markContributions', 'meta', 'stories', 'storyOrder']);
    expect(keys).not.toContain('blocks');
    expect(keys).not.toContain('texts');
    expect(keys).not.toContain('marks');
    expect(keys).not.toContain('formattingMetadata');
    const stories = (schema.root as { keys: { stories: { record: { fields: Record<string, { type: string }> } } } })
      .keys.stories.record.fields;
    expect(stories.bodySequence.type).toBe('Y.Text');
    const mc = (schema.root as { keys: { markContributions: { containerType: string } } }).keys.markContributions;
    expect(mc.containerType).toBe('Y.Map');
  });

  test('closed limits match design exactly', () => {
    const limits = schema.limits as Record<string, number>;
    expect(limits).toEqual({
      maxReconstructionJournalEvents: 64,
      retainedJournalHorizon: 48,
      maxUndoEntriesPerSession: 32,
      maxRedoEntriesPerSession: 32,
      maxActorSessions: 16,
      maxReplicationUpdateBytes: 262144,
      maxGenesisPayloadBytes: 4194304,
      maxAggregateReplayBytes: 4194304,
      maxSnapshotBytes: 8388608,
      maxBodySequenceUtf16Units: 262144,
      maxBoundaryEmbedCount: 4096,
      maxFormattingEvidenceSourceRecords: 8192,
      maxCausalDisableTargets: 256,
      maxRepairEvidenceRecords: 4096,
      maxCanonicalEmbedPayloadBytes: 4096,
      maxValidationNesting: 4,
      maxRelativePositionBase64UrlChars: 349526,
      maxDecodedRelativePositionBytes: 262144,
    });
    expect(history.limits).toEqual(limits);
  });

  test('FormattingEvidence and repair keying are frozen', () => {
    const fe = schema.formattingEvidence as { evidenceVersion: string; normalizedIdInputs: readonly string[] };
    expect(fe.evidenceVersion).toBe('formatting-evidence/2');
    expect(fe.normalizedIdInputs).toEqual([
      'engine-core-spike-mark-v2',
      'markKind',
      'sortedActiveAddContributionIds',
      'sortedClippingRemoveContributionIds',
      'segmentOrdinal',
    ]);
    const repair = schema.repairEvidence as { keyInputs: readonly string[] };
    expect(repair.keyInputs).toEqual(['repair-v2', 'repairKind', 'proposedSemanticId', 'sortedInvolvedCreationIds']);
  });

  test('binding oracle preserves exact IME strings and sequence affinities', () => {
    expect(binding.offsetUnit).toBe('UTF-16-code-unit');
    const ime = binding.ime as {
      fixtures: Array<{ id: string; commitExpectedText: string; cancelExpectedText: string }>;
    };
    const insert = ime.fixtures.find((f) => f.id === 'ime-remote-insert-during-compose');
    expect(insert?.commitExpectedText).toBe('!helloni');
    expect(insert?.cancelExpectedText).toBe('!hello');
    const envelope = schema.relativeEndpointEnvelope as { envelopeVersion: string; assocAffinityPairs: unknown };
    expect(envelope.envelopeVersion).toBe('relative-endpoint/2');
    expect(envelope.assocAffinityPairs).toEqual([
      { affinity: 'before', assoc: -1 },
      { affinity: 'after', assoc: 0 },
    ]);
  });

  test('history oracle freezes all ten gates with executable fixtures', () => {
    const gates = (history.gates as Array<Record<string, unknown>>).map((g) => g.id);
    expect(gates).toEqual([
      'G-v2-1',
      'G-v2-2',
      'G-v2-3',
      'G-v2-4',
      'G-v2-5',
      'G-v2-6',
      'G-v2-7',
      'G-v2-8',
      'G-v2-9',
      'G-v2-10',
    ]);
    for (const gate of history.gates as Array<Record<string, unknown>>) {
      expect(gate.preState).toBeDefined();
      expect(gate.actions).toBeDefined();
      const expected = gate.expected as Record<string, unknown>;
      expect(expected.canonicalSemanticFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(gateFingerprint(expected)).toBe(expected.canonicalSemanticFingerprint as string);
    }
  });

  test('manager-stack redo rules and rejection atomicity are frozen', () => {
    const redo = history.managerStackRedo as Record<string, unknown>;
    expect(redo.remotePreservesRedo).toBe(true);
    expect(redo.repairPreservesRedo).toBe(true);
    expect(redo.sameSessionTrackedClearsRedo).toBe(true);
    expect(redo.otherActorSessionPreservesRedo).toBe(true);
    expect(history.rejectionAtomicity).toBe(
      'no-yjs-commit-no-canonical-revision-no-repair-no-journal-no-history-no-notification'
    );
  });

  test('comparator contracts cover winner-only comparison inputs', () => {
    const defs = Object.keys(comparators.definitions as Record<string, unknown>).sort();
    expect(defs).toEqual([
      'atomicRejection',
      'canonicalSemanticFingerprint',
      'canonicalState',
      'decodedSequenceEmbedOrder',
      'formattingEvidence',
      'localYjsParity',
      'managerStacks',
      'normalizedIdsProvenanceAuthoredIntent',
      'repairEvidence',
    ]);
    expect(defs).not.toContain('nativeFormatDelta');
    expect(defs).not.toContain('formattingMetadata');
  });

  test('no loser leakage in serialized artifacts', () => {
    const bundle = [schema, binding, history, comparators].map((a) => JSON.stringify(a)).join('\n');
    for (const pattern of LOSER_PATTERNS) {
      expect(bundle.includes(pattern)).toBe(false);
    }
  });
});
