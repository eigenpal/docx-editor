// The lane resolver has to actually resolve (task 10.2 preparation).
//
// Every guard that now calls `existingLanePath` passes today, and would pass identically if
// the function simply returned its argument — the lanes have not moved yet, so the rewrite is
// a no-op on every real input. That makes the passing guards no evidence at all.
//
// So the resolver is tested against the case that does not exist yet: a lane whose `package`
// is null, meaning it has moved into `packages/core`. If these fail, the migration will find
// the guards scanning empty directories and reporting success.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_LANES, laneSourceRoot, sourceRootOf } from '../../__tests__/core-lane-graph.ts';
import { existingLanePath, laneRelativePath, PACKAGES_ROOT } from './lane-paths.ts';
import { laneHasMoved, type LaneName } from '../../__tests__/core-lane-graph.ts';

/**
 * A lane that has not moved yet, chosen at run time.
 *
 * Naming one made this file fail the moment that lane moved — which is a test breaking on
 * the change it is supposed to survive. Section 10 moves every lane eventually, so the
 * example has to be looked up rather than written down.
 */
const UNMOVED: LaneName | undefined = (
  ['contracts', 'sync', 'server', 'clients', 'binding', 'output', 'editor'] as LaneName[]
).find((lane) => !laneHasMoved(lane));

describe('lane path resolution survives a lane moving', () => {
  test('an unmoved lane keeps its current location', () => {
    if (!UNMOVED) return; // Every lane has moved: this case no longer exists to test.
    const root = laneSourceRoot(UNMOVED);
    expect(laneRelativePath(root)).toBe(root);
    expect(laneRelativePath(`${root}/index.ts`)).toBe(`${root}/index.ts`);
  });

  test('the store lane, which HAS moved, redirects both root and nested file', () => {
    // Not hypothetical any more: task 10.2 moved this lane, so every guard still naming it
    // `engine-core/src` is relying on exactly this rewrite.
    expect(laneRelativePath('engine-core/src')).toBe('core/src/store');
    expect(laneRelativePath('engine-core/src/package/ooxml-tree.ts')).toBe(
      'core/src/store/package/ooxml-tree.ts'
    );
  });

  test('the rewrite rule itself handles a lane that has not moved yet', () => {
    // The whole point of the indirection, exercised on the only input that can show it.
    // `laneSourceRoot` reads the DAG, so this is the behaviour the guards will get the
    // moment a `package` field flips to null — not a restatement of it.
    // `sourceRootOf` is the rule `laneSourceRoot` and `laneRelativePath` both run on, called
    // here with a lane record whose `package` is null — the state the migration creates.
    expect(sourceRootOf({ ...CORE_LANES.store, package: null })).toBe('core/src/store');
    expect(sourceRootOf({ ...CORE_LANES.editor, package: null })).toBe('core/src/editor');
    // Same function, unmoved: the two branches are not separate implementations.
    if (UNMOVED) {
      expect(sourceRootOf(CORE_LANES[UNMOVED])).toBe(laneSourceRoot(UNMOVED));
      expect(sourceRootOf(CORE_LANES[UNMOVED]).startsWith('core/src/')).toBe(false);
    }
  });

  test('a path outside every lane is returned untouched', () => {
    // `react/src` is scanned by the layout guard and belongs to no lane.
    expect(laneRelativePath('react/src')).toBe('react/src');
  });

  test('a path that does not exist THROWS rather than scanning nothing', () => {
    // The failure this whole file exists to prevent: `collectSources` on a missing directory
    // returns [], so a guard whose lane moved passes having examined no files.
    expect(() => existingLanePath('engine-layout/src/definitely-not-here')).toThrow(
      /does not exist/
    );
  });

  test('the resolver points at real files, so the guards are scanning something', () => {
    const resolved = existingLanePath('engine-core/src');
    expect(resolved.startsWith(PACKAGES_ROOT)).toBe(true);
  });

  test('fixture paths in this lane still resolve after the move', () => {
    // The failure this catches is SILENT. Several tests here are written as
    // `test.if(existsSync(fixture))`, so a fixture path that stops resolving does not fail —
    // the test quietly stops running. Moving the lane two directories deeper broke four of
    // them that way, and the suite still reported green.
    const fixtures = join(PACKAGES_ROOT, '..', 'e2e', 'fixtures');
    expect({ fixtures, found: existsSync(fixtures) }).toEqual({ fixtures, found: true });

    // And the relative form the tests actually use, from this directory.
    const fromHere = join(import.meta.dir, '..', '..', '..', '..', '..', 'e2e', 'fixtures');
    expect(existsSync(fromHere)).toBe(true);
  });
});
