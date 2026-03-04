/**
 * @eigenpal/docx-js-editor/react
 *
 * React entry point — DocxEditor component and renderAsync.
 *
 * @example
 * ```tsx
 * import { DocxEditor } from '@eigenpal/docx-js-editor/react';
 * ```
 */

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export { DocxEditor, type DocxEditorProps, type DocxEditorRef } from './components/DocxEditor';
export {
  DirectXmlDocxEditor,
  type DirectXmlDocxEditorProps,
  type DirectXmlOperationContext,
} from './components/DirectXmlDocxEditor';
export { renderAsync, type RenderAsyncOptions, type DocxEditorHandle } from './renderAsync';
export { type DocxInput, toArrayBuffer } from './utils/docxInput';

// ============================================================================
// ERROR HANDLING
// ============================================================================

export {
  ErrorBoundary,
  type ErrorBoundaryProps,
  ErrorProvider,
  useErrorNotifications,
  type ErrorContextValue,
  type ErrorNotification,
  type ErrorSeverity,
  ParseErrorDisplay,
  type ParseErrorDisplayProps,
  UnsupportedFeatureWarning,
  type UnsupportedFeatureWarningProps,
  isParseError,
  getUserFriendlyMessage,
} from './components/ErrorBoundary';

// ============================================================================
// HOOKS
// ============================================================================

export {
  useTableSelection,
  TABLE_DATA_ATTRIBUTES,
  type TableSelectionState,
  type UseTableSelectionReturn,
  type UseTableSelectionOptions,
} from './hooks/useTableSelection';

export {
  useAutoSave,
  formatLastSaveTime,
  getAutoSaveStatusLabel,
  getAutoSaveStorageSize,
  formatStorageSize,
  isAutoSaveSupported,
  type AutoSaveStatus,
  type UseAutoSaveOptions,
  type UseAutoSaveReturn,
  type SavedDocumentData,
} from './hooks/useAutoSave';

export {
  useWheelZoom,
  getZoomPresets,
  findNearestZoomPreset,
  getNextZoomPreset,
  getPreviousZoomPreset,
  formatZoom,
  parseZoom,
  isZoomPreset,
  clampZoom,
  ZOOM_PRESETS,
  type UseWheelZoomOptions,
  type UseWheelZoomReturn,
} from './hooks/useWheelZoom';

export {
  useClipboard,
  createSelectionFromDOM,
  getSelectionRuns,
  type ClipboardSelection,
  type UseClipboardOptions,
  type UseClipboardReturn,
} from './hooks/useClipboard';

export {
  useSelectionHighlight,
  generateOverlayElements,
  type UseSelectionHighlightOptions,
  type UseSelectionHighlightReturn,
  type SelectionOverlayProps,
} from './hooks/useSelectionHighlight';

// ============================================================================
// PLUGIN API
// ============================================================================

export {
  PluginHost,
  PLUGIN_HOST_STYLES,
  type EditorPlugin,
  type PluginPanelProps,
  type PanelConfig,
  type PluginContext,
  type PluginHostProps,
  type PluginHostRef,
} from './plugin-api';
