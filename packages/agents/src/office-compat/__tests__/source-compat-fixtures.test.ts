/**
 * Requirement 7/8 (task-1 brief): representative Office.js examples,
 * rewritten `Word` -> `DocxEditor`, must actually type-check against
 * DocxEditor's own declarations — and this test must fail if that stops
 * being true, or if someone quietly deletes/empties the fixtures so the
 * broader `typecheck-compat.test.ts` "zero diagnostics" check becomes
 * vacuous.
 */
import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { typecheckProject } from '../../../scripts/lib/typecheck-compat.mjs';

const fixturesDir = path.join(__dirname, '..', '..', '..', 'compat', 'fixtures', 'source-compat');
const compatTsconfig = path.join(__dirname, '..', '..', '..', 'compat', 'tsconfig.json');

describe('representative source-compatibility fixtures', () => {
  const fixtureFiles = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.ts'));

  test('at least one fixture file exists', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  test('every fixture calls `DocxEditor.run(...)` and imports from the authored declarations (not a vacuous/empty file)', () => {
    for (const file of fixtureFiles) {
      const text = fs.readFileSync(path.join(fixturesDir, file), 'utf8');
      expect(text).toContain("from '../../docxeditor/declarations'");
      expect(text).toMatch(/DocxEditor\.run\(/);
    }
  });

  test('no fixture references the upstream `Word` namespace (the rewrite is real, not just file-renamed)', () => {
    for (const file of fixtureFiles) {
      const text = fs.readFileSync(path.join(fixturesDir, file), 'utf8');
      const codeLines = text.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));
      for (const line of codeLines) {
        expect(line).not.toMatch(/\bWord\.\w/);
      }
    }
  });

  test('every fixture file is part of the compat/ TypeScript program (sanity: tsconfig include actually reaches fixtures/)', () => {
    const configFile = ts.readConfigFile(compatTsconfig, (f) => fs.readFileSync(f, 'utf8'));
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(compatTsconfig));
    const included = new Set(parsed.fileNames.map((f) => path.resolve(f)));
    for (const file of fixtureFiles) {
      expect(included.has(path.resolve(fixturesDir, file))).toBe(true);
    }
  });

  test('the whole compat/ project (fixtures included) type-checks with zero diagnostics', () => {
    expect(typecheckProject(compatTsconfig)).toEqual([]);
  });
});
