/**
 * Layout constants + CSS-in-JS style objects for PagedEditor's container,
 * viewport, pages, and plugin-overlays layers.
 *
 * Note: this file also re-exports a handful of non-style constants
 * (DEFAULT_PAGE_WIDTH / DEFAULT_PAGE_GAP / VIEWPORT_PADDING_TOP / EMPTY_PLUGINS)
 * because they're consumed by both the JSX styles below and the layout
 * pipeline — keeping them here avoids a separate constants file.
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

/** Padding below page content in the viewport div. */
export const VIEWPORT_PADDING_BOTTOM = 24;

export const containerStyles: CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: '100%',
  overflow: 'visible',
  backgroundColor: 'var(--doc-bg)',
};

export const viewportStyles: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: VIEWPORT_PADDING_TOP,
  paddingBottom: VIEWPORT_PADDING_BOTTOM,
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
