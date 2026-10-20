/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Local edits of paragraph inline content, written to the paragraph's shared text.
 *
 * A journal addresses the editor's tree: runs, text elements, properties and wrappers by
 * node ID. In shared state those live in one shared text per paragraph. The journal's
 * effects on them are replayed onto a scratch copy of each paragraph they touch, built from
 * the same view every replica shows; the paragraph's inline sequence before and after is
 * then diffed, and only the difference is written: inserted and deleted characters and
 * changed attributes. Effects on anything else (block structure, paragraph properties, and
 * the inside of embedded objects) pass through to the record pipeline unchanged.
 */
import {
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import type { CanonicalPrimitiveEffect } from '@docx-editor.dev/core/collaboration/replication';
import { keyId } from './registry-node-reads.ts';
import {
  attributeFrom,
  elementFrom,
  embedPlaceholder,
  expectElement,
  textNode,
} from './node-shapes.ts';
import { idOf, type LogicalId } from './identity.ts';
import { sharedEffect, type SharedEffect } from './shared-effect.ts';
import { rejectDangerousKey } from './limits.ts';
import type { DocumentRegistry } from './registry.ts';
import { inlineChildren } from './paragraph-text-view.ts';
import { partitionChildIds, sharedChildShell } from './singleton-children.ts';

interface ScratchNode {
  readonly id: LogicalId;
  kind: string;
  namespaceUri: string;
  localName: string;
  prefix?: string;
  attributes: OoxmlAttribute[];
  bindings: { prefix: string; namespaceUri: string }[];
  children: LogicalId[];
  value: string | null;
  parent: LogicalId | null;
  /** A node whose own content stays in records: a block child or an embedded object. */
  opaque: boolean;
  /** A block child of its paragraph, such as `w:pPr`. */
  block: boolean;
  /** A paragraph this plan writes. */
  paragraph: boolean;
  /** Placed under a parent outside the plan, such as a new list level's `w:rPr`. */
  outside?: boolean;
}

/** What one journal changes in paragraph shared texts. */
export interface InlinePlan {
  readonly paragraphs: readonly { readonly id: LogicalId; readonly after: OoxmlElement }[];
  /** Embedded nodes the touched paragraphs held before the journal. */
  readonly embedsBefore: ReadonlySet<LogicalId>;
}

const INLINE_SHELL_KINDS = new Set(['run', 'runProperties']);
const TEXT_ELEMENTS = new Set(['t', 'delText', 'instrText', 'delInstrText']);
const WRAPPERS = new Set([
  'hyperlink',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'sdt',
  'sdtContent',
  'fldSimple',
  'smartTag',
  'customXml',
  'dir',
  'bdo',
]);

function isInlineShell(node: ScratchNode): boolean {
  if (INLINE_SHELL_KINDS.has(node.kind)) return true;
  return (
    node.namespaceUri === WML_NAMESPACE_URI &&
    (TEXT_ELEMENTS.has(node.localName) || WRAPPERS.has(node.localName))
  );
}

/** An attribute as the canonical tree types it. */
function attributeOf(
  qname: { namespaceUri: string; localName: string; prefix?: string },
  value: string
): OoxmlAttribute {
  const prefix = qname.prefix === undefined ? {} : { prefix: qname.prefix };
  if (
    qname.namespaceUri === XML_NAMESPACE_URI &&
    qname.localName === 'space' &&
    qname.prefix === 'xml' &&
    (value === 'default' || value === 'preserve')
  ) {
    return attributeFrom({
      kind: 'xmlSpace',
      namespaceUri: XML_NAMESPACE_URI,
      localName: 'space',
      prefix: 'xml',
      value,
    });
  }
  if (qname.namespaceUri === WML_NAMESPACE_URI && qname.localName === 'val') {
    return attributeFrom({
      kind: 'wmlVal',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'val',
      ...prefix,
      value,
    });
  }
  return attributeFrom({
    kind: 'genericExtension',
    namespaceUri: qname.namespaceUri,
    localName: qname.localName,
    ...prefix,
    value,
  });
}

/** A repeat of one shell in a paragraph carries a suffix; shared text names the shell. */
function shellId(id: string): string {
  return id.replace(/(~\d+)+$/, '');
}

/** Why routing refuses a journal, in the codes the record pipeline uses for the same faults. */
interface RouteRefusal {
  readonly code:
    | 'invalid-bound'
    | 'invalid-logical-id'
    | 'unknown-logical-id'
    | 'prototype-key'
    | 'text-too-long'
    | 'too-many-children';
  readonly detail: string;
}

class Scratch {
  readonly nodes = new Map<LogicalId, ScratchNode>();
  /** The first effect whose bounds the scratch tree cannot satisfy. */
  refusal: RouteRefusal | null = null;

  refuse(code: RouteRefusal['code'], detail: string): false {
    this.refusal ??= { code, detail };
    return false;
  }
  /** Text nodes this journal describes again, whose first insert may be their fill. */
  readonly described = new Set<LogicalId>();

  add(node: OoxmlNode, parent: LogicalId | null, opaqueIds: ReadonlySet<LogicalId>): void {
    const id = idOf(node);
    const opaque = opaqueIds.has(id);
    const scratch: ScratchNode = {
      id,
      kind: node.kind,
      namespaceUri: node.kind === 'textValue' ? '' : node.namespaceUri,
      localName: node.kind === 'textValue' ? '' : node.localName,
      ...(node.kind !== 'textValue' && node.prefix !== undefined ? { prefix: node.prefix } : {}),
      attributes: node.kind === 'textValue' ? [] : [...node.attributes],
      bindings: node.kind === 'textValue' ? [] : [...node.namespaceBindings],
      children: [],
      value: node.kind === 'textValue' ? node.value : null,
      parent,
      opaque,
      block: false,
      paragraph: false,
    };
    this.nodes.set(id, scratch);
    if (node.kind === 'textValue' || opaque) return;
    for (const child of node.children) {
      scratch.children.push(idOf(child));
      this.add(child, id, opaqueIds);
    }
  }

  placeholder(id: LogicalId, kind: string): ScratchNode {
    const existing = this.nodes.get(id);
    if (existing) return existing;
    const node: ScratchNode = {
      id,
      kind,
      namespaceUri: '',
      localName: '',
      attributes: [],
      bindings: [],
      children: [],
      value: null,
      parent: null,
      opaque: true,
      block: false,
      paragraph: false,
    };
    this.nodes.set(id, node);
    return node;
  }

  detach(id: LogicalId): void {
    const node = this.nodes.get(id);
    if (!node || node.parent === null) return;
    const parent = this.nodes.get(node.parent);
    if (parent) {
      const at = parent.children.indexOf(id);
      if (at >= 0) parent.children.splice(at, 1);
    }
    node.parent = null;
  }

  /** Whether effects on this node's children are this plan's to write. */
  open(id: LogicalId): boolean {
    const node = this.nodes.get(id);
    return node !== undefined && !node.opaque && !this.insideOpaque(node);
  }

  private insideOpaque(node: ScratchNode): boolean {
    let at = node.parent;
    for (let depth = 0; at !== null && depth < 256; depth += 1) {
      const parent = this.nodes.get(at);
      if (!parent) return false;
      if (parent.opaque) return true;
      at = parent.parent;
    }
    return false;
  }

  /** The paragraph a node sits in, and whether it is part of that paragraph's inline text. */
  region(id: LogicalId): { paragraph: LogicalId; inline: boolean } | null {
    const chain: ScratchNode[] = [];
    let node = this.nodes.get(id);
    for (let depth = 0; node && depth < 256; depth += 1) {
      chain.push(node);
      if (node.paragraph) break;
      node = node.parent === null ? undefined : this.nodes.get(node.parent);
    }
    const root = chain[chain.length - 1];
    if (!root?.paragraph) return null;
    // Walk down from the paragraph: inline shells stay inline, anything else is an object.
    for (let at = chain.length - 2; at >= 0; at -= 1) {
      const step = chain[at]!;
      if (step.block || step.opaque) return { paragraph: root.id, inline: false };
      if (step.kind === 'textValue' || isInlineShell(step)) continue;
      const parent = chain[at + 1]!;
      // A run's properties, a wrapper's fixed parts, and everything inside them are part of
      // their shell, as a content control's properties are of the control.
      if (parent.kind === 'runProperties' || insideShellPart(chain, at)) continue;
      return { paragraph: root.id, inline: false };
    }
    return { paragraph: root.id, inline: true };
  }

  /** The top of the detached subtree a node belongs to. */
  detachedRoot(id: LogicalId): ScratchNode {
    let node = this.nodes.get(id)!;
    for (let depth = 0; node.parent !== null && depth < 256; depth += 1) {
      const parent = this.nodes.get(node.parent);
      if (!parent) break;
      node = parent;
    }
    return node;
  }

  /** The node's subtree. A node listed twice, as a journal applied twice lists it, shows once. */
  toTree(id: LogicalId, shown = new Set<LogicalId>()): OoxmlNode {
    shown.add(id);
    const node = this.nodes.get(id)!;
    if (node.kind === 'textValue') {
      return textNode(shellId(node.id), node.value ?? '');
    }
    return elementFrom({
      id: node.paragraph || node.opaque ? node.id : shellId(node.id),
      kind: node.kind,
      namespaceUri: node.namespaceUri,
      localName: node.localName,
      namespaceBindings: node.bindings,
      attributes: node.attributes,
      children: node.opaque ? [] : this.childTrees(node, shown),
      ...(node.prefix === undefined ? {} : { prefix: node.prefix }),
    });
  }

  private childTrees(node: ScratchNode, shown: Set<LogicalId>): OoxmlNode[] {
    const children: OoxmlNode[] = [];
    for (const child of node.children) {
      // A child a later splice listed elsewhere without unlisting it here belongs there.
      if (this.nodes.get(child)?.parent !== node.id || shown.has(child)) continue;
      children.push(this.toTree(child, shown));
    }
    return children;
  }
}

/** Whether the node at `index` of a bottom-up chain lies inside a property element or wrapper part. */
function insideShellPart(chain: readonly ScratchNode[], index: number): boolean {
  for (let at = index; at < chain.length - 1; at += 1) {
    const node = chain[at]!;
    const parent = chain[at + 1]!;
    if (parent.kind === 'runProperties') return true;
    if (parent.namespaceUri === WML_NAMESPACE_URI && WRAPPERS.has(parent.localName)) {
      // A wrapper's children are content unless they are its fixed parts.
      return node.namespaceUri === WML_NAMESPACE_URI && /Pr$|^fldData$/.test(node.localName);
    }
  }
  return false;
}

function referencedIds(effect: SharedEffect): LogicalId[] {
  switch (effect.kind) {
    case 'putNode':
      return [effect.descriptor.logicalId];
    case 'spliceText':
    case 'setAttribute':
    case 'setNamespaceBinding':
      return [effect.logicalId];
    case 'spliceChildren':
      return [effect.parentLogicalId, ...effect.childLogicalIds];
    case 'moveNode':
      return [effect.logicalId, effect.destinationParentLogicalId];
    default:
      return [];
  }
}

/**
 * Split a journal into effects for the record pipeline and a plan for paragraph texts.
 * Returns no plan when the journal touches no paragraph content.
 */
export function routeInlineEffects(
  registry: DocumentRegistry,
  given: readonly CanonicalPrimitiveEffect[]
): {
  readonly passThrough: CanonicalPrimitiveEffect[];
  readonly plan: InlinePlan | null;
  readonly refusal?: RouteRefusal;
} {
  const effects = given.map(sharedEffect);
  const minted = new Map<LogicalId, Extract<SharedEffect, { kind: 'putNode' }>>();
  for (const effect of effects) {
    if (effect.kind === 'putNode') minted.set(effect.descriptor.logicalId, effect);
  }
  const paragraphOf = (id: LogicalId): LogicalId | null => {
    if (registry.inline.textOf(id)) return id;
    if (minted.get(id)?.descriptor.kind === 'paragraph') return id;
    // A paragraph whose shared text has not arrived yet is still one: its runs go to the text
    // its plan creates, never to records. One that lists runs as records keeps them there.
    if (registry.kindOf(id) === 'paragraph' && !listsRunRecords(registry, id)) {
      return id;
    }
    return registry.inline.owner(id);
  };
  const touched = new Set<LogicalId>();
  for (const effect of effects) {
    for (const id of referencedIds(effect)) {
      const paragraph = paragraphOf(id);
      if (paragraph) touched.add(paragraph);
    }
  }
  if (touched.size === 0) return { passThrough: [...effects], plan: null };

  const build = (paragraphs: ReadonlySet<LogicalId>) => {
    const scratch = new Scratch();
    const embedsBefore = new Set<LogicalId>();
    for (const paragraphId of paragraphs) {
      const text = registry.inline.textOf(paragraphId);
      const root = scratch.placeholder(paragraphId, 'paragraph');
      root.opaque = false;
      root.paragraph = true;
      root.kind = 'paragraph';
      root.namespaceUri = WML_NAMESPACE_URI;
      root.localName = 'p';
      // Block children as a replica shows them: concurrent property copies show as one.
      const record = registry.record(paragraphId);
      const { shown } = partitionChildIds(
        'paragraph',
        record && 'childIds' in record ? record.childIds : [],
        (id) => sharedChildShell(registry, id)
      );
      for (const childId of shown) {
        const block = scratch.placeholder(childId, registry.kindOf(childId) ?? 'generic');
        block.block = true;
        block.parent = paragraphId;
        root.children.push(childId);
      }
      if (!text) continue;
      const embedded = new Set<LogicalId>();
      // An embed shows as the materializer shows it: not when its record is deleted or has not
      // arrived. A placeholder for it put a child in this tree that the editor's tree lacks,
      // and the journal's child indexes then addressed the wrong children.
      const placeholderOf = (id: LogicalId): OoxmlNode | null => {
        if (!registry.showsAsChild(id)) return null;
        embedded.add(id);
        return embedPlaceholder(id);
      };
      for (const child of inlineChildren(
        paragraphId,
        text,
        placeholderOf,
        registry.limits,
        registry.inline.viewOf(paragraphId)
      )) {
        scratch.add(child, paragraphId, embedded);
        root.children.push(idOf(child));
      }
      for (const id of embedded) {
        embedsBefore.add(id);
        const node = scratch.nodes.get(id);
        if (node) node.kind = registry.kindOf(id) ?? 'generic';
      }
    }
    return { scratch, embedsBefore };
  };
  let { scratch, embedsBefore } = build(touched);
  // An inline node a journal names but no touched paragraph shows: its ID no longer says
  // where it shows. Find the paragraph that shows it and build again with it.
  const missing = effects
    .flatMap((effect) => referencedIds(effect))
    .filter((id) => !scratch.nodes.has(id) && !minted.has(id) && !registry.hasNode(id));
  if (missing.length > 0) {
    const found = new Set(touched);
    for (const showing of paragraphsShowing(registry, new Set(missing))) found.add(showing);
    if (found.size > touched.size) {
      for (const id of found) touched.add(id);
      ({ scratch, embedsBefore } = build(touched));
    }
  }

  const applied: boolean[] = [];
  // A paragraph splice that adds or removes a block child also goes to the record pipeline,
  // as a splice over block children only: that pipeline resolves concurrent property copies.
  const blockSplices = new Map<number, SharedEffect>();
  for (const effect of effects) {
    const block = blockSplice(scratch, effect, registry);
    if (block) blockSplices.set(applied.length, block);
    applied.push(replay(scratch, effect, registry));
    if (scratch.refusal) return { passThrough: [...effects], plan: null, refusal: scratch.refusal };
  }

  const passThrough: SharedEffect[] = [];
  effects.forEach((effect, index) => {
    const block = blockSplices.get(index);
    if (block) passThrough.push(block);
    else if (!applied[index] || !consumed(scratch, effect)) passThrough.push(effect);
  });
  const paragraphs = [...touched]
    .filter((id) => scratch.nodes.get(id)?.paragraph)
    .map((id) => ({ id, after: expectElement(scratch.toTree(id)) }));
  return { passThrough, plan: { paragraphs, embedsBefore } };
}

/**
 * The block part of a splice of a paragraph's children, in block child positions, or null
 * when the splice adds and removes no block child.
 */
function blockSplice(
  scratch: Scratch,
  effect: SharedEffect,
  registry: DocumentRegistry
): SharedEffect | null {
  if (effect.kind !== 'spliceChildren') return null;
  const parent = scratch.nodes.get(effect.parentLogicalId);
  if (!parent?.paragraph) return null;
  const isBlock = (id: LogicalId): boolean => {
    const node = scratch.nodes.get(id);
    return node
      ? node.block || node.kind === 'paragraphProperties'
      : registry.kindOf(id) === 'paragraphProperties';
  };
  const shown = parent.children.filter((id) => scratch.nodes.get(id)?.parent === parent.id);
  const removed = parent.children.slice(effect.start, effect.start + effect.deleteCount);
  const deleted = removed.filter((id) => scratch.nodes.get(id)?.block).length;
  const inserted = effect.childLogicalIds.filter(isBlock);
  if (deleted === 0 && inserted.length === 0) return null;
  const start = parent.children
    .slice(0, effect.start)
    .filter((id) => shown.includes(id) && scratch.nodes.get(id)?.block).length;
  return { ...effect, start, deleteCount: deleted, childLogicalIds: inserted };
}

/** Apply one effect to the scratch tree. False when it does not concern the scratch tree. */
function replay(scratch: Scratch, effect: SharedEffect, registry: DocumentRegistry): boolean {
  switch (effect.kind) {
    case 'putNode': {
      const { descriptor } = effect;
      if (rejectDangerousKey(descriptor.logicalId)) {
        return scratch.refuse('invalid-logical-id', descriptor.logicalId);
      }
      if (
        descriptor.kind !== 'textValue' &&
        (rejectDangerousKey(descriptor.qname.localName) ||
          (descriptor.qname.prefix !== undefined && rejectDangerousKey(descriptor.qname.prefix)))
      ) {
        return scratch.refuse('prototype-key', descriptor.logicalId);
      }
      const existing = scratch.nodes.get(descriptor.logicalId);
      if (descriptor.kind === 'textValue') {
        if (existing) scratch.described.add(descriptor.logicalId);
        if (!existing) {
          const node = scratch.placeholder(descriptor.logicalId, 'textValue');
          node.opaque = false;
          node.value = '';
        }
        return true;
      }
      const node = existing ?? scratch.placeholder(descriptor.logicalId, descriptor.kind);
      if (!existing) node.opaque = false;
      if (existing?.opaque) return false;
      node.kind = descriptor.kind;
      node.namespaceUri = descriptor.qname.namespaceUri;
      node.localName = descriptor.qname.localName;
      if (descriptor.qname.prefix !== undefined) node.prefix = descriptor.qname.prefix;
      if (descriptor.kind === 'paragraph' && !registry.hasNode(descriptor.logicalId)) {
        node.paragraph = true;
      }
      return true;
    }
    case 'spliceText': {
      const node = scratch.nodes.get(effect.logicalId);
      if (!node || node.value === null || !scratch.open(effect.logicalId)) return false;
      // A journal applied again describes its new text nodes again and fills them with the
      // text they already hold. Only an insert of exactly that text is the fill.
      if (
        !Number.isSafeInteger(effect.utf16Start) ||
        !Number.isSafeInteger(effect.deleteCount) ||
        effect.utf16Start < 0 ||
        effect.deleteCount < 0 ||
        effect.utf16Start + effect.deleteCount > node.value.length
      ) {
        return scratch.refuse('invalid-bound', effect.logicalId);
      }
      if (
        node.value.length - effect.deleteCount + effect.insert.length >
        registry.limits.maxTextLength
      ) {
        return scratch.refuse('text-too-long', effect.logicalId);
      }
      const described = scratch.described.delete(effect.logicalId);
      if (
        described &&
        effect.utf16Start === 0 &&
        effect.deleteCount === 0 &&
        effect.insert.length > 0 &&
        effect.insert === node.value
      ) {
        return true;
      }
      node.value =
        node.value.slice(0, effect.utf16Start) +
        effect.insert +
        node.value.slice(effect.utf16Start + effect.deleteCount);
      return true;
    }
    case 'setAttribute': {
      const node = scratch.nodes.get(effect.logicalId);
      if (!node || node.paragraph || !scratch.open(effect.logicalId)) return false;
      if (
        rejectDangerousKey(effect.qname.localName) ||
        (effect.qname.prefix !== undefined && rejectDangerousKey(effect.qname.prefix))
      ) {
        return scratch.refuse('prototype-key', effect.logicalId);
      }
      const at = node.attributes.findIndex(
        (attribute) =>
          attribute.namespaceUri === effect.qname.namespaceUri &&
          attribute.localName === effect.qname.localName
      );
      if (effect.value === null) {
        if (at >= 0) node.attributes.splice(at, 1);
      } else if (at >= 0) {
        node.attributes[at] = attributeOf(effect.qname, effect.value);
      } else {
        node.attributes.push(attributeOf(effect.qname, effect.value));
      }
      return true;
    }
    case 'setNamespaceBinding': {
      const node = scratch.nodes.get(effect.logicalId);
      if (!node || node.paragraph || !scratch.open(effect.logicalId)) return false;
      if (rejectDangerousKey(effect.prefix))
        return scratch.refuse('prototype-key', effect.logicalId);
      const at = node.bindings.findIndex((binding) => binding.prefix === effect.prefix);
      if (effect.uri === null) {
        if (at >= 0) node.bindings.splice(at, 1);
      } else if (at >= 0) {
        node.bindings[at] = { prefix: effect.prefix, namespaceUri: effect.uri };
      } else {
        node.bindings.push({ prefix: effect.prefix, namespaceUri: effect.uri });
      }
      return true;
    }
    case 'spliceChildren': {
      if (!scratch.open(effect.parentLogicalId)) {
        // Its children now hang from records the record pipeline writes.
        for (const id of effect.childLogicalIds) {
          const node = scratch.nodes.get(id);
          if (!node) continue;
          node.parent = effect.parentLogicalId;
          node.outside = true;
        }
        return false;
      }
      const parent = scratch.nodes.get(effect.parentLogicalId)!;
      if (
        !Number.isSafeInteger(effect.start) ||
        !Number.isSafeInteger(effect.deleteCount) ||
        effect.start < 0 ||
        effect.deleteCount < 0 ||
        effect.start + effect.deleteCount > parent.children.length
      ) {
        return scratch.refuse('invalid-bound', effect.parentLogicalId);
      }
      if (
        parent.children.length - effect.deleteCount + effect.childLogicalIds.length >
        registry.limits.maxChildren
      ) {
        return scratch.refuse('too-many-children', effect.parentLogicalId);
      }
      const dangerous = effect.childLogicalIds.find((id) => rejectDangerousKey(id));
      if (dangerous !== undefined) return scratch.refuse('invalid-logical-id', dangerous);
      // Splices are plain array edits, as in the registry: a child listed under a new parent
      // stays listed under its old one until a splice there removes it.
      const removed = parent.children.splice(effect.start, effect.deleteCount);
      for (const id of removed) {
        const node = scratch.nodes.get(id);
        if (node?.parent === parent.id) node.parent = null;
      }
      const inserted: LogicalId[] = [];
      for (const id of effect.childLogicalIds) {
        // A child is a scratch node or a record. Anything else is a node this replica does
        // not know, which the record pipeline refuses too; a placeholder would reach shared
        // text as an embed of nothing.
        const kind = registry.kindOf(id);
        // A placeholder stands for a record. An inline shell outside the scratch tree is a
        // node of a paragraph view this journal was not made against.
        if (!scratch.nodes.has(id) && (kind === null || !registry.hasNode(id))) {
          return scratch.refuse('unknown-logical-id', id);
        }
        const node = scratch.nodes.get(id) ?? scratch.placeholder(id, kind!);
        node.parent = parent.id;
        node.outside = false;
        if (parent.paragraph && node.kind === 'paragraphProperties') node.block = true;
        inserted.push(id);
      }
      parent.children.splice(effect.start, 0, ...inserted);
      return true;
    }
    case 'moveNode': {
      const intoScratch = scratch.open(effect.destinationParentLogicalId);
      const fromScratch = scratch.nodes.get(effect.logicalId)?.parent != null;
      if (!intoScratch && !fromScratch) return false;
      const kind = registry.kindOf(effect.logicalId);
      if (
        !scratch.nodes.has(effect.logicalId) &&
        (kind === null || !registry.hasNode(effect.logicalId))
      ) {
        return scratch.refuse('unknown-logical-id', effect.logicalId);
      }
      const node =
        scratch.nodes.get(effect.logicalId) ?? scratch.placeholder(effect.logicalId, kind!);
      scratch.detach(effect.logicalId);
      node.outside = !intoScratch;
      if (intoScratch) {
        const parent = scratch.nodes.get(effect.destinationParentLogicalId)!;
        node.parent = parent.id;
        parent.children.splice(
          Math.max(0, Math.min(effect.destinationIndex, parent.children.length)),
          0,
          effect.logicalId
        );
      }
      // A node that leaves a paragraph for a block parent is moved by the record pipeline.
      return intoScratch;
    }
    default:
      return false;
  }
}

/** Whether a replayed effect is wholly written by the paragraph text plan. */
function consumed(scratch: Scratch, effect: SharedEffect): boolean {
  // Inline content, or a scratch node the journal minted or took out of its paragraph and
  // left nowhere: an intermediate run of a multi-step split exists in no final state.
  const inline = (id: LogicalId): boolean => {
    const region = scratch.region(id);
    if (region) return region.inline;
    const node = scratch.nodes.get(id);
    if (!node || node.opaque || node.paragraph) return false;
    // Detached: inline content only if what it hangs from is an inline shell. A new part,
    // comment or table is block content the record pipeline writes.
    const root = scratch.detachedRoot(id);
    return !root.outside && (root.kind === 'textValue' || isInlineShell(root));
  };
  switch (effect.kind) {
    case 'putNode': {
      const id = effect.descriptor.logicalId;
      const node = scratch.nodes.get(id);
      if (!node || node.paragraph || node.opaque) return false;
      // A shell that ended up nowhere was minted and dropped within the journal.
      return inline(id);
    }
    case 'spliceText':
    case 'setAttribute':
    case 'setNamespaceBinding':
      return inline(effect.logicalId);
    case 'spliceChildren': {
      const parent = scratch.nodes.get(effect.parentLogicalId);
      return parent?.paragraph === true || inline(effect.parentLogicalId);
    }
    case 'moveNode': {
      const parent = scratch.nodes.get(effect.destinationParentLogicalId);
      return parent?.paragraph === true || inline(effect.destinationParentLogicalId);
    }
    default:
      return false;
  }
}

/** Whether a paragraph record lists a run as a record child, as the record model did. */
function listsRunRecords(registry: DocumentRegistry, paragraphId: LogicalId): boolean {
  const record = registry.record(paragraphId);
  if (!record || !('childIds' in record)) return true;
  return record.childIds.some((child) => registry.kindOf(child) === 'run');
}

/** The paragraphs whose shown inline content holds one of `ids`, in one read of every paragraph. */
function paragraphsShowing(
  registry: DocumentRegistry,
  ids: ReadonlySet<LogicalId>
): Set<LogicalId> {
  const found = new Set<LogicalId>();
  const unfound = new Set(ids);
  const shows = (nodes: readonly OoxmlNode[]): boolean =>
    nodes.some(
      (node) => unfound.delete(idOf(node)) || (node.kind !== 'textValue' && shows(node.children))
    );
  registry.schema.nodes.forEach((_record, key) => {
    if (unfound.size === 0) return;
    const paragraphId = keyId(key);
    const text = registry.inline.textOf(paragraphId);
    if (!text || registry.inline.isDeletedParagraph(paragraphId)) return;
    const view = registry.inline.viewOf(paragraphId);
    if (shows(inlineChildren(paragraphId, text, () => null, registry.limits, view))) {
      found.add(paragraphId);
    }
  });
  return found;
}
