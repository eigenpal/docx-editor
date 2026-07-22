import { describe, expect, test } from 'bun:test';
import {
  canReuseResolvedCache,
  createDocumentModel,
  createFrozenAuthoredFixture,
  createResolvedModelCache,
  fingerprintAuthoredModel,
  loadOracleManifest,
  validateAuthoredPackage,
  type AuthoredMark,
  type AuthoredPackageModel,
  type AuthoredParagraph,
  type AuthoredProperty,
  type DocumentModel,
  type UnsupportedCapsule,
} from '../src';

function cloneFixture(): AuthoredPackageModel {
  return createFrozenAuthoredFixture().authored;
}

describe('authored model fixture', () => {
  const manifest = loadOracleManifest();

  test('seeds 128 ordered body paragraphs from frozen manifest pattern', () => {
    const model = createFrozenAuthoredFixture();
    expect(model.authored.body.storyId).toBe(manifest.fixture.storyId);
    expect(model.authored.body.paragraphOrder).toHaveLength(128);
    expect(model.authored.body.paragraphOrder[0]).toBe('para-000');
    expect(model.authored.body.paragraphOrder[127]).toBe('para-127');
    expect(model.authored.body.paragraphs.get('para-064')?.text).toBe('p064');
    expect(model.authored.body.paragraphs.get('para-064')?.styleId).toBe('style-A');
    expect(model.authored.body.paragraphs.get('para-000')?.styleId).toBe('style-default');
    for (const index of manifest.fixture.sourceParagraphPattern.styleAIndices) {
      expect(model.authored.body.paragraphs.get(`para-${String(index).padStart(3, '0')}`)?.styleId).toBe(
        'style-A'
      );
    }
  });

  test('includes one ordered unsupported capsule with frozen ownership evidence', () => {
    const model = createFrozenAuthoredFixture();
    const capsule = manifest.unsupportedCapsule;
    expect(model.authored.capsules).toHaveLength(1);
    const only = model.authored.capsules[0]!;
    expect(only.ownerStoryId).toBe(capsule.ownerSlot.storyId);
    expect(only.ownerBlockId).toBe(capsule.ownerSlot.blockId);
    expect(only.childIndex).toBe(capsule.ownerSlot.childIndex);
    expect(Buffer.from(only.bytes).toString('hex')).toBe(capsule.bytesHex);
    expect(only.namespaceBindings).toEqual(capsule.namespaceBindings);
    expect(Buffer.from(only.previousSiblingBytes).toString('hex')).toBe(capsule.previousSiblingBytesHex);
    expect(Buffer.from(only.nextSiblingBytes).toString('hex')).toBe(capsule.nextSiblingBytesHex);
    expect(model.authored.body.paragraphs.has('para-003')).toBe(true);
    expect(model.authored.body.paragraphs.get('para-003')?.blockId).toBe('block-para-003');
  });

  test('carries bold and italic authored marks with stable IDs', () => {
    const paragraph = createFrozenAuthoredFixture().authored.body.paragraphs.get('para-001')!;
    expect(paragraph.marks.map((mark) => mark.kind).sort()).toEqual(['bold', 'italic']);
    expect(new Set(paragraph.marks.map((mark) => mark.markId)).size).toBe(2);
  });

  test('preserves omitted raw lexical and typed authored properties', () => {
    const authored = createFrozenAuthoredFixture().authored;
    expect(authored.body.paragraphs.get('para-000')?.authoredProperties.lineHeightTwips).toEqual({
      state: 'omitted',
    });
    expect(authored.body.paragraphs.get('para-064')?.authoredProperties.lineHeightTwips).toEqual({
      state: 'raw',
      rawLexical: '288',
    });
    expect(authored.body.paragraphs.get('para-002')?.authoredProperties.keepLines).toEqual({
      state: 'value',
      value: true,
    });
  });
});

