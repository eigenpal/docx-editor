// The internal lane DAG holds, before and after the move (task 10.1).
//
// Written before section 10 moves anything, and checked against the packages that hold the
// code TODAY. That is what stops it being a document: if a lane's declared dependencies
// disagree with what the corresponding package actually depends on, this fails now — not
// after the move, when it would be indistinguishable from migration damage.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_FORBIDDEN_DEPENDENCIES,
  BROWSER_REACHABLE,
  CORE_LANES,
  laneHasMoved,
  laneSourceRoot,
  laneTopologicalOrder,
  reachableLanes,
  type LaneName,
} from './core-lane-graph';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const laneNames = Object.keys(CORE_LANES) as LaneName[];

/** The package.json of the workspace package a lane occupies today. */
function manifestOf(lane: LaneName): Record<string, unknown> | null {
  const name = CORE_LANES[lane].package;
  if (!name) return null;
  const directory = name.replace('@docx-editor.dev/', '');
  const file = join(PACKAGES, directory === 'core-contract' ? 'core' : directory, 'package.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

const workspaceDependencies = (manifest: Record<string, unknown>): string[] =>
  Object.keys((manifest.dependencies as Record<string, string>) ?? {}).filter((name) =>
    name.startsWith('@docx-editor.dev/')
  );

describe('the lane DAG is well formed (task 10.1)', () => {
  test('it is acyclic, so a topological order exists', () => {
    expect(() => laneTopologicalOrder()).not.toThrow();
    expect(laneTopologicalOrder()).toHaveLength(laneNames.length);
  });

  test('every declared dependency names a lane that exists', () => {
    for (const lane of laneNames) {
      for (const dependency of CORE_LANES[lane].mayImport) {
        expect({ lane, dependency, known: laneNames.includes(dependency) }).toEqual({
          lane,
          dependency,
          known: true,
        });
      }
    }
  });

  test('no lane depends on itself', () => {
    for (const lane of laneNames) {
      expect(CORE_LANES[lane].mayImport).not.toContain(lane);
    }
  });

  test('the base lanes depend on nothing, so there is something to build on', () => {
    expect(CORE_LANES.store.mayImport).toEqual([]);
    expect(CORE_LANES.contracts.mayImport).toEqual([]);
  });

  test('lane directories and subpaths are unique', () => {
    const directories = laneNames.map((lane) => CORE_LANES[lane].directory);
    expect(new Set(directories).size).toBe(directories.length);
    const subpaths = laneNames.map((lane) => CORE_LANES[lane].subpath).filter(Boolean);
    expect(new Set(subpaths).size).toBe(subpaths.length);
  });
});

describe('the DAG matches the packages that hold the code today (task 10.1)', () => {
  test('every lane resolves to source that exists, moved or not', () => {
    // Reads the DAG rather than a literal path, so this keeps holding as lanes move.
    for (const lane of laneNames) {
      const root = join(PACKAGES, laneSourceRoot(lane));
      expect({ lane, found: existsSync(root) }).toEqual({ lane, found: true });
    }
  });

  test('a lane still in its own package declares the dependencies the DAG gives it', () => {
    // Only meaningful BEFORE a lane moves: once it lives in `packages/core` its dependencies
    // merge into that manifest and the per-lane comparison stops being expressible.
    for (const lane of laneNames) {
      if (laneHasMoved(lane)) continue;
      expect(manifestOf(lane)).not.toBeNull();
    }
  });

  test("an UNMOVED lane's declared imports match its package's real dependencies", () => {
    // The migration is a REPACKAGING. A lane quietly gaining a dependency during the move
    // would be a design change smuggled in as a file move, and this is where that shows.
    for (const lane of laneNames) {
      if (laneHasMoved(lane)) continue;
      const manifest = manifestOf(lane);
      if (!manifest) continue;
      const actual = workspaceDependencies(manifest)
        // `package ?? alias`: a moved lane is still depended on under its old package name
        // until the compatibility alias is removed, and that edge is a real one.
        .map((name) =>
          laneNames.find(
            (candidate) => (CORE_LANES[candidate].package ?? CORE_LANES[candidate].alias) === name
          )
        )
        .filter((name): name is LaneName => name !== undefined)
        .sort();
      const declared = [...CORE_LANES[lane].mayImport].sort();
      expect({ lane, actual }).toEqual({ lane, actual: declared });
    }
  });
});

describe('a browser bundle cannot reach the server (task 10.1)', () => {
  test('nothing reachable from the editor lane is server-only', () => {
    // Without this, the browser editor importing the server lane would ship a transport
    // stack and a filesystem shim to every consumer that will never call them.
    for (const lane of reachableLanes('editor')) {
      expect({ lane, environment: CORE_LANES[lane].environment }).not.toEqual({
        lane,
        environment: 'node',
      });
    }
  });

  test('the browser-reachable set is exactly what the editor lane closes over', () => {
    const reachable = reachableLanes('editor');
    reachable.add('editor');
    expect([...reachable].sort()).toEqual([...BROWSER_REACHABLE].sort());
  });

  test('sync, server and clients are NOT browser-reachable from the editor', () => {
    const reachable = reachableLanes('editor');
    for (const lane of ['sync', 'server', 'clients'] as LaneName[]) {
      expect({ lane, reachable: reachable.has(lane) }).toEqual({ lane, reachable: false });
    }
  });

  test('an UNMOVED browser-reachable package depends on no forbidden runtime', () => {
    // Only expressible for a lane that still owns a manifest. Once lanes share one, this
    // check cannot distinguish yjs arriving with the sync lane from yjs reaching the editor —
    // and the sync lane legitimately brings it. The real guarantee lives in the import-graph
    // walk (browser-bundle-graph.test.ts), which follows what a bundler follows.
    // A lane whose manifest is the SHARED core manifest cannot be checked this way either,
    // even if it has not moved: the contracts lane still owns `packages/core`, and every
    // moved lane's dependencies land in exactly that file.
    const shared = Object.keys(CORE_LANES).some((lane) => laneHasMoved(lane as LaneName));
    let checked = 0;
    for (const lane of BROWSER_REACHABLE) {
      if (laneHasMoved(lane)) continue;
      if (shared && CORE_LANES[lane].package === '@docx-editor.dev/core-contract') continue;
      const manifest = manifestOf(lane);
      if (!manifest) continue;
      checked += 1;
      const dependencies = Object.keys((manifest.dependencies as Record<string, string>) ?? {});
      for (const forbidden of BROWSER_FORBIDDEN_DEPENDENCIES) {
        expect({ lane, forbidden, present: dependencies.includes(forbidden) }).toEqual({
          lane,
          forbidden,
          present: false,
        });
      }
    }
    // Recorded, not asserted: as section 10 proceeds this reaches zero, and a check that
    // examines nothing must say so rather than read as a pass.
    if (checked === 0) {
      expect(
        BROWSER_REACHABLE.every(
          (lane) => laneHasMoved(lane) || CORE_LANES[lane].package === '@docx-editor.dev/core-contract'
        )
      ).toBe(true);
    }
  });

  test("heavy lane runtimes are OPTIONAL peers, not dependencies", () => {
    // pdf-lib (output) and yjs (sync) are real runtimes of real lanes, but a consumer that
    // only parses and paints a document needs neither. As plain dependencies they were
    // installed by everyone; as optional peers they are installed only by consumers that use
    // those lanes. This is about INSTALL weight — it says nothing about what a bundle pulls
    // in, which is the import-graph walk's job, because a manifest cannot stop an import.
    const core = manifestOf('contracts') ?? {};
    const dependencies = Object.keys((core.dependencies as Record<string, string>) ?? {});
    const peers = (core.peerDependencies as Record<string, string>) ?? {};
    const meta = (core.peerDependenciesMeta as Record<string, { optional?: boolean }>) ?? {};

    for (const heavy of ['pdf-lib', 'yjs']) {
      expect({ heavy, inDependencies: dependencies.includes(heavy) }).toEqual({
        heavy,
        inDependencies: false,
      });
      expect({ heavy, declared: heavy in peers, optional: meta[heavy]?.optional === true }).toEqual({
        heavy,
        declared: true,
        optional: true,
      });
    }

    // What everyone genuinely needs stays a hard dependency.
    expect(dependencies).toContain('fflate');
    expect(dependencies).toContain('harfbuzzjs');
  });

  test('the guard is not vacuous: the server lane really does depend on the sync lane', () => {
    // If the graph were empty every reachability assertion above would pass trivially.
    expect(reachableLanes('server').has('sync')).toBe(true);
    expect(reachableLanes('editor').has('store')).toBe(true);
  });
});

describe('every lane has somewhere to be imported from (task 10.1)', () => {
  test('every lane is importable at its own subpath', () => {
    // The store lane was the package root while it lived in `engine-core`. Now that it sits
    // inside the core package alongside `contracts`, the root belongs to the package itself
    // and every lane — store included — is reached by subpath.
    for (const lane of laneNames) {
      expect({ lane, subpath: CORE_LANES[lane].subpath }).toEqual({ lane, subpath: `./${lane}` });
    }
  });

  test('a moved lane keeps a compatibility alias, and an unmoved one has none', () => {
    // The alias is what task 10.5 permits while a lane is in flight; task 10.6 deletes it.
    // Asserting BOTH directions so the field cannot quietly become permanent decoration.
    for (const lane of laneNames) {
      const hasAlias = CORE_LANES[lane].alias !== undefined;
      expect({ lane, hasAlias }).toEqual({ lane, hasAlias: laneHasMoved(lane) });
    }
  });

  test('each lane declares the directory it will occupy under the core package', () => {
    for (const lane of laneNames) {
      expect(CORE_LANES[lane].directory).toBe(`src/${lane}`);
    }
  });
});

describe('the per-lane environment boundary is NOT structurally enforced yet', () => {
  // This replaces the per-package tsconfig checks that task 1.4's topology guard used to make
  // (deleted with the `engine-*` packages in task 10.6). Those checks asserted that a neutral
  // package's tsconfig omitted the DOM lib, so a DOM call in the store or layout lane would
  // not compile. One tsconfig now covers every lane, and the browser lanes genuinely need
  // `DOM` and `DOM.Iterable` — so that structural guarantee is GONE, not merely relocated.
  //
  // Recorded as a failing-open fact rather than dropped: what still protects the neutral lanes
  // is the static DOM-usage scan in layout-authority, which is weaker (it matches known DOM
  // identifiers rather than making the code fail to compile). Restoring the strong form is
  // task 10.1's remaining "TypeScript project boundaries" deliverable.
  const tsconfigPath = join(PACKAGES, 'core', 'tsconfig.json');

  test('the single core tsconfig does include the DOM lib', () => {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
    const lib: string[] = tsconfig.compilerOptions?.lib ?? [];
    expect(lib.some((entry) => /dom/i.test(entry))).toBe(true);
  });

  test('so at least one NEUTRAL lane is compiled against the DOM it must not use', () => {
    // The precise cost of the collapse. If this ever reports zero, either every neutral lane
    // gained its own project (the fix) or the DAG stopped calling them neutral (a regression).
    const neutralInCore = (Object.keys(CORE_LANES) as LaneName[]).filter(
      (lane) => CORE_LANES[lane].environment === 'neutral' && laneHasMoved(lane)
    );
    expect(neutralInCore.length).toBeGreaterThan(0);
  });
});
