import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, '..', 'check-lockfile-workspaces.mjs');

// The layout Bun writes: two-space indents, trailing commas.
const lockfile = (coreVersion: string, i18nRange: string) => `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
    },
    "packages/core": {
      "name": "@docx-editor.dev/core",
      "version": "${coreVersion}",
      "dependencies": {
        "@docx-editor.dev/i18n": "${i18nRange}",
        "fflate": "^0.8.2",
      },
    },
  },
  "packages": {},
}
`;

function workspace(coreDependencies: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'lockfile-workspaces-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root' }));
  mkdirSync(join(dir, 'packages', 'core'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'core', 'package.json'),
    JSON.stringify({
      name: '@docx-editor.dev/core',
      version: '2.22.1',
      dependencies: coreDependencies,
    })
  );
  writeFileSync(join(dir, 'bun.lock'), lockfile('2.22.0', '^2.22.0'));
  return dir;
}
const check = (dir: string, ...args: string[]) =>
  spawnSync('node', [script, ...args], { cwd: dir, encoding: 'utf8' });

test('--fix rewrites the versions and ranges that Bun left behind', () => {
  const dir = workspace({ '@docx-editor.dev/i18n': '^2.22.1', fflate: '^0.8.2' });
  try {
    expect(check(dir).status).toBe(1);
    expect(check(dir, '--fix').status).toBe(0);
    expect(readFileSync(join(dir, 'bun.lock'), 'utf8')).toBe(lockfile('2.22.1', '^2.22.1'));
    expect(check(dir).status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--fix leaves a missing dependency to Bun and still fails', () => {
  const dir = workspace({
    '@docx-editor.dev/i18n': '^2.22.1',
    fflate: '^0.8.2',
    'new-dependency': '^1.0.0',
  });
  try {
    const result = check(dir, '--fix');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('new-dependency is (missing) in the lockfile');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
