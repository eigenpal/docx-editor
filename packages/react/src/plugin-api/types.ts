/**
 * React Plugin Interface for the DOCX Editor
 *
 * Extends the framework-agnostic EditorPluginCore with React-specific
 * UI rendering capabilities (Panel component, renderOverlay).
 */

import type { EditorView } from 'prosemirror-view';
import type { ReactNode } from 'react';

// Re-export all core types for backwards compatibility
export type {
  EditorPluginCore,
  PluginPanelProps,
  PanelConfig,
  RenderedDomContext,
  PositionCoordinates,
  SidebarItem,
  SidebarItemContext,
} from '@eigenpal/docx-core/plugin-api/types';

import type {
  EditorPluginCore,
  PluginPanelProps,
  RenderedDomContext,
  SidebarItem,
  SidebarItemContext,
} from '@eigenpal/docx-core/plugin-api/types';

/**
 * React-specific editor plugin interface.
 *
 * Extends EditorPluginCore with:
 * - Panel: React component for rendering in the annotation panel
 * - renderOverlay: Function returning ReactNode for overlay rendering
 */
/**
 * Render props passed to each sidebar item.
 */
export interface SidebarItemRenderProps {
  /** Whether this item is currently expanded/active. */
  isExpanded: boolean;
  /** Toggle expand/collapse for this item. */
  onToggleExpand: () => void;
  /** Ref callback to measure the rendered card height. */
  measureRef: (el: HTMLDivElement | null) => void;
}

/**
 * A sidebar item with React rendering, anchored to a document position.
 */
export interface ReactSidebarItem extends SidebarItem {
  /** Render the card content. */
  render: (props: SidebarItemRenderProps) => ReactNode;
  /** Estimated height in pixels (for pre-layout before measurement). Default: 40. */
  estimatedHeight?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ReactEditorPlugin<TState = any> extends EditorPluginCore<TState> {
  /**
   * React component to render in the annotation panel area.
   * Receives editor state and callbacks for interaction.
   */
  Panel?: React.ComponentType<PluginPanelProps<TState>>;

  /**
   * Render an overlay on top of the rendered pages.
   * Use this for highlights, annotations, or other visual elements
   * that need to be positioned relative to the document content.
   */
  renderOverlay?: (
    context: RenderedDomContext,
    state: TState,
    editorView: EditorView | null
  ) => ReactNode;

  /**
   * Provide sidebar items anchored to document positions.
   * Called whenever plugin state changes.
   * Items from all plugins are merged and laid out together in a unified sidebar.
   */
  getSidebarItems?: (state: TState, context: SidebarItemContext) => ReactSidebarItem[];
}

/**
 * Backwards-compatible alias — EditorPlugin is now ReactEditorPlugin.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EditorPlugin<TState = any> = ReactEditorPlugin<TState>;

/**
 * Context value provided to plugins and panels.
 */
export interface PluginContext {
  /** All registered plugins */
  plugins: EditorPlugin[];

  /** Current editor view */
  editorView: EditorView | null;

  /** Set the editor view (called by editor on mount) */
  setEditorView: (view: EditorView | null) => void;

  /** Get plugin state by plugin ID */
  getPluginState: <T>(pluginId: string) => T | undefined;

  /** Update plugin state */
  setPluginState: <T>(pluginId: string, state: T) => void;

  /** Scroll to a position in the editor */
  scrollToPosition: (pos: number) => void;

  /** Select a range in the editor */
  selectRange: (from: number, to: number) => void;
}

/**
 * Props for the PluginHost component.
 */
export interface PluginHostProps {
  /** Plugins to enable */
  plugins: EditorPlugin[];

  /** The editor component (passed as child) */
  children: React.ReactElement;

  /** Class name for the host container */
  className?: string;
}

/**
 * Ref interface for the PluginHost component.
 */
export interface PluginHostRef {
  /** Get plugin state by plugin ID */
  getPluginState: <T>(pluginId: string) => T | undefined;

  /** Update plugin state for a plugin */
  setPluginState: <T>(pluginId: string, state: T) => void;

  /** Get the current editor view */
  getEditorView: () => EditorView | null;

  /** Force a refresh of all plugin states */
  refreshPluginStates: () => void;
}
