/**
 * Runs the real conformance generator against the real, checked-in
 * `compat/manifest.json`, `compat/reference/word.reference.json`, and
 * `compat/docxeditor/declarations.ts`, and asserts two things `bun test`
 * must gate on:
 *
 *   1. Zero conformance issues — DocxEditor's own declarations are, right
 *      now, an exact structural match for every selected Office.js
 *      overload.
 *   2. The checked-in `compat/generated/*` files are byte-identical to a
 *      fresh run — nobody hand-edited the generated files, and nobody
 *      edited `declarations.ts`/`manifest.json` without re-running
 *      `node scripts/generate-conformance.mjs`.
 */
import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { generateConformance } from '../../../scripts/generate-conformance.mjs';

const agentsDir = path.join(__dirname, '..', '..', '..');
const compatDir = path.join(agentsDir, 'compat');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(compatDir, relativePath), 'utf8'));
}

describe('the checked-in compat/generated/ output', () => {
  const referenceFixture = readJson('reference/word.reference.json');
  const manifest = readJson('manifest.json');
  const docxEditorSourceText = fs.readFileSync(
    path.join(compatDir, 'docxeditor', 'declarations.ts'),
    'utf8'
  );
  const packageJson = readJson(path.join('..', 'package.json'));

  const result = generateConformance({
    referenceFixture,
    manifest,
    docxEditorSourceText,
    docxEditorPackageVersion: packageJson.version,
  });

  test('DocxEditor\'s own declarations have zero conformance issues against the frozen reference', () => {
    expect(result.issues).toEqual([]);
  });

  test('compat/generated/docxeditor.shape.json matches a fresh regeneration', () => {
    const checkedIn = fs.readFileSync(path.join(compatDir, 'generated', 'docxeditor.shape.json'), 'utf8');
    expect(checkedIn).toBe(`${JSON.stringify(result.authoredFixture, null, 2)}\n`);
  });

  test('compat/generated/conformance.assertions.ts matches a fresh regeneration', () => {
    const checkedIn = fs.readFileSync(
      path.join(compatDir, 'generated', 'conformance.assertions.ts'),
      'utf8'
    );
    expect(checkedIn).toBe(`${result.assertionsSource}\n`);
  });
});
