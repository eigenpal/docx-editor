import { describe, test, expect } from 'bun:test';
import { buildProvenance, validateProvenance } from '../../../scripts/lib/provenance.mjs';
import {
  DOCS_REFERENCE_REPOSITORY,
  PINNED_DOCS_REFERENCE_COMMIT,
  buildDocsReferenceMetadata,
} from '../../../scripts/lib/docs-reference.mjs';

const validUpstreamPackage = {
  name: '@types/office-js',
  version: '1.0.604',
  integrity: 'sha512-abc123==',
  shasum: 'deadbeef',
  tarballUrl: 'https://registry.npmjs.org/@types/office-js/-/office-js-1.0.604.tgz',
  typesPublisherContentHash: '838b5638',
  sourceRepository: {
    type: 'git',
    url: 'https://github.com/DefinitelyTyped/DefinitelyTyped.git',
    directory: 'types/office-js',
    commit: '929735ef7d8bafb29c17e39b26042ada8529e670',
    sourceUrl:
      'https://github.com/DefinitelyTyped/DefinitelyTyped/tree/929735ef7d8bafb29c17e39b26042ada8529e670/types/office-js',
  },
  license: 'MIT',
};

const validDocsReference = buildDocsReferenceMetadata({
  repository: DOCS_REFERENCE_REPOSITORY,
  commit: PINNED_DOCS_REFERENCE_COMMIT,
  commitDate: '2026-08-04T15:36:00Z',
  commitMessage: 'Automatically generated docs (#2601)',
  htmlUrl: `https://github.com/${DOCS_REFERENCE_REPOSITORY}/commit/${PINNED_DOCS_REFERENCE_COMMIT}`,
});

describe('buildProvenance', () => {
  test('derives the requirement sets actually present in the fixture', () => {
    const fixture = {
      symbols: {
        Body: {
          requirementSet: 'WordApi 1.1',
          members: {
            text: { requirementSet: 'WordApi 1.1' },
            end: { requirementSet: 'WordApiDesktop 1.4' },
          },
        },
      },
    };
    const provenance = buildProvenance({
      upstreamPackage: validUpstreamPackage,
      fixture,
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: validDocsReference,
    });

    expect(provenance.targetRequirementSets.sort()).toEqual(
      ['WordApi 1.1', 'WordApiDesktop 1.4'].sort()
    );
  });

  test('deduplicates requirement sets and omits nulls', () => {
    const fixture = {
      symbols: {
        A: { requirementSet: 'WordApi 1.1', members: {} },
        B: { requirementSet: 'WordApi 1.1', members: { x: { requirementSet: null } } },
        run: { requirementSet: null, overloads: [] },
      },
    };
    const provenance = buildProvenance({
      upstreamPackage: validUpstreamPackage,
      fixture,
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: validDocsReference,
    });
    expect(provenance.targetRequirementSets).toEqual(['WordApi 1.1']);
  });
});

describe('validateProvenance', () => {
  test('accepts a well-formed provenance record', () => {
    const provenance = buildProvenance({
      upstreamPackage: validUpstreamPackage,
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: validDocsReference,
    });
    expect(validateProvenance(provenance)).toEqual([]);
  });

  test('flags a missing integrity hash', () => {
    const provenance = buildProvenance({
      upstreamPackage: { ...validUpstreamPackage, integrity: '' },
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: validDocsReference,
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /integrity/i.test(e))).toBe(true);
  });

  test('flags a missing license', () => {
    const provenance = buildProvenance({
      upstreamPackage: { ...validUpstreamPackage, license: '' },
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: validDocsReference,
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /license/i.test(e))).toBe(true);
  });

  test('flags a missing source repository URL', () => {
    const provenance = buildProvenance({
      upstreamPackage: { ...validUpstreamPackage, sourceRepository: undefined },
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: validDocsReference,
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /sourceRepository/i.test(e))).toBe(true);
  });

  test('flags a missing DefinitelyTyped commit and immutable source URL', () => {
    const provenance = buildProvenance({
      upstreamPackage: {
        ...validUpstreamPackage,
        sourceRepository: {
          ...validUpstreamPackage.sourceRepository,
          commit: undefined,
          sourceUrl: undefined,
        },
      },
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: validDocsReference,
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /sourceRepository\.commit/.test(e))).toBe(true);
    expect(errors.some((e) => /sourceRepository\.sourceUrl/.test(e))).toBe(true);
  });

  test('flags a missing docsReference entirely (Critical 3: provenance must carry a verified docs-reference commit)', () => {
    const provenance = buildProvenance({
      upstreamPackage: validUpstreamPackage,
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: undefined,
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /docsReference/.test(e) && /commit/.test(e))).toBe(true);
  });

  test('flags a docsReference with a malformed commit sha', () => {
    const provenance = buildProvenance({
      upstreamPackage: validUpstreamPackage,
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
      docsReference: { ...validDocsReference, commit: 'main' },
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /docsReference\.commit/.test(e))).toBe(true);
  });
});
