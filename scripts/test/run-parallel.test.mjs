import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the real CLI in a tiny isolated repository, including Bun's failure
// exit code. No production-suite execution or runner implementation mocks.
test('fail-fast stops dispatch after the first failure; normal mode reports both', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-runner-test-'));
  try {
    for (const dir of ['scripts/test', 'packages', 'docs', 'examples', 'benchmarks']) {
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

    const excluded = run('--exclude', 'packages/first');
    expect(excluded.status).toBe(1);
    expect(excluded.stdout).toContain('Running 1 test files');
    expect(excluded.stdout).not.toContain('FAIL packages/first.test.ts');
    expect(excluded.stdout).toContain('FAIL packages/second.test.ts');

    // Shards are assigned before exclusion, so shard 2/2 keeps its file.
    const excludedShard = run('--shard', '2/2', '--exclude', 'packages/first');
    expect(excludedShard.status).toBe(1);
    expect(excludedShard.stdout).toContain('FAIL packages/second.test.ts');

    // A balanced shard still runs its files, and --durations-out lists only what this run ran.
    const out = join(root, 'durations-out.json');
    const balanced = run('--balance', '--exclude', 'packages/first', '--durations-out', out);
    expect(balanced.stdout).toContain('FAIL packages/second.test.ts');
    expect(Object.keys(JSON.parse(readFileSync(out, 'utf8')))).toEqual(['packages/second.test.ts']);

    // --retry-failed: a file that fails only on its first run passes and is reported as FLAKY;
    // a file that fails every time still fails.
    const marker = join(root, 'flaky-ran-once');
    writeFileSync(
      join(root, 'packages', 'flaky.test.ts'),
      `import { test, expect } from 'bun:test';
       import { existsSync, writeFileSync } from 'node:fs';
       test('fails only on the first run', () => {
         const first = !existsSync(${JSON.stringify(marker)});
         writeFileSync(${JSON.stringify(marker)}, '');
         expect(first).toBe(false);
       });`
    );
    const retried = run(
      '--retry-failed',
      '--exclude',
      'packages/first',
      '--exclude',
      'packages/second'
    );
    expect(retried.status).toBe(0);
    expect(retried.stdout).toContain('FLAKY packages/flaky.test.ts');
    const stillFailing = run('--retry-failed', '--exclude', 'packages/flaky');
    expect(stillFailing.status).toBe(1);
    expect(stillFailing.stdout).toContain('FAIL packages/first.test.ts');
    rmSync(join(root, 'packages', 'flaky.test.ts'));

    // --only runs just the listed files, never forwarding the paths to `bun test`.
    const list = join(root, 'only.txt');
    writeFileSync(list, 'packages/second.test.ts\n');
    const onlyRun = run('--only', list);
    expect(onlyRun.stdout).toContain('Running 1 test files');
    expect(onlyRun.stdout).toContain('FAIL packages/second.test.ts');
    expect(onlyRun.stdout).not.toContain('FAIL packages/first.test.ts');

    const emptyExclude = run('--exclude=');
    expect(emptyExclude.status).toBe(1);
    expect(emptyExclude.stderr).toContain('non-empty path prefix');

    const invalid = run('--shard', '0/2');
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Invalid shard');
    expect(invalid.stdout).not.toContain('FAIL');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

// A failing test can leave a child holding stdout open; another active worker
// can also have spawned a compiler/server. Neither may outlive fail-fast.
test.skipIf(process.platform === 'win32')(
  'fail-fast kills worker descendants and closes inherited pipes',
  async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const { setTimeout: sleep } = await import('node:timers/promises');
    const root = mkdtempSync(join(tmpdir(), 'ci-runner-process-tree-'));
    const pids = [];
    try {
      for (const dir of ['scripts/test', 'packages', 'docs', 'examples', 'benchmarks']) {
        mkdirSync(join(root, dir), { recursive: true });
      }
      for (const file of ['run-parallel.mjs', 'shard.mjs']) {
        copyFileSync(new URL(file, import.meta.url), join(root, 'scripts/test', file));
      }
      writeFileSync(
        join(root, 'child.mjs'),
        `
      import { writeFileSync } from 'node:fs';
      writeFileSync(process.argv[2], String(process.pid));
      setInterval(() => {}, 1000);
    `
      );
      for (const name of ['first', 'second']) {
        writeFileSync(
          join(root, 'packages', `${name}.test.ts`),
          `
        import { test, expect } from 'bun:test';
        import { spawn } from 'node:child_process';
        import { existsSync, writeFileSync } from 'node:fs';
        test('${name}', async () => {
          writeFileSync('${name}.worker.pid', String(process.pid));
          spawn('node', ['child.mjs', '${name}.pid'], { stdio: 'inherit' });
          while (!existsSync('first.pid') || !existsSync('second.pid')) await Bun.sleep(10);
          ${name === 'first' ? 'expect(1).toBe(2);' : 'await Bun.sleep(60000);'}
        }, 65000);
      `
        );
      }
      const result = spawnSync(
        'node',
        [join(root, 'scripts/test/run-parallel.mjs'), '--jobs', '2', '--fail-fast'],
        { encoding: 'utf8', timeout: 10000 }
      );
      for (const name of ['first', 'second']) {
        const file = join(root, `${name}.pid`);
        if (existsSync(file)) pids.push(Number(readFileSync(file, 'utf8')));
      }
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Expected: 2');
      expect(pids).toHaveLength(2);
      // Allow init to reap descendants after their parent exits.
      await sleep(100);
      for (const pid of pids) {
        // Linux may retain an already-dead orphan as a zombie until init reaps it.
        const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
        expect(state.stdout.trim() === '' || state.stdout.trim().startsWith('Z')).toBe(true);
      }
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000
);
