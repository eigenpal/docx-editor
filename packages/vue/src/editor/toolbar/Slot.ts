import { cloneVNode, defineComponent, mergeProps, type VNode, type VNodeRef } from 'vue';
import { cn } from '../../lib/utils';

type AnyProps = Record<string, unknown>;

function composeHandlers(childHandler: unknown, slotHandler: unknown): unknown {
  if (typeof slotHandler !== 'function') return childHandler;
  if (typeof childHandler !== 'function') return slotHandler;
  return (event: Event & { defaultPrevented?: boolean }) => {
    (childHandler as (e: Event) => void)(event);
    if (!event.defaultPrevented) (slotHandler as (e: Event) => void)(event);
  };
}

function mergeSlotProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged = mergeProps(slotProps, childProps) as AnyProps;
  for (const key of Object.keys(slotProps)) {
    if (/^on[A-Z]/.test(key)) {
      merged[key] = composeHandlers(childProps[key], slotProps[key]);
    } else if (key === 'class') {
      merged[key] = cn(
        typeof slotProps[key] === 'string' ? slotProps[key] : '',
        typeof childProps[key] === 'string' ? childProps[key] : ''
      );
    } else if (key === 'style') {
      merged[key] = {
        ...(slotProps[key] as object),
        ...(childProps[key] as object),
      };
    }
  }
  return merged;
}

/** @public */
export interface SlotProps {
  class?: string;
  style?: Record<string, string | number>;
  children?: VNode;
  ref?: VNodeRef;
}

/** Renders its single child vnode with the slot props merged in. @public */
export const Slot = defineComponent({
  name: 'DocxSlot',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => {
      const children = slots.default?.() ?? [];
      if (children.length !== 1) return null;
      const child = children[0] as VNode;
      if (!child || typeof child !== 'object') return null;
      return cloneVNode(child, mergeSlotProps(attrs as AnyProps, (child.props ?? {}) as AnyProps));
    };
  },
});
