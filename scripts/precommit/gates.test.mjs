import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiPackagesByFreshness } from './gates.mjs';

function write(path, seconds) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
  utimesSync(path, seconds, seconds);
}

test('a package is checked only when its declarations are newer than its sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'precommit-gates-'));
  try {
    // current: built after the last source edit. stale: a source edit after the build.
    // unbuilt: no declarations. Tests and the package's own dist/ never count as sources.
    write(join(root, 'current/src/index.ts'), 100);
    write(join(root, 'current/src/__tests__/late.test.ts'), 500);
    write(join(root, 'current/package.json'), 100);
    write(join(root, 'current/dist/index.d.ts'), 200);
    write(join(root, 'stale/src/deep/index.ts'), 300);
    write(join(root, 'stale/dist/index.d.ts'), 200);
    write(join(root, 'unbuilt/src/index.ts'), 100);
    const packages = [
      { name: 'current', root: 'current' },
      { name: 'stale', root: 'stale' },
      { name: 'unbuilt', root: 'unbuilt' },
      { name: 'skipped', root: 'skipped', disconnected: 'no build' },
    ];
    const { fresh, stale } = apiPackagesByFreshness(packages, root);
    expect(fresh.map((pkg) => pkg.name)).toEqual(['current']);
    expect(stale.map((pkg) => pkg.name)).toEqual(['stale', 'unbuilt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