describe('authored model validation', () => {
  test('rejects duplicate paragraph and block IDs', () => {
    const authored = cloneFixture();
    const duplicate = authored.body.paragraphs.get('para-001')!;
    const paragraphs = new Map(authored.body.paragraphs);
    paragraphs.set('para-099', { ...duplicate, paragraphId: 'para-099' });
    expect(validateAuthoredPackage({ ...authored, body: { ...authored.body, paragraphs } })).toContain(
      'duplicate paragraph ID'
    );
  });

  test('rejects invalid mark ranges kinds and duplicate mark IDs', () => {
    const authored = cloneFixture();
    const paragraph = authored.body.paragraphs.get('para-001')!;
    const badRange: AuthoredParagraph = {
      ...paragraph,
      marks: [{ markId: 'mark-bad', kind: 'bold', start: 2, end: 2 }],
    };
    const badKind: AuthoredParagraph = {
      ...paragraph,
      marks: [{ markId: 'mark-bad', kind: 'underline' as AuthoredMark['kind'], start: 0, end: 1 }],
    };
    const duplicateMarks: AuthoredParagraph = {
      ...paragraph,
      marks: [
        { markId: 'mark-dup', kind: 'bold', start: 0, end: 1 },
        { markId: 'mark-dup', kind: 'italic', start: 1, end: 2 },
      ],
    };
    const paragraphs = new Map(authored.body.paragraphs);
    paragraphs.set('para-001', badRange);
    expect(validateAuthoredPackage({ ...authored, body: { ...authored.body, paragraphs } })).toContain(
      'invalid mark'
    );
    paragraphs.set('para-001', badKind);
    expect(validateAuthoredPackage({ ...authored, body: { ...authored.body, paragraphs } })).toContain(
      'invalid mark'
    );
    paragraphs.set('para-001', duplicateMarks);
    expect(validateAuthoredPackage({ ...authored, body: { ...authored.body, paragraphs } })).toContain(
      'invalid mark'
    );
  });

  test('rejects invalid capsule ownership order and bytes', () => {
    const authored = cloneFixture();
    const capsule = authored.capsules[0]!;
    expect(
      validateAuthoredPackage({
        ...authored,
        capsules: [{ ...capsule, ownerBlockId: 'missing-block' }],
      })
    ).toContain('frozen capsule evidence mismatch');
    expect(
      validateAuthoredPackage({
        ...authored,
        capsules: [
          capsule,
          { ...capsule, capsuleId: 'capsule-dup-slot', ownerBlockId: capsule.ownerBlockId },
        ],
      })
    ).toContain('exactly one frozen capsule is required');
    expect(
      validateAuthoredPackage({
        ...authored,
        capsules: [{ ...capsule, bytes: new Uint8Array([0xab]) }],
      })
    ).toContain('frozen capsule evidence mismatch');
  });

  test('rejects non-body stories and resolved cache values in authored state', () => {
    const authored = cloneFixture();
    expect(
      validateAuthoredPackage({
        ...authored,
        body: { ...authored.body, storyId: 'story-header-0' },
      })
    ).toContain('invalid body story');
    const paragraph = authored.body.paragraphs.get('para-000')!;
    const paragraphs = new Map(authored.body.paragraphs);
    paragraphs.set('para-000', {
      ...paragraph,
      authoredProperties: {
        resolvedLineHeightTwips: { state: 'value', value: 240 } as AuthoredProperty,
      },
    });
    expect(validateAuthoredPackage({ ...authored, body: { ...authored.body, paragraphs } })).toContain(
      'resolved or cache value in authored state'
    );
  });
});

describe('DocumentModel revision and immutability', () => {
  test('requires non-negative monotonic revision representation', () => {
    const fixture = createFrozenAuthoredFixture();
    expect(createDocumentModel(fixture.authored, 0).revision).toBe(0);
    expect(createDocumentModel(fixture.authored, 5).revision).toBe(5);
    expect(() => createDocumentModel(fixture.authored, -1)).toThrow(/revision/i);
    expect(() => createDocumentModel(fixture.authored, 1.5)).toThrow(/revision/i);
  });

  test('defensive copies prevent runtime mutation of bytes and maps', () => {
    const model = createFrozenAuthoredFixture();
    const capsuleBytes = model.authored.capsules[0]!.bytes;
    capsuleBytes[0] = 0xff;
    expect(model.authored.capsules[0]!.bytes[0]).not.toBe(0xff);
    const paragraph = model.authored.body.paragraphs.get('para-000')!;
    expect(() => {
      (paragraph.authoredProperties as Record<string, unknown>).lineHeightTwips = {
        state: 'value',
        value: 999,
      };
    }).toThrow();
    expect(model.authored.body.paragraphs.get('para-000')?.authoredProperties.lineHeightTwips).toEqual({
      state: 'omitted',
    });
  });
});

