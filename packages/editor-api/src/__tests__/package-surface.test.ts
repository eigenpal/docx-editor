/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What this package IS, from the outside.
//
// The package used to be four unrelated products sharing a name: a headless reviewer over
// docxtemplater, a flat tool catalog, an MCP server, and two frameworks' worth of chat UI. None of
// them compiled against the current engine. The object model replaces all of it, so the manifest
// has to say so — an exports map that still advertises `./mcp` is a promise the tarball cannot
// keep, and a `disconnected` exemption in the API gate is a package nobody is checking.
//
// These assertions retain the release and dependency boundaries that production behavior cannot
// cover: removed subpaths, install-time dependencies, and participation in repository gates.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const PACKAGE = join(import.meta.dir, '..', '..');
const REPO = join(PACKAGE, '..', '..');

/** The name this package published under before the rename. There is no alias for it. */
const LEGACY_NAME = '@docx-editor.dev/agents';

interface Manifest {
  readonly name: string;
  readonly license: string;
  readonly files: readonly string[];
  readonly exports: Record<string, unknown>;
  readonly typesVersions: Record<string, Record<string, string[]>>;
  readonly scripts: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, unknown>;
  readonly devDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as Manifest;

/** Every subpath the legacy package published, and the one intermediate subpath the rebuild used. */
const REMOVED_SUBPATHS = [
  './server',
  './runtime',
  './runtime/browser',
  './react',
  './vue',
  './mcp',
  './ai-sdk/server',
  './ai-sdk/react',
  './ai-sdk/vue',
  './bridge',
];

describe('the name the package used to have', () => {
  // A hard rename, so the old name must be absent everywhere the tooling still looks — not
  // present as a second workspace, a leftover API snapshot, or an alias in the API gate table.
  test('the package publishes under the new name only', () => {
    expect(manifest.name).toBe('@docx-editor.dev/editor-api');
  });

  test('the old package directory is gone from the tree and the workspaces', () => {
    expect(existsSync(join(REPO, 'packages', 'agents'))).toBe(false);
    const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      workspaces: string[];
    };
    expect(root.workspaces).not.toContain('packages/agents');
  });

  test('nothing in the API gate or its snapshots still carries the old name or slug', () => {
    expect(existsSync(join(REPO, 'docs', 'api', 'docx-editor-agents'))).toBe(false);
    expect(readFileSync(join(REPO, 'scripts', 'lib', 'packages.mjs'), 'utf8')).not.toContain(
      LEGACY_NAME
    );
  });
});

describe('the published entry points', () => {
  test('every subpath that served a removed surface is gone, not aliased', () => {
    // Aliasing would be worse than removing: a subpath that still resolves is a subpath a
    // consumer keeps importing, and the thing behind it no longer exists.
    for (const subpath of REMOVED_SUBPATHS) {
      expect(manifest.exports[subpath]).toBeUndefined();
      expect(manifest.typesVersions['*']?.[subpath.replace(/^\.\//, '')]).toBeUndefined();
    }
  });
});

describe('what the package depends on', () => {
  test('no framework, AI or second document toolkit, at any dependency kind', () => {
    const declared = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    });
    const forbidden = [
      'react',
      'react-dom',
      'vue',
      '@ai-sdk/vue',
      'ai',
      'docxtemplater',
      'jszip',
      'pizzip',
      'xml-js',
      // The published engine, as opposed to the private contract package the build inlines.
      // Nothing here imports it, and declaring it would make the tarball install a second engine.
      '@docx-editor.dev/core',
      // The compatible subset is authored here and checked against a reference fixture offline.
      // A Microsoft package in any dependency kind would make the claim a dependency instead.
      'office-js',
      '@types/office-js',
      '@types/office-js-preview',
      '@microsoft/office-js',
      '@microsoft/office-js-helpers',
    ];
    expect(declared.filter((name) => forbidden.includes(name))).toEqual([]);
  });

  test('there are no peer dependencies left to be optional about', () => {
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.peerDependenciesMeta).toBeUndefined();
  });

  test('there are no runtime dependencies at all', () => {
    // Both entries bundle the private contract package and everything under it, and nothing
    // survives into either output as a bare import, so a consumer installs nothing beyond this
    // tarball. `harfbuzzjs` is listed as external in the tsup config, but only so the build can
    // skip RESOLVING the shaper the layout pass loads dynamically — the emitted bundles do not
    // mention it, which `scripts/pack-smoke.mjs` asserts against the tarball itself. A dependency
    // declared here that no output imports would be install weight for nothing.
    expect(manifest.dependencies).toBeUndefined();
  });

  test('the private contract package is a dev dependency, because the build inlines it', () => {
    expect(manifest.devDependencies?.['@docx-editor.dev/core-contract']).toBe('workspace:*');
    expect(manifest.dependencies?.['@docx-editor.dev/core-contract']).toBeUndefined();
  });
});

