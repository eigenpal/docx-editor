import { describe, test, expect } from 'bun:test';
import {
  buildReferenceFixture,
  validateReferenceFixture,
} from '../../../scripts/lib/reference-normalize.mjs';

describe('buildReferenceFixture', () => {
  test('wraps symbols with schema version and provenance-linking metadata', () => {
    const fixture = buildReferenceFixture({
      packageName: '@types/office-js',
      packageVersion: '1.0.604',
      symbols: {
        Body: {
          uid: 'Word.Body',
          kind: 'class',
          requirementSet: 'WordApi 1.1',
          members: {
            text: {
              uid: 'Word.Body#text',
              kind: 'property',
              readonly: true,
              requirementSet: 'WordApi 1.1',
              overloads: [{ params: [], returns: 'string' }],
            },
          },
        },
      },
    });

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.generatedFrom).toEqual({
      package: '@types/office-js',
      version: '1.0.604',
    });
    expect(fixture.symbols.Body.uid).toBe('Word.Body');
    expect(fixture.symbols.Body.members.text.overloads).toEqual([
      { params: [], returns: 'string' },
    ]);
  });

  test('sorts symbol and member keys deterministically regardless of input order', () => {
    const fixtureA = buildReferenceFixture({
      packageName: '@types/office-js',
      packageVersion: '1.0.604',
      symbols: {
        Range: { uid: 'Word.Range', kind: 'class', requirementSet: null, members: {} },
        Body: {
          uid: 'Word.Body',
          kind: 'class',
          requirementSet: null,
          members: {
            text: {
              uid: 'Word.Body#text',
              kind: 'property',
              requirementSet: null,
              overloads: [],
            },
            style: {
              uid: 'Word.Body#style',
              kind: 'property',
              requirementSet: null,
              overloads: [],
            },
          },
        },
      },
    });

    expect(Object.keys(fixtureA.symbols)).toEqual(['Body', 'Range']);
    expect(Object.keys(fixtureA.symbols.Body.members)).toEqual(['style', 'text']);
  });

  test('produces byte-identical JSON for the same logical input regardless of key order', () => {
    const build = (symbols: Record<string, unknown>) =>
      JSON.stringify(buildReferenceFixture({ packageName: 'x', packageVersion: '1.0.0', symbols }));

    const a = build({
      Body: { uid: 'Word.Body', kind: 'class', requirementSet: null, members: {} },
      Range: { uid: 'Word.Range', kind: 'class', requirementSet: null, members: {} },
    });
    const b = build({
      Range: { uid: 'Word.Range', kind: 'class', requirementSet: null, members: {} },
      Body: { uid: 'Word.Body', kind: 'class', requirementSet: null, members: {} },
    });

    expect(a).toBe(b);
  });
});

describe('validateReferenceFixture', () => {
  test('accepts a well-formed fixture', () => {
    const fixture = buildReferenceFixture({
      packageName: '@types/office-js',
      packageVersion: '1.0.604',
      symbols: {
        Body: { uid: 'Word.Body', kind: 'class', requirementSet: null, members: {} },
      },
    });
    expect(validateReferenceFixture(fixture)).toEqual([]);
  });

  test('rejects a symbol missing a uid', () => {
    const errors = validateReferenceFixture({
      schemaVersion: 1,
      generatedFrom: { package: 'x', version: '1.0.0' },
      symbols: {
        Body: { kind: 'class', requirementSet: null, members: {} },
      },
    } as never);
    expect(errors.some((e) => /Body/.test(e) && /uid/.test(e))).toBe(true);
  });

  test('rejects a member overload missing a returns field', () => {
    const errors = validateReferenceFixture({
      schemaVersion: 1,
      generatedFrom: { package: 'x', version: '1.0.0' },
      symbols: {
        Body: {
          uid: 'Word.Body',
          kind: 'class',
          requirementSet: null,
          members: {
            text: {
              uid: 'Word.Body#text',
              kind: 'property',
              requirementSet: null,
              overloads: [{ params: [] }],
            },
          },
        },
      },
    } as never);
    expect(errors.some((e) => /Body#text|Body\.text/.test(e) && /returns/.test(e))).toBe(true);
  });

  test('rejects an unsupported schema version', () => {
    const errors = validateReferenceFixture({
      schemaVersion: 2,
      generatedFrom: { package: 'x', version: '1.0.0' },
      symbols: {},
    } as never);
    expect(errors.some((e) => /schemaVersion/.test(e))).toBe(true);
  });
});
