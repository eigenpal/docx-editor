import { describe, expect, test } from 'bun:test';
import {
  canReuseResolvedCache,
  createDocumentModel,
  createFrozenAuthoredFixture,
  createResolvedModelCache,
  fingerprintAuthoredModel,
  loadOracleManifest,
  RESOLVED_STYLE_LIMITS,
  validateAuthoredPackage,
  validateDocumentModel,
  type AuthoredPackageModel,
  type AuthoredPackageModelInput,
} from '../src';

function mutableFixture(): AuthoredPackageModelInput {
  const source = createFrozenAuthoredFixture().authored;
  return {
    body: {
      storyId: source.body.storyId,
      paragraphOrder: [...source.body.paragraphOrder],
      paragraphs: new Map(source.body.paragraphs),
    },
    capsules: [...source.capsules],
  };
}

describe('adversarial authored model immutability', () => {
  test('paragraph lookup rejects set delete and clear without changing canonical state', () => {
    const model = createFrozenAuthoredFixture();
    const before = fingerprintAuthoredModel(model);
    const paragraphs = model.authored.body.paragraphs as unknown as Map<string, unknown>;

    expect(() => paragraphs.set('para-999', {})).toThrow();
    expect(() => paragraphs.delete('para-000')).toThrow();
    expect(() => paragraphs.clear()).toThrow();
    expect(fingerprintAuthoredModel(model)).toBe(before);
    expect(model.authored.body.paragraphOrder).toHaveLength(128);
  });

  test('resolved cache lookup rejects set delete and clear without changing entries', () => {
    const cache = createResolvedModelCache({
      entries: [
        ['para-064', {
          paragraphId: 'para-064',
          sourceRevision: 2,
          dependencyFingerprint: 'style-A:288:120',
          inputFingerprint: 'para-064:p064',
          immutableInputFingerprint: 'toy-inputs/1',
          shapingEnvironmentVersion: 'toy-shaping/1',
          value: { lineHeightTwips: 288, spaceAfterTwips: 120 },
        }],
      ],
    } as never);
    const entries = cache.entries as unknown as Map<string, unknown>;

    expect(() => entries.set('para-065', {})).toThrow();
    expect(() => entries.delete('para-064')).toThrow();
    expect(() => entries.clear()).toThrow();
    expect(cache.entries.get('para-064')?.value.lineHeightTwips).toBe(288);
  });
});

describe('single-snapshot canonical construction', () => {
  test('exported validator rejects accessors without invoking them', () => {
    const authored = mutableFixture();
    const paragraph = authored.body.paragraphs.get('para-000')!;
    let reads = 0;
    const accessorParagraph = { ...paragraph } as Record<string, unknown>;
    Object.defineProperty(accessorParagraph, 'text', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'p000' : 'changed';
      },
    });
    const paragraphs = new Map(authored.body.paragraphs);
    paragraphs.set('para-000', accessorParagraph as never);

    const errors = validateAuthoredPackage({
      ...authored,
      body: { ...authored.body, paragraphs },
    });
    expect(errors.join('; ')).toMatch(/accessor/i);
    expect(reads).toBe(0);
  });

  test('exported validator rejects arbitrary duck-typed lookups', () => {
    const authored = mutableFixture();
    const entries = [...authored.body.paragraphs];
    const duckLookup = {
      size: entries.length,
      get(key: string) {
        return entries.find(([entryKey]) => entryKey === key)?.[1];
      },
      has(key: string) {
        return entries.some(([entryKey]) => entryKey === key);
      },
      *entries() {
        yield* entries;
      },
      *keys() {
        for (const [key] of entries) yield key;
      },
      *values() {
        for (const [, value] of entries) yield value;
      },
      *[Symbol.iterator]() {
        yield* entries;
      },
    };

    const errors = validateAuthoredPackage({
      ...authored,
      body: { ...authored.body, paragraphs: duckLookup },
    });
    expect(errors.join('; ')).toMatch(/lookup/i);
  });

  test('rejects accessor-backed authored fields without invoking them', () => {
    const authored = mutableFixture();
    const paragraph = authored.body.paragraphs.get('para-000')!;
    let reads = 0;
    const accessorParagraph = { ...paragraph } as Record<string, unknown>;
    Object.defineProperty(accessorParagraph, 'text', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'p000' : 'changed';
      },
    });
    const paragraphs = new Map(authored.body.paragraphs);
    paragraphs.set('para-000', accessorParagraph as never);

    expect(() =>
      createDocumentModel(
        { ...authored, body: { ...authored.body, paragraphs } } as AuthoredPackageModelInput,
        0
      )
    ).toThrow(/accessor/i);
    expect(reads).toBe(0);
  });

  test('rejects a custom lookup that lies about iteration get and size', () => {
    const authored = mutableFixture();
    const realEntries = [...authored.body.paragraphs];
    const lyingLookup = {
      size: realEntries.length,
      get() {
        return undefined;
      },
      has() {
        return true;
      },
      *entries() {
        yield* realEntries;
      },
      *keys() {
        for (const [key] of realEntries) yield key;
      },
      *values() {
        for (const [, value] of realEntries) yield value;
      },
      *[Symbol.iterator]() {
        yield* realEntries;
      },
    };

    expect(() =>
      createDocumentModel(
        {
          ...authored,
          body: { ...authored.body, paragraphs: lyingLookup },
        } as AuthoredPackageModelInput,
        0
      )
    ).toThrow(/lookup/i);
  });

  test('snapshots once and constructed output always revalidates', () => {
    const authored = mutableFixture();
    const model = createDocumentModel(authored, 7);
    const before = fingerprintAuthoredModel(model);
    const sourceParagraph = authored.body.paragraphs.get('para-000')!;
    (authored.body.paragraphs as Map<string, unknown>).set('para-000', {
      ...sourceParagraph,
      text: 'mutated-after-construction',
    });

    expect(validateDocumentModel(model)).toEqual([]);
    expect(fingerprintAuthoredModel(model)).toBe(before);
    expect(model.authored.body.paragraphs.get('para-000')?.text).toBe('p000');
  });

  test('copies typed-array bytes without invoking overridden instance methods', () => {
    const authored = mutableFixture();
    const capsule = authored.capsules[0]!;
    const bytes = capsule.bytes;
    let calls = 0;
    Object.defineProperty(bytes, 'slice', {
      value() {
        calls += 1;
        return new Uint8Array([0]);
      },
      enumerable: false,
    });

    const model = createDocumentModel(
      { ...authored, capsules: [{ ...capsule, bytes }] },
      0
    );
    expect(calls).toBe(0);
    expect(Buffer.from(model.authored.capsules[0]!.bytes).toString('hex')).toBe(
      loadOracleManifest().unsupportedCapsule.bytesHex
    );
    expect(validateDocumentModel(model)).toEqual([]);
  });
});

