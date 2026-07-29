// Resolving a lane's files while the lane is moving (task 10.2 preparation).
//
// The architectural guards in this directory scan lanes by path: `engine-core/src`,
// `engine-layout/src/semantic-layout.ts`, and so on. Those literals are correct today and
// wrong the moment section 10 moves a lane into `packages/core`, and a guard that cannot
// find its files does not fail loudly — `collectSources` on a missing directory returns an
// empty list, so the scan passes having scanned nothing.
//
// That is the real hazard: the first attempt at the move turned several of these guards into
// vacuous passes rather than errors. So every path goes through the lane DAG instead, and a
// lane that has moved resolves to its new home automatically. Moving a lane becomes a
// one-line edit to the DAG rather than a hunt through the guards that happened to name it.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_LANES, laneSourceRoot, type LaneName } from '../../core/src/__tests__/core-lane-graph.ts';

export const PACKAGES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Legacy source-root prefix (`engine-layout/src` and friends) to the lane that owns it. */
const LANE_BY_LEGACY_PREFIX: ReadonlyMap<string, LaneName> = new Map(
  (Object.keys(CORE_LANES) as LaneName[])
    .map((lane) => {
      const name = CORE_LANES[lane].package;
      if (!name) return null;
      const directory = name.replace('@docx-editor.dev/', '');
      return [`${directory === 'core-contract' ? 'core' : directory}/src`, lane] as const;
    })
    .filter((entry): entry is readonly [string, LaneName] => entry !== null)
);

/**
 * Rewrite a `packages/`-relative path so it points at wherever its lane lives now.
 *
 * Accepts both a lane root (`engine-core/src`) and a file inside one
 * (`engine-core/src/package/ooxml-tree.ts`); anything outside a lane is returned untouched,
 * which is what keeps `react/src` and the like working through the same call.
 */
export function laneRelativePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  for (const [prefix, lane] of LANE_BY_LEGACY_PREFIX) {
    if (normalized !== prefix && !normalized.startsWith(`${prefix}/`)) continue;
    return `${laneSourceRoot(lane)}${normalized.slice(prefix.length)}`;
  }
  return normalized;
}

/** An absolute path to a lane-relative file or directory, wherever its lane lives now. */
export function lanePath(path: string): string {
  return join(PACKAGES_ROOT, laneRelativePath(path));
}

/**
 * Assert a scanned path exists before scanning it.
 *
 * The guards' failure mode is silence, not error: a moved lane leaves them scanning nothing
 * and reporting success. This turns that into the failure it should have been.
 */
export function existingLanePath(path: string): string {
  const resolved = lanePath(path);
  if (!existsSync(resolved)) {
    throw new Error(
      `Lane path "${path}" resolves to "${resolved}", which does not exist. ` +
        'If a lane moved, update its `package` field in core-lane-graph.ts.'
    );
  }
  return resolved;
}
