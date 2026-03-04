/**
 * Framework-Agnostic Plugin Interface for the DOCX Editor
 *
 * Core plugin types that can be used by any framework (React, Vue, etc.).
 * Framework-specific adapters extend EditorPluginCore with their own
 * UI rendering capabilities (e.g., ReactEditorPlugin, VueEditorPlugin).
 */

import type { Plugin as ProseMirrorPlugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

/**
 * Coordinates returned by position lookup in the rendered DOM.
 */
export interface PositionCoordinates {
  x: number;
  y: number;
  height: number;
}

/**
 * Context for accessing the rendered DOM in the paged editor.
 *
 * Provides DOM-based position mapping that works with the LayoutPainter
 * output (visible pages). Use this for rendering overlays, annotations,
 * and other visual elements positioned relative to rendered content.
 *
 * The rendered DOM uses data-pm-start/data-pm-end attributes on spans
 * to map between ProseMirror positions and DOM elements.
 */
export interface RenderedDomContext {
  /** The container element holding all rendered pages. */
  pagesContainer: HTMLElement;

  /**
   * Get pixel coordinates for a ProseMirror position in the rendered DOM.
   * Returns null if the position cannot be found.
   */
  getCoordinatesForPosition(pmPos: number): PositionCoordinates | null;

  /**
   * Find DOM elements that overlap with a ProseMirror position range.
   */
  findElementsForRange(from: number, to: number): Element[];

  /**
   * Get bounding rectangles for a range of text, accounting for line wraps.
   * Returns rects relative to the pages container.
   */
  getRectsForRange(
    from: number,
    to: number
  ): Array<{ x: number; y: number; width: number; height: number }>;

  /** Current zoom level (1 = 100%). */
  zoom: number;

  /**
   * Offset of the pages container from its parent viewport.
   */
  getContainerOffset(): { x: number; y: number };
}

/**
 * Props passed to plugin panel components (framework-agnostic base).
 */
export interface PluginPanelProps<TState = unknown> {
  /** Current ProseMirror editor view */
  editorView: EditorView | null;

  /** Current ProseMirror document */
  doc: ProseMirrorNode | null;

  /** Scroll editor to a specific position */
  scrollToPosition: (pos: number) => void;

  /** Select a range in the editor */
  selectRange: (from: number, to: number) => void;

  /** Plugin-specific state (managed by the plugin) */
  pluginState: TState;

  /** Width of the panel in pixels */
  panelWidth: number;

  /**
   * Context for the rendered DOM (LayoutPainter output).
   * May be null if layout hasn't completed yet.
   */
  renderedDomContext: RenderedDomContext | null;
}

/**
 * Configuration for plugin panel rendering.
 */
export interface PanelConfig {
  /** Where to render the panel */
  position: 'left' | 'right' | 'bottom';

  /** Default width/height of the panel */
  defaultSize: number;

  /** Minimum size */
  minSize?: number;

  /** Maximum size */
  maxSize?: number;

  /** Whether the panel is resizable */
  resizable?: boolean;

  /** Whether the panel can be collapsed */
  collapsible?: boolean;

  /** Initial collapsed state */
  defaultCollapsed?: boolean;
}

/**
 * Framework-agnostic core plugin interface.
 *
 * Contains all non-UI plugin capabilities:
 * - ProseMirror plugins (decorations, keymaps, etc.)
 * - State management (initialize, onStateChange, destroy)
 * - CSS injection
 * - Panel configuration
 *
 * Framework adapters (ReactEditorPlugin, VueEditorPlugin) extend this
 * with their own Panel component type and renderOverlay function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EditorPluginCore<TState = any> {
  /** Unique plugin identifier */
  id: string;

  /** Display name for the plugin */
  name: string;

  /**
   * ProseMirror plugins to register with the editor.
   * These are merged with the editor's internal plugins.
   */
  proseMirrorPlugins?: ProseMirrorPlugin[];

  /**
   * Configuration for the panel (position, size, etc.)
   */
  panelConfig?: PanelConfig;

  /**
   * Called when the editor state changes.
   * Use this to update plugin-specific state based on document changes.
   */
  onStateChange?: (view: EditorView) => TState | undefined;

  /**
   * Initialize plugin state when the plugin is first loaded.
   */
  initialize?: (view: EditorView | null) => TState;

  /**
   * Called when the plugin is being destroyed.
   * Use this for cleanup (subscriptions, timers, etc.)
   */
  destroy?: () => void;

  /**
   * CSS styles to inject for this plugin.
   * Can be a string of CSS or a URL to a stylesheet.
   */
  styles?: string;
}
