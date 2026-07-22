import { describe, expect, test } from 'bun:test';
import {
  CANONICAL_STATE_COMPARATOR_VERSION,
  COUNTER_CEILINGS_COMPARATOR_VERSION,
  PAGINATION_FINGERPRINT_COMPARATOR_VERSION,
  SEMANTIC_ZIP_COMPARATOR_VERSION,
  XML_PART_RANGE_COMPARATOR_VERSION,
  YJS_SCHEMA_FINGERPRINT_COMPARATOR_VERSION,
  compareCanonicalState,
  compareCounterCeilings,
  comparePaginationFingerprint,
  compareSemanticZip,
  compareXmlPartRange,
  compareYjsSchema,
  fingerprintYjsSchema,
  loadOracleManifest,
  validateDecodedYjsModel,
} from '../src';
import { canonicalState, decodedYjsModel } from './comparator-fixtures';

describe('strict comparator contracts', () => {
  const manifest = loadOracleManifest();

  test('versions match manifest comparator versions', () => {
    expect(XML_PART_RANGE_COMPARATOR_VERSION).toBe(manifest.comparatorVersions.xmlPartRange);
    expect(SEMANTIC_ZIP_COMPARATOR_VERSION).toBe(manifest.comparatorVersions.semanticZip);
    expect(CANONICAL_STATE_COMPARATOR_VERSION).toBe(manifest.comparatorVersions.canonicalState);
    expect(YJS_SCHEMA_FINGERPRINT_COMPARATOR_VERSION).toBe(
      manifest.comparatorVersions.yjsSchemaFingerprint
    );
    expect(PAGINATION_FINGERPRINT_COMPARATOR_VERSION).toBe(
      manifest.comparatorVersions.paginationFingerprint
    );
    expect(COUNTER_CEILINGS_COMPARATOR_VERSION).toBe(manifest.comparatorVersions.counterCeilings);
  });

  test('XML comparator allows variable owned bytes but rejects prefix, suffix, and ownership drift', () => {
    const encode = (value: string) => new TextEncoder().encode(value);
    const evidence = {
      capsuleBytes: encode('capsule'),
      namespaceBindings: { custom: 'urn:custom' },
      ownerSlot: { storyId: 'body', blockId: 'p1', childIndex: 1 },
      previousSiblingBytes: encode('previous'),
      nextSiblingBytes: encode('next'),
    };
    expect(
      compareXmlPartRange(encode('prefix-OLD-suffix'), encode('prefix-LONGER-suffix'), 7, 10, {
        before: evidence,
        after: evidence,
      }).equal
    ).toBe(true);
    expect(
      compareXmlPartRange(encode('prefix-OLD-suffix'), encode('Prefix-LONGER-suffix'), 7, 10).equal
    ).toBe(false);
    expect(
      compareXmlPartRange(encode('prefix-OLD-suffix'), encode('prefix-LONGER-Suffix'), 7, 10).equal
    ).toBe(false);
    expect(
      compareXmlPartRange(encode('prefix-OLD-suffix'), encode('prefix-LONGER-suffix'), 7, 10, {
        before: evidence,
        after: { ...evidence, ownerSlot: { ...evidence.ownerSlot, childIndex: 2 } },
      }).equal
    ).toBe(false);
  });

  test('semantic ZIP compares every payload and tolerates only listed metadata', () => {
    const before = new Map([
      [
        'word/document.xml',
        {
          meta: {
            path: 'word/document.xml',
            crc32: 1,
            compressedSize: 2,
            uncompressedSize: 2,
            offset: 10,
            lastModifiedIso: '2026-01-01T00:00:00Z',
          },
          bytes: new Uint8Array([1, 2]),
        },
      ],
    ]);
    const recompressed = new Map([
      [
        'word/document.xml',
        {
          meta: {
            path: 'word/document.xml',
            crc32: 9,
            compressedSize: 1,
            uncompressedSize: 2,
            offset: 20,
            lastModifiedIso: '2026-01-01T00:00:00Z',
          },
          bytes: new Uint8Array([1, 2]),
        },
      ],
    ]);
    expect(compareSemanticZip(before, recompressed, {}).equal).toBe(true);

    const badPayload = new Map(recompressed);
    badPayload.set('word/document.xml', {
      ...recompressed.get('word/document.xml')!,
      bytes: new Uint8Array([1, 3]),
    });
    expect(compareSemanticZip(before, badPayload, {}).equal).toBe(false);

    const badMetadata = new Map(recompressed);
    badMetadata.set('word/document.xml', {
      ...recompressed.get('word/document.xml')!,
      meta: {
        ...recompressed.get('word/document.xml')!.meta,
        lastModifiedIso: '2026-02-02T00:00:00Z',
      },
    });
    expect(compareSemanticZip(before, badMetadata, {}).equal).toBe(false);

    const encode = (value: string) => new TextEncoder().encode(value);
    const ownership = {
      capsuleBytes: encode('capsule'),
      namespaceBindings: { custom: 'urn:custom' },
      ownerSlot: { storyId: 'body', blockId: 'p1', childIndex: 1 },
      previousSiblingBytes: encode('previous'),
      nextSiblingBytes: encode('next'),
    };
    const ownedBefore = new Map([
      [
        'word/document.xml',
        { meta: { path: 'word/document.xml' }, bytes: encode('prefix-OLD-suffix') },
      ],
    ]);
    const ownedAfter = new Map([
      [
        'word/document.xml',
        { meta: { path: 'word/document.xml' }, bytes: encode('prefix-LONGER-suffix') },
      ],
    ]);
    expect(
      compareSemanticZip(ownedBefore, ownedAfter, {
        ownedXmlParts: {
          'word/document.xml': {
            ownedRangeStart: 7,
            ownedRangeEnd: 10,
            evidence: { before: ownership, after: ownership },
          },
        },
      }).equal
    ).toBe(true);
    expect(
      compareSemanticZip(ownedBefore, ownedAfter, {
        ownedXmlParts: {
          'word/document.xml': {
            ownedRangeStart: 7,
            ownedRangeEnd: 10,
            evidence: {
              before: ownership,
              after: { ...ownership, capsuleBytes: encode('changed') },
            },
          },
        },
      }).equal
    ).toBe(false);
  });

  test('canonical state detects text, marks, authored, capsule, anchor, and result drift', () => {
    const base = canonicalState();
    expect(compareCanonicalState(base, structuredClone(base)).equal).toBe(true);
    const variants = [
      { ...base, paragraphs: [{ ...base.paragraphs[0]!, text: 'world' }] },
      {
        ...base,
        paragraphs: [
          {
            ...base.paragraphs[0]!,
            marks: [{ ...base.paragraphs[0]!.marks[0]!, end: 4 }],
          },
        ],
      },
      {
        ...base,
        paragraphs: [
          {
            ...base.paragraphs[0]!,
            authoredProperties: { keepNext: { state: 'omitted' as const } },
          },
        ],
      },
      { ...base, capsules: [{ ...base.capsules[0]!, bytesHex: '00fe' }] },
      { ...base, anchors: [{ ...base.anchors[0]!, detached: true }] },
      { ...base, resultData: { changed: false } },
    ];
    for (const variant of variants) expect(compareCanonicalState(base, variant).equal).toBe(false);
  });

  test('Yjs comparator validates decoded containers, order, ownership, endpoints, collisions, tombstones', () => {
    const base = decodedYjsModel();
    expect(validateDecodedYjsModel(base)).toEqual([]);
    expect(compareYjsSchema(base, structuredClone(base)).equal).toBe(true);
    expect(fingerprintYjsSchema(base)).toMatch(/^[a-f0-9]{64}$/);

    const invalids = [
      { ...base, gcEnabled: true },
      { ...base, storyOrder: ['missing-story'] },
      {
        ...base,
        texts: [{ ...base.texts[0]!, contentContainerType: 'Y.Map' as never }],
      },
      {
        ...base,
        marks: [
          {
            ...base.marks[0]!,
            start: { ...base.marks[0]!.start, textCreationId: 'unowned' },
          },
        ],
      },
      { ...base, collisionCandidates: [...base.collisionCandidates].reverse() },
      { ...base, tombstones: [''] },
    ];
    for (const invalid of invalids)
      expect(compareYjsSchema(base, invalid as never).equal).toBe(false);
  });

  test('pagination comparator canonicalizes page structures and compares bytes plus hash', () => {
    const expected = manifest.pagination.fingerprint;
    expect(
      comparePaginationFingerprint(expected.structure, {
        canonicalBytesHex: expected.canonicalBytesHex,
        expectedHash: expected.hash,
      }).equal
    ).toBe(true);
    expect(
      comparePaginationFingerprint(
        {
          ...expected.structure,
          pages: [
            { ...expected.structure.pages[0]!, usedHeightFixed: 26111 },
            expected.structure.pages[1]!,
          ],
        },
        { canonicalBytesHex: expected.canonicalBytesHex, expectedHash: expected.hash }
      ).equal
    ).toBe(false);
  });

  test('counter comparator rejects ceilings, missing values, negatives, fractions, and excess', () => {
    const ceilings = {
      measuredParagraphs: 4,
      projectedParagraphs: 4,
      paginatedPages: 2,
      fullDocumentScans: 0,
      fullDocumentRebuilds: 0,
      dependencyEdgeVisits: 128,
    };
    const valid = {
      measuredParagraphs: 4,
      projectedParagraphs: 4,
      paginatedPages: 2,
      fullDocumentScans: 0,
      fullDocumentRebuilds: 0,
      dependencyEdgeVisits: 64,
    };
    expect(compareCounterCeilings(valid, ceilings).withinCeilings).toBe(true);
    expect(compareCounterCeilings({}, ceilings).withinCeilings).toBe(false);
    expect(
      compareCounterCeilings({ ...valid, measuredParagraphs: -1 }, ceilings).withinCeilings
    ).toBe(false);
    expect(
      compareCounterCeilings({ ...valid, measuredParagraphs: 1.5 }, ceilings).withinCeilings
    ).toBe(false);
    expect(
      compareCounterCeilings({ ...valid, measuredParagraphs: 5 }, ceilings).withinCeilings
    ).toBe(false);
  });
});
