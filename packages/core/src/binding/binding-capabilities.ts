// Binding capability registry (comprehensive 3.4/3.5). The ProseMirror projection is composed from
// registered capabilities instead of a hardcoded schema + a `block.kind` projection switch: each
// feature contributes PM node specs, mark specs, and a per-block-kind projector. The editable
// paragraph capability contributes the paragraph/text nodes, bold/italic marks, and the paragraph
// projector; a generic read-only capability contributes the blockEmbed atom + the default projector
// for every non-editable kind. A new editable/read-only block kind registers a projector here
// instead of editing modelToDoc. The PM doc is a PROJECTION — never canonical state.

import { Schema, type NodeSpec, type MarkSpec, Node as PMNode } from 'prosemirror-model';
import { type Block, registeredBlockKinds, isTopLevelEditable } from '@docx-editor.dev/core-contract/store';

/** Project one authored block into a ProseMirror node (given the composed schema). */
export type BlockProjector = (block: Block, schema: Schema) => PMNode;

/** The reverse-mapping role of a PM node: an editable text 'paragraph', or a read-only 'atom'
 *  (a projected non-editable block). The forward mapper (mapDocToOps) consults these instead of
 *  hardcoding node names, so a registered node participates in the reverse lane too. */
export type NodeRole = 'paragraph' | 'atom';

const nodeSpecs = new Map<string, NodeSpec>();
const nodeRoles = new Map<string, NodeRole>();
const markSpecs = new Map<string, MarkSpec>();
const projectors = new Map<string, BlockProjector>(); // keyed by block.kind
let defaultProjector: BlockProjector | undefined; // for any kind without its own projector (read-only)
let composedSchema: Schema | undefined;

/** The block kinds whose FULL edit round-trip the reverse lane actually implements: projector →
 *  editable PM node → mapDocToOps → DocOps and back. This is the SINGLE source of truth for binding
 *  editability, consulted by BOTH the completeness check here and the reverse matcher in binding.ts,
 *  so the two can never disagree. It is an INTERNAL constant, NOT a per-projector caller flag: an
 *  external feature must not be able to assert its kind is editable while the reverse lane (which is
 *  paragraph/run-specific — see mapDocToOps/trySplit/mapJoin) cannot map it. A kind joins this set
 *  only when the binding maintainer implements its reverse mapping in binding.ts, right beside this
 *  declaration. Today the DocOp surface is paragraph/run, so paragraph is the only member. */
const BINDING_EDITABLE_KINDS: ReadonlySet<string> = new Set(['paragraph']);

function assertNotBuilt(what: string): void {
  if (composedSchema) throw new Error(`cannot register ${what} after the schema is composed`);
}

/** Register a PM node spec (a projection target). `role` declares how the reverse mapper treats it
 *  ('paragraph' = editable text block, 'atom' = read-only embed); omit for a structural node (doc,
 *  text) the block mapper never dispatches on. Duplicate names are rejected. */
export function registerBindingNode(name: string, spec: NodeSpec, role?: NodeRole): void {
  assertNotBuilt('a node');
  if (nodeSpecs.has(name)) throw new Error(`duplicate binding node spec '${name}'`);
  nodeSpecs.set(name, spec);
  if (role) nodeRoles.set(name, role);
}
/** The reverse-mapping role of a PM node name, if it is a block-level projection target. */
export const nodeRole = (nodeName: string): NodeRole | undefined => nodeRoles.get(nodeName);
/** Register a PM mark spec (an inline formatting capability). Duplicate names are rejected. */
export function registerBindingMark(name: string, spec: MarkSpec): void {
  assertNotBuilt('a mark');
  if (markSpecs.has(name)) throw new Error(`duplicate binding mark spec '${name}'`);
  markSpecs.set(name, spec);
}
/** Register the projector for a specific block kind (its canonical or read-only projection). Whether
 *  a kind is EDITABLE through the binding is NOT a projector flag — it is the internal reverse-lane
 *  fact `BINDING_EDITABLE_KINDS`, so a projector cannot assert an editability the reverse mapper does
 *  not back. */
