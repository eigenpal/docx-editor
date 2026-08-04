// How this slice ships.
//
// Additive: a new `@docx-editor.dev/agents/runtime` subpath next to the package's existing entries,
// none of which move. The package around it is mid-rebuild and its cutover is a later slice — a
// consumer adopting the runtime should not have to wait for that, and an existing consumer should
// not notice it happened.
//
// The one packaging mistake worth a test of its own: `@docx-editor.dev/core-contract` is PRIVATE
// and never published. If the build left it external, the published entry would resolve an import
// that does not exist on npm — a package that installs and then fails at the first import.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE = join(import.meta.dir, '..', '..', '..');

interface Manifest {
  readonly exports: Record<string, { types: string; import: string; require: string }>;
  readonly typesVersions: Record<string, Record<string, string[]>>;
  readonly files: readonly string[];
  readonly dependencies: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as Manifest;
const tsup = readFileSync(join(PACKAGE, 'tsup.config.ts'), 'utf8');

describe('the runtime subpath', () => {
  test('is exported, with types, ESM and CJS', () => {
    expect(manifest.exports['./runtime']).toEqual({
      types: './dist/runtime.d.ts',
      import: './dist/runtime.mjs',
      require: './dist/runtime.js',
    });
  });

  test('has an editor-bound sibling, so the neutral entry stays neutral', () => {
    // `createBrowser` reaches the editor lane, which brings the painted engine and its font shaper.
    // Exporting it from `./runtime` would charge every server consumer for that.
    expect(manifest.exports['./runtime/browser']).toEqual({
      types: './dist/runtime/browser.d.ts',
      import: './dist/runtime/browser.mjs',
      require: './dist/runtime/browser.js',
    });
  });

  test('resolves for consumers on older TypeScript module settings', () => {
    // Every other subpath in this package carries a `typesVersions` fallback. A new one that
    // skipped it would type-check for the maintainers and resolve to `any` for a consumer on
    // `moduleResolution: node`.
    expect(manifest.typesVersions['*']?.runtime).toEqual(['./dist/runtime.d.ts']);
    expect(manifest.typesVersions['*']?.['runtime/browser']).toEqual([
      './dist/runtime/browser.d.ts',
    ]);
  });

  test('both entries are built, from the modules that own their namespaces', () => {
    expect(tsup).toContain("runtime: 'src/runtime/index.ts'");
    expect(tsup).toContain("'runtime/browser': 'src/runtime/browser-entry.ts'");
  });

  test('the font shaper stays external, because it cannot be bundled into CJS', () => {
    // harfbuzzjs initializes its wasm with a top-level await. Bundled, the CJS output of this
    // package does not build at all — which is how this was found rather than guessed.
    expect(tsup).toMatch(/external:[\s\S]{0,400}harfbuzzjs/);
    expect(manifest.dependencies.harfbuzzjs).toBe('1.4.0');
  });

  test('bundles the private contract package instead of importing it', () => {
    expect(tsup).toMatch(/noExternal:[\s\S]{0,200}core-contract/);
  });

  test('ships in the published files, because dist already does', () => {
    expect(manifest.files).toContain('dist');
  });
});

describe('what this slice does not touch', () => {
  test('every entry the package already had is still exported, unmoved', () => {
    for (const [subpath, target] of Object.entries({
      '.': './dist/index.mjs',
      './server': './dist/server.mjs',
      './react': './dist/react.mjs',
      './vue': './dist/vue.mjs',
      './mcp': './dist/mcp.mjs',
      './ai-sdk/server': './dist/ai-sdk/server.mjs',
      './ai-sdk/react': './dist/ai-sdk/react.mjs',
      './ai-sdk/vue': './dist/ai-sdk/vue.mjs',
    })) {
      expect(manifest.exports[subpath]?.import).toBe(target);
    }
  });

  test('the runtime is a subpath, not a replacement for the package root', () => {
    // Taking over `.` is the cutover slice's decision, and it removes things. Not here.
    expect(manifest.exports['.']?.import).toBe('./dist/index.mjs');
  });
});
