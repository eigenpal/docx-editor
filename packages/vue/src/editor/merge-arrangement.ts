// Default-set + in-place-override merge for Vue vnodes.
// Same contract as packages/react/src/editor/merge-arrangement.tsx.

import { Fragment, type VNode, type VNodeArrayChildren, isVNode } from 'vue';

/** Marker on component options: which packaged member this part overrides. */
export interface DocxSlotComponent {
  docxSlot?: string;
}

/** Resolve the override key for one vnode, or null when it is host content. */
export type KeyOfChild = (child: VNode) => string | null;

function vnodeChildren(child: VNode): VNode[] {
  const raw = child.children;
  if (Array.isArray(raw)) return raw.filter(isVNode);
  if (typeof raw === 'object' && raw !== null && 'default' in raw) {
    const slot = (raw as { default?: () => VNode[] }).default;
    return slot?.().filter(isVNode) ?? [];
  }
  return [];
}

/**
 * Flatten a single-child Fragment (`v-for`, `<template>`) to its override key.
 * Returns null when the Fragment holds zero or several keyed children.
 */
export function unwrapFragment(child: VNode, keyOf: KeyOfChild): string | null {
  if (!isVNode(child) || child.type !== Fragment) return null;
  const inner = vnodeChildren(child);
  const keys = inner.map(keyOf).filter((key): key is string => key !== null);
  return keys.length === 1 ? keys[0]! : null;
}

/** Read `docxSlot` from a part component's options object. */
export function docxSlotOf(vnode: VNode): string | null {
  if (!isVNode(vnode)) return null;
  const type = vnode.type;
  if (typeof type === 'object' && type !== null && 'docxSlot' in type) {
    const slot = (type as DocxSlotComponent).docxSlot;
    return typeof slot === 'string' ? slot : null;
  }
  return null;
}

export interface MergeArrangementInput<Entry> {
  readonly entries: readonly Entry[];
  readonly children: VNode[];
  readonly preset: boolean;
  readonly keyOfEntry: (entry: Entry, index: number) => string;
  readonly keyOfChild: KeyOfChild;
  readonly renderEntry: (entry: Entry, index: number) => VNode;
}

/**
 * Merge host vnodes into a packaged arrangement.
 * Last override for a key wins; unmatched overrides append; unknown children append.
 */
export function mergeArrangement<Entry>({
  entries,
  children,
  preset,
  keyOfEntry,
  keyOfChild,
  renderEntry,
}: MergeArrangementInput<Entry>): VNodeArrayChildren {
  if (!preset) return children;
  const overrides = new Map<string, VNode>();
  const appended: VNode[] = [];
  for (const child of children) {
    if (!isVNode(child)) continue;
    const key = keyOfChild(child);
    if (key) overrides.set(key, child);
    else appended.push(child);
  }
  const base: VNode[] = entries.map((entry, index) => {
    const key = keyOfEntry(entry, index);
    const override = overrides.get(key);
    if (override) return override;
    return renderEntry(entry, index);
  });
  const known = new Set(entries.map(keyOfEntry));
  const unmatched = [...overrides.entries()]
    .filter(([key]) => !known.has(key))
    .map(([, vnode]) => vnode);
  return [...base, ...unmatched, ...appended];
}
