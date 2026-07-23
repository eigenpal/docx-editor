// Binding capability registry (comprehensive 3.4/3.5). The ProseMirror projection is composed from
// registered capabilities instead of a hardcoded schema + a `block.kind` projection switch: each
// feature contributes PM node specs, mark specs, and a per-block-kind projector. The editable
// paragraph capability contributes the paragraph/text nodes, bold/italic marks, and the paragraph
// projector; a generic read-only capability contributes the blockEmbed atom + the default projector
// for every non-editable kind. A new editable/read-only block kind registers a projector here
// instead of editing modelToDoc. The PM doc is a PROJECTION — never canonical state.

import { Schema, type NodeSpec, type MarkSpec, Node as PMNode } from 'prosemirror-model';
import type { Block } from '@docx-editor.dev/engine-core';

/** Project one authored block into a ProseMirror node (given the composed schema). */
export type BlockProjector = (block: Block, schema: Schema) => PMNode;

const nodeSpecs = new Map<string, NodeSpec>();
const markSpecs = new Map<string, MarkSpec>();
const projectors = new Map<string, BlockProjector>(); // keyed by block.kind
let defaultProjector: BlockProjector | undefined; // for any kind without its own projector (read-only)
let composedSchema: Schema | undefined;

function assertNotBuilt(what: string): void {
  if (composedSchema) throw new Error(`cannot register ${what} after the schema is composed`);
}

/** Register a PM node spec (a projection target). Duplicate names are rejected. */
export function registerBindingNode(name: string, spec: NodeSpec): void {
  assertNotBuilt('a node');
  if (nodeSpecs.has(name)) throw new Error(`duplicate binding node spec '${name}'`);
  nodeSpecs.set(name, spec);
}
/** Register a PM mark spec (an inline formatting capability). Duplicate names are rejected. */
export function registerBindingMark(name: string, spec: MarkSpec): void {
  assertNotBuilt('a mark');
  if (markSpecs.has(name)) throw new Error(`duplicate binding mark spec '${name}'`);
  markSpecs.set(name, spec);
}
/** Register the projector for a specific block kind (its canonical or read-only projection). */
export function registerBlockProjector(kind: string, project: BlockProjector): void {
  if (projectors.has(kind)) throw new Error(`duplicate binding projector for block kind '${kind}'`);
  projectors.set(kind, project);
}
/** Register the fallback projector used for any block kind without its own (read-only embed). */
export function registerDefaultBlockProjector(project: BlockProjector): void {
  if (defaultProjector) throw new Error('duplicate default binding projector');
  defaultProjector = project;
}

/** Compose the ProseMirror schema from the registered node + mark specs (memoized). The registration
 *  order is preserved, so the base `doc` node stays the top node. */
export function buildDocSchema(): Schema {
  if (composedSchema) return composedSchema;
  composedSchema = new Schema({
    nodes: Object.fromEntries(nodeSpecs) as Record<string, NodeSpec>,
    marks: Object.fromEntries(markSpecs) as Record<string, MarkSpec>,
  });
  return composedSchema;
}

/** Project a block through its registered projector (or the default read-only projector). */
export function projectBlock(block: Block, schema: Schema): PMNode {
  const fn = projectors.get(block.kind) ?? defaultProjector;
  if (!fn) throw new Error(`no binding projector registered for block kind '${block.kind}'`);
  return fn(block, schema);
}
