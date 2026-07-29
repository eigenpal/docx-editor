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
  | 'sync'
  | 'layout'
  | 'output'
  | 'server'
  | 'clients'
  | 'editor';

export type LaneEnvironment = 'neutral' | 'browser' | 'node';

export interface Lane {
  /** Where the lane lives after the migration. */
  readonly directory: string;
  /** The workspace package holding it today, so the rule is checkable before the move. */
  readonly package: string | null;
  /** Lanes this one may import. Anything else is a violation. */
  readonly mayImport: readonly LaneName[];
  /**
   * What the lane may assume it is running in.
   *
   * `neutral` must run in both, which is what keeps save, layout and the store usable on a
   * server; `browser` may touch the DOM; `node` may touch the filesystem and sockets.
   */
  readonly environment: LaneEnvironment;
  /** The subpath consumers import it as, or null for lanes that stay internal. */
  readonly subpath: string | null;
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
    directory: 'src/contracts',
    package: '@docx-editor.dev/core-contract',
    mayImport: [],
    environment: 'neutral',
    subpath: './contracts',
  },
  store: {
    directory: 'src/store',
    package: '@docx-editor.dev/engine-core',
    mayImport: [],
    environment: 'neutral',
    subpath: '.',
  },
  binding: {
    directory: 'src/binding',
    package: '@docx-editor.dev/engine-binding',
    mayImport: ['contracts', 'store'],
    environment: 'browser',
    subpath: './binding',
  },
  sync: {
    directory: 'src/sync',
    package: '@docx-editor.dev/engine-sync',
    mayImport: ['store'],
    environment: 'neutral',
    subpath: './sync',
  },
  layout: {
    directory: 'src/layout',
    package: '@docx-editor.dev/engine-layout',
    mayImport: ['store'],
    environment: 'neutral',
    subpath: './layout',
  },
  output: {
    directory: 'src/output',
    package: '@docx-editor.dev/engine-output',
    mayImport: ['store', 'layout'],
    environment: 'browser',
    subpath: './output',
  },
  server: {
    directory: 'src/server',
    package: '@docx-editor.dev/engine-server',
    mayImport: ['store', 'sync', 'layout', 'output'],
    environment: 'node',
    subpath: './server',
  },
  clients: {
    directory: 'src/clients',
    package: '@docx-editor.dev/engine-clients',
    mayImport: ['store'],
    environment: 'neutral',
    subpath: './clients',
  },
  editor: {
    directory: 'src/editor',
    package: '@docx-editor.dev/engine-editor',
    mayImport: ['contracts', 'store', 'binding', 'layout', 'output'],
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
