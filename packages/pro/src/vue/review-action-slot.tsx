/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { cloneVNode, defineComponent, mergeProps, type PropType, type VNode } from 'vue';

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
      merged[key] = [slotProps[key], childProps[key]].filter(Boolean).join(' ');
    } else if (key === 'style') {
      merged[key] = { ...(slotProps[key] as object), ...(childProps[key] as object) };
    }
  }
  return merged;
}

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

function blockKeyboardActivation(event: KeyboardEvent): boolean {
  if (!isActivationKey(event.key)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function isNativeButton(type: unknown): boolean {
  return type === 'button';
}

function isAnchorLike(type: unknown, childProps: AnyProps): boolean {
  return type === 'a' || childProps.href != null;
}

/** Merge review-action wiring onto an asChild element; engine refusal wins over child props. */
export const ReviewActionSlot = defineComponent({
  name: 'ReviewActionSlot',
  props: {
    engineDisabled: { type: Boolean, required: true },
    disabledReason: { type: String as PropType<string | null>, default: null },
    slotProps: { type: Object as PropType<AnyProps>, required: true },
  },
  setup(props, { slots }) {
    return () => {
      const children = slots.default?.() ?? [];
      if (children.length !== 1) return null;
      const child = children[0] as VNode;
      if (!child || typeof child !== 'object') return null;
      const childProps = (child.props ?? {}) as AnyProps;
      const merged = mergeSlotProps(props.slotProps, childProps);

      if (!props.engineDisabled) {
        if (!isNativeButton(child.type)) {
          const activation = {
            onClick: (event: MouseEvent) => {
              if (typeof childProps.onClick === 'function') childProps.onClick(event);
              if (!event.defaultPrevented && typeof props.slotProps.onClick === 'function') {
                (props.slotProps.onClick as (e: MouseEvent) => void)(event);
              }
              if (isAnchorLike(child.type, childProps)) event.preventDefault();
            },
            onKeydown: (event: KeyboardEvent) => {
              if (typeof childProps.onKeydown === 'function') childProps.onKeydown(event);
              if (!isActivationKey(event.key)) return;
              if (!event.defaultPrevented && typeof props.slotProps.onClick === 'function') {
                (props.slotProps.onClick as (e: MouseEvent) => void)(
                  event as unknown as MouseEvent
                );
              }
              if (isAnchorLike(child.type, childProps)) event.preventDefault();
            },
          };
          merged.onClick = activation.onClick;
          merged.onKeydown = activation.onKeydown;
        }
        return cloneVNode(child, merged);
      }

      if (isNativeButton(child.type)) {
        merged.disabled = true;
        delete merged['aria-disabled'];
      } else {
        delete merged.disabled;
        merged['aria-disabled'] = true;
        merged['data-disabled'] = '';
        merged.tabIndex = -1;
        merged.href = undefined;
        if (merged.role === undefined) merged.role = 'button';
        const childKeyDown = merged.onKeydown;
        merged.onKeydown = (event: KeyboardEvent) => {
          if (blockKeyboardActivation(event)) return;
          if (typeof childKeyDown === 'function') childKeyDown(event);
        };
      }
      if (props.disabledReason) merged.title = props.disabledReason;
      merged.onClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
      };

      return cloneVNode(child, merged);
    };
  },
});
