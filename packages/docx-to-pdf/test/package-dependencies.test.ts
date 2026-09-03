/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repositoryRoot = join(import.meta.dir, '..', '..', '..');
const packageRoot = join(import.meta.dir, '..');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  private?: boolean;
  license?: string;
  files?: readonly string[];
  publishConfig?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const changesetConfig = JSON.parse(
  readFileSync(join(repositoryRoot, '.changeset', 'config.json'), 'utf8')
) as { fixed?: string[][]; ignore?: string[]; updateInternalDependencies?: string };
const coreManifest = JSON.parse(
  readFileSync(join(repositoryRoot, 'packages', 'core', 'package.json'), 'utf8')
) as { version: string; peerDependencies?: Record<string, string> };
const fontsManifest = JSON.parse(
  readFileSync(join(repositoryRoot, 'packages', 'fonts', 'package.json'), 'utf8')
) as { version: string };

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

  test('stays private and outside release automation until the explicit release step', () => {
    const packageName = '@docx-editor.dev/docx-to-pdf';
    const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8');
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig).toBeUndefined();
    expect(changesetConfig.fixed?.flat()).not.toContain(packageName);
    expect(changesetConfig.updateInternalDependencies).toBe('patch');
    expect(
      requiresSameMinor(manifest.peerDependencies?.['@docx-editor.dev/core'], coreManifest.version)
    ).toBe(true);
    expect(manifest.dependencies?.['@docx-editor.dev/fonts']).toBe(`~${fontsManifest.version}`);

    const pendingChangesets = readdirSync(join(repositoryRoot, '.changeset')).filter((entry) =>
      entry.endsWith('.md')
    );
    for (const changeset of pendingChangesets) {
      expect(readFileSync(join(repositoryRoot, '.changeset', changeset), 'utf8')).not.toContain(
        `'${packageName}':`
      );
      expect(readFileSync(join(repositoryRoot, '.changeset', changeset), 'utf8')).not.toContain(
        `"${packageName}":`
      );
    }
    expect(readme).toMatch(
      /replace this private banner and workspace demo quick start with public\s+installation and usage instructions/
    );
  });

  test('owns the PDF paint contract without exposing it from core', () => {
    const coreExportSource = readFileSync(
      join(repositoryRoot, 'packages', 'core', 'src', 'export', 'index.ts'),
      'utf8'
    );
    expect(coreExportSource).not.toMatch(/PdfPaint|docx-to-pdf|\.\/pdf/);
    expect(existsSync(join(repositoryRoot, 'packages/core/src/export/pdf.ts'))).toBe(false);
  });

  test('does not leave the unused pdf-lib optional peer on core', () => {
    expect(coreManifest.peerDependencies?.['pdf-lib']).toBeUndefined();
  });

  test('declares pdfkit as a runtime dependency and keeps it out of the public barrel', () => {
    expect(manifest.dependencies?.pdfkit).toMatch(/^\^0\.20\./);
    const indexSource = readFileSync(join(packageRoot, 'src', 'index.ts'), 'utf8');
    expect(indexSource).toContain('HARD_MAX_FIDELITY_DIAGNOSTICS');
    expect(indexSource).toContain('HARD_MAX_OUTPUT_BYTES');
    expect(indexSource).toContain('HARD_MAX_PAINT_COMMANDS');
    expect(indexSource).toContain('HARD_MAX_PDF_PAGES');
    expect(indexSource).toContain('PdfPaintValidationError');
    expect(indexSource).not.toContain('pdfBeginPage');
    expect(indexSource).not.toContain('createPdfPaintPlan');
    expect(indexSource).not.toContain('planPdfPaintFromLayout');
    expect(indexSource).not.toContain('writePdfPaintPlanToBytes');
    expect(indexSource).not.toContain('PdfKitPaintWriter');
  });
});

describe('EigenPal Pro License wiring', () => {
  test('names the evaluation licence and ships LICENSE.md instead of Apache LICENSE', () => {
    expect(manifest.license).toBe('LicenseRef-EigenPal-Pro-Evaluation-1.0');
    expect(manifest.files).toContain('LICENSE.md');
    expect(manifest.files).not.toContain('LICENSE');
    expect(existsSync(join(packageRoot, 'LICENSE.md'))).toBe(true);
    expect(existsSync(join(packageRoot, 'LICENSE'))).toBe(false);
  });

  test('covers this directory in LICENSE.md and exposes header-check scripts', () => {
    const text = readFileSync(join(packageRoot, 'LICENSE.md'), 'utf8');
    expect(text).toContain('“packages/docx-to-pdf/” directory');
    expect(manifest.scripts?.['license:check']).toContain('license-check.json');
    expect(manifest.scripts?.['license:add']).toContain('license-check.json');
  });

  test('is excluded from the repository Apache licence notice', () => {
    const text = readFileSync(join(repositoryRoot, 'LICENSE'), 'utf8');
    expect(text).toContain('packages/docx-to-pdf/LICENSE.md');
  });

  test('carries the Pro license header on every src file', () => {
    const header = readFileSync(join(packageRoot, 'license-header.txt'), 'utf8').trim();
    const banner = `/*\n${header}\n*/\n`;
    const unlicensed = sourceFiles(join(packageRoot, 'src'))
      .filter((file) => !readFileSync(file, 'utf8').startsWith(banner))
      .map((file) => relative(packageRoot, file));
    expect(unlicensed).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
  }
  return found;
}
