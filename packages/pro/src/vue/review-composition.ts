/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { cloneVNode, Fragment, isVNode, type VNode } from 'vue';

const ROOT_PARTS = new Set(['List', 'Markers', 'AddComment', 'Draft', 'Balloon']);
const LIST_PARTS = new Set(['Card', 'Empty']);

function isVNodeElement(value: unknown): value is VNode {
  return isVNode(value);
}

export function partitionReviewChildren(
  children: VNode[],
  scope: 'root' | 'list'
): { parts: Record<string, VNode>; rest: VNode[] } {
  const accepted = scope === 'root' ? ROOT_PARTS : LIST_PARTS;
  const parts: Record<string, VNode> = {};
  const rest: VNode[] = [];
  const visit = (nodes: VNode[]): void => {
    for (const node of nodes) {
      if (!isVNodeElement(node)) continue;
      if (node.type === Fragment) {
        const inner = (Array.isArray(node.children) ? node.children : []) as VNode[];
        visit(inner);
        continue;
      }
      const marker = (node.type as { docxReviewPart?: string }).docxReviewPart;
      if (marker && accepted.has(marker)) parts[marker] = node;
      else rest.push(node);
    }
  };
  visit(children);
  return { parts, rest };
}

export function cloneReviewCard(card: VNode, rootClassName: string | undefined): VNode {
  if (!rootClassName) return card;
  const ownClassName = (card.props as { class?: string }).class;
  return cloneVNode(card, {
    class: `${rootClassName}${ownClassName ? ` ${ownClassName}` : ''}`,
  });
}
