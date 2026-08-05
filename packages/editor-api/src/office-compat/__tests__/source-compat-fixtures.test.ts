/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, test, expect } from 'bun:test';
import path from 'node:path';
import { typecheckProject } from '../../../scripts/lib/typecheck-compat.mjs';

const compatTsconfig = path.join(__dirname, '..', '..', '..', 'compat', 'tsconfig.json');

describe('representative source-compatibility fixtures', () => {
  test('the whole compat/ project (fixtures included) type-checks with zero diagnostics', () => {
    expect(typecheckProject(compatTsconfig)).toEqual([]);
  });
});
