// The lane DAG, enforced against the real import statements.
//
// `CORE_LANES` declares which lane may import which (`core-lane-graph.ts`). After the lanes
// moved into `packages/core`, the declaration-level check in `core-lane-graph.test.ts`
// short-circuits for every moved lane, and `check:lane-boundaries` only catches an illegal
// edge incidentally, when the imported lane happens to need a DOM lib. So this walks every
// source file of every lane and asserts each import statement's target lane is one the DAG
// allows.
//
// VALUE imports must obey the DAG, no exceptions. TYPE-ONLY imports (`import type` /
// `export type ... from`) are erased at compile time and cannot move code between
// environments, but they are still coupling — so a cross-lane type edge outside the DAG is
// permitted only when pinned in GRANDFATHERED_TYPE_EDGES below, and the pin RATCHETS: an
// entry that stops matching fails, so the list can only shrink or be consciously edited.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_LANES, type LaneName } from './core-lane-graph';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANES = Object.keys(CORE_LANES) as LaneName[];

/**
 * Type-only cross-lane edges the DAG does not allow, pinned file by file.
 *
 * Adding an entry needs the same justification a DAG edit does: say WHY the type cannot
 * live in a lane both sides may import (usually `contracts` or `store`). The known bulk is
 * the contracts lane describing editor-facing shapes that reference store and layout types
 * — coupling that predates the lane move and is compile-time only.
 */
const GRANDFATHERED_TYPE_EDGES: readonly { readonly file: string; readonly to: LaneName }[] = [
  { file: 'binding/tree-session.ts', to: 'layout' },
  { file: 'contracts/editor.ts', to: 'layout' },
  { file: 'contracts/editor.ts', to: 'store' },
  { file: 'contracts/modules.ts', to: 'layout' },
  { file: 'contracts/modules.ts', to: 'store' },
  { file: 'layout/table-interaction-targets.ts', to: 'contracts' },
  { file: 'store/store/tree-op-types.ts', to: 'contracts' },
];

/**
 * VALUE edges the DAG does not allow, pinned until their code moves lane.
 *
 * These are live coupling, not just compile-time — each one is a debt with a tracked
 * issue, and the pin ratchets exactly like the type list. Today's single entry:
 * `review-patch.ts` calls `reviewItemKey`/`reviewItemPositionRank`, pure helpers over the
 * `ReviewItem` vocabulary that lives in `layout/review-support.ts`; the fix is moving the
 * review vocabulary to a lane binding may import, which is a refactor of its own.
 */
const GRANDFATHERED_VALUE_EDGES: readonly { readonly file: string; readonly to: LaneName }[] = [
  { file: 'binding/review-patch.ts', to: 'layout' },
];

interface ImportEdge {
  readonly file: string; // relative to src/, posix separators
  readonly to: LaneName;
  readonly typeOnly: boolean;
  readonly specifier: string;
}

function laneOfFile(relativePath: string): LaneName | null {
  const first = relativePath.split('/')[0]!;
  return (LANES as string[]).includes(first) ? (first as LaneName) : null;
}

/** The lane a specifier lands in, or null for anything external to the lanes. */
function laneOfSpecifier(specifier: string, fromFile: string): LaneName | null {
  if (specifier.startsWith('.')) {
    const absolute = resolve(join(SRC, dirname(fromFile)), specifier);
    return laneOfFile(relative(SRC, absolute).split(sep).join('/'));
  }
  const CORE = '@docx-editor.dev/core';
  if (specifier !== CORE && !specifier.startsWith(`${CORE}/`)) return null;
  const subpath = specifier === CORE ? '.' : `./${specifier.slice(CORE.length + 1)}`;
  for (const lane of LANES) {
    const declared = CORE_LANES[lane];
    if (declared.subpath === subpath) return lane;
    if (declared.subpathPrefix && subpath.startsWith(declared.subpathPrefix)) return lane;
  }
  return null;
}

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

// One statement at a time, so `import type` classifies the whole statement. A mixed
// `import { value, type T }` counts as a VALUE import, which is the conservative reading.
//
// The clause between the keyword and `from` excludes `;` and quotes rather than being
// length-capped. Both restrictions are load-bearing: a char budget silently DROPPED any
// import whose specifier list outgrew it (a 39-line layout import already had), and a
// clause that could cross a `;` let a from-less `export type X = ...;` statement pair
// with the NEXT statement's `from`, recording a VALUE import as type-only — which would
// let it hide under a pinned type grandfather.
const STATIC_IMPORT =
  /(?:^|\n)[ \t]*(import|export)\s+(type\s+)?([^;'"`]*?)from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]/g;

function edgesOf(file: string): ImportEdge[] {
  const relativePath = relative(SRC, file).split(sep).join('/');
  const ownLane = laneOfFile(relativePath);
  if (!ownLane) return [];
  const source = readFileSync(file, 'utf8');
  const edges: ImportEdge[] = [];
  const record = (specifier: string, typeOnly: boolean) => {
    const target = laneOfSpecifier(specifier, relativePath);
    if (target && target !== ownLane) {
      edges.push({ file: relativePath, to: target, typeOnly, specifier });
    }
  };
  for (const match of source.matchAll(STATIC_IMPORT)) record(match[4]!, match[2] !== undefined);
  for (const match of source.matchAll(BARE_IMPORT)) record(match[1]!, false);
  for (const match of source.matchAll(DYNAMIC_IMPORT)) record(match[1]!, false);
  return edges;
}

const allEdges: ImportEdge[] = [];
for (const lane of LANES) {
  for (const file of sourceFiles(join(SRC, lane))) allEdges.push(...edgesOf(file));
}

describe('every lane import obeys the DAG (core-lane-graph.ts)', () => {
  test('the walk is not vacuous: it sees the editor lane import the others', () => {
    const fromEditor = allEdges.filter((edge) => edge.file.startsWith('editor/'));
    expect(fromEditor.some((edge) => edge.to === 'layout')).toBe(true);
    expect(fromEditor.some((edge) => edge.to === 'store')).toBe(true);
  });

  test('no VALUE import crosses an edge the DAG forbids, beyond the pinned debt', () => {
    const offDag = allEdges.filter((edge) => {
      if (edge.typeOnly) return false;
      const from = laneOfFile(edge.file)!;
      return !CORE_LANES[from].mayImport.includes(edge.to);
    });
    const actual = [...new Set(offDag.map((edge) => `${edge.file} → ${edge.to}`))].sort();
    const pinned = GRANDFATHERED_VALUE_EDGES.map((edge) => `${edge.file} → ${edge.to}`).sort();
    expect(actual).toEqual(pinned);
  });

  test('every off-DAG TYPE edge is pinned, and every pin is still real', () => {
    const offDag = allEdges.filter((edge) => {
      if (!edge.typeOnly) return false;
      const from = laneOfFile(edge.file)!;
      return !CORE_LANES[from].mayImport.includes(edge.to);
    });
    const actual = [...new Set(offDag.map((edge) => `${edge.file} → ${edge.to}`))].sort();
    const pinned = GRANDFATHERED_TYPE_EDGES.map((edge) => `${edge.file} → ${edge.to}`).sort();
    // Exact equality, both directions: a NEW off-DAG type edge fails until pinned with a
    // justification, and a pin whose edge was cleaned up fails until removed — the ratchet.
    expect(actual).toEqual(pinned);
  });
});