describe('adversarial capsule validation', () => {
  const manifest = loadOracleManifest();

  test('requires exactly one capsule including frozen boundaries', () => {
    const authored = mutableFixture();
    const capsule = authored.capsules[0]!;
    expect(capsule.byteBoundaryStart).toBe(manifest.unsupportedCapsule.byteBoundaryStart);
    expect(capsule.byteBoundaryEnd).toBe(manifest.unsupportedCapsule.byteBoundaryEnd);
    expect(validateAuthoredPackage({ ...authored, capsules: [] })).toContain(
      'exactly one frozen capsule is required'
    );
    expect(validateAuthoredPackage({ ...authored, capsules: [capsule, capsule] })).toContain(
      'exactly one frozen capsule is required'
    );
  });

  test('rejects every frozen capsule evidence drift', () => {
    const authored = mutableFixture();
    const capsule = authored.capsules[0]!;
    const drifts = [
      { ownerStoryId: 'story-body-other' },
      { ownerBlockId: 'block-para-004' },
      { childIndex: capsule.childIndex + 1 },
      { byteBoundaryStart: capsule.byteBoundaryStart + 1 },
      { byteBoundaryEnd: capsule.byteBoundaryEnd + 1 },
      { bytes: new Uint8Array(capsule.bytes.map((byte, index) => (index === 0 ? byte ^ 1 : byte))) },
      { namespaceBindings: { ...capsule.namespaceBindings, custom: 'urn:drift' } },
      { previousSiblingBytes: new Uint8Array([0]) },
      { nextSiblingBytes: new Uint8Array([0]) },
    ];
    for (const drift of drifts) {
      expect(
        validateAuthoredPackage({
          ...authored,
          capsules: [{ ...capsule, ...drift }],
        })
      ).toContain('frozen capsule evidence mismatch');
    }
  });
});

