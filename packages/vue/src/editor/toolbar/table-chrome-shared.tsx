import { h, toValue, watch, type MaybeRefOrGetter, type Ref, type VNode } from 'vue';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { editorScopeFor } from '../editor-scope';
import { useTranslation } from '../../i18n';
import { focusBy, focusEdge } from '../menu/menu-keyboard';
import { useStableDocxId } from '../../lib/stable-id';
import { guardToolbarMousedown } from './ToolbarButton';

/** Return focus to the painted pages layer after a table colour dialog applies. */
export function restoreToolbarDocumentFocus(from: HTMLElement | null): void {
  const root = editorScopeFor(from) ?? from?.ownerDocument?.body;
  root?.querySelector<HTMLElement>('.docx-pages')?.focus();
}

/** Outside mousedown closes a toolbar popup. */
export function useDropdownClose(
  open: Ref<boolean>,
  setOpen: (open: boolean) => void,
  rootRef: Ref<HTMLElement | null>
): void {
  watch(open, (isOpen, _, onCleanup) => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.value;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    onCleanup(() => document.removeEventListener('mousedown', onMouseDown));
  });
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
  readonly reasonNode: VNode | null;
} {
  const { t } = useTranslation();
  const localizedReason = localizeDisabledReason(disabledReason, t);
  const reasonId = useStableDocxId('table-chrome-reason');
  const describe = !enabled && localizedReason ? reasonId : undefined;
  return {
    reasonId,
    shared: {
      type: 'button' as const,
      onMousedown: guardToolbarMousedown,
      'aria-label': ariaLabel,
      ...(describe ? { 'aria-describedby': describe } : {}),
      ...(localizedReason ? { title: localizedReason } : {}),
      ...(!enabled ? { 'data-disabled': '', 'aria-disabled': true } : {}),
    },
    reasonNode:
      describe && localizedReason
        ? h('span', { id: reasonId, class: 'docx-editor-sr-only' }, localizedReason)
        : null,
  };
}

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** Keyboard contract for role=menu popups: arrows, Home/End, Enter/Space, Escape. */
export function useTableMenuKeyboard(
  open: MaybeRefOrGetter<boolean>,
  setOpen: (open: boolean) => void,
  panelRef: Ref<HTMLElement | null>,
  triggerRef: Ref<HTMLElement | null>
): void {
  watch(
    () => toValue(open),
    (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const panel = panelRef.value;
      const trigger = triggerRef.value;
      if (!panel) return;

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
      onCleanup(() => panel.removeEventListener('keydown', onKeyDown));
    },
    { flush: 'post' }
  );
}

/** Escape closes a role=dialog popup and restores trigger focus; Enter/Space activate focused swatches. */
export function useTableDialogKeyboard(
  open: MaybeRefOrGetter<boolean>,
  setOpen: (open: boolean) => void,
  dialogRef: Ref<HTMLElement | null>,
  triggerRef: Ref<HTMLElement | null>
): void {
  watch(
    () => toValue(open),
    (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const dialog = dialogRef.value;
      const trigger = triggerRef.value;
      if (!dialog) return;

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
      onCleanup(() => dialog.removeEventListener('keydown', onKeyDown));
    },
    { flush: 'post' }
  );
}
