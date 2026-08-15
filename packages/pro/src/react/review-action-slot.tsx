/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { Children, cloneElement, isValidElement } from 'react';
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react';

type AnyProps = Record<string, unknown>;

function composeHandlers(
  childHandler: unknown,
  slotHandler: unknown
): ((event: Event & { defaultPrevented: boolean }) => void) | unknown {
  if (typeof slotHandler !== 'function') return childHandler;
  if (typeof childHandler !== 'function') return slotHandler;
  return (event: Event & { defaultPrevented: boolean }) => {
    childHandler(event);
    if (!event.defaultPrevented) (slotHandler as (e: unknown) => void)(event);
  };
}

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...slotProps, ...childProps };
  for (const key of Object.keys(slotProps)) {
    if (/^on[A-Z]/.test(key)) {
      merged[key] = composeHandlers(childProps[key], slotProps[key]);
    } else if (key === 'className') {
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

function isNativeButton(child: ReactElement): boolean {
  return child.type === 'button';
}

function isAnchorLike(child: ReactElement, childProps: AnyProps): boolean {
  return child.type === 'a' || childProps.href != null;
}

function composeEnabledActivationHandlers(
  childClick: unknown,
  childKeyDown: unknown,
  slotClick: unknown,
  anchorLike: boolean
): { onClick: (event: MouseEvent) => void; onKeyDown: (event: KeyboardEvent) => void } {
  const runEngine = (event: MouseEvent | KeyboardEvent) => {
    if (typeof slotClick === 'function') slotClick(event as MouseEvent);
  };

  return {
    onClick: (event: MouseEvent) => {
      if (typeof childClick === 'function') childClick(event);
      const consumerCancelled = event.defaultPrevented;
      if (!consumerCancelled) runEngine(event);
      if (anchorLike) event.preventDefault();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (typeof childKeyDown === 'function') childKeyDown(event);
      if (!isActivationKey(event.key)) return;
      const consumerCancelled = event.defaultPrevented;
      if (!consumerCancelled) runEngine(event);
      if (anchorLike) event.preventDefault();
    },
  };
}

/** Merge review-action wiring onto an asChild element; engine refusal wins over child props. */
export function ReviewActionSlot({
  engineDisabled,
  disabledReason,
  slotProps,
  children,
}: {
  readonly engineDisabled: boolean;
  readonly disabledReason: string | null;
  readonly slotProps: AnyProps;
  readonly children: ReactNode;
}): ReactNode {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const childProps = child.props as AnyProps;
  const merged = mergeProps(slotProps, childProps);

  if (!engineDisabled) {
    if (!isNativeButton(child)) {
      const activation = composeEnabledActivationHandlers(
        childProps.onClick,
        childProps.onKeyDown,
        slotProps.onClick,
        isAnchorLike(child, childProps)
      );
      merged.onClick = activation.onClick;
      merged.onKeyDown = activation.onKeyDown;
    }
    return cloneElement(child as ReactElement, merged);
  }

  if (isNativeButton(child)) {
    merged.disabled = true;
    delete merged['aria-disabled'];
  } else {
    delete merged.disabled;
    merged['aria-disabled'] = true;
    merged['data-disabled'] = '';
    merged.tabIndex = -1;
    merged.href = undefined;
    if (merged.role === undefined) merged.role = 'button';
    const childKeyDown = merged.onKeyDown;
    merged.onKeyDown = (event: KeyboardEvent) => {
      if (blockKeyboardActivation(event)) return;
      if (typeof childKeyDown === 'function') childKeyDown(event);
    };
  }
  if (disabledReason) merged.title = disabledReason;
  merged.onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return cloneElement(child as ReactElement, merged);
}
