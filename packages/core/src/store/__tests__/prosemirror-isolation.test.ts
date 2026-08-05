// ProseMirror isolation guards (tasks 6.5 and 6.6).
//
// `import-graph.test.ts` already forbids a `prosemirror-*` IMPORT in the PM-free packages.
// That is necessary and not sufficient for what these two tasks ask:
//
//   6.5 — no ProseMirror types or view access in store, layout, output, or the PUBLIC HOST
//         CONTRACTS. The contract package is not in `PACKAGE_RULES` at all, so nothing was
//         checking it, and a structurally-typed leak (a parameter shaped like an
//         `EditorView`, a re-exported PM type alias) needs no import to exist.
//   6.6 — save, layout, and semantic history must not READ the ProseMirror document or its
//         history plugin. An import ban does not express that; a reference ban does.
//
// So this scans for the IDENTIFIERS as well, across every lane that must stay PM-free.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existingLanePath, NESTED_LANE_DIRECTORIES, PACKAGES_ROOT } from './lane-paths.ts';

const PACKAGES = PACKAGES_ROOT;
const REPO = join(PACKAGES, '..');

/**
 * Lanes that must never see ProseMirror.
 *
 * `packages/core` is the PUBLIC contract package — the one task 6.5 names and the one the
 * per-package import rules never covered.
 */
const PM_FREE_ROOTS: readonly { readonly label: string; readonly dir: string }[] = [
  { label: 'public host contracts', dir: 'core/src' },
  { label: 'store + save + semantic history', dir: 'core/src/store' },
  { label: 'layout', dir: 'core/src/layout' },
  { label: 'output', dir: 'core/src/output' },
  // The browser editor facade is the composition root the adapters bind to, so it is a
  // public host contract in practice even though it is not the contract package.
  { label: 'editor facade', dir: 'core/src/editor' },
];

/**
 * ProseMirror surface tokens.
 *
 * Deliberately specific. A generic word like `Transaction` or `Selection` would fire on
 * this repo's own vocabulary (`transact`, `SelectionMark`) and a guard that cries wolf gets
 * disabled. Each token below only exists if ProseMirror does.
 */
const PM_TOKENS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bprosemirror-[a-z]/i, why: 'ProseMirror module specifier' },
  { pattern: /\bProseMirror\b/, why: 'ProseMirror identifier' },
  { pattern: /\bEditorView\b/, why: 'ProseMirror view access' },
  { pattern: /\bEditorState\b/, why: 'ProseMirror state access' },
  { pattern: /\bpmViewDesc\b/, why: 'ProseMirror view-desc access' },
  { pattern: /\bundoDepth\b|\bredoDepth\b/, why: 'ProseMirror history plugin' },
  { pattern: /\bdocView\b/, why: 'ProseMirror document view' },
];

function collectSources(root: string, depth = 0): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    // `__tests__` now sits INSIDE a lane's source directory (task 10.2 moved the store
    // lane's tests alongside it). These rules are about lane source, and a guard that
    // scanned its own assertions would flag the strings it looks for.
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (entry === '__tests__' || entry === 'test' || entry === 'tests') continue;
    const full = join(root, entry);
    // Do not cross into a nested lane: `core/src` holds every moved lane as a subdirectory,
    // so without this the contracts lane inherits the others' imports.
    if (depth === 0 && NESTED_LANE_DIRECTORIES.has(entry) && !root.endsWith(`/${entry}`)) continue;
    if (statSync(full).isDirectory()) out.push(...collectSources(full, depth + 1));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Strip comments before scanning.
 *
 * This file's own lanes explain WHY they avoid ProseMirror, and several do so by naming it.
 * Banning the word in prose would push those explanations out of the code, which is worse
 * for the next reader than the leak the guard is looking for.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function violations(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const token of PM_TOKENS) {
    if (token.pattern.test(code)) found.push(token.why);
  }
  return found;
}

describe('ProseMirror stays inside the binding (tasks 6.5, 6.6)', () => {
  for (const root of PM_FREE_ROOTS) {
    test(`${root.label} references no ProseMirror type or view`, () => {
      const offenders: string[] = [];
      for (const file of collectSources(existingLanePath(root.dir))) {
        const found = violations(readFileSync(file, 'utf8'));
        if (found.length > 0) {
          offenders.push(`${relative(REPO, file)}: ${[...new Set(found)].join(', ')}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  test('the save path reads the canonical tree, never a ProseMirror document', () => {
    // Task 6.6, stated as the files that actually produce output bytes.
    // The legacy byte-capsule save path (wml-serialize.ts, docx/write.ts) was deleted with
    // the legacy store; the tree serializer and the package writer are the whole save path.
    const savePath = [
      'core/src/store/package/ooxml-tree.ts',
      'core/src/store/package/ooxml-package.ts',
    ];
    for (const relativePath of savePath) {
      const file = existingLanePath(relativePath);
      if (!existsSync(file)) continue;
      expect({ [relativePath]: violations(readFileSync(file, 'utf8')) }).toEqual({
        [relativePath]: [],
      });
    }
  });

  test('semantic history reads the canonical tree, never the PM history plugin', () => {
    const file = existingLanePath('core/src/store/store/tree-store.ts');
    expect(violations(readFileSync(file, 'utf8'))).toEqual([]);
    // Positive statement of the same fact: entries are canonical parts and revisions.
    const source = readFileSync(file, 'utf8');
    expect(source).toContain('OoxmlPart');
  });

  test('the guard actually detects a leak (it cannot pass by scanning nothing)', () => {
    // A guard that silently matches no files is the failure mode these replace, so prove
    // the detector fires on each token and that the corpus is non-empty.
    expect(violations('const view: EditorView = get();')).toEqual(['ProseMirror view access']);
    expect(violations("import { EditorState } from 'prosemirror-state';").length).toBeGreaterThan(
      0
    );
    expect(violations('if (undoDepth(state) > 0) {}')).toEqual(['ProseMirror history plugin']);
    // ...and that a comment mentioning it is NOT a violation.
    expect(violations('// ProseMirror is deliberately absent here\nconst x = 1;')).toEqual([]);

    let scanned = 0;
    for (const root of PM_FREE_ROOTS) scanned += collectSources(existingLanePath(root.dir)).length;
    expect(scanned).toBeGreaterThan(50);
  });

  test('the binding IS allowed to own ProseMirror, so the guard is not vacuous', () => {
    // If engine-binding were also clean, the whole suite would pass for the wrong reason:
    // ProseMirror having been removed entirely rather than confined.
    const bindingFiles = collectSources(existingLanePath('core/src/binding'));
    const owning = bindingFiles.filter((file) => violations(readFileSync(file, 'utf8')).length > 0);
    expect(owning.length).toBeGreaterThan(0);
  });
});
