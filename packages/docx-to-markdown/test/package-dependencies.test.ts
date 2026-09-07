import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
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
) as { fixed?: string[][]; ignore?: string[]; updateInternalDependencies?: string };
const coreManifest = JSON.parse(
  readFileSync(join(repositoryRoot, 'packages', 'core', 'package.json'), 'utf8')
) as { version: string };
const fontsManifest = JSON.parse(
  readFileSync(join(repositoryRoot, 'packages', 'fonts', 'package.json'), 'utf8')
) as { version: string };

// Patch releases within the engine minor are compatible. The declared floor may lag behind the
// workspace version because publishing an in-range patch does not need to rewrite every peer.
const requiresSameMinor = (range: string | undefined, version: string): boolean => {
  const rangeMatch = /^~(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(range ?? '');
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (!rangeMatch || !versionMatch) return false;
  return (
    Number(rangeMatch[1]) === Number(versionMatch[1]) &&
    Number(rangeMatch[2]) === Number(versionMatch[2]) &&
    Number(rangeMatch[3]) <= Number(versionMatch[3])
  );
};

describe('engine dependency integrity', () => {
  test('requires one consumer-owned core instance', () => {
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toMatch(/^~\d+\.\d+\.\d+$/);
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
    expect(manifest.peerDependenciesMeta?.['@docx-editor.dev/core']?.optional).toBeUndefined();
    expect(manifest.devDependencies?.['@docx-editor.dev/core']).toBe('workspace:*');
  });

  test('stays private and outside releases with compatible engine dependencies', () => {
    const packageName = '@docx-editor.dev/docx-to-markdown';
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig).toBeUndefined();
    expect(changesetConfig.fixed?.flat()).not.toContain(packageName);
    expect(changesetConfig.ignore).toContain(packageName);
    expect(changesetConfig.updateInternalDependencies).toBe('patch');
    expect(
      requiresSameMinor(manifest.peerDependencies?.['@docx-editor.dev/core'], coreManifest.version)
    ).toBe(true);
    expect(manifest.dependencies?.['@docx-editor.dev/fonts']).toBe(`~${fontsManifest.version}`);
  });

  test('accepts only compatible tilde floors from the current engine minor', () => {
    expect(requiresSameMinor('~2.13.0', '2.13.0')).toBe(true);
    expect(requiresSameMinor('~2.13.0', '2.13.7')).toBe(true);
    expect(requiresSameMinor('~2.13.0-beta.1', '2.13.2')).toBe(true);

    expect(requiresSameMinor('~2.13.8', '2.13.7')).toBe(false);
    expect(requiresSameMinor('~2.12.9', '2.13.0')).toBe(false);
    expect(requiresSameMinor('~3.13.0', '2.13.0')).toBe(false);
    expect(requiresSameMinor('^2.13.0', '2.13.0')).toBe(false);
    expect(requiresSameMinor('2.13.0', '2.13.0')).toBe(false);
    expect(requiresSameMinor(undefined, '2.13.0')).toBe(false);
  });

  test('owns the Markdown API and has a public guide', () => {
    const coreExportSource = readFileSync(
      join(repositoryRoot, 'packages', 'core', 'src', 'export', 'index.ts'),
      'utf8'
    );
    expect(coreExportSource).not.toMatch(/Markdown|\.\/markdown/);
    expect(existsSync(join(repositoryRoot, 'packages/core/src/export/markdown.ts'))).toBe(false);
    expect(existsSync(join(repositoryRoot, 'docs/site/content/export/markdown.mdx'))).toBe(true);
    expect(
      readFileSync(join(repositoryRoot, 'docs', 'site', 'content', 'meta.json'), 'utf8')
    ).toContain('export/markdown');
  });

  test('confines packaged fonts through the fonts package asset-root contract', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf8');
    const fontsIndex = readFileSync(
      join(repositoryRoot, 'packages', 'fonts', 'src', 'index.ts'),
      'utf8'
    );
    expect(manifest.dependencies?.['@docx-editor.dev/fonts']).toBe(`~${fontsManifest.version}`);
    expect(source).toContain('FONT_ASSET_ROOT');
    expect(source).toContain("from '@docx-editor.dev/fonts'");
    expect(source).not.toContain('../../fonts/assets/');
    expect(fontsIndex).toContain('export const FONT_ASSET_ROOT');
    expect(fontsIndex).not.toMatch(/docx-to-markdown|docx-to-pdf/);
  });

  test('documents the embedded-font parity boundary', () => {
    const readme = readFileSync(join(import.meta.dir, '..', 'docs', 'api.md'), 'utf8');
    expect(readme).toContain('Document-embedded fonts are admitted after explicit origins');
    expect(readme).toContain('same mapper as the browser editor');
    expect(readme).toContain('host-owned');
  });
});
