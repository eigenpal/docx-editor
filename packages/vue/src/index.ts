// @eigenpal/docx-editor-vue
// Vue.js wrapper for the DOCX editor — community contributed
//
// This package provides Vue 3 components wrapping @eigenpal/docx-core.
// Contributions welcome! See the repository README for guidelines.

// renderAsync stub
export { renderAsync } from './renderAsync';
export type { VueRenderAsyncOptions } from './renderAsync';

// Plugin types
export type { VueEditorPlugin } from './plugin-api/types';
export type {
  EditorPluginCore,
  PluginPanelProps,
  PanelConfig,
  RenderedDomContext,
  PositionCoordinates,
} from './plugin-api/types';