describe('closed authored runtime schema', () => {
  test('rejects unknown fields and derived/cache fields at every authored level', () => {
    const authored = mutableFixture();
    const paragraph = authored.body.paragraphs.get('para-000')!;
    const mark = authored.body.paragraphs.get('para-001')!.marks[0]!;
    const capsule = authored.capsules[0]!;
    const candidates: unknown[] = [
      { ...authored, header: {} },
      { ...authored, resolvedStyles: {} },
      { ...authored, body: { ...authored.body, footer: {} } },
      {
        ...authored,
        body: {
          ...authored.body,
          paragraphs: new Map(authored.body.paragraphs).set('para-000', {
            ...paragraph,
            cache: {},
          } as never),
        },
      },
      {
        ...authored,
        body: {
          ...authored.body,
          paragraphs: new Map(authored.body.paragraphs).set('para-001', {
            ...authored.body.paragraphs.get('para-001')!,
            marks: [{ ...mark, derived: true } as never],
          }),
        },
      },
      { ...authored, capsules: [{ ...capsule, extra: true }] },
    ];
    for (const candidate of candidates) {
      expect(validateAuthoredPackage(candidate as AuthoredPackageModel)).toContain(
        'unknown or derived authored field'
      );
    }
  });

  test('rejects wrong primitives malformed IDs text style and property extra keys', () => {
    const authored = mutableFixture();
    const paragraph = authored.body.paragraphs.get('para-000')!;
    const invalidParagraphs = [
      { ...paragraph, paragraphId: 'bad id' },
      { ...paragraph, blockId: '' },
      { ...paragraph, text: 3 },
      { ...paragraph, styleId: 'bad style!' },
      {
        ...paragraph,
        authoredProperties: {
          lineHeightTwips: { state: 'omitted', extra: true },
        },
      },
    ];
    for (const invalid of invalidParagraphs) {
      const paragraphs = new Map(authored.body.paragraphs);
      paragraphs.delete('para-000');
      paragraphs.set(invalid.paragraphId as string, invalid as never);
      const order = [...authored.body.paragraphOrder];
      order[0] = invalid.paragraphId as string;
      expect(
        validateAuthoredPackage({
          ...authored,
          body: { ...authored.body, paragraphOrder: order, paragraphs },
        })
      ).not.toEqual([]);
    }
  });

  test('rejects dangerous enumerable property keys without prototype mutation', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const authored = mutableFixture();
      const paragraph = authored.body.paragraphs.get('para-000')!;
      const properties = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(properties, key, {
        value: { state: 'omitted' },
        enumerable: true,
      });
      const paragraphs = new Map(authored.body.paragraphs);
      paragraphs.set('para-000', { ...paragraph, authoredProperties: properties } as never);
      expect(
        validateAuthoredPackage({
          ...authored,
          body: { ...authored.body, paragraphs },
        })
      ).toContain('unsafe authored property key');
    }
    expect(Object.prototype).not.toHaveProperty('state');
  });
});

