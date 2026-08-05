import { describe, test, expect } from 'bun:test';
import path from 'node:path';
import { typecheckProject } from '../../../scripts/lib/typecheck-compat.mjs';

describe('typecheckProject', () => {
  test('reports diagnostics for an intentionally broken tsconfig project (sanity check)', () => {
    const fixtureDir = path.join(__dirname, '__fixtures__', 'broken-tsconfig');
    const diagnostics = typecheckProject(path.join(fixtureDir, 'tsconfig.json'));
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