export function registerBlockProjector(kind: string, project: BlockProjector): void {
  if (projectors.has(kind)) throw new Error(`duplicate binding projector for block kind '${kind}'`);
  projectors.set(kind, project);
}
/** Whether the binding reverse lane can round-trip edits to this block kind. The forward matcher
 *  (binding.ts) consults this instead of hardcoding 'paragraph', so editability has one source. */
export const isBindingEditableKind = (kind: string): boolean => BINDING_EDITABLE_KINDS.has(kind);
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

/**
 * Project a block through its registered projector (or the default read-only projector).
 *
 * `forceReadOnly` routes a block to the read-only atom projector regardless of its kind
 * (partial-body-editability, task M6P.1). Editability is CONTEXTUAL — a paragraph whose
 * current source slice carries unmodeled inline OOXML cannot be patched losslessly even
 * though `paragraph` is an editable kind — so the projector cannot be chosen from
 * `block.kind` alone. The canonical kind is unchanged; only this projection differs.
 */
export function projectBlock(block: Block, schema: Schema, forceReadOnly = false): PMNode {
  const fn = forceReadOnly ? defaultProjector : (projectors.get(block.kind) ?? defaultProjector);
  if (!fn) throw new Error(`no binding projector registered for block kind '${block.kind}'`);
  return fn(block, schema);
}

/** Whether a block kind has its own (non-default) projector registered — i.e. it is projected as a
 *  first-class editable node rather than the read-only fallback embed. */
export const hasBlockProjector = (kind: string): boolean => projectors.has(kind);

/** Enforce the BINDING lane of feature completeness (comprehensive 3.9): every core block kind that
 *  is editable in the model MUST be round-trippable through the binding — its edited PM node must map
 *  back to DocOps. Presence of a projector is NOT sufficient (a projector can target the read-only
 *  atom, or an editable node the reverse mapper cannot turn into DocOps); the kind must be in the
 *  reverse lane's BINDING_EDITABLE_KINDS (an internal fact, not a caller flag). A core kind that is
 *  editable but not binding-editable would silently lose edits in the browser; reject it here, before
 *  a document is opened, rather than as a lost edit or a mid-edit rejection at runtime. Throws
 *  listing every gap. */
export function assertBindingLaneComplete(): void {
  const schema = buildDocSchema(); // an unbuildable schema surfaces here too
  const missing: string[] = [];
  for (const kind of registeredBlockKinds()) {
    if (!isTopLevelEditable(kind)) continue; // read-only kinds ride the default projector
    if (!projectors.has(kind)) {
      missing.push(`'${kind}' has no binding projector (would fall back to the read-only embed)`);
    } else if (!BINDING_EDITABLE_KINDS.has(kind)) {
      missing.push(
        `'${kind}' is core-editable but the binding reverse lane cannot map its edits to DocOps ` +
          `(not in BINDING_EDITABLE_KINDS)`
      );
    }
  }
  void schema;
  if (missing.length > 0) {
    throw new Error(
      `binding lane incomplete for editable block kinds:\n  - ${missing.join('\n  - ')}`
    );
  }
}

/** Snapshot the mutable binding PROJECTOR registry so a test that registers a projector can restore
 *  it and never leak into sibling/watch-mode tests. Node/mark specs and BINDING_EDITABLE_KINDS are
 *  fixed (composed once / constant) and need no snapshot. */
export const snapshotBindingRegistryForTest = (): ReadonlyMap<string, BlockProjector> =>
  new Map(projectors);
export function restoreBindingRegistryForTest(snap: ReadonlyMap<string, BlockProjector>): void {
  projectors.clear();
  for (const [kind, fn] of snap) projectors.set(kind, fn);
}
