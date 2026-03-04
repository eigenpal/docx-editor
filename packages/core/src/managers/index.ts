/**
 * Manager Classes — Framework-Agnostic Business Logic
 *
 * These classes contain the state machines and coordination logic
 * extracted from React components and hooks. They can be consumed
 * by any UI framework via the subscribe/getSnapshot pattern.
 */

// Base class
export { Subscribable } from './Subscribable';

// Types
export type {
  EditorHandle,
  AutoSaveStatus,
  AutoSaveManagerOptions,
  SavedDocumentData,
  AutoSaveSnapshot,
  CellCoordinates,
  TableSelectionSnapshot,
  ErrorSeverity,
  ErrorNotification,
  ErrorManagerSnapshot,
  PluginLifecycleConfig,
  PluginLifecycleSnapshot,
} from './types';

// Manager classes
export {
  AutoSaveManager,
  formatLastSaveTime,
  getAutoSaveStatusLabel,
  getAutoSaveStorageSize,
  formatStorageSize,
  isAutoSaveSupported,
} from './AutoSaveManager';

export { TableSelectionManager } from './TableSelectionManager';
export {
  TABLE_DATA_ATTRIBUTES,
  findTableFromClick,
  getTableFromDocument,
  updateTableInDocument,
  deleteTableFromDocument,
} from './TableSelectionManager';

export {
  getSelectionRuns,
  createSelectionFromDOM,
  extractFormattingFromElement,
  rgbToHex,
} from './ClipboardManager';
export type { ClipboardSelection } from './ClipboardManager';

export { ErrorManager } from './ErrorManager';

export { PluginLifecycleManager, injectStyles } from './PluginLifecycleManager';

export { LayoutCoordinator } from './LayoutCoordinator';
export type {
  SelectionRect,
  CaretPosition,
  ImageSelectionInfo,
  ColumnResizeState,
  LayoutCoordinatorSnapshot,
} from './LayoutCoordinator';

export { EditorCoordinator } from './EditorCoordinator';
export type {
  EditorLoadingState,
  EditorCoordinatorOptions,
  EditorCoordinatorSnapshot,
} from './EditorCoordinator';
