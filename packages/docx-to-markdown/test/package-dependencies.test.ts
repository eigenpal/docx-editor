import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = join(import.meta.dir, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as {
  private?: boolean;
  publishConfig?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
};
const changesetConfig = JSON.parse(
  readFileSync(join(repositoryRoot, '.changeset', 'config.json'), 'utf8')
) as { fixed?: string[][]; ignore?: string[] };

describe('engine dependency integrity', () => {
  test('requires one consumer-owned core instance', () => {
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toMatch(/^~\d+\.\d+\.\d+$/);
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
    expect(manifest.peerDependenciesMeta?.['@docx-editor.dev/core']?.optional).toBeUndefined();
    expect(manifest.devDependencies?.['@docx-editor.dev/core']).toBe('workspace:*');
  });

  test('stays private and outside release automation until the explicit release step', () => {
    const packageName = '@docx-editor.dev/docx-to-markdown';
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig).toBeUndefined();
    expect(changesetConfig.fixed?.flat()).not.toContain(packageName);
    expect(changesetConfig.ignore).toContain(packageName);

    const pendingChangesets = readdirSync(join(repositoryRoot, '.changeset')).filter((entry) =>
      entry.endsWith('.md')
    );
    for (const changeset of pendingChangesets) {
      expect(readFileSync(join(repositoryRoot, '.changeset', changeset), 'utf8')).not.toContain(
        `'${packageName}':`
      );
    }
  });
});
