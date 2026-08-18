import { inject, type InjectionKey } from 'vue';

/** @public */
export interface ContextMenuAnchor {
  readonly x: number;
  readonly y: number;
}

/** @public */
export interface ContextMenuContextValue {
  readonly close: (restoreFocus?: boolean) => void;
  readonly anchor: ContextMenuAnchor | null;
  readonly tocId: string | null;
  readonly target: HTMLElement | null;
  readonly clipboardRefusal: string | null;
  readonly reportClipboardRefusal: (reason: string) => void;
}

/** @public */
export const ContextMenuContext: InjectionKey<ContextMenuContextValue> =
  Symbol('ContextMenuContext');

const fallback: ContextMenuContextValue = {
  close: () => {},
  anchor: null,
  tocId: null,
  target: null,
  clipboardRefusal: null,
  reportClipboardRefusal: () => {},
};

/** @internal */
export function useContextMenuContext(): ContextMenuContextValue {
  return inject(ContextMenuContext, fallback);
}

/** @public */
export function useContextMenuTarget(): ContextMenuContextValue['target'] {
  return inject(ContextMenuContext, fallback).target;
}
