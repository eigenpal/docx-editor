// Build a symbol → { path, line } index by scanning a package's `src/`
// for top-level `export` declarations. Used by the docs-json transformer
// to attach GitHub source links to each public symbol.
//
// Why regex instead of the TypeScript compiler API:
// - 30-50ms per package vs 500-1500ms for ts.createProgram.
// - The shapes we care about are unambiguous at the source level:
//     export function foo(...)
//     export interface Foo {...}
//     export class Foo extends ...
//     export type Foo = ...
//     export enum Foo {...}
//     export const foo = ...
//     export { Bar } from './Bar'           // re-export by name
//     export { default as Foo } from './Foo.vue'   // Vue SFC default
// - The compiler API gives more accurate type info but we don't need it;
//   the doc-model JSON already has types. We only need *location*.

import fs from 'node:fs';
import path from 'node:path';

const SRC_FILE = /\.(ts|tsx|vue)$/;
const IGNORE_DIRS = new Set(['node_modules', 'dist', '__tests__', 'temp']);

// Top-level declaration with name capture. Anchored at start-of-line so
// it doesn't match `export` inside function bodies. Optional modifiers
// covered: declare, default, async, abstract.  `const enum` is handled
// because `const` matches first and `enum` is captured as the name —
// callers that need to distinguish should look at the surrounding line.
const DECL_RX =
  /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|interface|class|type|enum|const|let|var)\s+(\w+)/;

// `export { Foo, Bar as Baz } from './Foo'` — name re-exports. Source line
// for the re-export points at the barrel line (good enough; the docs site
// can choose to chase the import path if it wants the original).
const REEXPORT_RX = /^export\s*\{([^}]+)\}\s*(?:from\s+['"]([^'"]+)['"])?/;

// `export { default as X } from './X.vue'` — Vue SFC default re-export.
// The original isn't a parseable source line in a .vue file (the
// component is the default export of the SFC), so we link to the .vue
// file itself at line 1.
const VUE_DEFAULT_REEXPORT_RX =
  /^export\s*\{\s*default\s+as\s+(\w+)\s*\}\s*from\s+['"]([^'"]+\.vue)['"]/;

function walkDir(dir, fn) {
  // Sort by name so symbol-collision resolution (first-walked wins) is
  // deterministic across machines. macOS and Linux ext4 disagree on raw
  // readdir order, which would otherwise make `docs/json/**` drift in CI.
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, fn);
    else if (entry.isFile() && SRC_FILE.test(entry.name)) fn(full);
  }
}

/**
 * @param {{ packageRoot: string, repoRoot: string }} options
 * @returns {Map<string, { path: string, line: number }>}
 */
export function buildSourceIndex(options) {
  const { packageRoot, repoRoot } = options;
  const srcRoot = path.join(packageRoot, 'src');
  if (!fs.existsSync(srcRoot)) return new Map();

  const index = new Map();
  const add = (name, filePath, line) => {
    if (!index.has(name)) {
      index.set(name, {
        path: path.relative(repoRoot, filePath),
        line,
      });
    }
  };

  walkDir(srcRoot, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip `.vue` files for direct declarations (the regexes don't make
      // sense inside <template> / <script setup>). Re-exports of .vue
      // files are handled at the barrel level below.
      if (filePath.endsWith('.vue')) continue;

      const direct = DECL_RX.exec(line);
      if (direct) {
        add(direct[1], filePath, i + 1);
        continue;
      }
      const vueDefault = VUE_DEFAULT_REEXPORT_RX.exec(line);
      if (vueDefault) {
        const [, name, vueRel] = vueDefault;
        const vuePath = path.resolve(path.dirname(filePath), vueRel);
        if (fs.existsSync(vuePath)) {
          add(name, vuePath, 1);
        } else {
          add(name, filePath, i + 1);
        }
        continue;
      }
      const reexport = REEXPORT_RX.exec(line);
      if (reexport) {
        const names = reexport[1].split(',').map((s) => {
          const m = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(s);
          return m ? m[2] || m[1] : null;
        }).filter(Boolean);
        for (const name of names) add(name, filePath, i + 1);
      }
    }
  });

  return index;
}
