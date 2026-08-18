import { inject, unref, type InjectionKey, type MaybeRef } from 'vue';

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
export const ContextMenuContext: InjectionKey<MaybeRef<ContextMenuContextValue>> =
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
  return unref(inject(ContextMenuContext, fallback)) as ContextMenuContextValue;
}

/** @public */
export function useContextMenuTarget(): HTMLElement | null {
  const ctx = unref(inject(ContextMenuContext, fallback));
  const target: HTMLElement | null = ctx?.target ?? null;
  return target;
}
