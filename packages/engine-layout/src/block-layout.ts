// Block layout capability registry (comprehensive 3.6/3.7). Each block kind (paragraph, table,
// transparent SDT) registers its flow-layout handler HERE instead of a `block.kind` switch in
// layoutBody. A handler advances the shared mutable cursor and pushes DisplayItems; a container
// kind (SDT) recurses its nested blocks through the SAME dispatch. A new block kind registers a
// layout handler instead of editing layoutBody. All arithmetic stays integer/fixed-point, so
// fingerprints are unchanged.

import { type Block, registeredBlockKinds } from '@docx-editor.dev/engine-core';
import type { DisplayItem } from './display-item.ts';
import type { MetricsPort } from './metrics.ts';
import { type DependencyKey, keyId } from './dependency-graph.ts';

/** The minimal builder a layout handler pushes into (the PageBuilder implements it). */
export interface LayoutBuilder {
  push(item: DisplayItem): void;
  break(): void;
  currentPageIndex(): number;
}

/** The mutable layout cursor + shared context a block-layout handler advances. */
export interface BlockLayoutContext {
  readonly margin: number;
  readonly contentRight: number;
  readonly contentBottom: number;
  readonly metrics: MetricsPort;
  readonly builder: LayoutBuilder;
  x: number;
  y: number;
  /** Advance to the next line, breaking the page when it would overflow the content box. */
  newLine(): void;
  /** Lay out a nested block list through the SAME registry (a container capability recurses here). */
  layoutBlocks(blocks: readonly Block[]): void;
}

export type BlockLayout = (block: Block, ctx: BlockLayoutContext) => void;

const registry = new Map<string, BlockLayout>();

/**
 * Register the flow-layout handler for a block kind. Duplicate ownership is rejected.
 *
 * This function takes no opt-out. Re-registration for this package's built-ins lives in
 * {@link registerBuiltInBlockLayout}, which the package index does not export.
 */
export function registerBlockLayout(kind: string, fn: BlockLayout): void {
  if (registry.has(kind)) throw new Error(`duplicate block layout handler for kind '${kind}'`);
  registry.set(kind, fn);
}

/**
 * Re-registration, for THIS PACKAGE's built-ins only.
 *
 * `replace` used to be a public boolean on the registrars, which meant the invariant "two
 * different capabilities must not claim one kind" was enforced by convention: any caller
 * could pass it and silently take over `paragraph`. Review flagged that, and it mattered most
 * for dependencies — a replaced layout handler breaks visibly, a replaced dependency
 * extractor breaks resolved-cache invalidation and surfaces as stale layout that reads like a
 * caching bug.
 *
 * These are deliberately NOT re-exported from the package index, so the escape hatch is
 * structural rather than documented. Hot reload needs it because the built-ins register at
 * module scope and a re-evaluation creates fresh closures, so identity comparison cannot
 * substitute for an explicit opt-in.
 */
export function registerBuiltInBlockLayout(kind: string, fn: BlockLayout): void {
  registry.set(kind, fn);
}

/** Lay out one block through its registered handler; fails closed on an unknown kind. */
export function layoutBlock(block: Block, ctx: BlockLayoutContext): void {
  const fn = registry.get(block.kind);
  if (!fn) throw new Error(`no block layout handler registered for kind '${block.kind}'`);
  fn(block, ctx);
}

// ─── 3.6 layout registration lanes beyond display emission: resolution dependencies, semantic
// roles (a11y), and hit ownership. A block kind registers these ALONGSIDE its layout handler, so a
// new kind declares what it depends on + how it is read/hit without editing a central switch. ───

/** The authored resolution keys a block reads (style/numbering/section/font/...), for the
 *  dependency-graph closure (8.2) that gates resolved-cache reuse (8.3). */
export type BlockDependencies = (block: Block) => readonly DependencyKey[];
const dependencyRegistry = new Map<string, BlockDependencies>();
/**
 * Duplicate ownership is rejected. Re-registration for this package's built-ins lives in
 * {@link registerBuiltInBlockDependencies}.
 *
 * This was the SECOND registry with the throwing shape and it was missed when the first was
 * fixed — the hot-reload cascade simply moved from `duplicate block layout handler` to
 * `duplicate block dependency declaration`. Any further registry needs the same pair.
 */
export function registerBlockDependencies(kind: string, fn: BlockDependencies): void {
  if (dependencyRegistry.has(kind))
    throw new Error(`duplicate block dependency declaration for kind '${kind}'`);
  dependencyRegistry.set(kind, fn);
}

/** Built-ins only; see {@link registerBuiltInBlockLayout}. */
export function registerBuiltInBlockDependencies(kind: string, fn: BlockDependencies): void {
  dependencyRegistry.set(kind, fn);
}
/** The resolution dependencies a block reads (empty when the kind declared none), DEDUPED by key —
 *  a container composing children can list the same key (e.g. docDefaults) more than once; a
 *  dependency set has each key once. */
export function blockDependencies(block: Block): readonly DependencyKey[] {
  const raw = dependencyRegistry.get(block.kind)?.(block) ?? [];
  const seen = new Set<string>();
  const out: DependencyKey[] = [];
  for (const k of raw) {
    const id = keyId(k);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(k);
  }
  return out;
}

/** The accessibility/semantic role a block kind projects to (reading-order + tagged output). */
const semanticRoleRegistry = new Map<string, string>();
export function registerBlockSemanticRole(kind: string, role: string): void {
  if (semanticRoleRegistry.has(kind)) throw new Error(`duplicate semantic role for kind '${kind}'`);
  semanticRoleRegistry.set(kind, role);
}

/** Built-ins only; see {@link registerBuiltInBlockLayout}. */
export function registerBuiltInBlockSemanticRole(kind: string, role: string): void {
  semanticRoleRegistry.set(kind, role);
}
export const blockSemanticRole = (kind: string): string | undefined =>
  semanticRoleRegistry.get(kind);

/** Hit ownership: the block that owns a hit is the one identified by the anchor a layout item
 *  carries (anchor.paragraphId). This is the single hit-ownership rule — a block owns exactly the
 *  display items anchored to it — exposed so a backend maps a hit to its owning block without a
 *  per-kind switch. */
export const hitOwner = (anchor: { paragraphId: string }): string => anchor.paragraphId;

/** Whether a block kind has registered its resolution-dependency + semantic-role lanes (3.6). */
export const hasLayoutMetadata = (kind: string): boolean =>
  dependencyRegistry.has(kind) && semanticRoleRegistry.has(kind);

/** Whether a block kind has a registered layout handler. */
export const hasBlockLayout = (kind: string): boolean => registry.has(kind);

/** Enforce the LAYOUT lane of feature completeness (comprehensive 3.9): every registered core block
 *  kind — editable OR read-only — MUST contribute a flow-layout handler, because a paginated
 *  document renders every block it contains. `layoutBlock` fails closed at layout time, but this
 *  check surfaces the gap up front (at composition / before a document is opened) so an
 *  under-registered feature is rejected rather than discovered mid-render. Throws listing every
 *  block kind that lacks a handler. */
export function assertLayoutLaneComplete(): void {
  const missing = registeredBlockKinds().filter((kind) => !registry.has(kind));
  if (missing.length > 0) {
    throw new Error(
      `layout lane incomplete — no layout handler for block kind(s): ${missing.join(', ')}`
    );
  }
}
