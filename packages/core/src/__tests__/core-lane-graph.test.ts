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
  laneTopologicalOrder,
  reachableLanes,
  type LaneName,
} from './core-lane-graph.ts';

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
  test('every lane names a workspace package that exists', () => {
    for (const lane of laneNames) {
      expect({ lane, found: manifestOf(lane) !== null }).toEqual({ lane, found: true });
    }
  });

  test("a lane's declared imports match its package's real dependencies", () => {
    // The migration is a REPACKAGING. A lane quietly gaining a dependency during the move
    // would be a design change smuggled in as a file move, and this is where that shows.
    for (const lane of laneNames) {
      const manifest = manifestOf(lane);
      if (!manifest) continue;
      const actual = workspaceDependencies(manifest)
        .map((name) => laneNames.find((candidate) => CORE_LANES[candidate].package === name))
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

  test('no browser-reachable package depends on a forbidden runtime today', () => {
    // Checked against real manifests, so the list is a live constraint rather than a wish.
    for (const lane of BROWSER_REACHABLE) {
      const manifest = manifestOf(lane);
      if (!manifest) continue;
      const dependencies = Object.keys((manifest.dependencies as Record<string, string>) ?? {});
      for (const forbidden of BROWSER_FORBIDDEN_DEPENDENCIES) {
        expect({ lane, forbidden, present: dependencies.includes(forbidden) }).toEqual({
          lane,
          forbidden,
          present: false,
        });
      }
    }
  });

  test('the guard is not vacuous: the server lane really does depend on the sync lane', () => {
    // If the graph were empty every reachability assertion above would pass trivially.
    expect(reachableLanes('server').has('sync')).toBe(true);
    expect(reachableLanes('editor').has('store')).toBe(true);
  });
});

describe('every lane has somewhere to be imported from (task 10.1)', () => {
  test('the store lane is the package root, and the rest are subpaths', () => {
    expect(CORE_LANES.store.subpath).toBe('.');
    for (const lane of laneNames) {
      const subpath = CORE_LANES[lane].subpath;
      if (lane === 'store') continue;
      expect({ lane, subpath }).toEqual({ lane, subpath: `./${lane}` });
    }
  });

  test('each lane declares the directory it will occupy under the core package', () => {
    for (const lane of laneNames) {
      expect(CORE_LANES[lane].directory).toBe(`src/${lane}`);
    }
  });
});
