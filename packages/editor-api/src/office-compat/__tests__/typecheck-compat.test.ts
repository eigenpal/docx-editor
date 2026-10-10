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
});
