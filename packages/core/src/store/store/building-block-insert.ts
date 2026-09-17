// `insertBuildingBlock`: a gallery control takes the body of one building block.
//
// The op carries the block's body as blocks, the way `insertFragment` carries a paste: the
// glossary is a side part the story store cannot address, so the editor resolves the pick
// and the store lands it. Nodes are cloned with fresh ids and fresh paragraph identities, so
// two picks of the same block never collide and the journal replays the same primitives.

import { createNodeIdAllocator, replaceChildren, replaceNode } from '../package/ooxml-edit.ts';
import type { EditOptions } from '../package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { usedParaIds } from '../package/para-id.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { isInlineControl } from './content-control-checkbox.ts';
import { withParagraphDiff } from './content-control-value-content.ts';
import { replaceControlContent } from './tree-op-apply.ts';
import {
  MAX_FRAGMENT_DEPTH,
  MAX_FRAGMENT_NODES,
  withFreshParaIds,
  withRequiredNamespaceBindings,
} from './tree-op-fragment.ts';
import {
  cloneWithNewIds,
  contentControlAncestorsOf,
  contentControlContentOf,
  contentControlPropertiesOf,
  contentControlUnwrapPayload,
  effectiveLockOf,
  findContentControl,
  fromEdit,
  isBoundContentControl,
  isTemporaryControl,
  parentOf,
  sdtPrChild,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** Replace a building block gallery control's content with one block's body. */
export interface InsertBuildingBlockOp {
  readonly op: 'insertBuildingBlock';
  readonly controlId: string;
  /** `w:docPartPr/w:name` of the picked block, for the journal and the host. */
  readonly name: string;
  /** The block's `w:docPartBody` children; cloned with fresh ids at apply. */
  readonly blocks: readonly OoxmlNode[];
}

/** A block's body never needs the paste budget; this is what one glossary entry can hold. */
export const MAX_BUILDING_BLOCK_BLOCKS = 4096;

const BODY_BLOCK_KINDS: ReadonlySet<string> = new Set(['paragraph', 'table', 'contentControl']);

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function shapeOf(
  node: OoxmlNode,
  depth: number,
  budget: { nodes: number }
): TreeOpRejection | null {
  if (depth > MAX_FRAGMENT_DEPTH) return 'fragment-too-deep';
  budget.nodes += 1;
  if (budget.nodes > MAX_FRAGMENT_NODES) return 'fragment-resource-budget';
  if (node.kind === 'textValue') {
    return typeof node.value === 'string' ? null : 'fragment-invalid-block';
  }
  if (typeof node.localName !== 'string' || typeof node.namespaceUri !== 'string') {
    return 'fragment-invalid-block';
  }
  if (!Array.isArray(node.children) || !Array.isArray(node.attributes)) {
    return 'fragment-invalid-block';
  }
  for (const child of node.children) {
    const refused = shapeOf(child, depth + 1, budget);
    if (refused) return refused;
  }
  return null;
}

/** A row- or cell-level control wraps table structure no block body can stand in for. */
function wrapsTableStructure(control: OoxmlElement): boolean {
  const content = contentControlContentOf(control);
  return (
    content?.children.some(
      (child) =>
        child.kind === 'tableRow' ||
        child.kind === 'tableCell' ||
        isWml(child, 'tr') ||
        isWml(child, 'tc')
    ) ?? false
  );
}

export function validateInsertBuildingBlock(
  part: OoxmlPart,
  op: InsertBuildingBlockOp
): TreeOpRejection | null {
  if (typeof op.controlId !== 'string' || op.controlId.length === 0) return 'unknown-control';
  const control = findContentControl(part, op.controlId);
  if (!control) return 'unknown-control';
  if (!sdtPrChild(contentControlPropertiesOf(control), 'docPartList')) return 'typeMismatch';
  if (
    isBoundContentControl(control) ||
    contentControlAncestorsOf(part, control.id).some(isBoundContentControl)
  ) {
    return 'bound';
  }
  if (effectiveLockOf(part, control).content) return 'locked';
  if (isTemporaryControl(control) && effectiveLockOf(part, control).wrapper) return 'locked';
  if (typeof op.name !== 'string' || op.name.length === 0 || !isValidXmlText(op.name)) {
    return 'invalidArgs';
  }
  if (!Array.isArray(op.blocks) || op.blocks.length === 0) return 'fragment-invalid-block';
  if (op.blocks.length > MAX_BUILDING_BLOCK_BLOCKS) return 'fragment-resource-budget';
  const budget = { nodes: 0 };
  for (const block of op.blocks) {
    if (block.kind === 'textValue' || !BODY_BLOCK_KINDS.has(block.kind)) {
      return 'fragment-invalid-block';
    }
    const refused = shapeOf(block, 1, budget);
    if (refused) return refused;
  }
  if (wrapsTableStructure(control)) return 'unsupported';
  // An inline control holds runs: only a one-paragraph block has runs to give it. A block
  // body with several paragraphs or a table needs a block-level control, as in Word.
  if (isInlineControl(part, op.controlId)) {
    if (op.blocks.length !== 1 || op.blocks[0]!.kind !== 'paragraph') return 'unsupported';
  }
  return null;
}

function withoutShowingPlaceholder(control: OoxmlNode): OoxmlNode {
  if (control.kind === 'textValue') return control;
  const properties = contentControlPropertiesOf(control);
  if (!properties) return control;
  const kept = properties.children.filter(
    (child) => child.kind === 'textValue' || child.localName !== 'showingPlcHdr'
  );
  if (kept.length === properties.children.length) return control;
  const next = { ...properties, children: kept } as OoxmlNode;
  return {
    ...control,
    children: control.children.map((child) => (child.id === properties.id ? next : child)),
  } as OoxmlNode;
}

export function applyInsertBuildingBlock(
  part: OoxmlPart,
  op: InsertBuildingBlockOp,
  options?: EditOptions
): TreeOpResult {
  const control = findContentControl(part, op.controlId);
  if (!control) return { ok: false, reason: 'unknown-control' };
  const owner = parentOf(part, control.id);

  // Fresh ids from the paste family, so a clone can never collide with a node the tree
  // already holds, and fresh `w14:paraId`s, so two picks of one block stay distinct.
  const nextId = createNodeIdAllocator(part, 'paste');
  const paraIds = new Set(usedParaIds(part.root as OoxmlElement));
  const counter = { value: 0 };
  const blocks = op.blocks.map((block, index) =>
    withFreshParaIds(cloneWithNewIds(block, nextId), paraIds, `${op.controlId}:${index}`, counter)
  );
  const bound = withRequiredNamespaceBindings(part, blocks);

  const inline = isInlineControl(bound, op.controlId);
  const children = inline
    ? (blocks[0] as OoxmlElement).children.filter(
        (child) => child.kind !== 'paragraphProperties' && !isWml(child, 'pPr')
      )
    : blocks;
  const nextControl = withoutShowingPlaceholder(replaceControlContent(control, children, nextId));

  const effect = withParagraphDiff(
    {
      dirty: owner ? [owner.id] : [control.id],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
    },
    control,
    nextControl
  );

  if (isTemporaryControl(control)) {
    if (!owner) return { ok: false, reason: 'tree-invariant' };
    const kept = contentControlUnwrapPayload(nextControl);
    if (!kept) return { ok: false, reason: 'tree-invariant' };
    const siblings = owner.children.flatMap((child) => (child.id === control.id ? kept : [child]));
    return fromEdit(replaceChildren(bound, owner.id, siblings, options), effect);
  }
  return fromEdit(replaceNode(bound, control.id, nextControl, options), effect);
}
