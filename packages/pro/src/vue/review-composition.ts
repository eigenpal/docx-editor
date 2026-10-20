/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { cloneVNode, Fragment, isVNode, type Slot, type VNode } from 'vue';

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

/**
 * Normalize what a raw slot function returned. A slot read from a vnode's `children` has
 * not passed through the component's slot normalization, so it may return one vnode.
 */
export function slotNodes(result: unknown): VNode[] {
  if (result === undefined || result === null) return [];
  return (Array.isArray(result) ? result.flat(Infinity) : [result]) as VNode[];
}

/** The card template a host wrote inside the `List` part. */
export interface ListCardTemplate {
  /** The List part is hidden, so no card renders from it. */
  readonly hidden: boolean;
  readonly default: Slot | undefined;
  readonly item: Slot | undefined;
}

/**
 * Read the card template from a `List` part, for a card the rail renders OUTSIDE the list.
 *
 * The compact rail floats one card beside the marker strip. That card must use the same
 * template the list uses, or the host's part overrides and extra children vanish whenever
 * the gutter is narrow. Returns `null` when there is no List part, or when the part has no
 * slots of its own, so the caller falls back to the root's children.
 */
export function listCardTemplate(listPart: VNode | undefined): ListCardTemplate | null {
  if (!listPart) return null;
  const hiddenProp = (listPart.props as { hidden?: unknown } | null)?.hidden;
  const hidden = hiddenProp !== undefined && hiddenProp !== false;
  const children = listPart.children as Record<string, unknown> | null;
  const slot = (name: string): Slot | undefined => {
    const value = children && typeof children === 'object' ? children[name] : undefined;
    return typeof value === 'function' ? (value as Slot) : undefined;
  };
  const template = { hidden, default: slot('default'), item: slot('item') };
  if (!hidden && !template.default && !template.item) return null;
  return template;
}
