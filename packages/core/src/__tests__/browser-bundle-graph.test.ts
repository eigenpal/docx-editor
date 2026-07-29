// What a browser import actually pulls in (task 10.1).
//
// The lane DAG says the editor lane may not import the server lane. That is a rule about
// DECLARED dependencies, and a bundler does not read it — it follows `import` statements,
// through re-export barrels, into whatever they reach. A single `export *` in a barrel is
// enough to put a transport stack and a Yjs document in every consumer's bundle while every
// package.json still looks correct.
//
// So this walks the real import graph from the browser entry points and asserts what it can
// reach. It resolves relative imports within a package and package imports across the
// workspace, which is what a bundler does; it stops at third-party names and records them,
// which is enough to catch the dependencies that matter here.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_FORBIDDEN_DEPENDENCIES, CORE_LANES, type LaneName } from './core-lane-graph';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Workspace package name to its source root. */
const WORKSPACE: ReadonlyMap<string, string> = new Map(
  (Object.keys(CORE_LANES) as LaneName[])
    .map((lane) => {
      const name = CORE_LANES[lane].package;
      if (!name) return null;
      const directory = name.replace('@docx-editor.dev/', '');
      return [name, join(PACKAGES, directory === 'core-contract' ? 'core' : directory)] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null)
);

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g;

/** Every specifier a file imports or re-exports from. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

function resolveFile(candidate: string): string | null {
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const path = `${candidate}${suffix}`;
    if (existsSync(path) && !path.endsWith('/')) {
      try {
        if (readFileSync(path).length >= 0) return path;
      } catch {
        // A directory: fall through to the index candidates.
      }
    }
  }
  return null;
}

interface Reach {
  /** Workspace packages reached, by name. */
  readonly packages: Set<string>;
  /** Third-party specifiers reached. */
  readonly external: Set<string>;
}

/** Walk the import graph from an entry file. */
function reachFrom(entry: string): Reach {
  const packages = new Set<string>();
  const external = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveFile(resolve(dirname(file), specifier.replace(/\.ts$/, '')));
        if (resolved) queue.push(resolved);
        continue;
      }
      const workspace = [...WORKSPACE.keys()].find(
        (name) => specifier === name || specifier.startsWith(`${name}/`)
      );
      if (workspace) {
        packages.add(workspace);
        const root = WORKSPACE.get(workspace)!;
        const entryFile = resolveFile(join(root, 'src', 'index'));
        if (entryFile) queue.push(entryFile);
        continue;
      }
      external.add(specifier);
    }
  }
  return { packages, external };
}

const editorEntry = join(PACKAGES, 'engine-editor', 'src', 'index.ts');

describe('a browser import cannot reach the server (task 10.1)', () => {
  const reach = reachFrom(editorEntry);

  test('the walk is not vacuous: it reaches the packages the editor really uses', () => {
    // If resolution silently failed, every assertion below would pass over an empty graph.
    expect(reach.packages.has('@docx-editor.dev/engine-core')).toBe(true);
    expect(reach.packages.has('@docx-editor.dev/engine-layout')).toBe(true);
    expect(reach.external.size).toBeGreaterThan(0);
  });

  test('it does not reach the server, sync or clients lanes', () => {
    // Not a declared-dependency check: a bundler follows imports through barrels, and one
    // `export *` is enough to ship a transport stack to every consumer while every
    // package.json still looks correct.
    for (const lane of ['sync', 'server', 'clients'] as LaneName[]) {
      const name = CORE_LANES[lane].package!;
      expect({ lane, reached: reach.packages.has(name) }).toEqual({ lane, reached: false });
    }
  });

  test('it does not reach a forbidden runtime', () => {
    const reached = BROWSER_FORBIDDEN_DEPENDENCIES.filter((forbidden) =>
      [...reach.external].some(
        (specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`)
      )
    );
    expect(reached).toEqual([]);
  });

  test('it pulls in no Node builtin, so the graph is genuinely browser-safe', () => {
    // `node:` specifiers are never npm dependencies, so a package.json check cannot see
    // them — this is the only place that constraint can actually fail.
    const builtins = [...reach.external].filter((specifier) => specifier.startsWith('node:'));
    expect(builtins).toEqual([]);
  });

  test('the forbidden check would FIRE if the graph ever reached one', () => {
    // The control. The assertions above pass, and a check that only ever passes is
    // indistinguishable from one that cannot fail — so the detection is exercised against a
    // graph that does contain a forbidden name.
    const pretend = new Set(['yjs/dist/y.mjs', 'node:fs', 'prosemirror-view']);
    const reached = BROWSER_FORBIDDEN_DEPENDENCIES.filter((forbidden) =>
      [...pretend].some(
        (specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`)
      )
    );
    expect(reached).toContain('yjs');
    expect([...pretend].filter((s) => s.startsWith('node:'))).toEqual(['node:fs']);
  });

  test('the server lane declares a dependency on sync that its source never imports', () => {
    // Recorded, not asserted away: `engine-server` lists `engine-sync` in package.json and
    // imports nothing from it, so the lane DAG's manifest check passes on an edge the code
    // does not have. Harmless today; it means the DAG describes intent there, not reality.
    const serverEntry = join(PACKAGES, 'engine-server', 'src', 'index.ts');
    if (!existsSync(serverEntry)) return;
    expect(reachFrom(serverEntry).packages.has('@docx-editor.dev/engine-sync')).toBe(false);
  });
});
