// What this package IS, from the outside.
//
// The package used to be four unrelated products sharing a name: a headless reviewer over
// docxtemplater, a flat tool catalog, an MCP server, and two frameworks' worth of chat UI. None of
// them compiled against the current engine. The object model replaces all of it, so the manifest
// has to say so — an exports map that still advertises `./mcp` is a promise the tarball cannot
// keep, and a `disconnected` exemption in the API gate is a package nobody is checking.
//
// These assertions are about the MANIFEST and the FILE TREE rather than about behaviour, because
// that is exactly the layer that a rewrite leaves behind: the code can be deleted and the package
// can still ship a subpath pointing at a file that no longer builds.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE = join(import.meta.dir, '..', '..');
const REPO = join(PACKAGE, '..', '..');

interface Manifest {
  readonly name: string;
  readonly description: string;
  readonly sideEffects?: unknown;
  readonly main: string;
  readonly module: string;
  readonly types: string;
  readonly exports: Record<string, unknown>;
  readonly typesVersions: Record<string, Record<string, string[]>>;
  readonly files: readonly string[];
  readonly scripts: Record<string, string>;
  readonly keywords: readonly string[];
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, unknown>;
  readonly devDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as Manifest;
const tsup = readFileSync(join(PACKAGE, 'tsup.config.ts'), 'utf8');

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

describe('the published entry points', () => {
  test('the root entry is the server-safe one', () => {
    // Root rather than a `./server` subpath: the lifecycle, the object model and the errors are
    // the package, and they need no browser. A consumer with bytes imports the package name.
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.mjs',
      require: './dist/index.js',
    });
    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.module).toBe('./dist/index.mjs');
    expect(manifest.types).toBe('./dist/index.d.ts');
  });

  test('browser construction is an explicit subpath, so it cannot reach the server bundle', () => {
    expect(manifest.exports['./browser']).toEqual({
      types: './dist/browser.d.ts',
      import: './dist/browser.mjs',
      require: './dist/browser.js',
    });
  });

  test('there are exactly those two code entries', () => {
    const code = Object.keys(manifest.exports).filter((key) => key !== './package.json');
    expect(code.sort()).toEqual(['.', './browser']);
  });

  test('every subpath that served a removed surface is gone, not aliased', () => {
    // Aliasing would be worse than removing: a subpath that still resolves is a subpath a
    // consumer keeps importing, and the thing behind it no longer exists.
    for (const subpath of REMOVED_SUBPATHS) {
      expect(manifest.exports[subpath]).toBeUndefined();
      expect(manifest.typesVersions['*']?.[subpath.replace(/^\.\//, '')]).toBeUndefined();
    }
  });

  test('the browser subpath resolves for consumers on older TypeScript module settings', () => {
    expect(manifest.typesVersions['*']?.browser).toEqual(['./dist/browser.d.ts']);
  });

  test('the package ships dist and its licence, and nothing else', () => {
    expect([...manifest.files].sort()).toEqual(['LICENSE', 'dist']);
  });

  test('nothing in it has a side effect, now that no stylesheet ships', () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

describe('what the package says it is', () => {
  test('the description promises the object model, not an agent chat kit', () => {
    expect(manifest.description).not.toMatch(/MCP|AI SDK|chat UI|bridge/i);
    expect(manifest.description).toMatch(/document/i);
  });

  test('the keywords do not advertise the removed surfaces', () => {
    const forbidden = ['ai', 'agent', 'review', 'track-changes', 'legal', 'contract'];
    expect(manifest.keywords.filter((keyword) => forbidden.includes(keyword))).toEqual([]);
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

  test('no Vue toolchain is left to build SFCs that no longer exist', () => {
    const dev = Object.keys(manifest.devDependencies ?? {});
    for (const name of ['@vitejs/plugin-vue', 'vue', 'vue-tsc', 'vite-plugin-dts', 'ai']) {
      expect(dev).not.toContain(name);
    }
  });
});

describe('how the package is built and checked', () => {
  test('tsup builds exactly the two entries', () => {
    expect(tsup).toContain("index: 'src/index.ts'");
    expect(tsup).toContain("browser: 'src/browser.ts'");
    for (const removed of ['src/server.ts', 'src/react.ts', 'src/mcp/', 'src/ai-sdk/']) {
      expect(tsup).not.toContain(removed);
    }
  });

  test('there is no second Vite pass, because there are no SFCs to compile', () => {
    expect(existsSync(join(PACKAGE, 'vite.config.ts'))).toBe(false);
    expect(manifest.scripts.build).not.toContain('vite');
  });

  test('typecheck really type-checks', () => {
    // It used to `echo` a paragraph explaining why it could not. A script that prints and exits
    // zero is worse than no script: every aggregate `bun run typecheck` reported success.
    expect(manifest.scripts.typecheck).toBe('tsc --noEmit');
    expect(manifest.scripts['typecheck:disabled']).toBeUndefined();
  });

  test('the package participates in the API gate and in a tarball smoke test', () => {
    expect(manifest.scripts['api:check']).toContain('--package @docx-editor.dev/agents');
    expect(manifest.scripts['pack:smoke']).toBe('node scripts/pack-smoke.mjs');
    expect(existsSync(join(PACKAGE, 'scripts', 'pack-smoke.mjs'))).toBe(true);
  });

  test('the API gate no longer exempts this package', () => {
    const table = readFileSync(join(REPO, 'scripts', 'lib', 'packages.mjs'), 'utf8');
    const entry = table.slice(table.indexOf("'@docx-editor.dev/agents'"));
    const end = entry.indexOf('},');
    expect(entry.slice(0, end)).not.toContain('disconnected');
  });

  test('a committed API snapshot exists for both entries, and none for a removed one', () => {
    const reports = readdirSync(join(REPO, 'docs', 'api', 'docx-editor-agents')).sort();
    expect(reports).toEqual(['browser.api.md', 'index.api.md']);
  });
});

describe('the source that is left', () => {
  const legacy = [
    'DocxReviewer.ts',
    'agent-types.ts',
    'batch.ts',
    'changes.ts',
    'comments.ts',
    'content.ts',
    'discovery.ts',
    'errors.ts',
    'reviewerBridge.ts',
    'server.ts',
    'textSearch.ts',
    'types.ts',
    'useAgentChat.ts',
    'useDocxAgentTools.ts',
    'utils.ts',
    'wordCompat.ts',
    'react.ts',
    'vue.ts',
    'mcp',
    'tools',
    'ai-sdk',
    'react',
    'vue',
    'i18n',
  ];

  test('every module that only served a removed surface is deleted', () => {
    const survivors = legacy.filter((name) => existsSync(join(PACKAGE, 'src', name)));
    expect(survivors).toEqual([]);
  });

  test('the package no longer carries its own locale strings', () => {
    // They named an agent panel, a chat composer and an AI action menu. A document automation
    // API has no user-facing strings of its own: everything it returns is the document's.
    expect(existsSync(join(PACKAGE, 'i18n'))).toBe(false);
  });

  test('src holds the two entries and the lanes behind them, and nothing else', () => {
    const entries = readdirSync(join(PACKAGE, 'src'))
      .filter((name) => name !== '__tests__')
      .sort();
    expect(entries).toEqual(['browser.ts', 'index.ts', 'model', 'office-compat', 'runtime']);
    expect(statSync(join(PACKAGE, 'src', 'model')).isDirectory()).toBe(true);
  });
});
