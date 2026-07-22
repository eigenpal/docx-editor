import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  auditImplementationSurface,
  canonicalJson,
  compareCanonicalState,
  compareSemanticZip,
  compareXmlPartRange,
  compareYjsSchema,
  loadBindingOracle,
  loadOracleManifest,
  validateDecodedYjsModel,
} from '../src';
import { canonicalState, decodedYjsModel } from './comparator-fixtures';

describe('second review adversarial regressions', () => {
  test('semantic ZIP rejects meta.path drift and unknown metadata keys', () => {
    const before = new Map([
      [
        'word/document.xml',
        {
          meta: { path: 'word/document.xml', crc32: 1 },
          bytes: new Uint8Array([1]),
        },
      ],
    ]);
    const pathDrift = new Map([
      [
        'word/document.xml',
        {
          meta: { path: 'word/other.xml', crc32: 1 },
          bytes: new Uint8Array([1]),
        },
      ],
    ]);
    const unknownMetadata = new Map([
      [
        'word/document.xml',
        {
          meta: { path: 'word/document.xml', crc32: 1, vendorFlag: true },
          bytes: new Uint8Array([1]),
        },
      ],
    ]);
    expect(compareSemanticZip(before, pathDrift, {}).equal).toBe(false);
    expect(compareSemanticZip(before, unknownMetadata as never, {}).equal).toBe(false);
  });

  test('invalid but identical Yjs models fail semantic validation', () => {
    const base = decodedYjsModel();
    const invalids = [
      {
        ...base,
        stories: [{ ...base.stories[0]!, blockOrder: ['actor-a:1:2', 'actor-a:1:2'] }],
      },
      { ...base, storyOrder: ['actor-a:1:1', 'actor-a:1:1'] },
      {
        ...base,
        blocks: [{ ...base.blocks[0]!, textId: 'missing-text' }, base.blocks[1]!],
      },
      {
        ...base,
        texts: [{ ...base.texts[0]!, parentBlockId: 'actor-b:1:1' }, base.texts[1]!],
      },
      {
        ...base,
        blocks: [{ ...base.blocks[0]!, markIds: ['actor-a:1:4', 'actor-a:1:4'] }, base.blocks[1]!],
      },
      {
        ...base,
        blocks: [
          { ...base.blocks[0]!, capsuleIds: ['actor-a:1:5', 'actor-a:1:5'] },
          base.blocks[1]!,
        ],
      },
      {
        ...base,
        blocks: [
          { ...base.blocks[0]!, capsuleIds: ['actor-a:1:5', 'actor-a:1:6'] },
          base.blocks[1]!,
        ],
        capsules: [
          base.capsules[0]!,
          {
            ...base.capsules[0]!,
            creationId: 'actor-a:1:6',
            semanticId: 'capsule-2',
            proposedSemanticId: 'capsule-2',
            childIndex: 0,
          },
        ],
      },
      {
        ...base,
        marks: [{ ...base.marks[0]!, parentBlockId: 'missing-block' }],
      },
      {
        ...base,
        capsules: [{ ...base.capsules[0]!, parentBlockId: 'missing-block' }],
      },
      {
        ...base,
        collisionCandidates: [
          {
            ...base.collisionCandidates[0]!,
            semanticId: 'wrong-winner',
          },
          base.collisionCandidates[1]!,
        ],
      },
      {
        ...base,
        tombstones: [{ creationId: 'missing-record', deleted: true }],
      },
    ];
    for (const invalid of invalids) {
      expect(compareYjsSchema(invalid as never, structuredClone(invalid) as never).equal).toBe(
        false
      );
    }
    const missingProvenance = structuredClone(base) as unknown as Record<string, unknown>;
    delete (missingProvenance.blocks as Record<string, unknown>[])[0]!.actorId;
    expect(validateDecodedYjsModel(missingProvenance as never).length).toBeGreaterThan(0);
    const missingSemanticId = structuredClone(base) as unknown as Record<string, unknown>;
    delete (missingSemanticId.blocks as Record<string, unknown>[])[0]!.semanticId;
    expect(validateDecodedYjsModel(missingSemanticId as never).length).toBeGreaterThan(0);
  });

  test('canonical JSON rejects every non-JSON-safe shape', () => {
    const sparse = new Array(2);
    sparse[1] = 'value';
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.value = 1;
    const invalid = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => undefined,
      Symbol('x'),
      sparse,
      new Date(0),
      nullPrototype,
      { value: undefined },
      { __proto__: { polluted: true } },
    ];
    for (const value of invalid) expect(() => canonicalJson(value)).toThrow();
    const state = canonicalState();
    const invalidState = { ...state, resultData: { nested: [1, Number.NaN] } };
    expect(compareCanonicalState(invalidState, structuredClone(invalidState)).equal).toBe(false);
  });

  test('canonical key ordering is UTF-16 code-unit lexical, not locale collation', () => {
    const value = { '\uE000': 1, '😀': 2, Z: 3, a: 4 };
    expect(canonicalJson(value)).toBe('{"Z":3,"a":4,"😀":2,"":1}');
  });

  test('changed XML requires complete ownership evidence', () => {
    const before = new TextEncoder().encode('prefix-OLD-suffix');
    const after = new TextEncoder().encode('prefix-NEW-suffix');
    expect(compareXmlPartRange(before, after, 7, 10).equal).toBe(false);
    expect(compareXmlPartRange(before, before, 7, 10).equal).toBe(true);
  });

  test('capsule owner identity matches the frozen manifest', () => {
    const manifest = loadOracleManifest();
    const state = canonicalState();
    expect(state.capsules[0]?.ownerBlockId).toBe(manifest.unsupportedCapsule.ownerSlot.blockId);
  });

  test('scope audit derives actual source instead of trusting observed declarations', () => {
    const errors = auditImplementationSurface(
      {
        sourceRoot: join(import.meta.dir, '../src'),
        modules: [],
      } as never,
      [],
      ['prosemirror']
    );
    expect(errors.some((error) => error.includes('observed module inventory mismatch'))).toBe(true);
  });

  test('normalization repairs endpoints before final zero-length removal', () => {
    const precedence = loadBindingOracle().normalizationPrecedence;
    expect(precedence.indexOf('repair-orphaned-mark-endpoints')).toBeLessThan(
      precedence.indexOf('remove-zero-length-marks')
    );
  });

  test('IME sequence declares incremental full-text semantics', () => {
    const ime = loadBindingOracle().ime;
    expect(ime.compositionInputSequenceSemantics).toBe(
      'ordered-compositionupdate-full-text-values-not-deltas'
    );
    expect(ime.fixtures[0]?.compositionInputSequence).toEqual(['n', 'ni']);
  });
});
