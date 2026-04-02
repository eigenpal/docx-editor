// @eigenpal/docx-editor-vue
// Vue.js wrapper for the DOCX editor — community contributed
//
// This package provides Vue 3 components wrapping @eigenpal/docx-core.
// Contributions welcome! See the repository README for guidelines.

// Components
export { default as DocxEditorVue } from './components/DocxEditorVue.vue';
export { default as BasicToolbar } from './components/BasicToolbar.vue';
export { default as FindReplaceDialog } from './components/FindReplaceDialog.vue';
export { default as TableToolbar } from './components/TableToolbar.vue';
export { default as InsertTableDialog } from './components/InsertTableDialog.vue';
export { default as InsertImageDialog } from './components/InsertImageDialog.vue';
export { default as HyperlinkDialog } from './components/HyperlinkDialog.vue';
export { default as InsertSymbolDialog } from './components/InsertSymbolDialog.vue';
export { default as ImageEditOverlay } from './components/ImageEditOverlay.vue';
export { default as ImagePropertiesDialog } from './components/ImagePropertiesDialog.vue';
export { default as PageSetupDialog } from './components/PageSetupDialog.vue';
export { default as DocumentOutline } from './components/DocumentOutline.vue';
export { default as KeyboardShortcutsDialog } from './components/KeyboardShortcutsDialog.vue';
export { default as TextContextMenu } from './components/TextContextMenu.vue';
export { default as UnifiedSidebar } from './components/sidebar/UnifiedSidebar.vue';
export { default as CommentCard } from './components/sidebar/CommentCard.vue';
export { default as TrackedChangeCard } from './components/sidebar/TrackedChangeCard.vue';
export { default as AddCommentCard } from './components/sidebar/AddCommentCard.vue';
export { default as TablePropertiesDialog } from './components/TablePropertiesDialog.vue';
export { default as TableStyleGallery } from './components/TableStyleGallery.vue';
export { default as ImagePositionDialog } from './components/ImagePositionDialog.vue';
export { default as DocumentName } from './components/DocumentName.vue';
export { default as MenuBar } from './components/MenuBar.vue';
export { default as PrintButton } from './components/PrintButton.vue';
export { default as HorizontalRuler } from './components/HorizontalRuler.vue';
export { default as VerticalRuler } from './components/VerticalRuler.vue';
export { default as ResponsiveToolbar } from './components/ResponsiveToolbar.vue';

// Tier 8 — Advanced Features
export { default as FootnotePropertiesDialog } from './components/FootnotePropertiesDialog.vue';
export { default as UnsavedIndicator } from './components/UnsavedIndicator.vue';
export { default as ErrorBoundary } from './components/ErrorBoundary.vue';
export { default as PasteSpecialDialog } from './components/PasteSpecialDialog.vue';
export { default as InlineHeaderFooterEditor } from './components/InlineHeaderFooterEditor.vue';
export { default as AIContextMenu } from './components/AIContextMenu.vue';
export { default as AIResponsePreview } from './components/AIResponsePreview.vue';

// Composables
export { useDocxEditor } from './composables/useDocxEditor';
export { useZoom } from './composables/useZoom';
export { useTableSelection } from './composables/useTableSelection';
export { useAutoSave } from './composables/useAutoSave';
export type { UseDocxEditorOptions } from './composables/useDocxEditor';
export type { UseAutoSaveOptions } from './composables/useAutoSave';

// i18n
export { useTranslation, provideLocale, i18nPlugin, defaultLocale } from './i18n';
export type { LocaleStrings, Translations } from './i18n';

// renderAsync
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
