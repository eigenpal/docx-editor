import { describe, expect, test } from 'bun:test';
import {
  compareCanonicalState,
  compareYjsSchema,
  loadYjsSchemaOracle,
  validateCanonicalState,
  validateDecodedYjsModel,
} from '../src';
import { canonicalState, decodedYjsModel } from './comparator-fixtures';

describe('fourth review adversarial regressions', () => {
  test('decoded Yjs model verifies every nested container tag', () => {
    const base = decodedYjsModel();
    const invalids = [
      { ...base, rootContainerType: 'object' },
      { ...base, storyOrderContainerType: 'array' },
      { ...base, stories: [{ ...base.stories[0]!, containerType: 'object' }] },
      {
        ...base,
        stories: [{ ...base.stories[0]!, blockOrderContainerType: 'array' }],
      },
      {
        ...base,
        blocks: [{ ...base.blocks[0]!, containerType: 'object' }, ...base.blocks.slice(1)],
      },
      {
        ...base,
        blocks: [{ ...base.blocks[0]!, markIdsContainerType: 'array' }, ...base.blocks.slice(1)],
      },
      {
        ...base,
        blocks: [{ ...base.blocks[0]!, capsuleIdsContainerType: 'array' }, ...base.blocks.slice(1)],
      },
      { ...base, texts: [{ ...base.texts[0]!, containerType: 'object' }, ...base.texts.slice(1)] },
      {
        ...base,
        texts: [{ ...base.texts[0]!, contentContainerType: 'string' }, ...base.texts.slice(1)],
      },
      { ...base, marks: [{ ...base.marks[0]!, containerType: 'object' }] },
      { ...base, capsules: [{ ...base.capsules[0]!, containerType: 'object' }] },
      { ...base, allocatorContainerType: 'object' },
      {
        ...base,
        allocator: [{ ...base.allocator[0]!, containerType: 'object' }, ...base.allocator.slice(1)],
      },
      {
        ...base,
        allocator: [
          { ...base.allocator[0]!, observedSemanticIdsContainerType: 'array' },
          ...base.allocator.slice(1),
        ],
      },
    ];
    for (const invalid of invalids) {
      expect(compareYjsSchema(invalid as never, structuredClone(invalid) as never).equal).toBe(
        false
      );
    }
  });

  test('allocator counters exceed observed IDs and cover semantic IDs', () => {
    const base = decodedYjsModel();
    expect(validateDecodedYjsModel(base)).toEqual([]);
    const actorA = base.allocator.find((record) => record.actorId === 'actor-a')!;
    const invalids = [
      {
        ...base,
        allocator: base.allocator.map((record) =>
          record.actorId === 'actor-a' ? { ...record, nextLocalSeq: 7 } : record
        ),
      },
      {
        ...base,
        allocator: base.allocator.map((record) =>
          record.actorId === 'actor-a' ? { ...record, nextCommitSeq: 1 } : record
        ),
      },
      {
        ...base,
        allocator: base.allocator.filter((record) => record.actorId !== 'actor-z'),
      },
      {
        ...base,
        allocator: base.allocator.map((record) =>
          record.actorId === 'actor-a'
            ? {
                ...record,
                observedSemanticIds: actorA.observedSemanticIds.filter(
                  (id) => id !== 'para-1-collision-actor-a-commit-1-6'
                ),
              }
            : record
        ),
      },
    ];
    for (const invalid of invalids) {
      expect(compareYjsSchema(invalid, structuredClone(invalid)).equal).toBe(false);
    }
    expect(loadYjsSchemaOracle().allocatorSafety).toEqual({
      counterRule:
        'For each actor, nextCommitSeq is strictly greater than every parsed CreationId and CommitId commitSeq, and nextLocalSeq is strictly greater than every CreationId localSeq, observed for that actor across live records, collision candidates, and tombstones.',
      semanticCoverage:
        'Each actor observedSemanticIds set contains every proposedSemanticId and semanticId observed for that actor across live records, collision candidates, and tombstones.',
      missingActorRule:
        'Every actor with any observed creation ID has exactly one allocator record.',
    });
  });

  test('authored properties are exact closed discriminated unions', () => {
    const base = canonicalState();
    const paragraph = base.paragraphs[0]!;
    const variants: unknown[] = [
      { state: 'unknown' },
      { state: 'omitted', value: true },
      { state: 'raw' },
      { state: 'raw', rawLexical: ' 0240' },
      { state: 'raw', rawLexical: '12.5' },
      { state: 'raw', rawLexical: '1'.repeat(33) },
      { state: 'raw', rawLexical: '0240', extra: true },
      { state: 'value' },
      { state: 'value', value: Number.NaN },
      { state: 'value', value: Number.POSITIVE_INFINITY },
      { state: 'value', value: 1.5 },
      { state: 'value', value: Number.MAX_SAFE_INTEGER + 1 },
      { state: 'value', value: '' },
      { state: 'value', value: true, extra: false },
    ];
    for (const property of variants) {
      const invalid = {
        ...base,
        paragraphs: [
          {
            ...paragraph,
            authoredProperties: { test: property },
          },
        ],
      };
      expect(validateCanonicalState(invalid as never).length).toBeGreaterThan(0);
      expect(compareCanonicalState(invalid as never, structuredClone(invalid) as never).equal).toBe(
        false
      );
    }
  });
});
