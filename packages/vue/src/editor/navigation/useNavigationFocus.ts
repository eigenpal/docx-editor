// Focus in and out of the navigation pane, Escape, and the Ctrl/Cmd+F shortcut.
//
// Focus requests are plain variables consumed by watchers on the pane's state, because the
// pane may be controlled: a request is made before the host has opened the pane (or switched
// its tab) and is honoured on the render where the host does. A host that declines leaves it
// pending, harmlessly. A request the pane already satisfies is honoured at once.

import { onMounted, onUnmounted, shallowRef, watch, type ShallowRef } from 'vue';
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
} from './navigation-keys';
import type { NavigationTab, UseNavigationPaneResult } from './useNavigationPane';

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
  let focusRequest: { tab?: NavigationTab } | null = null;
  let restoreRequest = false;

  const focusEntry = () => {
    if (!focusRequest || !pane.open.value) return;
    if (focusRequest.tab && pane.tab.value !== focusRequest.tab) return;
    focusRequest = null;
    const target = paneEntryTarget(rootRef.value, pane.tab.value);
    if (target) focusPaneEntry(target);
  };

  const restoreFocus = () => {
    if (!restoreRequest || pane.open.value) return;
    restoreRequest = false;
    const back = opener;
    opener = null;
    const disc = rootRef.value?.querySelector<HTMLElement>('.docx-nav__toggle');
    if (back?.isConnected) back.focus();
    else if (disc) disc.focus();
    else editor.value?.focus();
  };

  const close = () => {
    focusRequest = null;
    restoreRequest = true;
    pane.setOpen(false);
  };

  const intents: NavigationIntents = {
    toggle: () => {
      if (pane.open.value) {
        close();
        return;
      }
      opener = null;
      focusRequest = {};
      pane.setOpen(true);
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
    focusRequest = { tab: 'find' };
    if (pane.tab.value !== 'find') pane.setTab('find');
    if (!pane.open.value) pane.setOpen(true);
    // Already open on Find: nothing re-renders, so honour the request now.
    focusEntry();
  };
  let listening: Document | null = null;
  onMounted(() => {
    listening = rootRef.value?.ownerDocument ?? null;
    listening?.addEventListener('keydown', onDocumentKeyDown);
  });
  onUnmounted(() => {
    listening?.removeEventListener('keydown', onDocumentKeyDown);
    listening = null;
  });

  scopeDispose(watch([pane.open, pane.tab], focusEntry, { flush: 'post' }));
  scopeDispose(watch(pane.open, restoreFocus, { flush: 'post' }));

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
