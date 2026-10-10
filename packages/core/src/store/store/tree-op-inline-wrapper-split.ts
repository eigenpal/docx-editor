import { orphanFieldEndAt, segmentsOf } from './tree-op-segments.ts';
import { MAX_INLINE_CONTAINER_DEPTH, nextInlineContainerDepth } from '../package/ooxml-shared.ts';
// Property preservation for paragraph splits through lossless inline wrappers.

import { isInlineContainerProperty } from '../package/inline-container-properties.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { cloneWithNewIds } from './tree-op-nodes.ts';

/** Authored property children that every split copy of a lossless wrapper must retain. */
export function inlineWrapperProperties(wrapper: OoxmlNode): readonly OoxmlNode[] {
  if (wrapper.kind === 'textValue') return [];
  return wrapper.children.filter((child) => isInlineContainerProperty(wrapper, child));
}

/** Put wrapper properties before content, cloning them for a newly minted wrapper. */
export function wrapperChildren(
  properties: readonly OoxmlNode[],
  content: readonly OoxmlNode[],
  cloneProperties: boolean,
  nextId: () => string
): readonly OoxmlNode[] {
  const children: OoxmlNode[] = [];
  for (const property of properties) {
    children.push(cloneProperties ? cloneWithNewIds(property, nextId) : property);
  }
  for (const node of content) children.push(node);
  return children;
}

/** Separate closing markers from following content before a paragraph split. */
export function fieldSplitChildren(
  paragraph: OoxmlParagraphNode,
  offsets: readonly number[],
  nextId: () => string
): {
  children: readonly OoxmlNode[];
  endIds: ReadonlySet<string>;
  segments: ReturnType<typeof segmentsOf>;
} {
  const endIds = new Set(
    offsets.map((offset) => orphanFieldEndAt(paragraph, offset)).filter((id): id is string => !!id)
  );
  let children = paragraph.children;
  for (const id of endIds) {
    children = children.flatMap((child) => {
      const divided = splitThroughNode(child, id, nextId, 0);
      return divided ? [divided.head, ...(divided.tail ? [divided.tail] : [])] : [child];
    });
  }
  return {
    children,
    endIds,
    segments: segmentsOf(children === paragraph.children ? paragraph : { ...paragraph, children }),
  };
}

function splitThroughNode<T extends OoxmlNode>(
  node: T,
  id: string,
  nextId: () => string,
  depth: number
): { head: T; tail: T | null } | null {
  if (node.id === id) return { head: node, tail: null };
  if (node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return null;
  const properties = node.children.filter(
    (child) => child.kind === 'runProperties' || isInlineContainerProperty(node, child)
  );
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index]!;
    const divided = splitThroughNode(child, id, nextId, nextInlineContainerDepth(node, depth));
    if (!divided) continue;
    const after = node.children.slice(index + 1);
    if (!divided.tail && after.length === 0) return { head: node, tail: null };
    const headChildren = node.children.slice(0, index);
    headChildren.push(divided.head);
    const tailChildren = properties.map((property) => cloneWithNewIds(property, nextId));
    if (divided.tail) tailChildren.push(divided.tail);
    for (const item of after) if (!properties.includes(item)) tailChildren.push(item);
    return {
      head: { ...node, children: headChildren } as T,
      tail: { ...node, id: nextId(), children: tailChildren } as T,
    };
  }
  return null;
}
