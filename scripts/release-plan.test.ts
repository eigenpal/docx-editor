import { afterEach, expect, test } from 'bun:test';
import { getReleasePlan } from '@changesets/get-release-plan';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(import.meta.dir, '..');
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test('releases public packages without versioning private workspaces', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'docx-release-plan-'));
  directories.push(directory);
  const write = (path: string, value: unknown) => {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify(value));
  };
  const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const config = read('.changeset/config.json');
  write('.changeset/config.json', config);
  // Workspace discovery uses the lockfile to identify Bun projects.
  write('bun.lock', {});
  write('package.json', {
    name: 'release-plan-fixture',
    private: true,
    workspaces: ['packages/*', 'examples/*'],
  });

  const publicPackages: string[] = [];
  const privateManifests: { path: string; version?: string }[] = [];
  for (const parent of ['packages', 'examples']) {
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(parent, entry.name, 'package.json');
      // Some example directories contain standalone files rather than an application.
      if (!existsSync(join(root, path))) continue;
      const manifest = read(path);
      if (parent === 'examples') expect(manifest.private).toBe(true);
      if (!manifest.private) publicPackages.push(manifest.name);
      else privateManifests.push({ path, version: manifest.version });
      write(path, manifest);
    }
  }

  expect(config.fixed.flat().sort()).toEqual(publicPackages.sort());
  expect(config.privatePackages.tag).toBe(false);
  writeFileSync(
    join(directory, '.changeset', 'public-core-fix.md'),
    '---\n"@docx-editor.dev/core": patch\n---\nFix document layout.\n'
  );
  const plan = await getReleasePlan(directory);
  const versioned = plan.releases.filter((release) => release.type !== 'none');
  expect(versioned.map((release) => release.name).sort()).toEqual(publicPackages);
  expect(versioned.every((release) => release.type === 'patch')).toBe(true);
  for (const release of plan.releases.filter((release) => release.type === 'none')) {
    expect(release.newVersion).toBe(release.oldVersion);
  }

  execFileSync(
    process.execPath,
    [fileURLToPath(import.meta.resolve('@changesets/cli/bin.js')), 'version'],
    {
      cwd: directory,
      timeout: 30_000,
      stdio: 'pipe',
    }
  );
  for (const { path, version } of privateManifests) {
    const manifest = JSON.parse(readFileSync(join(directory, path), 'utf8'));
    expect(manifest.version).toBe(version);
    expect(existsSync(join(directory, dirname(path), 'CHANGELOG.md'))).toBe(false);
  }
  // Nuxt follows the local Vue package without a versioned range that can drift
  // when Changesets updates dependencies but leaves private package versions alone.
  const nuxt = JSON.parse(readFileSync(join(directory, 'packages/nuxt/package.json'), 'utf8'));
  expect(nuxt.dependencies['@docx-editor.dev/vue']).toBe('workspace:*');
});
