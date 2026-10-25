/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, test, expect } from 'bun:test';
import path from 'node:path';
import { TYPECHECK_TIMEOUT_MS, typecheckProject } from '../../../scripts/lib/typecheck-compat.mjs';

describe('typecheckProject', () => {
  test(
    'reports diagnostics for an intentionally broken tsconfig project (sanity check)',
    () => {
      const fixtureDir = path.join(__dirname, '__fixtures__', 'broken-tsconfig');
      const diagnostics = typecheckProject(path.join(fixtureDir, 'tsconfig.json'));
      expect(diagnostics.length).toBeGreaterThan(0);
    },
    TYPECHECK_TIMEOUT_MS
  );

  // `own.ts` is the project; `dependency.ts` is only reached through an import.
  const scoped = path.join(__dirname, '__fixtures__', 'scoped-project', 'tsconfig.json');
  const located = (diagnostics: readonly string[]) =>
    diagnostics.map((line) => {
      const [, file, row, rest] = /([^/]+\.ts):(\d+):\d+ - (.*)/.exec(line) ?? [];
      return `${file}:${row} ${rest?.split('\n')[0]}`;
    });

  test(
    'the program scope reports every file the program reaches',
    () => {
      const found = located(typecheckProject(scoped));
      expect(found.some((line) => line.startsWith('own.ts:10 '))).toBe(true);
      expect(found.some((line) => line.startsWith('dependency.ts:12 '))).toBe(true);
    },
    TYPECHECK_TIMEOUT_MS
  );

  test(
    'the project scope reports its own files and not the bodies of the files they import',
    () => {
      const found = located(typecheckProject(scoped, { scope: 'project' }));
      expect(found.some((line) => line.startsWith('own.ts:10 '))).toBe(true);
      expect(found.filter((line) => !line.startsWith('own.ts'))).toEqual([]);
    },
    TYPECHECK_TIMEOUT_MS
  );

  test(
    'the host scan reports server-runtime references the project scope skips, and only those',
    () => {
      const found = located(typecheckProject(scoped, { scope: 'project', forbidHost: true }));
      // `host-typed.ts` brings host types into the program, so `process` resolves, and counts.
      expect(found.filter((line) => !line.startsWith('own.ts'))).toEqual([
        'dependency.ts:8 imports fs',
        'dependency.ts:9 imports node:path',
        'dependency.ts:10 imports fs',
        'dependency.ts:16 names the host global process',
        'dependency.ts:17 reads import.meta.dir',
        'dependency.ts:18 names the host global process',
        'host-typed.ts:6 references types bun',
        'host-typed.ts:10 names the host global process',
      ]);
    },
    TYPECHECK_TIMEOUT_MS
  );
  test(
    'with no host types anywhere, a host global that resolves nowhere or only ambiently counts',
    () => {
      const untyped = scoped.replace('tsconfig.json', 'tsconfig.untyped.json');
      const found = located(typecheckProject(untyped, { scope: 'project', forbidHost: true }));
      expect(found.filter((line) => line.includes('host global'))).toEqual([
        'dependency.ts:16 names the host global process',
        'dependency.ts:18 names the host global process',
        'untyped.ts:13 names the host global Buffer',
      ]);
    },
    TYPECHECK_TIMEOUT_MS
  );
});
