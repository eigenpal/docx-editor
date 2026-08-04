/**
 * Deterministic, offline tests over the real, checked-in
 * `compat/manifest.json`, `compat/reference/word.reference.json`, and
 * `compat/provenance.json` — not synthetic fixtures. These are the tests
 * that actually gate "did someone hand-edit the manifest or the generated
 * reference into an inconsistent state" in normal (non-network) CI.
 */
import { describe, test, expect } from 'bun:test';
import manifest from '../../../compat/manifest.json';
import referenceFixture from '../../../compat/reference/word.reference.json';
import provenance from '../../../compat/provenance.json';
import { validateManifestAgainstReference } from '../../../scripts/lib/manifest-integrity.mjs';
import { validateReferenceFixture } from '../../../scripts/lib/reference-normalize.mjs';
import { validateProvenance } from '../../../scripts/lib/provenance.mjs';

describe('the checked-in compat/ fixtures', () => {
  test('manifest.json is a strict, internally consistent subset of the reference fixture', () => {
    expect(validateManifestAgainstReference(manifest, referenceFixture)).toEqual([]);
  });

  test('word.reference.json is well-formed', () => {
    expect(validateReferenceFixture(referenceFixture)).toEqual([]);
  });

  test('provenance.json is well-formed', () => {
    expect(validateProvenance(provenance)).toEqual([]);
  });

  test('every manifest category is non-empty and every listed symbol is selected', () => {
    for (const [category, symbolNames] of Object.entries(manifest.categories)) {
      expect(symbolNames.length).toBeGreaterThan(0);
      for (const symbolName of symbolNames) {
        expect(manifest.symbols).toHaveProperty(symbolName);
      }
    }
  });

  test('tables and images are recorded as deliberate omissions, never as selected symbols', () => {
    const omittedUids = manifest.omissions.map((o) => o.uid);
    expect(omittedUids).toContain('Word.Table');
    expect(omittedUids).toContain('Word.InlinePicture');
    expect(manifest.symbols).not.toHaveProperty('Table');
    expect(manifest.symbols).not.toHaveProperty('InlinePicture');
  });
});
