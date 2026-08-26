/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Turning shared-state records back into canonical nodes, and the counters that watch the cost.
//
// Every function here is a pure per-node step of a rebuild, which is why they live apart from
// the materializer that sequences them: they run once per node of an edit, so they are where
// the cost of receiving a character is decided, and they are worth reading on their own.

import {
  XML_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlTextNode,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import type { ElementRecord, EncodedAttribute } from './schema.ts';

export function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

export function payloadIdOfNode(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.id;
  return attributeValue(node, 'id') ?? node.id;
}

/**
 * Replace a child array, keeping the identity of every node the two arrays share.
 *
 * Downstream shortcuts key on array identity to prove a subtree did not move, so returning a
 * freshly allocated array with the same contents costs a full revalidation for nothing.
 */
export function replaceChildRange(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  if (previous.length === next.length && previous.every((child, index) => child === next[index])) {
    return previous;
  }
  let start = 0;
  const maxStart = Math.min(previous.length, next.length);
  while (start < maxStart && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return Object.freeze([
    ...previous.slice(0, start),
    ...next.slice(start, nextEnd),
    ...previous.slice(previousEnd),
  ]);
}

export function withRelsChildren(part: OoxmlPart, children: readonly OoxmlNode[]): OoxmlPart {
  const root = part.root;
  if (
    root.children.length === children.length &&
    root.children.every((child, index) => child === children[index])
  ) {
    return part;
  }
  const nextRoot = Object.freeze({
    ...root,
    children: replaceChildRange(root.children, children),
  }) as OoxmlElement;
  return Object.freeze({ ...part, root: nextRoot });
}

function freezeAttribute(attribute: EncodedAttribute): OoxmlAttribute {
  if (attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space') {
    const value = attribute.value === 'preserve' ? 'preserve' : 'default';
    return Object.freeze({
      kind: 'xmlSpace',
      namespaceUri: XML_NAMESPACE_URI,
      localName: 'space',
      prefix: 'xml',
      value,
    });
  }
  if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val') {
    return Object.freeze({
      kind: 'wmlVal',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'val',
      prefix: attribute.prefix,
      value: attribute.value,
    });
  }
  return Object.freeze({
    kind: 'genericExtension',
    namespaceUri: attribute.namespaceUri,
    localName: attribute.localName,
    prefix: attribute.prefix,
    value: attribute.value,
  });
}

/**
 * Nodes this process has read out of shared state and frozen into canonical form.
 *
 * Receiving one remote character must cost the size of the edit, not the size of the
 * document. A duration cannot say which of the two happened on a loaded machine; these
 * counters can, so the receive gates assert against them.
 */
let materializedBuilds = 0;
let materializedReads = 0;
let materializedBlobBytes = 0;
let materializedPlacementVisits = 0;
let materializedFullPlacement = 0;
let materializedPasses = 0;

/** Test-observable count of canonical nodes the materializer has frozen. */
export function materializedNodeBuilds(): number {
  return materializedBuilds;
}

/** Test-observable count of shared-state records the materializer has read. */
export function materializedNodeReads(): number {
  return materializedReads;
}

/**
 * Test-observable count of media bytes the materializer has pulled out of the blob store.
 *
 * `BlobBytesStore.get` hands back a defensive copy, so this is a byte-for-byte copy of
 * every image it names. Assembling the package reads one entry per binary, which made
 * receiving a single character copy every image in the document.
 */
export function materializedBlobBytesRead(): number {
  return materializedBlobBytes;
}

/**
 * Test-observable count of nodes visited to claim reused subtrees.
 *
 * Nothing else sees this walk: a reused subtree reads no record and freezes no node, so the
 * build and read counters both stay flat while the claim visits every node in the document.
 */
export function materializedPlacementClaims(): number {
  return materializedPlacementVisits;
}

/** Test-observable pass counts: how many ran at all, and how many claimed whole subtrees. */
export function materializedPassCounts(): { readonly passes: number; readonly full: number } {
  return { passes: materializedPasses, full: materializedFullPlacement };
}

export function countRecordRead(): void {
  materializedReads += 1;
}

export function countBlobBytes(length: number): void {
  materializedBlobBytes += length;
}

export function countPass(claimsWholeSubtrees: boolean): void {
  materializedPasses += 1;
  if (claimsWholeSubtrees) materializedFullPlacement += 1;
}

export function freezeText(logicalId: LogicalId, value: string): OoxmlTextNode {
  materializedBuilds += 1;
  return Object.freeze({ id: logicalId, kind: 'textValue', value });
}

function sameBindings(previous: OoxmlElement, record: ElementRecord): boolean {
  if (previous.namespaceBindings.length !== record.bindings.length) return false;
  return previous.namespaceBindings.every((binding, index) => {
    const encoded = record.bindings[index]!;
    return binding.prefix === encoded.prefix && binding.namespaceUri === encoded.namespaceUri;
  });
}

function sameAttributes(previous: OoxmlElement, record: ElementRecord): boolean {
  if (previous.attributes.length !== record.attributes.length) return false;
  return previous.attributes.every((attribute, index) => {
    const encoded = record.attributes[index]!;
    return (
      attribute.namespaceUri === encoded.namespaceUri &&
      attribute.localName === encoded.localName &&
      attribute.value === encoded.value &&
      attribute.prefix === (encoded.prefix?.length ? encoded.prefix : undefined)
    );
  });
}

/**
 * Freeze one element, keeping every array the predecessor can still vouch for.
 *
 * A rebuilt node is rebuilt because its CHILDREN moved. Handing it a newly allocated
 * bindings array anyway forfeits every downstream shortcut that keys on that array's
 * identity to prove the inherited namespace context did not change — the delta validator
 * stops pruning at the document element and revalidates the whole part for one keystroke.
 */
export function freezeElement(
  record: ElementRecord,
  children: readonly OoxmlNode[],
  previous?: OoxmlNode
): OoxmlElement {
  materializedBuilds += 1;
  const prior = previous && previous.kind !== 'textValue' ? previous : undefined;
  return Object.freeze({
    id: record.logicalId,
    kind: record.kind,
    namespaceUri: record.namespaceUri,
    localName: record.localName,
    prefix: record.prefix,
    namespaceBindings:
      prior && sameBindings(prior, record)
        ? prior.namespaceBindings
        : Object.freeze(record.bindings.map((binding) => Object.freeze({ ...binding }))),
    attributes:
      prior && sameAttributes(prior, record)
        ? prior.attributes
        : Object.freeze(record.attributes.map(freezeAttribute)),
    children,
  }) as OoxmlElement;
}

export function attributesMatch(node: OoxmlElement, record: ElementRecord): boolean {
  if (node.attributes.length !== record.attributes.length) return false;
  const encoded = new Map(
    record.attributes.map((attribute) => [
      `${attribute.namespaceUri}\n${attribute.localName}`,
      attribute.value,
    ])
  );
  for (const attribute of node.attributes) {
    if (encoded.get(`${attribute.namespaceUri}\n${attribute.localName}`) !== attribute.value) {
      return false;
    }
  }
  return node.localName === record.localName && node.kind === record.kind;
}

/**
 * Claim a whole reused subtree, and say whether the claim was uncontested.
 *
 * Reusing a cached subtree skips the per-node `placed` check that refuses a second parent,
 * so the claim has to be made for the descendants too. `false` means some node of this
 * subtree is already in the tree under another parent: two child arrays list the same id
 * and the cached answer disagrees with the rebuilt one. Emitting the node twice is a silent
 * corruption, so the caller redoes the pass without the cache instead.
 */
export function markPlaced(node: OoxmlNode, placed: Set<LogicalId>): boolean {
  // One `add` instead of `has` then `add`: this runs once per node of every reused subtree,
  // so a second hash of an already-long logical id is a measurable share of a receive.
  materializedPlacementVisits += 1;
  const before = placed.size;
  placed.add(node.id);
  let uncontested = placed.size !== before;
  if (node.kind === 'textValue') return uncontested;
  for (const child of node.children) {
    if (!markPlaced(child, placed)) uncontested = false;
  }
  return uncontested;
}

export function expandAncestors(
  registry: DocumentRegistry,
  ids: ReadonlySet<LogicalId>
): Set<LogicalId> {
  const expanded = new Set(ids);
  for (const id of ids) {
    let parent = registry.parentOf(id);
    while (parent) {
      expanded.add(parent);
      parent = registry.parentOf(parent);
    }
  }
  return expanded;
}
