// Focus in and out of the navigation pane, Escape, and the Ctrl/Cmd+F shortcut.
//
// Focus requests are plain variables answered after the next flush. The pane may be
// controlled, so a request is made before the host has opened (or closed) the pane, and the
// flush that follows is the host's answer: a request the pane now satisfies is honoured, and
// one the host declined is dropped there, so it cannot fire on some unrelated later open.

import { nextTick, onMounted, onUnmounted, shallowRef, watch, type ShallowRef } from 'vue';
import { useDocxEditor } from '../context';
import { scopeDispose } from '../scope-dispose';
import type { NavigationIntents } from './navigation-context';
import { useNavigationViewportElement } from './navigation-layout';
import {
  focusPaneEntry,
  isFindShortcut,
  ownsShortcutTarget,
  paneEntryTarget,
  publishViewportSize,
  returnFocus,
} from './navigation-keys';
import type { UseNavigationPaneResult } from './useNavigationPane';

/** @internal */
export interface NavigationFocus {
  readonly rootRef: ShallowRef<HTMLElement | null>;
  readonly intents: NavigationIntents;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

/** @internal */
export function useNavigationFocus(
  pane: UseNavigationPaneResult,
  findShortcut: () => boolean = () => true
): NavigationFocus {
  const editor = useDocxEditor();
  const viewport = useNavigationViewportElement();
  const rootRef = shallowRef<HTMLElement | null>(null);
  // Who opened the pane: an element to return focus to, or null for the disc.
  let opener: HTMLElement | null = null;
  let focusRequest = false;
  let restoreRequest = false;

  const focusEntry = () => {
    focusRequest = false;
    const target = paneEntryTarget(rootRef.value, pane.tab.value);
    if (target) focusPaneEntry(target);
  };

  const restoreFocus = () => {
    restoreRequest = false;
    const back = opener;
    opener = null;
    const disc = rootRef.value?.querySelector<HTMLElement>('.docx-nav__toggle') ?? null;
    const instance = editor.value;
    returnFocus(back, disc, instance ? () => instance.focus() : null);
  };

  // The flush after a request is the host's answer (see the header).
  const answerRequests = () => {
    void nextTick(() => {
      if (focusRequest) {
        if (pane.open.value) focusEntry();
        else focusRequest = false;
      }
      if (restoreRequest) {
        if (!pane.open.value) restoreFocus();
        else restoreRequest = false;
      }
    });
  };

  const close = () => {
    focusRequest = false;
    restoreRequest = true;
    pane.setOpen(false);
    answerRequests();
  };

  const intents: NavigationIntents = {
    toggle: () => {
      if (pane.open.value) {
        close();
        return;
      }
      opener = null;
      restoreRequest = false;
      focusRequest = true;
      pane.setOpen(true);
      answerRequests();
    },
    close,
    picked: () => {
      if (!pane.overlay.value) return;
      pane.setOpen(false);
      // The chosen row is about to turn inert; send focus to the document it pointed at.
      const active = rootRef.value?.ownerDocument.activeElement;
      if (active && rootRef.value?.contains(active)) editor.value?.focus();
    },
  };

  // Ctrl/Cmd+F, on the document so it reaches the toolbar and the pane as well as the pages.
  // Bubble phase: the engine's keymap and the viewport's zoom capture see it first, and an
  // event either of them claimed (default prevented) is left alone.
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (!findShortcut() || event.defaultPrevented || !isFindShortcut(event)) return;
    if (!ownsShortcutTarget(event.target, rootRef.value, viewport.value)) return;
    event.preventDefault();
    const active = rootRef.value?.ownerDocument.activeElement;
    if (active instanceof HTMLElement && !rootRef.value?.contains(active)) opener = active;
    restoreRequest = false;
    // Already open on Find: nothing re-renders, so focus the query now.
    if (pane.open.value && pane.tab.value === 'find') {
      focusEntry();
      return;
    }
    focusRequest = true;
    if (pane.tab.value !== 'find') pane.setTab('find');
    if (!pane.open.value) pane.setOpen(true);
    answerRequests();
  };
  let listening: Document | null = null;
  onMounted(() => {
    listening = rootRef.value?.ownerDocument ?? null;
    listening?.addEventListener('keydown', onDocumentKeyDown);
  });
  onUnmounted(() => {
    listening?.removeEventListener('keydown', onDocumentKeyDown);
    listening = null;
    // A host may answer a close by unmounting the pane in `onOpenChange(false)`; the
    // unmount then answers the pending return of focus.
    if (restoreRequest) restoreFocus();
  });

  // A pane inside the scroll container is sticky and sizes itself from these properties.
  scopeDispose(
    watch(
      [rootRef, viewport],
      ([root, element], _previous, onCleanup) => {
        if (!root || !element || !element.contains(root)) return;
        onCleanup(publishViewportSize(root, element));
      },
      { immediate: true, flush: 'post' }
    )
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    if (!pane.open.value) return;
    event.preventDefault();
    close();
  };

  return { rootRef, intents, onKeyDown };
}
