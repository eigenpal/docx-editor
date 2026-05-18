/**
 * Layout constants and CSS-in-JS style objects for PagedEditor's
 * container, viewport, pages, and plugin-overlays layers.
 */

import type { CSSProperties } from 'react';
import type { Plugin } from 'prosemirror-state';

// Default page size (US Letter at 96 DPI)
export const DEFAULT_PAGE_WIDTH = 816;

export const DEFAULT_PAGE_GAP = 24;

// Stable empty array to avoid re-creating on each render
export const EMPTY_PLUGINS: Plugin[] = [];

/** Padding above page content in the viewport div. */
export const VIEWPORT_PADDING_TOP = 24;

export const containerStyles: CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: '100%',
  overflow: 'visible',
  backgroundColor: 'var(--doc-bg, #f8f9fa)',
};

export const viewportStyles: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: VIEWPORT_PADDING_TOP,
  paddingBottom: 24,
  overflowAnchor: 'none',
};

export const pagesContainerStyles: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  overflowAnchor: 'none',
};

export const pluginOverlaysStyles: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'none',
  overflow: 'visible',
  zIndex: 8,
};
