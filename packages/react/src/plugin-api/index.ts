/**
 * Plugin API for the DOCX Editor
 *
 * This module exports the generic plugin interface and host component
 * that allows external plugins to integrate with the editor.
 *
 * @example
 * ```tsx
 * import { PluginHost, type EditorPlugin } from '@docx-editor/plugin-api';
 * import { templatePlugin } from '@docx-editor/plugins/template';
 *
 * function MyEditor() {
 *   return (
 *     <PluginHost plugins={[templatePlugin]}>
 *       <DocxEditor document={doc} onChange={handleChange} />
 *     </PluginHost>
 *   );
 * }
 * ```
 */

// Types (React-specific + re-exports from core)
export type {
  EditorPlugin,
  ReactEditorPlugin,
  PluginPanelProps,
  PanelConfig,
  PluginContext,
  PluginHostProps,
  PluginHostRef,
  RenderedDomContext,
  PositionCoordinates,
  SidebarItem,
  SidebarItemContext,
  ReactSidebarItem,
  SidebarItemRenderProps,
} from './types';

// Components
export { PluginHost, PLUGIN_HOST_STYLES } from './PluginHost';

// Rendered DOM Context
export { createRenderedDomContext, RenderedDomContextImpl } from './RenderedDomContext';
