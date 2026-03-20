import { Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Node } from 'prosemirror-model';
import { D as Document, e as Table, b as Run } from './agentApi-BVHzyk2l.js';

/**
 * Framework-Agnostic Plugin Interface for the DOCX Editor
 *
 * Core plugin types that can be used by any framework (React, Vue, etc.).
 * Framework-specific adapters extend EditorPluginCore with their own
 * UI rendering capabilities (e.g., ReactEditorPlugin, VueEditorPlugin).
 */

/**
 * Coordinates returned by position lookup in the rendered DOM.
 */
interface PositionCoordinates {
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
interface RenderedDomContext {
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
  ): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  /** Current zoom level (1 = 100%). */
  zoom: number;
  /**
   * Offset of the pages container from its parent viewport.
   */
  getContainerOffset(): {
    x: number;
    y: number;
  };
}
/**
 * Props passed to plugin panel components (framework-agnostic base).
 */
interface PluginPanelProps<TState = unknown> {
  /** Current ProseMirror editor view */
  editorView: EditorView | null;
  /** Current ProseMirror document */
  doc: Node | null;
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
interface PanelConfig {
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
interface EditorPluginCore<TState = any> {
  /** Unique plugin identifier */
  id: string;
  /** Display name for the plugin */
  name: string;
  /**
   * ProseMirror plugins to register with the editor.
   * These are merged with the editor's internal plugins.
   */
  proseMirrorPlugins?: Plugin[];
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

/**
 * Subscribable Base Class
 *
 * Framework-agnostic base for manager classes that need to notify
 * UI frameworks of state changes.
 *
 * Compatible with:
 * - React: useSyncExternalStore(manager.subscribe, manager.getSnapshot)
 * - Vue: watchEffect(() => { manager.subscribe(triggerRef) })
 */
declare abstract class Subscribable<TSnapshot> {
  private listeners;
  private snapshot;
  constructor(initialSnapshot: TSnapshot);
  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   * Bound method — safe to pass as `useSyncExternalStore(manager.subscribe, ...)`.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Get the current snapshot. Returns a stable reference unless state has changed.
   * Bound method — safe to pass as `useSyncExternalStore(..., manager.getSnapshot)`.
   */
  getSnapshot: () => TSnapshot;
  /**
   * Update the snapshot and notify all subscribers.
   * Subclasses should call this whenever their state changes.
   */
  protected setSnapshot(snapshot: TSnapshot): void;
  private notify;
}

/**
 * Manager Types
 *
 * Framework-agnostic interfaces for the editor's manager classes.
 */

/**
 * Framework-agnostic interface for an imperatively mounted editor instance.
 *
 * Returned by `renderAsync()` implementations (React, Vue, etc.).
 * Consumers use this to interact with the editor programmatically.
 */
interface EditorHandle {
  /** Save the document and return the DOCX as a Blob. */
  save(): Promise<Blob | null>;
  /** Get the current parsed document model. */
  getDocument(): Document | null;
  /** Focus the editor. */
  focus(): void;
  /** Unmount the editor and clean up. */
  destroy(): void;
}
/** Auto-save status */
type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
/** Configuration for AutoSaveManager */
interface AutoSaveManagerOptions {
  /** Storage key for localStorage (default: 'docx-editor-autosave') */
  storageKey?: string;
  /** Save interval in milliseconds (default: 30000 - 30 seconds) */
  interval?: number;
  /** Maximum age of auto-save before it's considered stale (default: 24 hours) */
  maxAge?: number;
  /** Whether to save on document change with debounce (default: true) */
  saveOnChange?: boolean;
  /** Debounce delay for saveOnChange in milliseconds (default: 2000) */
  debounceDelay?: number;
  /** Callback when save succeeds */
  onSave?: (timestamp: Date) => void;
  /** Callback when save fails */
  onError?: (error: Error) => void;
  /** Callback when recovery data is found */
  onRecoveryAvailable?: (savedDocument: SavedDocumentData) => void;
}
/** Saved document data structure */
interface SavedDocumentData {
  /** The document JSON */
  document: Document;
  /** When the document was saved */
  savedAt: string;
  /** Version for format compatibility */
  version: number;
  /** Optional document identifier */
  documentId?: string;
}
/** AutoSaveManager snapshot for UI consumption */
interface AutoSaveSnapshot {
  status: AutoSaveStatus;
  lastSaveTime: Date | null;
  hasRecoveryData: boolean;
  isEnabled: boolean;
}
/** Cell coordinates in a table */
interface CellCoordinates {
  tableIndex: number;
  rowIndex: number;
  columnIndex: number;
}
/** TableSelectionManager snapshot */
interface TableSelectionSnapshot {
  /** Currently selected cell, or null if no selection */
  selectedCell: CellCoordinates | null;
}
/** Error severity levels */
type ErrorSeverity = 'error' | 'warning' | 'info';
/** Error notification */
interface ErrorNotification {
  id: string;
  message: string;
  severity: ErrorSeverity;
  details?: string;
  timestamp: number;
  dismissed?: boolean;
}
/** ErrorManager snapshot */
interface ErrorManagerSnapshot {
  notifications: ErrorNotification[];
}
/** Plugin lifecycle configuration */
interface PluginLifecycleConfig {
  id: string;
  styles?: string;
  initialize?: (editorView: EditorView) => unknown;
  onStateChange?: (editorView: EditorView) => unknown;
  destroy?: () => void;
}
/** PluginLifecycleManager snapshot */
interface PluginLifecycleSnapshot {
  /** Map of plugin ID to plugin state */
  states: Map<string, unknown>;
  /** Version counter (incremented on any state change) */
  version: number;
}

/**
 * AutoSaveManager
 *
 * Framework-agnostic class for auto-saving documents to localStorage.
 * Extracted from the React `useAutoSave` hook.
 *
 * Usage with React:
 * ```ts
 * const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
 * ```
 */

declare class AutoSaveManager extends Subscribable<AutoSaveSnapshot> {
  private storageKey;
  private interval;
  private maxAge;
  private saveOnChange;
  private debounceDelay;
  private onSaveCallback?;
  private onErrorCallback?;
  private onRecoveryAvailableCallback?;
  private storageAvailable;
  private currentDocument;
  private lastSavedJson;
  private intervalTimer;
  private debounceTimer;
  private status;
  private lastSaveTime;
  private _hasRecoveryData;
  private _isEnabled;
  constructor(options?: AutoSaveManagerOptions);
  /** Update the current document. Triggers debounced save if enabled. */
  onDocumentChanged(document: Document | null): void;
  /** Manually trigger a save. */
  save(): Promise<boolean>;
  /** Clear auto-saved data from storage. */
  clear(): void;
  /** Get recovery data from storage. */
  getRecoveryData(): SavedDocumentData | null;
  /** Accept recovery and return the document. */
  acceptRecovery(): Document | null;
  /** Dismiss recovery and clear saved data. */
  dismissRecovery(): void;
  /** Enable auto-save and start the interval timer. */
  enable(): void;
  /** Disable auto-save and stop all timers. */
  disable(): void;
  /** Start the interval timer. Call after enabling or on init. */
  startInterval(): void;
  /** Save synchronously on destroy (best-effort). */
  destroy(): void;
  private checkRecoveryData;
  private persistToStorage;
  private debounceSave;
  private stopTimers;
  private updateStatus;
  private emitSnapshot;
}
/** Format last save time for display */
declare function formatLastSaveTime(date: Date | null): string;
/** Get auto-save status label */
declare function getAutoSaveStatusLabel(status: AutoSaveStatus): string;
/** Get storage size used by auto-save */
declare function getAutoSaveStorageSize(storageKey?: string): number;
/** Format storage size for display */
declare function formatStorageSize(bytes: number): string;
/** Check if auto-save is supported */
declare function isAutoSaveSupported(): boolean;

/**
 * TableSelectionManager
 *
 * Framework-agnostic class for managing table cell selection state.
 * Extracted from the React `useTableSelection` hook.
 *
 * Handles:
 * - Cell selection via data-attribute queries on the DOM
 * - Table document operations (add/delete rows/columns, merge/split)
 */

/** Data attributes for table elements in the rendered DOM */
declare const TABLE_DATA_ATTRIBUTES: {
  readonly TABLE_INDEX: 'data-table-index';
  readonly ROW_INDEX: 'data-row';
  readonly COLUMN_INDEX: 'data-col';
  readonly TABLE_CELL: 'data-table-cell';
};
/**
 * Find table cell coordinates from a click target by walking up the DOM
 * and reading data attributes.
 */
declare function findTableFromClick(
  target: EventTarget | null,
  container?: HTMLElement | null
): CellCoordinates | null;
/** Get a table from the document by index. */
declare function getTableFromDocument(doc: Document, tableIndex: number): Table | null;
/** Update a table in the document immutably. */
declare function updateTableInDocument(
  doc: Document,
  tableIndex: number,
  newTable: Table
): Document;
/** Delete a table from the document immutably. */
declare function deleteTableFromDocument(doc: Document, tableIndex: number): Document;
declare class TableSelectionManager extends Subscribable<TableSelectionSnapshot> {
  constructor();
  /** Select a specific cell. */
  selectCell(coords: CellCoordinates): void;
  /** Clear the current selection. */
  clearSelection(): void;
  /** Check if a specific cell is selected. */
  isCellSelected(tableIndex: number, rowIndex: number, columnIndex: number): boolean;
  /** Get the currently selected cell coordinates, or null. */
  getSelectedCell(): CellCoordinates | null;
}

/**
 * ClipboardManager
 *
 * Framework-agnostic class for clipboard operations in the editor.
 * Extracted from the React `useClipboard` hook.
 *
 * Handles:
 * - DOM selection traversal and run extraction
 * - Formatting extraction from computed styles
 * - Clipboard read/write operations
 */

/** Selection data for clipboard operations */
interface ClipboardSelection {
  text: string;
  runs: Run[];
  startParagraphIndex: number;
  startRunIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endRunIndex: number;
  endOffset: number;
  isMultiParagraph: boolean;
}
/**
 * Convert a CSS color string (rgb/rgba/hex) to a 6-char uppercase hex string.
 *
 * NOTE: This differs from `colorResolver.rgbToHex(r, g, b)` which takes
 * numeric components. This function parses CSS color strings.
 */
declare function cssColorToHex(color: string): string | null;
/** Extract formatting from an HTML element's computed styles. */
declare function extractFormattingFromElement(element: HTMLElement): Run['formatting'];
/** Get selected runs from the current DOM selection. */
declare function getSelectionRuns(): Run[];
/** Create a ClipboardSelection from the current DOM selection. */
declare function createSelectionFromDOM(): ClipboardSelection | null;
declare const rgbToHex: typeof cssColorToHex;

export {
  AutoSaveManager as A,
  rgbToHex as B,
  type CellCoordinates as C,
  updateTableInDocument as D,
  type ErrorManagerSnapshot as E,
  type PluginLifecycleSnapshot as P,
  type RenderedDomContext as R,
  Subscribable as S,
  TABLE_DATA_ATTRIBUTES as T,
  type PluginLifecycleConfig as a,
  type AutoSaveManagerOptions as b,
  type AutoSaveSnapshot as c,
  type AutoSaveStatus as d,
  type ClipboardSelection as e,
  type EditorHandle as f,
  type EditorPluginCore as g,
  type ErrorNotification as h,
  type ErrorSeverity as i,
  type PanelConfig as j,
  type PluginPanelProps as k,
  type PositionCoordinates as l,
  type SavedDocumentData as m,
  TableSelectionManager as n,
  type TableSelectionSnapshot as o,
  createSelectionFromDOM as p,
  deleteTableFromDocument as q,
  extractFormattingFromElement as r,
  findTableFromClick as s,
  formatLastSaveTime as t,
  formatStorageSize as u,
  getAutoSaveStatusLabel as v,
  getAutoSaveStorageSize as w,
  getSelectionRuns as x,
  getTableFromDocument as y,
  isAutoSaveSupported as z,
};
