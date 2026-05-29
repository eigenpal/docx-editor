/**
 * @eigenpal/docx-editor-react/hooks
 *
 * React hooks for editor history, table selection, find/replace, autosave,
 * clipboard, and zoom. Use alongside the main `DocxEditor` component.
 *
 * @example
 * ```tsx
 * import { useAutoSave, useFindReplace } from '@eigenpal/docx-editor-react/hooks';
 * ```
 *
 * @packageDocumentation
 * @public
 */

export { useHistory, useAutoHistory, useDocumentHistory, HistoryManager } from './useHistory';
export type { HistoryEntry, UseHistoryOptions, UseHistoryReturn } from './useHistory';

export { useTableSelection, TABLE_DATA_ATTRIBUTES } from './useTableSelection';
export type {
  TableSelectionState,
  UseTableSelectionReturn,
  UseTableSelectionOptions,
} from './useTableSelection';

export { useSelectionHighlight, generateOverlayElements } from './useSelectionHighlight';
export type {
  UseSelectionHighlightOptions,
  UseSelectionHighlightReturn,
  SelectionOverlayProps,
} from './useSelectionHighlight';

export { useClipboard, createSelectionFromDOM, getSelectionRuns } from './useClipboard';
export type { ClipboardSelection, UseClipboardOptions, UseClipboardReturn } from './useClipboard';

export {
  useAutoSave,
  formatLastSaveTime,
  getAutoSaveStatusLabel,
  getAutoSaveStorageSize,
  formatStorageSize,
  isAutoSaveSupported,
} from './useAutoSave';
export type {
  AutoSaveStatus,
  UseAutoSaveOptions,
  UseAutoSaveReturn,
  SavedDocumentData,
} from './useAutoSave';

export { useDragAutoScroll } from './useDragAutoScroll';
export type { DragAutoScrollOptions } from './useDragAutoScroll';

export { useFindReplace } from './useFindReplace';
export type { FindReplaceOptions, FindReplaceState, UseFindReplaceReturn } from './useFindReplace';

export { useFixedDropdown } from './useFixedDropdown';
export type { UseFixedDropdownOptions, UseFixedDropdownReturn } from './useFixedDropdown';

export { useAspectLockedSize } from './useAspectLockedSize';
export type { UseAspectLockedSizeReturn } from './useAspectLockedSize';

export { useVisualLineNavigation } from './useVisualLineNavigation';
export type { VisualLineNavigationOptions } from './useVisualLineNavigation';

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
} from './useWheelZoom';
export type { UseWheelZoomOptions, UseWheelZoomReturn } from './useWheelZoom';

export { useTrackedChanges, extractTrackedChanges } from './useTrackedChanges';
export type { TrackedChangesResult } from './useTrackedChanges';
