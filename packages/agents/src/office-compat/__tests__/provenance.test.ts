import { describe, test, expect } from 'bun:test';
import { buildProvenance, validateProvenance } from '../../../scripts/lib/provenance.mjs';

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
  },
  license: 'MIT',
};

describe('buildProvenance', () => {
  test('records the upstream package identity, license, and requirement sets actually present in the fixture', () => {
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
    });

    expect(provenance.upstreamPackage.version).toBe('1.0.604');
    expect(provenance.upstreamPackage.integrity).toBe('sha512-abc123==');
    expect(provenance.license).toBe('MIT');
    expect(provenance.targetRequirementSets.sort()).toEqual(
      ['WordApi 1.1', 'WordApiDesktop 1.4'].sort()
    );
    expect(provenance.fetchedAt).toBe('2026-08-01T00:00:00.000Z');
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
    });
    expect(validateProvenance(provenance)).toEqual([]);
  });

  test('flags a missing integrity hash', () => {
    const provenance = buildProvenance({
      upstreamPackage: { ...validUpstreamPackage, integrity: '' },
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /integrity/i.test(e))).toBe(true);
  });

  test('flags a missing license', () => {
    const provenance = buildProvenance({
      upstreamPackage: { ...validUpstreamPackage, license: '' },
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /license/i.test(e))).toBe(true);
  });

  test('flags a missing source repository URL', () => {
    const provenance = buildProvenance({
      upstreamPackage: { ...validUpstreamPackage, sourceRepository: undefined },
      fixture: { symbols: {} },
      fetchedAt: '2026-08-01T00:00:00.000Z',
    });
    const errors = validateProvenance(provenance);
    expect(errors.some((e) => /sourceRepository/i.test(e))).toBe(true);
  });
});
