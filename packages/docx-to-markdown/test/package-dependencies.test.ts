import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
};

describe('engine dependency integrity', () => {
  test('requires one consumer-owned core instance', () => {
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toMatch(/^~\d+\.\d+\.\d+$/);
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
    expect(manifest.peerDependenciesMeta?.['@docx-editor.dev/core']?.optional).toBeUndefined();
    expect(manifest.devDependencies?.['@docx-editor.dev/core']).toBe('workspace:*');
  });
});
