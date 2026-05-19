/**
 * @eigenpal/docx-editor-react/plugin-api
 *
 * Generic plugin interface and host component for integrating external
 * plugins with the editor. Pairs with the framework-agnostic plugin types
 * exported from `@eigenpal/docx-editor-core/plugin-api`.
 *
 * @example
 * ```tsx
 * import { PluginHost, templatePlugin, type EditorPlugin } from '@eigenpal/docx-editor-react/plugin-api';
 *
 * function MyEditor() {
 *   return (
 *     <PluginHost plugins={[templatePlugin]}>
 *       <DocxEditor document={doc} onChange={handleChange} />
 *     </PluginHost>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 * @public
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

// Built-in editor plugins
export {
  templatePlugin,
  createPlugin as createTemplatePlugin,
  createTemplatePlugin as createTemplateProseMirrorPlugin,
  templatePluginKey,
  getTemplateTags as getTemplatePluginTags,
  setHoveredElement,
  setSelectedElement,
  TEMPLATE_DECORATION_STYLES,
  type TemplateTag,
  type TagType,
} from '../plugins/template';
