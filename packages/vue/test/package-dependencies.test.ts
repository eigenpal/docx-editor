import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
};

describe('how this package asks for the engine', () => {
  test('the engine is a peer', () => {
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toBe('^2.6.0');
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
