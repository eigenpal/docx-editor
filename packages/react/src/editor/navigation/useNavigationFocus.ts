// Focus in and out of the navigation pane, Escape, and the Ctrl/Cmd+F shortcut.
//
// Focus requests are REFS answered by the next render. The pane may be controlled, so a
// request is made before the host has opened (or closed) the pane, and the render that
// follows is the host's answer: a request the pane now satisfies is honoured, and one the
// host declined is dropped there, so it cannot fire on some unrelated later open. A host
// that declines without rendering at all gets the same answer from a zero-delay timer,
// which runs after React has flushed the event's updates.
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
  inertBehindPane,
  isFindShortcut,
  ownsShortcutTarget,
  paneEntryTarget,
  publishViewportSize,
  returnFocus,
} from './navigation-keys';
import type { UseNavigationPaneResult } from './useNavigationPane';

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
  const focusRequest = useRef(false);
  const restoreRequest = useRef(false);
  const requestToken = useRef(0);
  // Drop whatever is still pending once the event's updates have flushed.
  const expireRequests = useCallback(() => {
    const token = ++requestToken.current;
    setTimeout(() => {
      if (requestToken.current !== token) return;
      focusRequest.current = false;
      restoreRequest.current = false;
    }, 0);
  }, []);

  const paneRef = useRef(pane);
  paneRef.current = pane;
  // Undoes the overlay's `inert` on the page area. Called before focus moves back to the
  // document, which an inert ancestor would refuse.
  const releaseInert = useRef<(() => void) | null>(null);

  const focusEntry = useCallback(() => {
    focusRequest.current = false;
    const target = paneEntryTarget(rootRef.current, paneRef.current.tab);
    if (target) focusPaneEntry(target);
  }, []);

  const restoreFocus = useCallback(() => {
    restoreRequest.current = false;
    releaseInert.current?.();
    const back = opener.current;
    opener.current = null;
    const disc = rootRef.current?.querySelector<HTMLElement>('.docx-nav__toggle') ?? null;
    returnFocus(back, disc, editor ? () => editor.focus() : null);
  }, [editor]);

  // A host may answer a close by unmounting the pane in `onOpenChange(false)`. No render
  // of this component follows, so the unmount answers the pending return of focus instead.
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  useEffect(
    () => () => {
      if (restoreRequest.current) restoreFocusRef.current();
    },
    []
  );

  const close = useCallback(() => {
    focusRequest.current = false;
    restoreRequest.current = true;
    paneRef.current.setOpen(false);
    expireRequests();
  }, [expireRequests]);

  const intents = useMemo<NavigationIntents>(
    () => ({
      toggle: () => {
        if (paneRef.current.open) {
          close();
          return;
        }
        opener.current = null;
        restoreRequest.current = false;
        focusRequest.current = true;
        paneRef.current.setOpen(true);
        expireRequests();
      },
      close,
      picked: () => {
        const current = paneRef.current;
        if (!current.overlay) return;
        current.setOpen(false);
        // The chosen row is about to turn inert; send focus to the document it pointed at.
        const active = rootRef.current?.ownerDocument.activeElement;
        releaseInert.current?.();
        if (active && rootRef.current?.contains(active)) editor?.focus();
      },
    }),
    [close, editor, expireRequests]
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
      restoreRequest.current = false;
      const current = paneRef.current;
      // Already open on Find: nothing re-renders, so focus the query now.
      if (current.open && current.tab === 'find') {
        focusEntry();
        return;
      }
      focusRequest.current = true;
      if (current.tab !== 'find') current.setTab('find');
      if (!current.open) current.setOpen(true);
      expireRequests();
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [viewport, focusEntry, findShortcut, expireRequests]);

  // Every render answers the requests made before it (see the header).
  useEffect(() => {
    if (focusRequest.current) {
      if (paneRef.current.open) focusEntry();
      else focusRequest.current = false;
    }
    if (restoreRequest.current) {
      if (!paneRef.current.open) restoreFocus();
      else restoreRequest.current = false;
    }
  });

  // An overlaying pane hides the page, so the page leaves the tab order while it does.
  const covering = pane.open && pane.overlay;
  useEffect(() => {
    const root = rootRef.current;
    if (!covering || !root || !viewport) return undefined;
    const release = inertBehindPane(root, viewport);
    releaseInert.current = release;
    return () => {
      release();
      if (releaseInert.current === release) releaseInert.current = null;
    };
  }, [covering, viewport]);

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
