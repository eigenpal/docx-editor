/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import {
  cloneVNode,
  computed,
  effectScope,
  Fragment,
  getCurrentInstance,
  isVNode,
  onUnmounted,
  type ComputedRef,
  type EffectScope,
  type Slot,
  type VNode,
} from 'vue';
import { sameElements } from '../review/review-roots.ts';

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

/** The slot flag the Vue compiler writes for slots whose functions never change in effect. */
const STABLE_SLOTS = 1;

/** Whether the Vue template compiler wrote this slot function. Vue marks those with `_c`. */
function isCompiledSlot(value: unknown): boolean {
  return typeof value === 'function' && (value as { _c?: unknown })._c === true;
}

/**
 * What tells one set of slots from another, for `names` of the slots a parent passed.
 *
 * A render function passes plain functions, and a new function is the only sign that the
 * slot reads another value, so the functions themselves are compared.
 *
 * A compiled template passes new functions on each render of the component that owns it, so
 * the functions say nothing. Vue marks such slots stable (`_: 1`) when they read nothing but
 * the owner's state, and then a change reaches the slot content through reactivity alone.
 * Those slots compare by which of them exist. A template with `v-if` or `v-for` on a slot,
 * or a slot that reads a `v-for` or `v-slot` variable around it, is not marked stable, and its functions
 * are compared like plain functions. So are plain functions under a stable flag, which a JSX
 * transform can write for a slot that reads a local variable.
 *
 * Hot module replacement of a template needs no part here: the development build of Vue
 * then tells each reader of the component's slots, and the build is one of them.
 */
function slotIdentity(vnode: VNode | undefined, names: readonly string[]): readonly unknown[] {
  const children: unknown = vnode?.children;
  if (children === null || typeof children !== 'object' || Array.isArray(children)) {
    return [children];
  }
  const passed = children as Record<string, unknown>;
  const functions = names.map((name) => passed[name]);
  const compiled =
    passed._ === STABLE_SLOTS &&
    functions.every((slot) => typeof slot !== 'function' || isCompiledSlot(slot));
  if (!compiled) return functions;
  return [STABLE_SLOTS, ...functions.map((slot) => typeof slot === 'function')];
}

/**
 * A value a component builds from its slots, for use in its render function. It is built
 * again only when the parent passes other slots (see `slotIdentity`), or when reactive
 * state the build read changes. A render for any other cause answers the same value, with
 * the same vnodes, so a child that takes it as a prop does not render again.
 *
 * The slots are compared as the parent passed them. The component's own `slots` object wraps
 * a plain function again on each update, so its entries do not compare.
 *
 * Two Vue behaviors carry this. The slots come from `vnode.children` of the component
 * instance, which holds the slots object the parent rendered. And the kept vnodes go to the
 * renderer again in a later render, which is safe because Vue clones a vnode that is already
 * mounted before it mounts it a second time. `review-rail-render-work-vue.test.ts` fails if
 * either stops holding: its tests of another item slot function and of another default slot
 * pass new slot functions to a mounted rail, and its render counts draw the kept vnodes again.
 * `review-rail-template-host-vue.test.ts` covers the slots of compiled templates.
 */
export function useSlotMemo<T>(names: readonly string[], build: () => T): () => T {
  const instance = getCurrentInstance();
  let seen: readonly unknown[] | null = null;
  let memo: ComputedRef<T> | null = null;
  // Each build has a scope of its own, stopped when another build replaces it and when the
  // component unmounts. A replaced build then drops its subscriptions to the state it read.
  let scope: EffectScope | null = null;
  onUnmounted(() => scope?.stop());
  return () => {
    const passed = slotIdentity(instance?.vnode, names);
    if (memo === null || seen === null || !sameElements(seen, passed)) {
      seen = passed;
      scope?.stop();
      scope = effectScope(true);
      memo = scope.run(() => computed(build))!;
    }
    return memo.value;
  };
}
