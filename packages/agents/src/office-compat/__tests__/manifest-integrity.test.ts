import { describe, test, expect } from 'bun:test';
import {
  validateManifestAgainstReference,
  validateManifestSchemaVersion,
  validateAuthoredExportsAgainstManifest,
} from '../../../scripts/lib/manifest-integrity.mjs';

function makeReferenceFixture() {
  return {
    schemaVersion: 1,
    generatedFrom: { package: '@types/office-js', version: '1.0.0' },
    symbols: {
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: 'WordApi 1.1',
        members: {
          text: { uid: 'Word.Body#text', kind: 'property', requirementSet: null, overloads: [] },
          insertText: {
            uid: 'Word.Body#insertText',
            kind: 'method',
            requirementSet: null,
            overloads: [],
          },
        },
      },
      run: { uid: 'Word.run', kind: 'function', requirementSet: null, overloads: [] },
    },
  };
}

function makeManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    categories: { core: ['Body'] },
    symbols: {
      Body: { members: ['text', 'insertText'] },
      run: { isFunction: true, members: [] },
    },
    omissions: [{ uid: 'Word.Table', reason: 'Deferred until the table engine lane lands.' }],
    ...overrides,
  };
}

describe('validateManifestAgainstReference', () => {
  test('accepts a manifest that is a strict subset of the reference fixture', () => {
    expect(validateManifestAgainstReference(makeManifest(), makeReferenceFixture())).toEqual([]);
  });

  test('flags a manifest symbol with no corresponding reference symbol (stale entry)', () => {
    const manifest = makeManifest({
      symbols: { Body: { members: ['text'] }, GhostSymbol: { members: [] } },
    });
    const issues = validateManifestAgainstReference(manifest, makeReferenceFixture());
    expect(issues.some((i) => /GhostSymbol/.test(i) && /reference/i.test(i))).toBe(true);
  });

  test('flags a manifest member with no corresponding reference member (stale entry)', () => {
    const manifest = makeManifest({ symbols: { Body: { members: ['text', 'ghostMember'] } } });
    const issues = validateManifestAgainstReference(manifest, makeReferenceFixture());
    expect(issues.some((i) => /Body/.test(i) && /ghostMember/.test(i))).toBe(true);
  });

  test('flags a category listing a symbol name absent from manifest.symbols', () => {
    const manifest = makeManifest({ categories: { core: ['Body', 'NotInSymbolsMap'] } });
    const issues = validateManifestAgainstReference(manifest, makeReferenceFixture());
    expect(issues.some((i) => /NotInSymbolsMap/.test(i))).toBe(true);
  });

  test('flags an omission entry with a missing or empty reason', () => {
    const manifest = makeManifest({ omissions: [{ uid: 'Word.Table', reason: '' }] });
    const issues = validateManifestAgainstReference(manifest, makeReferenceFixture());
    expect(issues.some((i) => /Word\.Table/.test(i) && /reason/i.test(i))).toBe(true);
  });

  test('flags an omission entry whose uid does not look like a Word/OfficeExtension UID', () => {
    const manifest = makeManifest({ omissions: [{ uid: 'NotNamespaced', reason: 'because' }] });
    const issues = validateManifestAgainstReference(manifest, makeReferenceFixture());
    expect(issues.some((i) => /NotNamespaced/.test(i))).toBe(true);
  });

  test('flags an omission uid that contradicts an active selection for the same member', () => {
    const manifest = makeManifest({
      symbols: { Body: { members: ['text', 'insertText'] } },
      omissions: [
        { uid: 'Word.Body#insertText', reason: 'accidentally both selected and omitted' },
      ],
    });
    const issues = validateManifestAgainstReference(manifest, makeReferenceFixture());
    expect(issues.some((i) => /Word\.Body#insertText/.test(i) && /contradict/i.test(i))).toBe(true);
  });

  test('does not flag a legitimate omission that is not also selected', () => {
    expect(validateManifestAgainstReference(makeManifest(), makeReferenceFixture())).toEqual([]);
  });
});

describe('validateManifestSchemaVersion', () => {
  test('accepts the current supported schema version', () => {
    expect(validateManifestSchemaVersion({ schemaVersion: 1 })).toEqual([]);
  });

  test('flags a missing schemaVersion field', () => {
    const issues = validateManifestSchemaVersion({});
    expect(issues.some((i) => /schemaVersion/.test(i))).toBe(true);
  });

  test('flags an unsupported schemaVersion value', () => {
    const issues = validateManifestSchemaVersion({ schemaVersion: 99 });
    expect(issues.some((i) => /schemaVersion/.test(i) && /99/.test(i))).toBe(true);
  });
});

describe('validateAuthoredExportsAgainstManifest', () => {
  const manifest = makeManifest();

  test('accepts exported names that are all selected manifest symbols', () => {
    const issues = validateAuthoredExportsAgainstManifest(['Body', 'run'], manifest);
    expect(issues).toEqual([]);
  });

  test('accepts the documented zero-runtime-footprint support types even though they are not manifest symbols', () => {
    const issues = validateAuthoredExportsAgainstManifest(
      ['Body', 'run', 'ClientRequestContext', 'SelectionMode', 'HeaderFooterType'],
      manifest
    );
    expect(issues).toEqual([]);
  });

  test('flags an exported symbol that is neither a selected manifest symbol nor an allowlisted support type (the Table/Image "stub sneaks in" scenario)', () => {
    const issues = validateAuthoredExportsAgainstManifest(['Body', 'run', 'Table'], manifest);
    expect(issues.some((i) => /Table/.test(i))).toBe(true);
  });
});
