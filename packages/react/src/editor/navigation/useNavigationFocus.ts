// Focus in and out of the navigation pane, Escape, and the Ctrl/Cmd+F shortcut.
//
// Focus requests are REFS consumed in effects keyed on the pane's state, because the pane
// may be controlled: a request is made before the host has opened the pane (or switched its
// tab) and is honoured on the render where the host does. A host that declines leaves it
// pending, harmlessly. A request the pane already satisfies is honoured at once.
//
// Refs rather than state also keep a click on the disc of a controlled, declining pane from
// re-rendering anything.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useDocxEditor } from '../context';
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
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly intents: NavigationIntents;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** @internal */
export function useNavigationFocus(
  pane: UseNavigationPaneResult,
  findShortcut = true
): NavigationFocus {
  const editor = useDocxEditor();
  const viewport = useNavigationViewportElement();
  const rootRef = useRef<HTMLDivElement>(null);
  // Who opened the pane: an element to return focus to, or null for the disc.
  const opener = useRef<HTMLElement | null>(null);
  const focusRequest = useRef<{ tab?: NavigationTab } | null>(null);
  const restoreRequest = useRef(false);

  const paneRef = useRef(pane);
  paneRef.current = pane;

  const focusEntry = useCallback(() => {
    const request = focusRequest.current;
    const current = paneRef.current;
    if (!request || !current.open) return;
    if (request.tab && current.tab !== request.tab) return;
    focusRequest.current = null;
    const target = paneEntryTarget(rootRef.current, current.tab);
    if (target) focusPaneEntry(target);
  }, []);

  const restoreFocus = useCallback(() => {
    if (!restoreRequest.current || paneRef.current.open) return;
    restoreRequest.current = false;
    const back = opener.current;
    opener.current = null;
    const disc = rootRef.current?.querySelector<HTMLElement>('.docx-nav__toggle');
    if (back?.isConnected) back.focus();
    else if (disc) disc.focus();
    else editor?.focus();
  }, [editor]);

  const close = useCallback(() => {
    focusRequest.current = null;
    restoreRequest.current = true;
    paneRef.current.setOpen(false);
  }, []);

  const intents = useMemo<NavigationIntents>(
    () => ({
      toggle: () => {
        if (paneRef.current.open) {
          close();
          return;
        }
        opener.current = null;
        focusRequest.current = {};
        paneRef.current.setOpen(true);
      },
      close,
      picked: () => {
        const current = paneRef.current;
        if (!current.overlay) return;
        current.setOpen(false);
        // The chosen row is about to turn inert; send focus to the document it pointed at.
        const active = rootRef.current?.ownerDocument.activeElement;
        if (active && rootRef.current?.contains(active)) editor?.focus();
      },
    }),
    [close, editor]
  );

  // Ctrl/Cmd+F, on the document so it reaches the toolbar and the pane as well as the pages.
  // Bubble phase: the engine's keymap and the viewport's zoom capture see it first, and an
  // event either of them claimed (default prevented) is left alone.
  useEffect(() => {
    const doc = rootRef.current?.ownerDocument;
    if (!doc || !findShortcut) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !isFindShortcut(event)) return;
      if (!ownsShortcutTarget(event.target, rootRef.current, viewport)) return;
      event.preventDefault();
      const active = doc.activeElement;
      if (active instanceof HTMLElement && !rootRef.current?.contains(active)) {
        opener.current = active;
      }
      focusRequest.current = { tab: 'find' };
      const current = paneRef.current;
      if (current.tab !== 'find') current.setTab('find');
      if (!current.open) current.setOpen(true);
      // Already open on Find: nothing re-renders, so honour the request now.
      focusEntry();
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [viewport, focusEntry, findShortcut]);

  useEffect(focusEntry, [focusEntry, pane.open, pane.tab]);
  useEffect(restoreFocus, [restoreFocus, pane.open]);

  // A pane inside the scroll container is sticky and sizes itself from these properties.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !viewport || !viewport.contains(root)) return undefined;
    return publishViewportSize(root, viewport);
  }, [viewport]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) {
        return;
      }
      if (!paneRef.current.open) return;
      event.preventDefault();
      close();
    },
    [close]
  );

  return { rootRef, intents, onKeyDown };
}
