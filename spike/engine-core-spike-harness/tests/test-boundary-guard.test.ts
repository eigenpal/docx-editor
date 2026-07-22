import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const guardedCheckScripts = [
  'scripts/check-consumer-install.mjs',
  'scripts/check-editor-contract.mjs',
  'scripts/check-export-parity.mjs',
  'scripts/check-feature-parity.mjs',
  'scripts/check-parity-contract.mjs',
  'scripts/parity-prepublish.mjs',
];

const guardedPackageTestRoots = [
  'packages/agents/src/__tests__',
  'packages/core/src/__tests__',
  'packages/vue/src/__tests__',
];

const retiredCoreImportMatchers: Array<[RegExp, string]> = [
  [/^@docx-editor\.dev\/core\/api$/, 'retired core runtime entry'],
  [/^@docx-editor\.dev\/core\/(?:headless|agent|prosemirror)(?:\/|$)/, 'retired core subpath'],
  [
    /^@docx-editor\.dev\/core\/(?:painter-model|pagination-model|flow-model)(?:\/|$)/,
    'retired implementation-model subpath',
  ],
  [/^@docx-editor\.dev\/core\/docx\/parser(?:\/|$)/, 'retired parser implementation path'],
  [/^@docx-editor\.dev\/core\/(?:utils|internal|legacy)(?:\/|$)/, 'private implementation path'],
];

const workspaceAliasImportMatchers: Array<[RegExp, string]> = [
  [/^@\//, 'workspace alias import'],
  [/^~\//, 'workspace alias import'],
  [/(?:^|\/)packages\/[^/]+\/(?:src|dist)\//, 'in-repo implementation path import'],
];

const retiredArchitectureSignals: Array<[RegExp, string]> = [
  [/@docx-editor\.dev\/core\/api/, 'retired core runtime entry text'],
  [/\b(?:painter-model|pagination-model|flow-model)\b/, 'retired implementation model name'],
  [/painter:painted/, 'legacy paint debug hook'],
  [/painted-pages-ready/, 'legacy painted-pages debug hook'],
];

const forbiddenPublicSurfaceSignals: Array<[RegExp, string]> = [
  [/\bEditorView\b/, 'EditorView exposure'],
  [/\bgetView\b/, 'getView exposure'],
  [/\bgetEditorView\b/, 'getEditorView exposure'],
  [/\bProseMirror\b/, 'ProseMirror exposure'],
];

const importPatterns = [
  /\bimport(?:\s+type)?\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport(?:\s+type)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
}

function collectImportSpecifiers(text: string): string[] {
  const source = stripComments(text);
  const specifiers = new Set<string>();
  for (const pattern of importPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers].sort();
}

function walkFiles(relativeDir: string): string[] {
  const absoluteDir = join(repoRoot, relativeDir);
  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolute = join(absoluteDir, entry);
    if (statSync(absolute).isDirectory()) {
      return walkFiles(relative(repoRoot, absolute));
    }
    return [relative(repoRoot, absolute)];
  });
}

function firstImportViolation(specifier: string): string | null {
  for (const [pattern, reason] of retiredCoreImportMatchers) {
    if (pattern.test(specifier)) return `${reason}: ${specifier}`;
  }
  for (const [pattern, reason] of workspaceAliasImportMatchers) {
    if (pattern.test(specifier)) return `${reason}: ${specifier}`;
  }
  return null;
}

function architectureViolations(relativePath: string): string[] {
  const text = readFileSync(join(repoRoot, relativePath), 'utf8');
  const violations: string[] = [];
  for (const [pattern, reason] of retiredArchitectureSignals) {
    if (pattern.test(text)) violations.push(`${reason}: ${relativePath}`);
  }
  return violations;
}

describe('surviving test boundary guard', () => {
  test('detects representative retired imports before repo scan runs', () => {
    expect(firstImportViolation('@docx-editor.dev/core/api')).toContain('retired core runtime entry');
    expect(firstImportViolation('@/legacy-core-shim')).toContain('workspace alias import');
    expect(firstImportViolation('@docx-editor.dev/react')).toBeNull();
  });

  test('surviving tests and checks avoid retired core subpaths and workspace aliases', () => {
    const guardedFiles = [
      ...guardedCheckScripts,
      ...guardedPackageTestRoots.flatMap((root) => walkFiles(root)),
    ].filter((file) => file !== 'spike/engine-core-spike-harness/tests/test-boundary-guard.test.ts');

    const violations: string[] = [];
    for (const relativePath of guardedFiles) {
      const specifiers = collectImportSpecifiers(readFileSync(join(repoRoot, relativePath), 'utf8'));
      for (const specifier of specifiers) {
        const violation = firstImportViolation(specifier);
        if (violation) violations.push(`${relativePath}: ${violation}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('consumer declaration check does not re-expose editor-view architecture', () => {
    const relativePath = 'packages/core/src/__tests__/consumer.test-d.ts';
    const text = stripComments(readFileSync(join(repoRoot, relativePath), 'utf8'));
    for (const [pattern, reason] of forbiddenPublicSurfaceSignals) {
      expect(pattern.test(text), `${reason} in ${relativePath}`).toBe(false);
    }
  });

  test('consumer install uses only the public declaration contract for static core typing', () => {
    const relativePath = 'scripts/check-consumer-install.mjs';
    const text = readFileSync(join(repoRoot, relativePath), 'utf8');

    expect(text).not.toMatch(/@docx-editor\.dev\/core\/\*/);
    expect(text).not.toMatch(/packages\/core\/src\/core\.ts/);
    expect(text).not.toMatch(/packages\/core\/src\/\*/);

    const allowedTargets = [
      'packages/core/src/index.ts',
      'packages/core/src/editor.ts',
      'packages/core/src/geometry.ts',
      'packages/core/src/plugin.ts',
      'packages/core/src/mcp.ts',
      'packages/core/src/types-barrel.ts',
    ];

    const mappedTargets = [...text.matchAll(/packages\/core\/src\/[A-Za-z0-9./-]+\.ts/g)].map(
      (match) => match[0]
    );

    expect(new Set(mappedTargets)).toEqual(new Set(allowedTargets));
  });

  test('consumer and parity checks avoid retired architecture strings', () => {
    const violations = guardedCheckScripts.flatMap((relativePath) => architectureViolations(relativePath));
    expect(violations).toEqual([]);
  });
});
