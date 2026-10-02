import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { publicPackages, releaseMode } from './release-mode.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(changesets: string[] = [], fixed = ['@scope/core', '@scope/react']) {
  const root = mkdtempSync(join(tmpdir(), 'docx-release-mode-'));
  directories.push(root);
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('packages/core/package.json', { name: '@scope/core', version: '1.2.0' });
  write('packages/react/package.json', { name: '@scope/react', version: '1.2.0' });
  write('packages/internal/package.json', {
    name: '@scope/internal',
    version: '1.2.0',
    private: true,
  });
  write('.changeset/README.md', 'Not a changeset.');
  write('.changeset/config.json', { fixed: [fixed] });
  for (const name of changesets) write(`.changeset/${name}`, '---\n"@scope/core": patch\n---\n');
  return root;
}

const npm =
  (published: string[], failing: string[] = []) =>
  async (name: string, version: string) => {
    if (failing.includes(name)) throw new Error(`Registry request failed: ${name}: ECONNRESET`);
    if (!published.includes(`${name}@${version}`))
      throw new Error(`Registry lookup failed: ${name}@${version}: HTTP 404`);
    return { name, version };
  };

test('lists the public members of the fixed group', () => {
  expect(publicPackages(fixture([], ['@scope/core', '@scope/react', '@scope/internal']))).toEqual([
    { name: '@scope/core', version: '1.2.0' },
    { name: '@scope/react', version: '1.2.0' },
  ]);
});

test('pending changesets update the release PR without asking the registry', async () => {
  const lookup = () => {
    throw new Error('registry must not be called');
  };
  expect(await releaseMode(fixture(['brave-fox.md']), lookup)).toEqual({
    mode: 'pending',
    unpublished: [],
  });
});

test('a fully published version set is idle', async () => {
  const lookup = npm(['@scope/core@1.2.0', '@scope/react@1.2.0']);
  expect(await releaseMode(fixture(), lookup)).toEqual({ mode: 'idle', unpublished: [] });
});

test('one missing version takes the publish path', async () => {
  const lookup = npm(['@scope/core@1.2.0']);
  expect(await releaseMode(fixture(), lookup)).toEqual({
    mode: 'publish',
    unpublished: ['@scope/react@1.2.0'],
  });
});

test('a registry failure takes the publish path, never idle', async () => {
  const lookup = npm(['@scope/core@1.2.0', '@scope/react@1.2.0'], ['@scope/react']);
  expect((await releaseMode(fixture(), lookup)).mode).toBe('publish');
});

test('metadata for a different version is not a publication', async () => {
  const lookup = async (name: string) => ({ name, version: '1.1.0' });
  expect((await releaseMode(fixture(), lookup)).mode).toBe('publish');
});

test('a group member without a manifest fails instead of hiding in the publish path', async () => {
  const root = fixture([], ['@scope/core', '@scope/react', '@scope/new']);
  const lookup = npm(['@scope/core@1.2.0', '@scope/react@1.2.0']);
  expect(releaseMode(root, lookup)).rejects.toThrow(
    'No packages/*/package.json is named @scope/new'
  );
});

test('manifests resolve by package name, not by directory name', () => {
  const root = fixture([], ['@scope/core', '@scope/pdf-tools']);
  mkdirSync(join(root, 'packages/pdf'), { recursive: true });
  writeFileSync(
    join(root, 'packages/pdf/package.json'),
    JSON.stringify({ name: '@scope/pdf-tools', version: '1.2.0' })
  );
  expect(publicPackages(root)).toEqual([
    { name: '@scope/core', version: '1.2.0' },
    { name: '@scope/pdf-tools', version: '1.2.0' },
  ]);
});

test('every lookup shares one bounded deadline', async () => {
  const deadlines: number[] = [];
  const lookup = async (name: string, version: string, options: { deadline: number }) => {
    deadlines.push(options.deadline);
    return { name, version };
  };
  await releaseMode(fixture(), lookup, () => 1000);
  expect(deadlines).toEqual([61_000, 61_000]);
});

test('the repository resolves the published package set', () => {
  const names = publicPackages(join(import.meta.dir, '..')).map(({ name }) => name);
  expect(names).toContain('@docx-editor.dev/core');
  expect(names).toContain('@docx-editor.dev/docx-to-pdf');
  expect(names.every((name) => name.startsWith('@docx-editor.dev/'))).toBe(true);
});
