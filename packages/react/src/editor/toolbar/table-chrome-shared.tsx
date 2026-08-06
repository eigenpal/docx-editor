// Shared a11y and keyboard helpers for contextual table toolbar compounds.

import { useEffect, useId, type ReactNode, type RefObject } from 'react';
import { editorScopeFor } from '../editor-scope';
import { focusBy, focusEdge } from '../menu/menu-keyboard';
import { guardToolbarMousedown } from './ToolbarButton';

/** Return focus to the painted pages layer after a table colour dialog applies. */
export function restoreToolbarDocumentFocus(from: HTMLElement | null): void {
  // NOT a bare `closest('.docx-editor')`: the toolbar's own root self-emits that class.
  const root = editorScopeFor(from) ?? from?.ownerDocument?.body;
  root?.querySelector<HTMLElement>('.docx-pages')?.focus();
}

/** Outside mousedown closes a toolbar popup. */
export function useDropdownClose(
  open: boolean,
  setOpen: (open: boolean) => void,
  rootRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, setOpen, rootRef]);
}

/** Props for a focusable disabled toolbar trigger with an announced reason. */
export interface TableChromeTriggerA11y {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly ariaLabel: string;
}

/** aria-disabled trigger props; reasons ride aria-describedby like menu rows. */
export function useTableChromeTriggerA11y({
  enabled,
  disabledReason,
  ariaLabel,
}: TableChromeTriggerA11y): {
  readonly reasonId: string;
  readonly shared: Record<string, unknown>;
  readonly reasonNode: ReactNode;
} {
  const reasonId = useId();
  const describe = !enabled && disabledReason ? reasonId : undefined;
  return {
    reasonId,
    shared: {
      type: 'button' as const,
      onMouseDown: guardToolbarMousedown,
      'aria-label': ariaLabel,
      ...(describe ? { 'aria-describedby': describe } : {}),
      ...(disabledReason ? { title: disabledReason } : {}),
      ...(!enabled ? { 'data-disabled': '', 'aria-disabled': true } : {}),
    },
    reasonNode:
      describe && disabledReason ? (
        <span id={reasonId} className="ep-sr-only">
          {disabledReason}
        </span>
      ) : null,
  };
}

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** Keyboard contract for role=menu popups: arrows, Home/End, Enter/Space, Escape. */
export function useTableMenuKeyboard(
  open: boolean,
  setOpen: (open: boolean) => void,
  panelRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel) return undefined;

    const items = () =>
      [...panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)].filter(
        (item) => item.closest('[role="menu"]') === panel
      );

    const focusInitial = () => {
      const list = items();
      const selected =
        list.find(
          (item) => item.hasAttribute('data-selected') || item.hasAttribute('data-active')
        ) ?? list[0];
      selected?.focus();
    };
    queueMicrotask(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      const list = items();
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger?.focus();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusBy(list, document.activeElement, 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusBy(list, document.activeElement, -1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusEdge(list, 'first');
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        focusEdge(list, 'last');
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && list.includes(focused)) {
          event.preventDefault();
          focused.click();
        }
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen, panelRef, triggerRef]);
}

/** Escape closes a role=dialog popup and restores trigger focus; Enter/Space activate focused swatches. */
export function useTableDialogKeyboard(
  open: boolean,
  setOpen: (open: boolean) => void,
  dialogRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    if (!dialog) return undefined;

    const activators = () =>
      [...dialog.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"])')].filter(
        (item) => item.closest('[role="dialog"]') === dialog
      );

    queueMicrotask(() => {
      activators()[0]?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger?.focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const focused = document.activeElement;
        const list = activators();
        if (focused instanceof HTMLElement && list.includes(focused)) {
          event.preventDefault();
          focused.click();
        }
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen, dialogRef, triggerRef]);
}
