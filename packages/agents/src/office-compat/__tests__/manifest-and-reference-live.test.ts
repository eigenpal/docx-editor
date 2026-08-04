/**
 * Deterministic, offline tests over the real, checked-in
 * `compat/manifest.json`, `compat/reference/word.reference.json`, and
 * `compat/provenance.json` — not synthetic fixtures. These are the tests
 * that actually gate "did someone hand-edit the manifest or the generated
 * reference into an inconsistent state" in normal (non-network) CI.
 */
import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import manifest from '../../../compat/manifest.json';
import referenceFixture from '../../../compat/reference/word.reference.json';
import provenance from '../../../compat/provenance.json';
import {
  validateManifestAgainstReference,
  validateManifestSchemaVersion,
  validateAuthoredExportsAgainstManifest,
} from '../../../scripts/lib/manifest-integrity.mjs';
import { validateReferenceFixture } from '../../../scripts/lib/reference-normalize.mjs';
import { validateProvenance } from '../../../scripts/lib/provenance.mjs';
import { listExportedSymbolNames } from '../../../scripts/lib/extract-docxeditor-shape.mjs';

const compatDir = path.join(__dirname, '..', '..', '..', 'compat');

describe('the checked-in compat/ fixtures', () => {
  test('manifest.json is a strict, internally consistent subset of the reference fixture', () => {
    expect(validateManifestAgainstReference(manifest, referenceFixture)).toEqual([]);
  });

  test('manifest.json declares a schemaVersion this tooling supports', () => {
    expect(validateManifestSchemaVersion(manifest)).toEqual([]);
  });

  test('word.reference.json is well-formed', () => {
    expect(validateReferenceFixture(referenceFixture)).toEqual([]);
  });

  test('provenance.json is well-formed', () => {
    expect(validateProvenance(provenance)).toEqual([]);
  });

  test('every symbol compat/docxeditor/declarations.ts exports is either a selected manifest symbol or an allowlisted support type (no Table/Image stub can sneak in)', () => {
    const declarationsSource = fs.readFileSync(
      path.join(compatDir, 'docxeditor', 'declarations.ts'),
      'utf8'
    );
    const exportedNames = listExportedSymbolNames(declarationsSource);
    expect(exportedNames.length).toBeGreaterThan(0);
    expect(validateAuthoredExportsAgainstManifest(exportedNames, manifest)).toEqual([]);
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
