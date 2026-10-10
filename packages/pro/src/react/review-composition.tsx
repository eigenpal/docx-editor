/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Scope-aware composition helpers for the review compound.

import { Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

const ROOT_PARTS = new Set(['List', 'Markers', 'AddComment', 'Draft', 'Balloon']);
const LIST_PARTS = new Set(['Card', 'Empty']);

/**
 * Split one compound scope from the children that belong to its nested scope.
 *
 * Fragments are transparent, matching Toolbar/Menu override behavior. A recognized part is
 * consumed at this level; everything else keeps its order and travels to the next level.
 */
export function partitionReviewChildren(
  children: ReactNode,
  scope: 'root' | 'list'
): { parts: Record<string, ReactNode>; rest: ReactNode[] } {
  const accepted = scope === 'root' ? ROOT_PARTS : LIST_PARTS;
  const parts: Record<string, ReactNode> = {};
  const rest: ReactNode[] = [];
  const visit = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isValidElement(node)) {
      if (node !== null && node !== undefined && node !== false) rest.push(node);
      return;
    }
    if (node.type === Fragment) {
      visit((node.props as { children?: ReactNode }).children);
      return;
    }
    const marker = (node.type as { docxReviewPart?: string }).docxReviewPart;
    if (marker && accepted.has(marker)) parts[marker] = node;
    else rest.push(node);
  };
  visit(children);
  return { parts, rest };
}

/** Apply the root card class to an explicit Card template without nesting another Card. */
export function cloneReviewCard(
  card: ReactElement<{ className?: string }>,
  rootClassName: string | undefined
): ReactNode {
  if (!rootClassName) return card;
  const ownClassName = card.props.className;
  return cloneElement(card, {
    className: `${rootClassName}${ownClassName ? ` ${ownClassName}` : ''}`,
  });
}

/** A card template: element children, or a render prop over the item. */
export type ReviewCardTemplate<Item> = ReactNode | ((item: Item) => ReactNode);

/**
 * Resolve the card template for a card the rail renders OUTSIDE the list.
 *
 * The compact rail floats one card beside the marker strip. That card must use the same
 * template the list uses, or the host's part overrides and extra children vanish whenever
 * the gutter is narrow. The root forwards its own children to the List only when the List
 * part supplies none, so the same precedence applies here. `hidden` reports a hidden List
 * part, which renders no card anywhere.
 */
export function listCardTemplate<Item>(
  rootRest: ReviewCardTemplate<Item>,
  listPart: ReactNode
): { template: ReviewCardTemplate<Item>; fromList: boolean; hidden: boolean } {
  if (!isValidElement<{ children?: ReviewCardTemplate<Item>; hidden?: boolean }>(listPart)) {
    return { template: rootRest, fromList: false, hidden: false };
  }
  const { children, hidden } = listPart.props;
  return {
    template: children === undefined ? rootRest : children,
    fromList: children !== undefined,
    hidden: hidden === true,
  };
}