describe('per-entry resolved cache provenance', () => {
  test('supports distinct entry provenance and safe cross-revision reuse', () => {
    const cache = createResolvedModelCache({
      entries: [
        ['para-064', {
          paragraphId: 'para-064',
          sourceRevision: 2,
          dependencyFingerprint: 'style-A:288:120',
          inputFingerprint: 'para-064:p064',
          immutableInputFingerprint: 'toy-inputs/1',
          shapingEnvironmentVersion: 'toy-shaping/1',
          value: { lineHeightTwips: 288, spaceAfterTwips: 120 },
        }],
        ['para-000', {
          paragraphId: 'para-000',
          sourceRevision: 1,
          dependencyFingerprint: 'style-default:240:0',
          inputFingerprint: 'para-000:p000',
          immutableInputFingerprint: 'toy-inputs/1',
          shapingEnvironmentVersion: 'toy-shaping/1',
          value: { lineHeightTwips: 240, spaceAfterTwips: 0 },
        }],
      ],
    } as never);

    expect(cache.entries.get('para-064')?.sourceRevision).toBe(2);
    expect(cache.entries.get('para-000')?.dependencyFingerprint).toBe('style-default:240:0');
    expect(
      canReuseResolvedCache(cache, 'para-064', {
        revision: 9,
        dependencyFingerprint: 'style-A:288:120',
        inputFingerprint: 'para-064:p064',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/1',
      } as never)
    ).toBe(true);
  });

  test('rejects reuse when any relevant entry fingerprint or environment differs', () => {
    const cache = createResolvedModelCache({
      entries: [
        ['para-064', {
          paragraphId: 'para-064',
          sourceRevision: 2,
          dependencyFingerprint: 'dep',
          inputFingerprint: 'input',
          immutableInputFingerprint: 'immutable',
          shapingEnvironmentVersion: 'env',
          value: { lineHeightTwips: 288, spaceAfterTwips: 120 },
        }],
      ],
    } as never);
    const base = {
      revision: 3,
      dependencyFingerprint: 'dep',
      inputFingerprint: 'input',
      immutableInputFingerprint: 'immutable',
      shapingEnvironmentVersion: 'env',
    };
    expect(canReuseResolvedCache(cache, 'missing', base as never)).toBe(false);
    for (const mismatch of [
      { dependencyFingerprint: 'other' },
      { inputFingerprint: 'other' },
      { immutableInputFingerprint: 'other' },
      { shapingEnvironmentVersion: 'other' },
    ]) {
      expect(
        canReuseResolvedCache(cache, 'para-064', { ...base, ...mismatch } as never)
      ).toBe(false);
    }
    for (const malformed of [
      { revision: Number.NaN },
      { dependencyFingerprint: '' },
      { inputFingerprint: 3 },
      { immutableInputFingerprint: 'bad value with spaces' },
      { shapingEnvironmentVersion: null },
      { extra: true },
    ]) {
      expect(
        canReuseResolvedCache(cache, 'para-064', { ...base, ...malformed } as never)
      ).toBe(false);
    }

    let reads = 0;
    const accessorProvenance = { ...base } as Record<string, unknown>;
    Object.defineProperty(accessorProvenance, 'inputFingerprint', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'input' : 'changed';
      },
    });
    expect(canReuseResolvedCache(cache, 'para-064', accessorProvenance as never)).toBe(false);
    expect(reads).toBe(0);
  });

  test('rejects malformed values provenance extra keys and entry-key mismatch', () => {
    expect(RESOLVED_STYLE_LIMITS).toEqual({
      lineHeightTwips: { min: 1, max: 31_680 },
      spaceAfterTwips: { min: 0, max: 31_680 },
    });
    const validEntry = {
      paragraphId: 'para-064',
      sourceRevision: 2,
      dependencyFingerprint: 'dep',
      inputFingerprint: 'input',
      immutableInputFingerprint: 'immutable',
      shapingEnvironmentVersion: 'env',
      value: { lineHeightTwips: 288, spaceAfterTwips: 120 },
    };
    const malformedEntries = [
      ['wrong-key', validEntry],
      ['para-064', { ...validEntry, extra: true }],
      ['para-064', { ...validEntry, dependencyFingerprint: '' }],
      ['para-064', { ...validEntry, sourceRevision: 1.5 }],
      ['para-064', { ...validEntry, value: { ...validEntry.value, extra: true } }],
      ['para-064', { ...validEntry, value: { ...validEntry.value, lineHeightTwips: Number.NaN } }],
      ['para-064', { ...validEntry, value: { ...validEntry.value, lineHeightTwips: Infinity } }],
      ['para-064', { ...validEntry, value: { ...validEntry.value, lineHeightTwips: 0 } }],
      [
        'para-064',
        {
          ...validEntry,
          value: {
            ...validEntry.value,
            lineHeightTwips: RESOLVED_STYLE_LIMITS.lineHeightTwips.max + 1,
          },
        },
      ],
      ['para-064', { ...validEntry, value: { ...validEntry.value, spaceAfterTwips: -1 } }],
      [
        'para-064',
        {
          ...validEntry,
          value: {
            ...validEntry.value,
            spaceAfterTwips: RESOLVED_STYLE_LIMITS.spaceAfterTwips.max + 1,
          },
        },
      ],
      ['para-064', { ...validEntry, value: { ...validEntry.value, spaceAfterTwips: '120' } }],
    ];
    for (const entry of malformedEntries) {
      expect(() => createResolvedModelCache({ entries: [entry] } as never)).toThrow();
    }
  });

  test('rejects dangerous cache keys and accessor-backed cache values', () => {
    const entry = {
      paragraphId: 'para-064',
      sourceRevision: 2,
      dependencyFingerprint: 'dep',
      inputFingerprint: 'input',
      immutableInputFingerprint: 'immutable',
      shapingEnvironmentVersion: 'env',
      value: { lineHeightTwips: 288, spaceAfterTwips: 120 },
    } as Record<string, unknown>;
    Object.defineProperty(entry, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });
    expect(() =>
      createResolvedModelCache({ entries: [['para-064', entry]] } as never)
    ).toThrow(/key|field/i);

    let reads = 0;
    const accessorValue = { spaceAfterTwips: 120 } as Record<string, unknown>;
    Object.defineProperty(accessorValue, 'lineHeightTwips', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 288 : Number.NaN;
      },
    });
    expect(() =>
      createResolvedModelCache({
        entries: [
          [
            'para-064',
            {
              paragraphId: 'para-064',
              sourceRevision: 2,
              dependencyFingerprint: 'dep',
              inputFingerprint: 'input',
              immutableInputFingerprint: 'immutable',
              shapingEnvironmentVersion: 'env',
              value: accessorValue,
            },
          ],
        ],
      } as never)
    ).toThrow(/accessor/i);
    expect(reads).toBe(0);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
