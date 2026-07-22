import { describe, expect, test } from 'bun:test';
import {
  canonicalJson,
  compareCanonicalState,
  compareSemanticZip,
  compareYjsSchema,
  loadYjsSchemaOracle,
  validateCanonicalState,
  validateDecodedYjsModel,
} from '../src';
import inventory from '../migration/playwright-inventory.v1.json';
import { canonicalState, decodedYjsModel } from './comparator-fixtures';

describe('third review adversarial regressions', () => {
  test('canonical JSON preserves code-unit order for integer-like keys', () => {
    const value = { '2': 'two', '10': 'ten', '\uE000': 1, '😀': 2 };
    expect(canonicalJson(value)).toBe('{"10":"ten","2":"two","😀":2,"":1}');

    const pythonUtf16BeSortKey = (value: string): Buffer => {
      const littleEndian = Buffer.from(value, 'utf16le');
      const bigEndian = Buffer.alloc(littleEndian.length);
      for (let index = 0; index < littleEndian.length; index += 2) {
        bigEndian[index] = littleEndian[index + 1]!;
        bigEndian[index + 1] = littleEndian[index]!;
      }
      return bigEndian;
    };
    expect(
      Object.keys(value).sort((a, b) =>
        Buffer.compare(pythonUtf16BeSortKey(a), pythonUtf16BeSortKey(b))
      )
    ).toEqual(['10', '2', '😀', '\uE000']);
  });

  test('Yjs versions, creation IDs, and endpoint envelopes are exact', () => {
    const base = decodedYjsModel();
    const endpoint = base.marks[0]!.start;
    const invalids = [
      { ...base, schemaVersion: '' },
      { ...base, normalizationVersion: '2.0.0' },
      { ...base, backendVersion: 'other-backend' },
      {
        ...base,
        blocks: [
          { ...base.blocks[0]!, creationId: 'actor-a:not-a-sequence:2' },
          ...base.blocks.slice(1),
        ],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, start: { ...endpoint, documentId: '' } }],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, start: { ...endpoint, backendVersion: 'wrong' } }],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, start: { ...endpoint, schemaVersion: 'wrong' } }],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, start: { ...endpoint, checkpoint: '' } }],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, start: { ...endpoint, textCreationId: '' } }],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, start: { ...endpoint, affinity: 'middle' } }],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, start: { ...endpoint, relativeBytes: 'AQID=' } }],
      },
    ];
    for (const invalid of invalids) {
      expect(compareYjsSchema(invalid as never, structuredClone(invalid) as never).equal).toBe(
        false
      );
    }
  });

  test('decoded Yjs records contain every frozen schema field', () => {
    const base = decodedYjsModel();
    expect(base.stories[0]?.storyKind).toBe('body');
    expect('parentId' in base.stories[0]!).toBe(false);
    expect(base.blocks[0]?.blockKind).toBe('paragraph');
    expect(base.blocks[0]?.styleId).toBe('style-default');
    expect(base.marks[0]?.markKind).toBe('bold');
    expect(base.capsules[0]?.namespaceBindings).toEqual({ custom: 'urn:custom' });
    expect('parentBlockId' in base.marks[0]!).toBe(false);

    const variants = [
      { ...base, stories: [{ ...base.stories[0]!, storyKind: 'header' }] },
      { ...base, stories: [{ ...base.stories[0]!, parentId: null }] },
      { ...base, blocks: [{ ...base.blocks[0]!, blockKind: 'table' }, ...base.blocks.slice(1)] },
      { ...base, blocks: [{ ...base.blocks[0]!, styleId: '' }, ...base.blocks.slice(1)] },
      { ...base, texts: [{ ...base.texts[0]!, content: 42 }, ...base.texts.slice(1)] },
      { ...base, marks: [{ ...base.marks[0]!, markKind: 'underline' }] },
      {
        ...base,
        capsules: [{ ...base.capsules[0]!, namespaceBindings: { custom: '' } }],
      },
      {
        ...base,
        capsules: [{ ...base.capsules[0]!, namespaceBindings: { custom: 42 } }],
      },
    ];
    for (const variant of variants) {
      expect(compareYjsSchema(variant as never, structuredClone(variant) as never).equal).toBe(
        false
      );
    }
    const validDifferences = [
      {
        ...base,
        blocks: [{ ...base.blocks[0]!, styleId: 'style-heading' }, ...base.blocks.slice(1)],
      },
      { ...base, marks: [{ ...base.marks[0]!, markKind: 'italic' as const }] },
      {
        ...base,
        capsules: [{ ...base.capsules[0]!, namespaceBindings: { custom: 'urn:custom:changed' } }],
      },
    ];
    for (const variant of validDifferences) {
      expect(validateDecodedYjsModel(variant)).toEqual([]);
      expect(compareYjsSchema(base, variant).equal).toBe(false);
    }
  });

  test('canonical state rejects malformed and duplicate identities', () => {
    const base = canonicalState();
    const paragraph = base.paragraphs[0]!;
    const invalids = [
      { ...base, capsules: [{ ...base.capsules[0]!, bytesHex: '' }] },
      { ...base, capsules: [{ ...base.capsules[0]!, previousSiblingBytesHex: '0' }] },
      { ...base, capsules: [{ ...base.capsules[0]!, nextSiblingBytesHex: 'zz' }] },
      { ...base, capsules: [base.capsules[0]!, { ...base.capsules[0]! }] },
      {
        ...base,
        paragraphs: [
          {
            ...paragraph,
            marks: [paragraph.marks[0]!, { ...paragraph.marks[0]! }],
          },
        ],
      },
      {
        ...base,
        paragraphs: [
          {
            ...paragraph,
            marks: [{ ...paragraph.marks[0]!, kind: 'underline' }],
          },
        ],
      },
      {
        ...base,
        paragraphs: [
          {
            ...paragraph,
            marks: [{ ...paragraph.marks[0]!, start: 5, end: 5 }],
          },
        ],
      },
      { ...base, anchors: [base.anchors[0]!, { ...base.anchors[0]! }] },
      { ...base, anchors: [{ ...base.anchors[0]!, detached: 'no' }] },
    ];
    for (const invalid of invalids) {
      expect(validateCanonicalState(invalid as never).length).toBeGreaterThan(0);
      expect(compareCanonicalState(invalid as never, structuredClone(invalid) as never).equal).toBe(
        false
      );
    }
  });

  test('semantic ZIP rejects non-Uint8Array payloads', () => {
    const invalid = new Map([
      [
        'word/document.xml',
        {
          meta: { path: 'word/document.xml' },
          bytes: 'not-bytes',
        },
      ],
    ]);
    expect(compareSemanticZip(invalid as never, structuredClone(invalid) as never, {}).equal).toBe(
      false
    );
  });

  test('allocator is actor-keyed with frozen monotonic merge behavior', () => {
    const oracle = loadYjsSchemaOracle();
    expect(oracle.root.keys.allocator.recordKey).toBe('ActorId');
    expect(oracle.allocatorMergeBehavior).toEqual({
      counters: 'per-actor-monotonic-max',
      observedSemanticIds: 'per-actor-set-union',
      writerRule: 'only the matching actor may increment its own record',
    });
    expect(validateDecodedYjsModel(decodedYjsModel())).toEqual([]);
    const duplicateActor = {
      ...decodedYjsModel(),
      allocator: [decodedYjsModel().allocator[0]!, { ...decodedYjsModel().allocator[0]! }],
    };
    expect(compareYjsSchema(duplicateActor, structuredClone(duplicateActor)).equal).toBe(false);
  });

  test('collision precedence includes creation local sequence tie-breaker', () => {
    const oracle = loadYjsSchemaOracle();
    expect(oracle.collisionPrecedence.order).toEqual([
      'ActorId-UTF16-code-unit-ascending',
      'CommitId-UTF16-code-unit-ascending',
      'CreationId-localSeq-numeric-ascending',
      'CreationId-UTF16-code-unit-ascending',
    ]);
    const base = decodedYjsModel();
    expect(base.collisionCandidates.map((candidate) => candidate.creationId)).toEqual([
      'actor-a:1:2',
      'actor-a:1:6',
      'actor-b:1:1',
    ]);
    const reversedTie = {
      ...base,
      collisionCandidates: [
        base.collisionCandidates[1]!,
        base.collisionCandidates[0]!,
        ...base.collisionCandidates.slice(2),
      ],
    };
    expect(compareYjsSchema(reversedTie, structuredClone(reversedTie)).equal).toBe(false);
  });

  test('anchor envelopes trust backend version', () => {
    expect(loadYjsSchemaOracle().anchorEnvelope.trustedFields).toContain('backendVersion');
  });

  test('behavioral migration candidates retain reusable current suites', () => {
    const candidates = inventory.tombstones
      .filter((tombstone) => tombstone.coupling.category === 'behavioral-migration-candidate')
      .map((tombstone) => tombstone.source);
    expect(candidates).toContain('e2e/tests/text-editing.spec.ts');
    expect(candidates).toContain('e2e/tests/formatting.spec.ts');
    expect(candidates).toContain('e2e/tests/formatting-persistence.spec.ts');
    expect(candidates).toContain('e2e/tests/scenario-driven.spec.ts');
    for (const tombstone of inventory.tombstones) {
      expect(tombstone.coupling.reason).toBeTruthy();
    }
  });
});
