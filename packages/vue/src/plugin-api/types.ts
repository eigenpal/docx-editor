/**
 * Vue Plugin Interface for the DOCX Editor
 *
 * Extends the framework-agnostic EditorPluginCore with Vue-specific
 * UI rendering capabilities.
 *
 * Community contributed — contributions welcome!
 */

import type { EditorView } from 'prosemirror-view';
import type { Component, VNode } from 'vue';

// Re-export core types
export type {
  EditorPluginCore,
  PluginPanelProps,
  PanelConfig,
  RenderedDomContext,
  PositionCoordinates,
} from '@eigenpal/docx-core/plugin-api';

import type {
  EditorPluginCore,
  PluginPanelProps,
  RenderedDomContext,
} from '@eigenpal/docx-core/plugin-api';

/**
 * Vue-specific editor plugin interface.
 *
 * Extends EditorPluginCore with:
 * - Panel: Vue component for rendering in the annotation panel
 * - renderOverlay: Function returning VNode for overlay rendering
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface VueEditorPlugin<TState = any> extends EditorPluginCore<TState> {
  /**
   * Vue component to render in the annotation panel area.
   */
  Panel?: Component<PluginPanelProps<TState>>;

  /**
   * Render an overlay on top of the rendered pages.
   */
  renderOverlay?: (
    context: RenderedDomContext,
    state: TState,
    editorView: EditorView | null
  ) => VNode | null;
}
