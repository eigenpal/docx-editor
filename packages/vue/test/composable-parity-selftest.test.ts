import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('check-composable-parity self-test', () => {
  test('fixture self-test passes', () => {
    execSync('node scripts/check-composable-parity.mjs --self-test', {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    expect(true).toBe(true);
  });
});
