// Block layout capability registry (comprehensive 3.6/3.7). Each block kind (paragraph, table,
// transparent SDT) registers its flow-layout handler HERE instead of a `block.kind` switch in
// layoutBody. A handler advances the shared mutable cursor and pushes DisplayItems; a container
// kind (SDT) recurses its nested blocks through the SAME dispatch. A new block kind registers a
// layout handler instead of editing layoutBody. All arithmetic stays integer/fixed-point, so
// fingerprints are unchanged.

import { type Block, registeredBlockKinds } from '@docx-editor.dev/engine-core';
import type { DisplayItem } from './display-item.ts';
import type { MetricsPort } from './metrics.ts';

/** The minimal builder a layout handler pushes into (the PageBuilder implements it). */
export interface LayoutBuilder {
  push(item: DisplayItem): void;
  break(): void;
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

/** Register the flow-layout handler for a block kind. Duplicate ownership is rejected. */
export function registerBlockLayout(kind: string, fn: BlockLayout): void {
  if (registry.has(kind)) throw new Error(`duplicate block layout handler for kind '${kind}'`);
  registry.set(kind, fn);
}

/** Lay out one block through its registered handler; fails closed on an unknown kind. */
export function layoutBlock(block: Block, ctx: BlockLayoutContext): void {
  const fn = registry.get(block.kind);
  if (!fn) throw new Error(`no block layout handler registered for kind '${block.kind}'`);
  fn(block, ctx);
}

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
    throw new Error(`layout lane incomplete — no layout handler for block kind(s): ${missing.join(', ')}`);
  }
}
