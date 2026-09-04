// Bounded placement helpers for note citations at nested inline-container boundaries.

import { withFreshIds } from './hf-lifecycle-shell.ts';
import { isInlineContainerProperty } from './inline-container-properties.ts';
import { replaceChildren } from './ooxml-edit.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from './ooxml-tree.ts';
import {
  isContentRevisionKind,
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  WML_NAMESPACE_URI,
} from './ooxml-shared.ts';

/** The ancestors of `nodeId` below `root`, from outermost through its direct parent. */
export function ancestorPathHolding(root: OoxmlNode, nodeId: string): readonly OoxmlNode[] | null {
  const path: OoxmlNode[] = [];
  const visit = (node: OoxmlNode, containerDepth: number): boolean => {
    if (node.kind === 'textValue') return false;
    const counted = isInlineRunContainer(node) || isContentControl(node);
    if (counted && containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return false;
    const childDepth = counted ? containerDepth + 1 : containerDepth;
    path.push(node);
    for (const child of node.children) {
      const childCounted = isInlineRunContainer(child) || isContentControl(child);
      const childAddressable = !childCounted || childDepth < MAX_INLINE_CONTAINER_DEPTH;
      if ((child.id === nodeId && childAddressable) || visit(child, childDepth)) return true;
    }
    path.pop();
    return false;
  };
  return visit(root, 0) ? path.slice() : null;
}

export interface BoundarySplit {
  readonly head: OoxmlNode | null;
  readonly tail: OoxmlNode | null;
}

/** Place a citation beside the outermost revision while neutral ancestors stay intact. */
export function placeOutsideOutermostRevision(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  path: readonly OoxmlNode[],
  anchorId: string,
  citations: readonly OoxmlNode[],
  nextId: () => string
): OoxmlPart | null | undefined {
  const revisionIndex = path.findIndex((ancestor) => isContentRevisionKind(ancestor.kind));
  if (revisionIndex < 0) return undefined;
  const revision = path[revisionIndex]!;
  const parent = revisionIndex === 0 ? paragraph : path[revisionIndex - 1]!;
  if (parent.kind === 'textValue') return null;
  const split = splitBeforeDescendant(revision, anchorId, nextId);
  if (!split || (!split.head && !split.tail)) return null;
  const children = parent.children.flatMap((child) => {
    if (child.id !== revision.id) return [child];
    const replacement: OoxmlNode[] = [];
    if (split.head) replacement.push(split.head);
    for (const citation of citations) replacement.push(citation);
    if (split.tail) replacement.push(split.tail);
    return replacement;
  });
  const replaced = replaceChildren(part, parent.id, children);
  return replaced.ok ? replaced.part : null;
}

/** Property children that must appear in both copies of a split lossless wrapper. */
function splitWrapperProperties(node: OoxmlNode): readonly OoxmlNode[] {
  if (node.kind === 'textValue') return [];
  if (node.kind === 'run') return node.children.filter((child) => child.kind === 'runProperties');
  return node.children.filter((child) => isInlineContainerProperty(node, child));
}

/** A control is atomic here because cloning it would duplicate its authored `w:id`. */
function isContentControl(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  return (
    node.kind === 'contentControl' ||
    (node.kind === 'generic' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'sdt')
  );
}

/** Split each wrapper on the path before one descendant, preserving reading order. */
export function splitBeforeDescendant(
  node: OoxmlNode,
  nodeId: string,
  nextId: () => string,
  containerDepth = 0
): BoundarySplit | null {
  if (node.kind === 'textValue') return null;
  const counted = isInlineRunContainer(node) || isContentControl(node);
  if (counted && containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return null;
  const properties = splitWrapperProperties(node);
  const content = node.children.filter(
    (child) => !properties.some((property) => property.id === child.id)
  );
  const index = content.findIndex((child) => child.id === nodeId);
  let headContent: readonly OoxmlNode[];
  let tailContent: readonly OoxmlNode[];
  if (index >= 0) {
    headContent = content.slice(0, index);
    tailContent = content.slice(index);
  } else {
    const childDepth = counted ? containerDepth + 1 : containerDepth;
    const holder = content.findIndex((child) => containsNodeId(child, nodeId, childDepth));
    if (holder < 0) return null;
    const head: OoxmlNode[] = content.slice(0, holder);
    const tail: OoxmlNode[] = [];
    const held = content[holder]!;
    if (isContentControl(held)) {
      // A citation that must escape an enclosing revision moves to the nearest control
      // boundary. The control stays whole, with one authored id and one protection scope.
      tail.push(held);
    } else {
      const nested = splitBeforeDescendant(held, nodeId, nextId, childDepth);
      if (!nested) return null;
      if (nested.head) head.push(nested.head);
      if (nested.tail) tail.push(nested.tail);
    }
    for (const child of content.slice(holder + 1)) tail.push(child);
    headContent = head;
    tailContent = tail;
  }
  const rebuild = (children: readonly OoxmlNode[], clone: boolean): OoxmlNode | null => {
    if (children.length === 0) return null;
    const rebuilt: OoxmlNode[] = [];
    for (const property of properties) {
      rebuilt.push(clone ? withFreshIds(property, nextId) : property);
    }
    for (const child of children) rebuilt.push(child);
    return { ...node, ...(clone ? { id: nextId() } : {}), children: rebuilt } as OoxmlNode;
  };
  return { head: rebuild(headContent, false), tail: rebuild(tailContent, true) };
}

function containsNodeId(node: OoxmlNode, nodeId: string, containerDepth: number): boolean {
  const counted = isInlineRunContainer(node) || isContentControl(node);
  if (counted && containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return false;
  if (node.id === nodeId) return true;
  if (node.kind === 'textValue') return false;
  const childDepth = counted ? containerDepth + 1 : containerDepth;
  return node.children.some((child) => containsNodeId(child, nodeId, childDepth));
}
