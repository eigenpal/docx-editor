/**
 * @eigenpal/docx-editor-vue/plugin-api
 *
 * Generic plugin interface and host component for integrating external
 * plugins with the Vue editor. Pairs with the framework-agnostic plugin
 * types exported from `@eigenpal/docx-editor-core/plugin-api`.
 *
 * @example
 * ```ts
 * import { PluginHost, type VueEditorPlugin } from '@eigenpal/docx-editor-vue/plugin-api';
 * ```
 *
 * @packageDocumentation
 * @public
 */

export { default as PluginHost } from './PluginHost.vue';
export { createRenderedDomContext, RenderedDomContextImpl } from './RenderedDomContext';
export type {
  EditorPluginCore,
  PanelConfig,
  PluginPanelProps,
  PositionCoordinates,
  RenderedDomContext,
  VueEditorPlugin,
} from './types';
