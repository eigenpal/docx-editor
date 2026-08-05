// One list of published subpaths, written down in four places, with nothing checking they agree.
//
// A subpath has to appear in all four or it breaks differently in each direction:
//   - `package.json` exports        — what a consumer is allowed to import
//   - `tsup.config.ts` entry        — what gets BUILT into dist; missing means the export map
//                                     points at a file that was never emitted
//   - `tsup.config.ts` esbuild alias— how the engine's own `@docx-editor.dev/core/*` imports
//                                     resolve during that build, now that exports point at dist
//   - `tsconfig.json` paths         — the same, for the declaration pass and for every consumer
//                                     that compiles core's sources
//
// tsup.config.ts already carries the comment "keep this in step with `exports` in package.json: a
// subpath with no entry here resolves to a missing file". This is the part that makes it true.
//
// The failure is not hypothetical or slow to surface as a type error: an export map entry with no
// build entry produces a package that installs fine and throws MODULE_NOT_FOUND on import.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import tsupConfig from '../../tsup.config.ts';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const manifest = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};
const tsconfig = JSON.parse(readFileSync(join(CORE, 'tsconfig.json'), 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};

const config = tsupConfig as unknown as {
  entry: Record<string, string>;
  esbuildOptions: (options: { alias?: Record<string, string> }) => void;
};

/** The alias table, read by running the hook the way tsup does. */
function esbuildAlias(): Record<string, string> {
  const options: { alias?: Record<string, string> } = {};
  config.esbuildOptions(options);
  return options.alias ?? {};
}

/** `./contracts/editor` → `contracts/editor`; `.` → `index`. Package-relative, no extension. */
const asEntryKey = (subpath: string): string =>
  subpath === '.' ? 'index' : subpath.replace(/^\.\//, '');

/** `.` → `@docx-editor.dev/core`, `./store` → `@docx-editor.dev/core/store`. */
const asSpecifier = (subpath: string): string =>
  subpath === '.' ? '@docx-editor.dev/core' : `@docx-editor.dev/core${subpath.slice(1)}`;

/**
 * The JS subpaths, which is what the four tables are about.
 *
 * `./styles/editor.css` is a copied asset with no build entry, and `./package.json` is the
 * conventional self-reference; neither is a module and neither belongs in the other three.
 */
const jsSubpaths = Object.keys(manifest.exports).filter(
  (subpath) => subpath !== './package.json' && !subpath.endsWith('.css')
);

describe('the published subpath tables agree', () => {
  test('the guard is not vacuous: there are subpaths to check', () => {
    expect(jsSubpaths.length).toBeGreaterThan(5);
    expect(jsSubpaths).toContain('.');
  });

  test('every exported subpath has a build entry', () => {
    const entries = Object.keys(config.entry);
    const missing = jsSubpaths.filter((subpath) => !entries.includes(asEntryKey(subpath)));
    expect({ missingBuildEntry: missing }).toEqual({ missingBuildEntry: [] });
  });

  test('every build entry is an exported subpath', () => {
    // The other direction: an entry nobody can import is dead weight in every bundle that
    // shares its chunks, and reads as a public surface when it is not one.
    const exported = new Set(jsSubpaths.map(asEntryKey));
    const orphans = Object.keys(config.entry).filter((entry) => !exported.has(entry));
    expect({ unexportedBuildEntry: orphans }).toEqual({ unexportedBuildEntry: [] });
  });

  test('the build alias table and the tsconfig paths name the same specifiers', () => {
    const alias = Object.keys(esbuildAlias()).sort();
    const paths = Object.keys(tsconfig.compilerOptions.paths).sort();
    expect(alias).toEqual(paths);
  });

  test('every exported subpath resolves to source in both self-reference tables', () => {
    // These are what let the engine import ITSELF by package name while `exports` points at a
    // dist that does not exist during the build.
    const alias = esbuildAlias();
    const paths = tsconfig.compilerOptions.paths;
    const missing = jsSubpaths.filter((subpath) => {
      const specifier = asSpecifier(subpath);
      return alias[specifier] === undefined || paths[specifier] === undefined;
    });
    expect({ missingSelfReference: missing }).toEqual({ missingSelfReference: [] });
  });

  test('both self-reference tables point at the same file, and at the build entry', () => {
    const alias = esbuildAlias();
    const paths = tsconfig.compilerOptions.paths;
    const disagreements: string[] = [];
    for (const subpath of jsSubpaths) {
      const specifier = asSpecifier(subpath);
      const aliased = relative(CORE, alias[specifier]!);
      const typed = paths[specifier]![0]!.replace(/^\.\//, '');
      const built = config.entry[asEntryKey(subpath)];
      if (aliased !== typed || aliased !== built) {
        disagreements.push(`${subpath}: alias=${aliased} tsconfig=${typed} entry=${built}`);
      }
    }
    expect({ disagreements }).toEqual({ disagreements: [] });
  });
});
