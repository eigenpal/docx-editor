import {
  cloneVNode,
  defineComponent,
  getCurrentInstance,
  isRef,
  mergeProps,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  type ComponentPublicInstance,
  type VNode,
} from 'vue';
import type { CSSProperties } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
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
  style?: CSSProperties;
  children?: DocxEditorChildren;
  ref?: unknown;
}

/** Renders its single child vnode with the slot props merged in. @public */
export const Slot = defineComponent({
  name: 'DocxSlot',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const instance = getCurrentInstance();
    let renderedElement: Element | null = null;
    const writeForwardedRef = (value: Element | null): void => {
      const componentRef = instance?.vnode.ref;
      const normalizedRef = Array.isArray(componentRef) ? componentRef[0] : componentRef;
      const forwardedRef = normalizedRef?.r;
      if (typeof forwardedRef === 'function') forwardedRef(value, {});
      else if (isRef(forwardedRef)) forwardedRef.value = value;
    };
    const syncForwardedRef = () => writeForwardedRef(renderedElement);
    onMounted(syncForwardedRef);
    onUpdated(syncForwardedRef);
    onBeforeUnmount(() => writeForwardedRef(null));

    return () => {
      const children = slots.default?.() ?? [];
      if (children.length !== 1) return null;
      const child = children[0] as VNode;
      if (!child || typeof child !== 'object') return null;
      const merged = mergeSlotProps(attrs as AnyProps, (child.props ?? {}) as AnyProps);
      return cloneVNode(
        child,
        {
          ...merged,
          ref: (value: Element | ComponentPublicInstance | null) => {
            renderedElement =
              value instanceof Element ? value : value?.$el instanceof Element ? value.$el : null;
          },
        },
        true
      );
    };
  },
});
