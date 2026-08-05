// The internal lane DAG of the single core package (task 10.1).
//
// Section 10 collapses eight `engine-*` workspace packages into one published package with
// guarded internal lanes. The boundaries that npm enforces today — a package cannot import
// what it does not depend on — stop existing the moment the code shares a directory tree, so
// they have to be re-established as a rule over paths and checked.
//
// This file is the machine-readable source of truth for that rule. It is written BEFORE the
// move so the migration has an acceptance test rather than a plan: every lane names the
// directory it will occupy, the package it occupies today, what it may import, and which
// environment it is allowed to assume. A lane that acquires a new dependency has to declare
// it here, in a diff a reviewer sees.

export type LaneName =
  | 'contracts'
  | 'store'
  | 'binding'
  | 'layout'
  | 'output'
  | 'automation'
  | 'editor';

export type LaneEnvironment = 'neutral' | 'browser' | 'node';

export interface Lane {
  /** Where the lane lives after the migration. */
  readonly directory: string;
  /**
   * The workspace package holding it TODAY, or null once it has moved into `packages/core`.
   *
   * The migration flips this per lane, one entry at a time, and every check reads it rather
   * than a literal path — so moving a lane's files updates one line here instead of breaking
   * each guard that happened to name the old location. A first attempt at the move failed on
   * exactly that cascade.
   */
  readonly package: string | null;
  /**
   * Declared straight into `packages/core`, never a standalone package.
   *
   * `package: null` reads as "moved" for every path-resolving caller, which is what a lane
   * that was born here wants — it simply never had a package of its own to move out of.
   */
  readonly nativeToCore?: boolean;
  /** Lanes this one may import. Anything else is a violation. */
  readonly mayImport: readonly LaneName[];
  /**
   * What the lane may assume it is running in.
   *
   * `neutral` must run in both, which is what keeps save, layout and the store usable on a
   * server; `browser` may touch the DOM; `node` may touch the filesystem and sockets.
   */
  readonly environment: LaneEnvironment;
  /**
   * The subpath consumers import it as, or null for lanes that stay internal.
   *
   * `contracts` is the one lane with no subpath of its own: it publishes a FAMILY
   * (`./contracts/editor`, `./contracts/types`, …) and never a bare `./contracts`,
   * so declaring one would name an entry point that does not exist in `exports`.
   * {@link Lane.subpathPrefix} is how it says so.
   */
  readonly subpath: string | null;
  /**
   * Set instead of {@link Lane.subpath} when the lane publishes a family of subpaths
   * under one prefix rather than a single entry point.
   */
  readonly subpathPrefix?: string;
}

/**
 * The DAG.
 *
 * Kept identical to the package graph it replaces, deliberately: the migration is a
 * repackaging, and a lane quietly gaining a dependency during the move would be a design
 * change smuggled in as a file move.
 */
export const CORE_LANES: Readonly<Record<LaneName, Lane>> = Object.freeze({
  contracts: {
    // Owns the core package itself, so it never "moves" in the sense the other lanes do.
    directory: 'src/contracts',
    package: '@docx-editor.dev/core',
    mayImport: [],
    environment: 'neutral',
    // No bare `./contracts` entry point exists; the lane ships one subpath per contract.
    subpath: null,
    subpathPrefix: './contracts/',
  },
  store: {
    directory: 'src/store',
    package: null,
    mayImport: [],
    environment: 'neutral',
    subpath: './store',
  },
  binding: {
    directory: 'src/binding',
    package: null,
    mayImport: ['contracts', 'store'],
    environment: 'browser',
    subpath: './binding',
  },
  // The sync, server, and clients lanes were deleted with the legacy PackageModel store
  // (legacy-lane retirement, phase 4): they were built entirely on DocumentStore/DocOps
  // and the deferred collaboration/server-binding slices own any future replacements.
  layout: {
    directory: 'src/layout',
    package: null,
    mayImport: ['store'],
    environment: 'neutral',
    subpath: './layout',
  },
  output: {
    directory: 'src/output',
    package: null,
    mayImport: ['store', 'layout'],
    environment: 'browser',
    subpath: './output',
  },
  automation: {
    directory: 'src/automation',
    // Born in `packages/core`: there is no `engine-automation` package and never was.
    package: null,
    nativeToCore: true,
    // The store lane and nothing else. This lane is the transport-neutral host port an
    // automation object model programs against, and a server has to be able to run it —
    // reaching into binding, output or editor would put a DOM in the headless host.
    mayImport: ['store'],
    environment: 'neutral',
    subpath: './automation',
  },
  editor: {
    directory: 'src/editor',
    package: null,
    mayImport: ['contracts', 'store', 'binding', 'layout', 'output', 'automation'],
    environment: 'browser',
    subpath: './editor',
  },
});

/**
 * Lanes a BROWSER bundle is allowed to pull in.
 *
 * The reason the check exists rather than the DAG alone: nothing in the DAG stops the
 * browser editor from importing the server lane, and the first time it does, every consumer
 * ships a transport stack and a filesystem shim they will never call.
 */
export const BROWSER_REACHABLE: readonly LaneName[] = [
  'contracts',
  'store',
  'binding',
  'layout',
  'output',
  'automation',
  'editor',
];

/** Third-party dependencies that must NOT reach a default browser import. */
export const BROWSER_FORBIDDEN_DEPENDENCIES: readonly string[] = [
  'yjs',
  'y-protocols',
  'pdfkit',
  'node:fs',
  'node:net',
  'node:http',
];

/** Whether a lane has been moved into the core package yet. */
export function laneHasMoved(name: LaneName): boolean {
  return CORE_LANES[name].package === null;
}

/**
 * Where a lane's source lives right now, relative to `packages/`.
 *
 * The single place that knows whether a lane has moved. A guard that resolves through this
 * keeps working across the migration; one that hard-codes `engine-core/src` does not.
 */
export function laneSourceRoot(name: LaneName): string {
  return sourceRootOf(CORE_LANES[name]);
}

/**
 * The same rule as a pure function of a lane record.
 *
 * Split out so the moved case is reachable in a test: `CORE_LANES` is frozen and every lane
 * in it is unmoved, so a test that could only call `laneSourceRoot` would be asserting on the
 * one branch that is not the interesting one.
 */
export function sourceRootOf(lane: Lane): string {
  if (lane.package === null) return `core/${lane.directory}`;
  const directory = lane.package.replace('@docx-editor.dev/', '');
  return `${directory === 'core' ? 'core' : directory}/src`;
}

/** Every lane, in an order where a lane's dependencies come first. */
export function laneTopologicalOrder(): LaneName[] {
  const order: LaneName[] = [];
  const visiting = new Set<LaneName>();

  const visit = (name: LaneName): void => {
    if (order.includes(name)) return;
    if (visiting.has(name)) throw new Error(`Lane cycle through ${name}`);
    visiting.add(name);
    for (const dependency of CORE_LANES[name].mayImport) visit(dependency);
    visiting.delete(name);
    order.push(name);
  };

  for (const name of Object.keys(CORE_LANES) as LaneName[]) visit(name);
  return order;
}

/** Lanes reachable from a starting lane, following the DAG. */
export function reachableLanes(from: LaneName): Set<LaneName> {
  const seen = new Set<LaneName>();
  const walk = (name: LaneName): void => {
    for (const dependency of CORE_LANES[name].mayImport) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      walk(dependency);
    }
  };
  walk(from);
  return seen;
}
