// `insertFragment` — the clipboard fragment's atomic landing (rich-clipboard-fidelity 2.1).
//
// The op carries BLOCKS ONLY, staying JSON-safe like every TreeDocOp; the resource merge
// travels through the package-edit path in the same transaction (clipboard-fragment-merge).
// Word's paragraph-mark rule at the seam: a merged edge paragraph takes the properties of
// the mark that ENDS it — the fragment's first-paragraph mark on the leading merge, the
// host's original mark on the trailing merge. A single-paragraph fragment whose source
// mark was not covered splices inline and leaves host properties untouched.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  isValidParaId,
  mintParaId,
  mintedParagraphIdentityAttributes,
  usedParaIds,
} from '../package/para-id.ts';
import { W14_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import {
  cloneWithNewIds,
  paragraphPropertiesNodeOf,
  parentOf,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import {
  indivisibleAt,
  isParagraph,
  paragraphLength,
  splitsSurrogate,
} from './tree-op-segments.ts';
import { rejectContentEdit } from './tree-op-validate-controls.ts';
import { applyTreeOp } from './tree-op-apply.ts';
import type { TreeDocOp, TreeOpEffect, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export type InsertFragmentOp = Extract<TreeDocOp, { readonly op: 'insertFragment' }>;

/** Fragment budgets: a hostile payload cannot force unbounded tree work. */
export const MAX_FRAGMENT_INSERT_BLOCKS = 50_000;
export const MAX_FRAGMENT_DEPTH = 64;
export const MAX_FRAGMENT_NODES = 500_000;

const INSERTABLE_BLOCK_KINDS = new Set(['paragraph', 'table', 'contentControl']);

function fragmentShape(
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
    const refused = fragmentShape(child, depth + 1, budget);
    if (refused) return refused;
  }
  return null;
}

export function validateInsertFragment(
  part: OoxmlPart,
  op: InsertFragmentOp
): TreeOpRejection | null {
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (!isParagraph(paragraph)) return 'not-a-paragraph';
  if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > paragraphLength(paragraph)) {
    return 'offset-out-of-range';
  }
  if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
  if (indivisibleAt(paragraph, op.offset)) return 'indivisible-content';
  if (!Array.isArray(op.blocks) || op.blocks.length === 0) return 'fragment-invalid-block';
  if (op.blocks.length > MAX_FRAGMENT_INSERT_BLOCKS) return 'fragment-resource-budget';
  const budget = { nodes: 0 };
  for (const block of op.blocks) {
    if (block.kind === 'textValue' || !INSERTABLE_BLOCK_KINDS.has(block.kind)) {
      return 'fragment-invalid-block';
    }
    const refused = fragmentShape(block, 1, budget);
    if (refused) return refused;
  }
  return rejectContentEdit(part, paragraph as OoxmlParagraphNode, op.offset, op.offset);
}

/** Fresh `w14:paraId`/`w14:textId` on every cloned paragraph, deterministic per seat. */
function withFreshParaIds(
  node: OoxmlNode,
  used: Set<string>,
  seedBase: string,
  counter: { value: number }
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const element: OoxmlElement = node;
  let attributes = element.attributes;
  if (element.localName === 'p' && element.namespaceUri === WML_NAMESPACE_URI) {
    const identity = element.attributes.find(
      (attribute) =>
        attribute.namespaceUri === W14_NAMESPACE_URI && attribute.localName === 'paraId'
    );
    if (identity && isValidParaId(identity.value)) {
      const minted = mintParaId(`${seedBase}:${counter.value}`, used);
      counter.value += 1;
      used.add(minted);
      const kept = element.attributes.filter(
        (attribute) =>
          !(
            attribute.namespaceUri === W14_NAMESPACE_URI &&
            (attribute.localName === 'paraId' || attribute.localName === 'textId')
          )
      );
      attributes = [
        ...kept,
        ...mintedParagraphIdentityAttributes(identity.prefix ?? 'w14', minted),
      ] as typeof element.attributes;
    }
  }
  const children = element.children.map((child) =>
    withFreshParaIds(child, used, seedBase, counter)
  );
  const childrenChanged = children.some((child, index) => child !== element.children[index]);
  if (attributes === element.attributes && !childrenChanged) return node;
  return { ...element, attributes, children } as OoxmlNode;
}

/**
 * Prefix bindings the incoming nodes need that the part root does not declare.
 *
 * Fragment content legitimately uses prefixes the TARGET root never bound (`wp:`, `a:`,
 * `pic:`, `w14:` — the source bound them on ITS root, which does not travel). The commit
 * validator requires every prefix bound in scope, so the missing ones are added to the
 * root; a prefix already bound to a DIFFERENT uri stays untouched and the incoming nodes
 * keep working through their own local bindings when they carry any.
 */
export function withRequiredNamespaceBindings(
  part: OoxmlPart,
  nodes: readonly OoxmlNode[]
): OoxmlPart {
  const rootBindings = new Map(
    part.root.namespaceBindings.map((binding) => [binding.prefix, binding.namespaceUri])
  );
  const additions = new Map<string, string>();
  const visit = (node: OoxmlNode, scope: ReadonlyMap<string, string>): void => {
    if (node.kind === 'textValue') return;
    let local = scope;
    if (node.namespaceBindings.length > 0) {
      const merged = new Map(scope);
      for (const binding of node.namespaceBindings) {
        merged.set(binding.prefix, binding.namespaceUri);
      }
      local = merged;
    }
    const need = (prefix: string | undefined, namespaceUri: string): void => {
      if (prefix === undefined || prefix.length === 0 || namespaceUri.length === 0) return;
      if (local.get(prefix) === namespaceUri) return;
      if (rootBindings.get(prefix) === namespaceUri) return;
      if (rootBindings.has(prefix) || additions.has(prefix)) {
        if (additions.get(prefix) === namespaceUri) return;
        // Bound to something else: leave it; the serializer resolves through local bindings.
        if (rootBindings.get(prefix) !== undefined && rootBindings.get(prefix) !== namespaceUri) {
          return;
        }
        return;
      }
      additions.set(prefix, namespaceUri);
    };
    need(node.prefix, node.namespaceUri);
    for (const attribute of node.attributes) {
      need(attribute.prefix, attribute.namespaceUri);
    }
    for (const child of node.children) visit(child, local);
  };
  for (const node of nodes) visit(node, rootBindings);
  if (additions.size === 0) return part;
  const root = {
    ...part.root,
    namespaceBindings: [
      ...part.root.namespaceBindings,
      ...[...additions].map(([prefix, namespaceUri]) => ({ prefix, namespaceUri })),
    ],
  } as typeof part.root;
  return Object.freeze({ ...part, root }) as OoxmlPart;
}

function inlineChildrenOf(paragraph: OoxmlElement): readonly OoxmlNode[] {
  const pPr = paragraphPropertiesNodeOf(paragraph);
  return paragraph.children.filter((child) => child !== pPr);
}

function rebuiltParagraph(
  pPr: OoxmlElement | undefined,
  inline: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  return pPr ? [pPr, ...inline] : inline;
}

export function applyInsertFragment(
  hostPart: OoxmlPart,
  op: InsertFragmentOp,
  options?: EditOptions
): TreeOpResult {
  const host = findNode(hostPart, op.paragraphId);
  if (!host || host.kind !== 'paragraph') return { ok: false, reason: 'unknown-paragraph' };

  // Clone every block with fresh node ids and fresh paragraph identities: the fragment's
  // ids belong to another document, and a second paste of the same payload must not
  // collide with the first.
  const nextId = createNodeIdAllocator(hostPart);
  const paraIds = new Set(usedParaIds(hostPart.root as OoxmlElement));
  const counter = { value: 0 };
  const blocks = op.blocks.map((block, index) =>
    withFreshParaIds(
      cloneWithNewIds(block, nextId),
      paraIds,
      `${op.paragraphId}:${op.offset}:${index}`,
      counter
    )
  );

  // Prefixes the fragment uses must be bound at the target root before commit validation.
  const part = withRequiredNamespaceBindings(hostPart, blocks);

  const first = blocks[0]!;
  const last = blocks[blocks.length - 1]!;
  const inlineOnly =
    blocks.length === 1 && first.kind === 'paragraph' && op.lastMarkCovered !== true;

  if (inlineOnly) {
    // Pure inline splice: split, append the fragment's inline content to the head, join.
    // Reusing split+join keeps every offset/atom/wrapper rule identical to typing lanes.
    const split = applyTreeOp(
      part,
      { op: 'splitParagraph', paragraphId: host.id, offset: op.offset },
      options
    );
    if (!split.ok) return split;
    const tailId = split.effect.split?.tail;
    if (!tailId) return { ok: false, reason: 'tree-invariant' };
    const head = findNode(split.part, host.id);
    if (!head || head.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const appended = replaceChildren(
      split.part,
      head.id,
      [...head.children, ...inlineChildrenOf(first as OoxmlElement)],
      { ...options, deferValidation: true }
    );
    if (!appended.ok) return { ok: false, reason: 'tree-invariant' };
    const joined = applyTreeOp(
      appended.part,
      { op: 'joinParagraphs', firstId: head.id, secondId: tailId },
      options
    );
    if (!joined.ok) return joined;
    const effect: TreeOpEffect = {
      dirty: [host.id],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
    };
    return { ok: true, part: joined.part, effect };
  }

  // Structural landing: split the host, merge paragraph edges, insert the rest between.
  const split = applyTreeOp(
    part,
    { op: 'splitParagraph', paragraphId: host.id, offset: op.offset },
    options
  );
  if (!split.ok) return split;
  const tailId = split.effect.split?.tail;
  if (!tailId) return { ok: false, reason: 'tree-invariant' };
  let current = split.part;

  const middle: OoxmlNode[] = [...blocks];
  const created: string[] = [tailId];

  // Leading merge: the merged paragraph ends at the fragment's first mark, so it takes the
  // fragment's paragraph properties and keeps the host's leading text.
  if (first.kind === 'paragraph') {
    middle.shift();
    const head = findNode(current, host.id);
    if (!head || head.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const fragmentPPr = paragraphPropertiesNodeOf(first as OoxmlElement);
    const headInline = inlineChildrenOf(head);
    const replaced = replaceChildren(
      current,
      head.id,
      rebuiltParagraph(fragmentPPr, [...headInline, ...inlineChildrenOf(first as OoxmlElement)]),
      { ...options, deferValidation: true }
    );
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
  }

  // Trailing merge: the merged paragraph ends at the HOST's original mark (now on the
  // tail), so the host properties stay and the fragment's last inline content leads it.
  if (
    middle.length > 0 &&
    last.kind === 'paragraph' &&
    middle[middle.length - 1] === last &&
    op.lastMarkCovered !== true
  ) {
    middle.pop();
    const tail = findNode(current, tailId);
    if (!tail || tail.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const tailPPr = paragraphPropertiesNodeOf(tail);
    const tailInline = inlineChildrenOf(tail);
    const replaced = replaceChildren(
      current,
      tail.id,
      rebuiltParagraph(tailPPr, [...inlineChildrenOf(last as OoxmlElement), ...tailInline]),
      { ...options, deferValidation: true }
    );
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
  }

  if (middle.length > 0) {
    const parent = parentOf(current, tailId);
    if (!parent) return { ok: false, reason: 'tree-invariant' };
    const tailIndex = parent.children.findIndex((child) => child.id === tailId);
    if (tailIndex === -1) return { ok: false, reason: 'tree-invariant' };
    const inserted = insertChildren(current, parent.id, tailIndex, middle, {
      ...options,
      deferValidation: true,
    });
    if (!inserted.ok) return { ok: false, reason: 'tree-invariant' };
    current = inserted.part;
    for (const block of middle) created.push(block.id);
  }

  const effect: TreeOpEffect = {
    dirty: [host.id, tailId],
    created,
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };
  return { ok: true, part: current, effect };
}
