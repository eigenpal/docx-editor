import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Obj = Record<string, unknown>;
const dir = join(import.meta.dir, '..', 'oracles');
const files = [
  'yjs-schema.v2.json',
  'binding-oracle.v2.json',
  'history-oracle.v2.json',
  'comparator-contracts.v2.json',
] as const;
const object = (value: unknown): Obj => value as Obj;
const array = (value: unknown): unknown[] => value as unknown[];
const get = (value: unknown, ...path: string[]): unknown =>
  path.reduce((child, key) => object(child)[key], value);
const keys = (value: unknown): string[] => Object.keys(object(value)).sort();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(object(value))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const read = (name: (typeof files)[number]): Obj =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as Obj;
const hash = (artifact: Obj): string => {
  const copy = structuredClone(artifact);
  delete object(copy.integrityHash).value;
  return createHash('sha256').update(canonical(copy)).digest('hex');
};

describe('task 2.5 lean v2 contract closure', () => {
  const schema = read(files[0]);
  const binding = read(files[1]);
  const history = read(files[2]);
  const comparators = read(files[3]);
  const artifacts = [schema, binding, history, comparators];

  test('artifacts have exact top-level closure and integrity-only hashes', () => {
    expect(keys(schema)).toEqual(['artifactRole','artifactVersions','atomicRejectionEffects','authority','bodySequence','boundaryCollision','boundaryEmbed','formattingEvidence','formattingWinner','gcEnabled','hashing','integrityHash','limits','markContributions','plainJson','relativeEndpoint','repairEvidence','root','undoManager','version','versions']);
    expect(keys(binding)).toEqual(['artifactRole','groupBoundaries','ime','implementationStatus','integrityHash','offsetUnit','origins','ownership','schemaIntegritySha256','schemaVersion','selection','sequenceMapping','version']);
    expect(keys(history)).toEqual(['artifactRole','atomicRejectionEffects','descriptorPolicy','implementationStatus','integrityHash','managerRules','scenarios','schemaIntegritySha256','schemaVersion','version']);
    expect(keys(comparators)).toEqual(['artifactRole','canonicalSerialization','comparators','definitions','frozenOutputs','implementationStatus','integrityHash','outputSchema','schemaIntegritySha256','schemaVersion','version']);
    for (const artifact of artifacts) {
      expect(keys(get(artifact, 'integrityHash'))).toEqual(['algorithm', 'purpose', 'scope', 'value']);
      expect(get(artifact, 'integrityHash', 'purpose')).toBe('drift-detection-only');
      expect(hash(artifact)).toBe(String(get(artifact, 'integrityHash', 'value')));
    }
    for (const artifact of [binding, history, comparators]) {
      expect(artifact.schemaVersion).toBe(schema.version);
      expect(artifact.schemaIntegritySha256).toBe(get(schema, 'integrityHash', 'value'));
    }
  });

  test('body grammar, winner records, and endpoint validation order are exact', () => {
    expect(keys(get(schema, 'root', 'keys'))).toEqual([
      'allocator', 'audit', 'capsules', 'markContributions', 'meta', 'stories', 'storyOrder',
    ]);
    expect(get(schema, 'bodySequence')).toEqual({
      grammar: 'opening-boundary text* (opening-boundary text*)*',
      mustBeginWithBoundary: true,
      minimumBoundaryCount: 1,
      boundaryStartsExactlyOneParagraph: true,
      paragraphEnd: 'next-opening-boundary-or-sequence-end',
      terminalSentinel: false,
      absoluteUnit: 'UTF-16-code-unit-or-length-1-embed',
      paragraphLocalUnit: 'UTF-16-code-unit-text-only',
      split: 'insert exactly one opening boundary',
      join: 'delete exactly one non-first opening boundary',
      yTextCreatedOrDeletedBySplitJoin: 0,
    });
    expect(get(schema, 'markContributions', 'add', 'closedFields')).toEqual([
      'kind', 'markKind', 'storyId', 'actorId', 'commitId',
      'relativeStart', 'relativeEnd', 'proposedSemanticMarkId',
    ]);
    expect(get(schema, 'markContributions', 'remove', 'closedFields')).toEqual([
      'kind', 'markKind', 'storyId', 'actorId', 'commitId',
      'relativeStart', 'relativeEnd', 'targetAddContributionIds',
    ]);
    expect(get(schema, 'boundaryEmbed', 'closedFields')).toEqual([
      'creationId', 'proposedBlockId', 'proposedParagraphId', 'proposedTextSpanId',
      'actorId', 'commitId', 'styleId', 'authoredProperties', 'storyId',
    ]);
    expect(get(schema, 'relativeEndpoint', 'closedFields')).toEqual([
      'envelopeVersion', 'documentId', 'schemaVersion', 'backendVersion', 'checkpoint',
      'storySequenceCreationId', 'relativePositionBase64Url', 'assoc', 'affinity',
    ]);
    expect(get(schema, 'relativeEndpoint', 'validationOrder')).toEqual([
      'containing-payload-byte-bound',
      'value-is-ASCII-string',
      'encoded-character-length-bound',
      'base64url-character-grammar',
      'length-modulo-four-not-one',
      'allocate-and-decode-with-decoded-byte-bound',
      'canonical-base64url-reencode-exact-match',
      'public-Yjs-relative-position-decode',
      'document-envelope-schema-backend-story-binding',
      'checkpoint-lineage',
      'absolute-position-resolution',
    ]);
    expect(get(schema, 'relativeEndpoint', 'decodedBytesLifetime')).toBe(
      'ephemeral-decoder-input-never-persisted'
    );
  });

  test('formatting evidence and hash framing are fully closed', () => {
    expect(get(schema, 'hashing', 'scalarStringFraming')).toBe(
      'uint32be UTF-8 byte length then UTF-8 bytes'
    );
    expect(get(schema, 'hashing', 'arrayFraming')).toBe(
      'uint32be element count then each UTF-8 element as uint32be byte length plus bytes'
    );
    expect(get(schema, 'hashing', 'ordinalFraming')).toBe('zero-based unsigned uint32be');
    expect(get(schema, 'hashing', 'ordinalOverflow')).toBe('reject-atomically');
    expect(get(schema, 'hashing', 'arrayOrder')).toBe('canonical UTF-8 byte ascending');
    expect(get(schema, 'formattingEvidence', 'derivation')).toEqual([
      'resolve-add-and-remove-endpoints-and-clip-at-paragraph-boundaries',
      'partition-text-at-every-add-remove-and-paragraph-endpoint',
      'per-interval-kind-active-adds-are-intersecting-adds-not-subtracted-by-valid-targeting-remove',
      'per-interval-kind-clipping-removes-are-removes-subtracting-a-targeted-add',
      'omit-interval-with-no-active-add',
      'merge-adjacent-iff-kind-active-add-ids-clipping-remove-ids-and-authored-intent-fingerprint-identical',
      'emit-one-evidence-item-per-maximal-group',
    ]);
    expect(keys(get(schema, 'formattingEvidence'))).toEqual([
      'actorIdsAndCommitIds',
      'closedFields',
      'derivation',
      'evidenceCreationIds',
      'evidenceVersion',
      'resolvedSegmentClosedFields',
      'resolvedSegments',
      'semanticMarkIds',
      'sortedDeduplicatedFields',
    ]);
    expect(get(schema, 'limits')).toEqual({
      reconstructionJournalEvents: 64, retainedJournalHorizon: 48,
      undoEntriesPerActorSession: 32, redoEntriesPerActorSession: 32,
      actorSessionsPerDocument: 16, replicationUpdateBytes: 262144,
      genesisPayloadBytes: 4194304, aggregateReplayBytes: 4194304,
      snapshotBytes: 8388608, bodySequenceUtf16Units: 262144,
      boundaryEmbedCount: 4096, formattingSourceRecords: 8192, removeTargets: 256,
      repairEvidenceRecords: 4096, boundaryEmbedCanonicalBytes: 4096,
      plainJsonNesting: 4, relativePositionEncodedCharacters: 349526,
      relativePositionDecodedBytes: 262144,
    });
  });

  test('ownership and all scenario descriptors are closed and nonempty', () => {
    expect(get(binding, 'ownership')).toEqual({
      '2.6': ['origin-domain-rejection-atomicity'],
      '2.7': ['UTF-16-sequence-mapping'],
      '2.8': ['manager-stack-group-boundaries', 'winner-formatting-endpoint-gate'],
      '3.1': ['shadow-state-forward-mapping'],
      '3.2': ['selection-reconciliation'],
      '3.3': ['IME-state-machine'],
      '3.4': ['reconciliation-loop-prevention'],
      '4.3': ['annotation-endpoint-behavior'],
    });
    const scenarios = array(history.scenarios).map(object);
    expect(scenarios.map((scenario) => scenario.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `G-v2-${index + 1}`)
    );
    for (const scenario of scenarios) {
      expect(keys(scenario)).toEqual(['actions', 'assertions', 'id', 'ownerTask']);
      expect(['2.7', '2.8']).toContain(String(scenario.ownerTask));
      for (const field of ['actions', 'assertions']) {
        expect(array(scenario[field]).length).toBeGreaterThan(0);
        expect(array(scenario[field]).every((item) => typeof item === 'string' && item.length > 0)).toBe(true);
      }
    }
    const gate = (id: string): Obj => scenarios.find((scenario) => scenario.id === id)!;
    expect(get(gate('G-v2-3'), 'assertions')).toContain('three-boundaries-observable');
    expect(gate('G-v2-6').ownerTask).toBe('2.8');
    expect(canonical(gate('G-v2-6'))).not.toMatch(/annotation|selection|3\.2/);
  });

  test('comparators define closed nested inputs, diagnostics, and common output', () => {
    expect(keys(get(comparators, 'canonicalSerialization'))).toEqual(['arrayOrder','encoding','failure','failureDiagnosticRef','firstDifference','numbers','objectKeyOrder','pathGrammar','version']);
    expect(keys(get(comparators, 'definitions'))).toEqual([
      'anchor', 'atomicEffects', 'authoredProperties', 'authoredProperty',
      'boundaryEmbed', 'canonicalAuthoredState', 'canonicalJson', 'capsule',
      'failureDiagnostic', 'formattingEvidence', 'formattingHashFraming', 'historyGroup', 'journalEntry', 'managerStack',
      'paragraph', 'relativeEndpoint', 'repairDerivedMapping',
      'repairEvidenceEntry', 'resolvedSegment',
    ]);
    expect(get(comparators, 'outputSchema')).toEqual({
      closedFields: ['equal', 'firstDifference'],
      equal: 'boolean',
      firstDifferenceUnion: [
        'null',
        {
          closedFields: ['path', 'expected', 'actual'],
          path: 'string matching canonicalSerialization.pathGrammar',
          expectedRef: 'canonicalJson',
          actualRef: 'canonicalJson',
        },
      ],
    });
    expect(get(comparators, 'canonicalSerialization', 'firstDifference')).toBe(
      'lowest canonical UTF-8 byte ordered path'
    );
    const definitionKeys: Record<string, string[]> = {
      anchor: ['closedFields','endRef','fieldTypes','startRef'],
      atomicEffects: ['closedFields','fieldType'],
      authoredProperties: ['keyGrammar','type','valueRef'],
      authoredProperty: ['union'],
      boundaryEmbed: ['authoredPropertiesRef','closedFields','fieldTypes','immutable','sequenceLength'],
      canonicalAuthoredState: ['anchorsRef','capsulesRef','closedFields','formattingEvidenceRef','paragraphsRef','revision'],
      canonicalJson: ['reject','union'],
      capsule: ['closedFields','fieldTypes','namespaceBindings'],
      failureDiagnostic: ['closedFields','path','reasonEnum'],
      formattingEvidence: ['authoredIntentFingerprint','closedFields','derivation','evidenceVersion','idArrays','kindEnum','resolvedSegmentsRef'],
      formattingHashFraming: ['algorithm','array','digest','ordinal','scalarString'],
      historyGroup: ['captureOrdinal','closedFields','constituentIds','fieldTypes'],
      journalEntry: ['closedFields','fieldTypes','operationDescriptorRef'],
      managerStack: ['closedFields','fieldTypes','journalEntriesRef','redoEntriesRef','undoEntriesRef'],
      paragraph: ['authoredPropertiesRef','closedFields','fieldTypes'],
      relativeEndpoint: ['assocAffinityUnion','closedFields','envelopeVersion','fieldTypes'],
      repairDerivedMapping: ['closedFields','fieldTypes'],
      repairEvidenceEntry: ['closedFields','derivedMappingsRef','fieldTypes','repairEvidenceVersion'],
      resolvedSegment: ['bounds','closedFields'],
    };
    for (const [name, expected] of Object.entries(definitionKeys)) {
      expect(keys(get(comparators, 'definitions', name))).toEqual(expected.sort());
    }
    for (const comparator of array(Object.values(object(comparators.comparators))).map(object)) {
      expect(comparator.outputRef).toBe('outputSchema');
      expect(Array.isArray(object(comparator.input).closedFields)).toBe(true);
      const owners = comparator.ownerTasks ?? [comparator.ownerTask];
      expect(array(owners).length).toBeGreaterThan(0);
      expect(array(owners).every((owner) => ['2.6', '2.7', '2.8'].includes(String(owner)))).toBe(true);
    }
  });

  test('contains no placeholders, fake outputs, loser leakage, or runtime assertions', () => {
    const text = artifacts.map(canonical).join('\n');
    expect(text).not.toMatch(/canonicalSemanticFingerprint|expectedFingerprint|TODO|TBD|placeholder/i);
    expect(text).not.toMatch(/formattingMetadata|native-attributes|native-format|toDelta/);
    expect(text).not.toMatch(/"any"|untyped-object/);
    expect(readFileSync(import.meta.path, 'utf8')).not.toMatch(/from ['"]\.\.\/src/);
  });
});
