import { afterEach, expect, test } from 'bun:test';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from './common.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'collaboration-dx-'));
  directories.push(dir);
  cpSync(import.meta.dirname, join(dir, 'scripts/collaboration'), { recursive: true });
  return dir;
}
function invoke(dir: string, file: string, args: string[]) {
  return spawnSync(process.execPath, [join(dir, 'scripts/collaboration', file), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
}

test.each(['cli.mjs', 'test.mjs'])('%s help works without dependencies, Git, or npm', (file) => {
  const dir = workspace();
  const result = invoke(dir, file, ['--help']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Usage:');
  expect(existsSync(join(dir, '.cache'))).toBe(false);
});

test.each([
  ['--all', '--seed', 'abc'],
  ['--all', '--shard', '5/4'],
  ['--all', '--seed', '1.5'],
  ['--all', '--shard', '1e0/4'],
  ['--all', '--release', '2.18.0'],
  ['--release', 'latest'],
  ['--all', '--relase', '2.18.0'],
  ['--all', '--seed', '1', '--seed', '2'],
  ['--all', '--candidate'],
  ['--release', '2.18.0', '--allow-current'],
])('rejects invalid arguments before installation: %j', (...args) => {
  const dir = workspace();
  const report = join(dir, '.cache/collaboration/failure.json');
  mkdirSync(join(dir, '.cache/collaboration'), { recursive: true });
  writeFileSync(report, 'previous evidence');
  const result = invoke(dir, 'test.mjs', args);
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain('ENOENT');
  expect(readFileSync(report, 'utf8')).toBe('previous evidence');
});

test('candidate setup failure records an explicit context and reproduction command', () => {
  const dir = workspace();
  cpSync(join(ROOT, '.collaboration'), join(dir, '.collaboration'), { recursive: true });
  const result = invoke(dir, 'test.mjs', ['--release', '2.18.0', '--candidate', 'missing']);
  expect(result.status).toBe(1);
  const report = JSON.parse(readFileSync(join(dir, '.cache/collaboration/failure.json'), 'utf8'));
  expect(report.context).toEqual({
    phase: 'candidate',
    release: '2.18.0',
    seed: null,
    shard: '1/1',
  });
  expect(report.reproduce).toBe('bun run collaboration:test --release 2.18.0');
  expect(result.stderr).toContain(report.reproduce);
});

test('catalog retry reuses a pushed baseline after PR creation fails', () => {
  const dir = workspace();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const executable = (name: string, source: string) => {
    const file = join(bin, name);
    writeFileSync(file, '#!/bin/bash\nset -euo pipefail\n' + source);
    chmodSync(file, 0o755);
  };
  executable(
    'node',
    `
if [[ "$1" = --input-type=module ]]; then exit 1; fi
if [[ "$*" = *--capture* ]]; then echo capture >> "$STATE/captures"; fi
`
  );
  executable(
    'git',
    `
echo "$*" >> "$STATE/git-calls"
if [[ "$1" = ls-remote && -f "$STATE/pushed" ]]; then echo 'abc refs/heads/automation/collaboration-catalog-2.19.0'; fi
if [[ "$1" = push ]]; then echo pushed > "$STATE/pushed"; fi
`
  );
  executable(
    'gh',
    `
if [[ "$2" = list ]]; then
  if [[ "$*" = *"--json number"* ]]; then echo 123; exit 0; fi
  if [[ -f "$STATE/closed" ]]; then echo CLOSED; elif [[ -f "$STATE/created" ]]; then echo OPEN; fi
elif [[ "$2" = create ]]; then
  if [[ ! -f "$STATE/failed" ]]; then echo failed > "$STATE/failed"; exit 1; fi
  echo created > "$STATE/created"
fi
`
  );
  const workflow = readFileSync(join(ROOT, '.github/workflows/collaboration-catalog.yml'), 'utf8');
  const parsed = Bun.YAML.parse(workflow) as any;
  const script = parsed.jobs.capture.steps.find((step: any) => step.id === 'capture').run;
  // Keep the workflow's generated PR body inside the test's isolated directory.
  const isolated = script.replaceAll('/tmp/collaboration-catalog-pr.md', join(dir, 'pr.md'));
  const run = () =>
    spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', isolated], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        STATE: dir,
        REQUESTED_VERSION: '2.19.0',
        GITHUB_OUTPUT: join(dir, 'outputs'),
      },
    });
  expect(run().status).toBe(1);
  expect(existsSync(join(dir, 'pushed'))).toBe(true);
  expect(run().status).toBe(0);
  expect(existsSync(join(dir, 'created'))).toBe(true);
  expect(readFileSync(join(dir, 'outputs'), 'utf8')).toContain('pr=123');
  expect(readFileSync(join(dir, 'captures'), 'utf8')).toBe('capture\n');
  expect(readFileSync(join(dir, 'git-calls'), 'utf8')).toContain('switch --track');
  expect(run().status).toBe(0);
  expect(readFileSync(join(dir, 'git-calls'), 'utf8').match(/^push /gm)).toHaveLength(1);
  writeFileSync(join(dir, 'closed'), 'closed');
  const closed = run();
  expect(closed.status).toBe(1);
  expect(closed.stdout).toContain('Restore or reopen');
});

test('single-release runs reject edited fixture bytes before packing or installing', () => {
  const dir = workspace();
  cpSync(join(ROOT, '.collaboration'), join(dir, '.collaboration'), { recursive: true });
  writeFileSync(join(dir, '.collaboration/releases/2.18.0/fixture.json'), '{}');
  const result = invoke(dir, 'test.mjs', ['--release', '2.18.0']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Changed historical file: 2.18.0/fixture.json');
  expect(existsSync(join(dir, '.cache/collaboration/candidate'))).toBe(false);
});

test('noninteractive decision creation accepts spaces between test paths', () => {
  const dir = workspace();
  const result = invoke(dir, 'cli.mjs', [
    'change',
    '--id',
    'review-tooling',
    '--impact',
    'no-impact',
    '--before',
    'Tooling diagnostics are hard to reproduce.',
    '--after',
    'Tooling diagnostics include their context.',
    '--reason',
    'This changes release tooling without changing shared state.',
    '--tests',
    'scripts/collaboration/policy.test.ts, scripts/collaboration/workflow.test.ts',
  ]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const record = JSON.parse(
    readFileSync(join(dir, '.collaboration/changes/review-tooling.json'), 'utf8')
  );
  expect(record.tests).toEqual([
    'scripts/collaboration/policy.test.ts',
    'scripts/collaboration/workflow.test.ts',
  ]);
});

test('a closed worker input rejects the request without crashing the parent', () => {
  const dir = workspace();
  writeFileSync(
    join(dir, 'worker.mjs'),
    `
    import { closeSync } from 'node:fs';
    closeSync(0);
    console.log(JSON.stringify({ id: 0, value: 'ready' }));
    setTimeout(() => {}, 2000);
  `
  );
  const source = `
    import { Peer } from ${JSON.stringify(join(dir, 'scripts/collaboration/peer.mjs'))};
    const peer = new Peer(${JSON.stringify(dir)}, 'broken-input');
    await new Promise(resolve => peer.child.stdout.once('data', resolve));
    try {
      await peer.request('info');
      process.exitCode = 1;
    } catch (error) {
      console.log('caught:', error.message);
    } finally {
      await peer.close();
    }
  `;
  // Exercise Node's real pipe-error event in a subprocess, so a regression is
  // observed as a failing exit status rather than taking down the test runner.
  const result = spawnSync('node', ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('caught: broken-input: worker input failed:');
});
