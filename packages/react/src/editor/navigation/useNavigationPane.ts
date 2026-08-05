// The navigation pane's own state: open, which tab, and how far it displaces the page.
//
// The displacement is the interesting half. An open pane must not move the document while
// there is room for it in the left gutter — see `navigation-geometry.ts` for why a fixed
// push is wrong and how the exact padding is derived. This hook measures the two inputs
// (the scroll container's width, the page's rendered width) and publishes the result on
// the layout store, where `DocxEditor.Viewport` and `DocxEditor.HorizontalRuler` pick it up.
//
// Measurement is a ResizeObserver on the registered viewport plus the snapshot's page
// setup and zoom, NOT a DOM query for a painted page: a pane opened before the first paint
// would otherwise measure nothing and settle a frame later, which reads as a flinch.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core-contract/contracts/editor';
import { twipsToPixels } from '../../lib/units';
import { ReviewRailContext } from '../context';
import { useEditorState } from '../useEditorState';
import {
  NAVIGATION_PANE_WIDTH,
  navigationPaneReservation,
  navigationShift,
} from './navigation-geometry';
import { useNavigationLayoutStore, useNavigationViewportElement } from './navigation-layout';

/** The pane's tabs. Word's Replace tab is a later slice; nothing here pretends it exists. */
export type NavigationTab = 'headings' | 'find';

const selectPageGeometry = (
  snapshot: EditorSnapshot
): { pageSetup: PageSetup | null; zoom: number; reviewPaneOpen: boolean } => ({
  pageSetup: snapshot.pageSetup ?? null,
  zoom: snapshot.zoom,
  reviewPaneOpen: snapshot.reviewPaneOpen ?? true,
});

const samePageGeometry = (
  a: { pageSetup: PageSetup | null; zoom: number; reviewPaneOpen: boolean },
  b: { pageSetup: PageSetup | null; zoom: number; reviewPaneOpen: boolean }
) =>
  a.zoom === b.zoom &&
  a.reviewPaneOpen === b.reviewPaneOpen &&
  a.pageSetup?.pageWidthTwips === b.pageSetup?.pageWidthTwips;

/** How `useNavigationPane` is configured. @public */
export interface UseNavigationPaneOptions {
  /** Open state for the first render when the pane is uncontrolled. Defaults to closed. */
  defaultOpen?: boolean;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Tab shown first when uncontrolled. Defaults to `'headings'`. */
  defaultTab?: NavigationTab;
  /** Controlled tab. Pair with `onTabChange`. */
  tab?: NavigationTab;
  onTabChange?: (tab: NavigationTab) => void;
  /** Panel width in px. Defaults to {@link NAVIGATION_PANE_WIDTH}. */
  paneWidth?: number;
}

/** What `useNavigationPane` answers. @public */
export interface UseNavigationPaneResult {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
  readonly tab: NavigationTab;
  readonly setTab: (tab: NavigationTab) => void;
  readonly paneWidth: number;
  /**
   * Px the chrome is displaced by, right now. `0` while the pane is closed AND whenever
   * the left gutter was already wide enough to hold it — which is the point.
   */
  readonly shift: number;
}

/**
 * The navigation pane's behavior, with no UI attached: open state, the active tab, and
 * the document displacement an open pane is entitled to.
 *
 * `DocxEditor.Navigation` calls this and shares the result with its parts. Call it
 * directly to drive a pane of your own.
 *
 * @public
 */
export function useNavigationPane(options: UseNavigationPaneOptions = {}): UseNavigationPaneResult {
  const {
    defaultOpen = false,
    defaultTab = 'headings',
    paneWidth = NAVIGATION_PANE_WIDTH,
  } = options;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [uncontrolledTab, setUncontrolledTab] = useState<NavigationTab>(defaultTab);
  const open = options.open ?? uncontrolledOpen;
  const tab = options.tab ?? uncontrolledTab;

  const { onOpenChange, onTabChange } = options;
  const isOpenControlled = options.open !== undefined;
  const isTabControlled = options.tab !== undefined;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isOpenControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isOpenControlled, onOpenChange]
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const setTab = useCallback(
    (next: NavigationTab) => {
      if (!isTabControlled) setUncontrolledTab(next);
      onTabChange?.(next);
    },
    [isTabControlled, onTabChange]
  );

  // ── Displacement ────────────────────────────────────────────────────────────────────
  const store = useNavigationLayoutStore();
  const viewport = useNavigationViewportElement();
  const rail = useContext(ReviewRailContext);
  const { pageSetup, zoom, reviewPaneOpen } = useEditorState(selectPageGeometry, samePageGeometry);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [inlineEndReservation, setInlineEndReservation] = useState(0);

  // `open` is a dependency as well as `viewport`: a window resized while the pane was
  // closed leaves no observation to react to (a hidden or throttled tab delivers no
  // ResizeObserver callbacks at all), and opening onto a stale width would put the page
  // in the wrong place for one frame. Opening always re-measures.
  useEffect(() => {
    if (!viewport) {
      setViewportWidth(0);
      setInlineEndReservation(0);
      return undefined;
    }
    const measure = () => {
      setViewportWidth(viewport.clientWidth);
      const padding = Number.parseFloat(getComputedStyle(viewport).paddingInlineEnd);
      setInlineEndReservation(Number.isFinite(padding) ? padding : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport, open, reviewPaneOpen, rail?.mounted]);

  // The snapshot reports `pageSetup` as null on some ticks even with a document loaded,
  // and a shift derived from one of those would collapse to zero and snap the page
  // sideways for a frame. The last width a document actually had is the honest answer for
  // a tick that reports none — it only resets when the editor itself goes away.
  const lastPageWidthTwips = useRef<number | null>(null);
  if (pageSetup) lastPageWidthTwips.current = pageSetup.pageWidthTwips;
  const pageWidthTwips = pageSetup?.pageWidthTwips ?? lastPageWidthTwips.current;

  const shift = useMemo(() => {
    if (!open) return 0;
    if (pageWidthTwips === null) return 0;
    return navigationShift({
      viewportWidth,
      pageWidthPx: twipsToPixels(pageWidthTwips) * zoom,
      reservation: navigationPaneReservation(paneWidth),
      inlineEndReservation,
    });
  }, [open, pageWidthTwips, zoom, viewportWidth, paneWidth, inlineEndReservation]);

  useEffect(() => {
    if (!store) return undefined;
    store.setShift(shift);
    // A pane unmounting mid-shift would otherwise leave the chrome permanently displaced.
    return () => store.setShift(0);
  }, [store, shift]);

  return { open, setOpen, toggle, tab, setTab, paneWidth, shift };
}
