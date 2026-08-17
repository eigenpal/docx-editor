/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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
import definitelyTypedCommits from '../../../compat/definitely-typed-commits.json';
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

  // The three files are written by one command but in three separate writes,
  // and `compat:adopt` runs unattended. Each file alone is valid in every
  // partial state, so only a cross-file check catches "provenance says 1.0.605
  // while the fixture still says 1.0.604", or a provenance record naming a
  // commit that no reviewed pin backs. The scheduled workflow runs these tests
  // before it opens its PR, which is the point at which this has to fail.
  test('the reference fixture, provenance, and the reviewed pin all name the same release', () => {
    const version = provenance.upstreamPackage.version;
    expect(referenceFixture.generatedFrom.version).toBe(version);
    expect(referenceFixture.generatedFrom.package).toBe(provenance.upstreamPackage.name);
    expect(provenance.upstreamPackage.tarballUrl).toContain(version);

    const pins: Record<string, string> = definitelyTypedCommits.commits;
    expect(Object.keys(pins)).toContain(version);
    expect(provenance.upstreamPackage.sourceRepository.commit).toBe(pins[version]);
    expect(provenance.upstreamPackage.sourceRepository.sourceUrl).toContain(pins[version]);
  });

  test('every reviewed pin is a well-formed commit sha, and the pin file keeps its own contract fields', () => {
    expect(definitelyTypedCommits.schemaVersion).toBe(1);
    expect(definitelyTypedCommits.package).toBe('@types/office-js');
    expect(definitelyTypedCommits.note.length).toBeGreaterThan(0);
    for (const [version, commit] of Object.entries(definitelyTypedCommits.commits)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(commit).toMatch(/^[0-9a-f]{40}$/);
    }
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

  test('tables and images are recorded as deliberate omissions, never as selected symbols', () => {
    const omittedUids = manifest.omissions.map((o) => o.uid);
    expect(omittedUids).toContain('Word.Table');
    expect(omittedUids).toContain('Word.InlinePicture');
    expect(manifest.symbols).not.toHaveProperty('Table');
    expect(manifest.symbols).not.toHaveProperty('InlinePicture');
  });
});