describe('how the package is built and checked', () => {
  test('typecheck really type-checks', () => {
    // It used to `echo` a paragraph explaining why it could not. A script that prints and exits
    // zero is worse than no script: every aggregate `bun run typecheck` reported success.
    expect(manifest.scripts.typecheck).toBe('tsc --noEmit');
    expect(manifest.scripts['typecheck:disabled']).toBeUndefined();
  });

  test('the package participates in the API gate', () => {
    expect(manifest.scripts['api:check']).toContain('--package @docx-editor.dev/editor-api');
  });

  test('the API gate no longer exempts this package', () => {
    const table = readFileSync(join(REPO, 'scripts', 'lib', 'packages.mjs'), 'utf8');
    const entry = table.slice(table.indexOf("'@docx-editor.dev/editor-api'"));
    const end = entry.indexOf('},');
    expect(entry.slice(0, end)).not.toContain('disconnected');
  });

  test('a committed API snapshot exists for both entries, and none for a removed one', () => {
    const reports = readdirSync(join(REPO, 'docs', 'api', 'docx-editor-editor-api')).sort();
    expect(reports).toEqual(['browser.api.md', 'index.api.md']);
  });
});

describe('the licence this package ships under', () => {
  test('the manifest names the evaluation licence and the tarball carries its text', () => {
    // The rest of the repository is Apache 2.0. This package is not, so the manifest and the
    // shipped file have to say the same thing: an SPDX id a consumer's audit tool reads, and the
    // text it points at. Shipping `LICENSE` here would ship the terms this package left behind.
    expect(manifest.license).toBe('LicenseRef-EigenPal-Pro-Evaluation-1.0');
    expect(manifest.files).toContain('LICENSE.md');
    expect(manifest.files).not.toContain('LICENSE');
    expect(existsSync(join(PACKAGE, 'LICENSE.md'))).toBe(true);
    expect(existsSync(join(PACKAGE, 'LICENSE'))).toBe(false);
  });

  test('the licence covers this directory, not the one its text was copied from', () => {
    const text = readFileSync(join(PACKAGE, 'LICENSE.md'), 'utf8');
    expect(text).toContain('“packages/editor-api/” directory');
    expect(text).not.toContain('packages/pro/');
  });

  test('the repository Apache licence expressly excludes this package', () => {
    const text = readFileSync(join(REPO, 'LICENSE'), 'utf8');
    expect(text).toContain(
      'The contents of packages/editor-api/ are not licensed under the Apache License.'
    );
    expect(text).toContain('packages/editor-api/LICENSE.md');
  });

  test('every source file carries the header, and this is the check CI runs', () => {
    // `license:check` is reached through `check:parity`, which is a pre-commit hook rather than a
    // CI job, so on its own it is a gate that only fires on the machine that already knows. CI
    // runs `bun test`.
    const header = readFileSync(join(PACKAGE, 'license-header.txt'), 'utf8').trim();
    const banner = `/*\n${header}\n*/\n`;
    const unlicensed = sourceFiles(join(PACKAGE, 'src'))
      .filter((file) => !readFileSync(file, 'utf8').startsWith(banner))
      .map((file) => relative(PACKAGE, file));
    expect(unlicensed).toEqual([]);
  });
});

/** Every `.ts`/`.tsx` file under `directory`, which is exactly the header tool's scope. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(absolute));
    else if (/\.tsx?$/.test(entry.name)) found.push(absolute);
  }
  return found;
}