describe('authored serialization fingerprint', () => {
  test('reads authored state only and is deterministic under canonical JSON rules', () => {
    const model = createFrozenAuthoredFixture();
    const first = fingerprintAuthoredModel(model);
    const second = fingerprintAuthoredModel(createDocumentModel(model.authored, model.revision));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test('preserves omission raw lexical values and capsule evidence exactly', () => {
    const model = createFrozenAuthoredFixture();
    const payload = fingerprintAuthoredModel(model, { includePayload: true });
    expect(payload).toContain('"state":"omitted"');
    expect(payload).toContain('"rawLexical":"288"');
    expect(payload).toContain(loadOracleManifest().unsupportedCapsule.bytesHex);
    expect(payload).toContain(loadOracleManifest().unsupportedCapsule.previousSiblingBytesHex);
    expect(payload).not.toContain('resolvedStyles');
    expect(payload).not.toContain('dependencyFingerprint');
  });
});

describe('resolved cache separation', () => {
  test('carries provenance fingerprints and shaping environment version', () => {
    const cache = createResolvedModelCache({
      entries: [['para-064', {
        paragraphId: 'para-064',
        sourceRevision: 2,
        dependencyFingerprint: 'style-A:288:120',
        inputFingerprint: 'para-064:p064',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/1',
        value: { lineHeightTwips: 288, spaceAfterTwips: 120 },
      }]],
    });
    const entry = cache.entries.get('para-064')!;
    expect(entry.sourceRevision).toBe(2);
    expect(entry.dependencyFingerprint).toBe('style-A:288:120');
    expect(entry.inputFingerprint).toBe('para-064:p064');
    expect(entry.shapingEnvironmentVersion).toBe('toy-shaping/1');
  });

  test('refuses reuse when any provenance fingerprint or environment differs', () => {
    const cache = createResolvedModelCache({
      entries: [['para-064', {
        paragraphId: 'para-064',
        sourceRevision: 2,
        dependencyFingerprint: 'style-A:288:120',
        inputFingerprint: 'para-064:p064',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/1',
        value: { lineHeightTwips: 288, spaceAfterTwips: 120 },
      }]],
    });
    expect(
      canReuseResolvedCache(cache, 'para-064', {
        revision: 3,
        dependencyFingerprint: 'style-A:288:120',
        inputFingerprint: 'para-064:p064',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/1',
      })
    ).toBe(true);
    expect(
      canReuseResolvedCache(cache, 'para-064', {
        revision: 2,
        dependencyFingerprint: 'style-A:240:0',
        inputFingerprint: 'para-064:p064',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/1',
      })
    ).toBe(false);
    expect(
      canReuseResolvedCache(cache, 'para-064', {
        revision: 2,
        dependencyFingerprint: 'style-A:288:120',
        inputFingerprint: 'para-065:p065',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/1',
      })
    ).toBe(false);
    expect(
      canReuseResolvedCache(cache, 'para-064', {
        revision: 2,
        dependencyFingerprint: 'style-A:288:120',
        inputFingerprint: 'para-064:p064',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/2',
      })
    ).toBe(false);
  });

  test('never influences authored serialization fingerprint', () => {
    const model: DocumentModel = createFrozenAuthoredFixture();
    const withCache = createResolvedModelCache({
      entries: [['para-064', {
        paragraphId: 'para-064',
        sourceRevision: model.revision,
        dependencyFingerprint: 'style-A:288:120',
        inputFingerprint: 'para-064:p064',
        immutableInputFingerprint: 'toy-inputs/1',
        shapingEnvironmentVersion: 'toy-shaping/1',
        value: { lineHeightTwips: 999, spaceAfterTwips: 999 },
      }]],
    });
    expect(fingerprintAuthoredModel(model)).toBe(fingerprintAuthoredModel(model));
    expect(canReuseResolvedCache(withCache, 'para-064', {
      revision: model.revision,
      dependencyFingerprint: 'style-A:288:120',
      inputFingerprint: 'para-064:p064',
      immutableInputFingerprint: 'toy-inputs/1',
      shapingEnvironmentVersion: 'toy-shaping/1',
    })).toBe(true);
  });
});
