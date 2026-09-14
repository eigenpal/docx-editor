import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the real CLI in a tiny isolated repository, including Bun's failure
// exit code. No production-suite execution or runner implementation mocks.
test('fail-fast stops dispatch after the first failure; normal mode reports both', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-runner-test-'));
  try {
    for (const dir of ['scripts/test', 'packages', 'docs', 'examples']) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    for (const file of ['run-parallel.mjs', 'shard.mjs']) {
      copyFileSync(new URL(file, import.meta.url), join(root, 'scripts/test', file));
    }
    for (const name of ['first', 'second']) {
      writeFileSync(
        join(root, 'packages', `${name}.test.ts`),
        `import { test, expect } from 'bun:test';
         test('${name}', () => expect(1).toBe(2));
         test('following test', () => console.log('SECOND_TEST_EXECUTED'));`
      );
    }
    const run = (...args) =>
      spawnSync(
        process.execPath.includes('bun') ? 'node' : process.execPath,
        [join(root, 'scripts/test/run-parallel.mjs'), '--jobs', '1', ...args],
        { encoding: 'utf8', timeout: 15000 }
      );
    const fast = run('--fail-fast');
    expect(fast.status).toBe(1);
    expect(fast.stdout).toContain('FAIL packages/first.test.ts');
    expect(fast.stdout).not.toContain('FAIL packages/second.test.ts');
    expect(fast.stderr).toContain('Expected: 2');
    expect(fast.stderr).not.toContain('SECOND_TEST_EXECUTED');

    const normal = run();
    expect(normal.status).toBe(1);
    expect(normal.stdout).toContain('FAIL packages/first.test.ts');
    expect(normal.stdout).toContain('FAIL packages/second.test.ts');
    expect(normal.stdout).toContain('SECOND_TEST_EXECUTED');

    const shard = run('--shard', '2/2');
    expect(shard.status).toBe(1);
    expect(shard.stdout).not.toContain('FAIL packages/first.test.ts');
    expect(shard.stdout).toContain('FAIL packages/second.test.ts');

    const invalid = run('--shard', '0/2');
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Invalid shard');
    expect(invalid.stdout).not.toContain('FAIL');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
