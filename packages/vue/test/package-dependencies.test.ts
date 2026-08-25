import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
};

const core = JSON.parse(
  readFileSync(join(import.meta.dir, '..', '..', 'core', 'package.json'), 'utf8')
) as { version: string };

// A tilde range on the engine's current minor: patch drift is allowed, a different minor is
// not, so an app never pairs this adapter with an engine minor it did not ship with. The floor
// patch may lag within the minor because in-range releases do not rewrite the range.
const requiresSameMinor = (range: string | undefined, version: string) => {
  const match = /^~(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(range ?? '');
  if (!match) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return Number(match[1]) === major && Number(match[2]) === minor && Number(match[3]) <= patch!;
};

describe('how this package asks for the engine', () => {
  test('the engine is a peer', () => {
    expect(
      requiresSameMinor(manifest.peerDependencies?.['@docx-editor.dev/core'], core.version)
    ).toBe(true);
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
  });

  test('the engine peer is required', () => {
    expect(manifest.peerDependenciesMeta?.['@docx-editor.dev/core']?.optional).toBeUndefined();
  });

  test('workspace devDependency pins the engine for build', () => {
    expect(manifest.devDependencies?.['@docx-editor.dev/core']).toBe('workspace:*');
  });

  test('does not install engine implementation dependencies', () => {
    expect(manifest.dependencies?.harfbuzzjs).toBeUndefined();
    expect(manifest.dependencies?.['emf-converter']).toBeUndefined();
  });
});
