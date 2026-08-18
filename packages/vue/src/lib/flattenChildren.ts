import { Fragment, type VNode, isVNode } from 'vue';

/** Flatten slot/default children like React Children.toArray. */
export function flattenChildren(children: unknown): VNode[] {
  if (children == null || children === false) return [];
  if (Array.isArray(children)) return children.flatMap(flattenChildren);
  if (isVNode(children)) {
    if (children.type === Fragment) {
      return flattenChildren(children.children);
    }
    return [children];
  }
  return [];
}
