/**
 * Manager Types
 *
 * Framework-agnostic interfaces for the editor's manager classes.
 */

import type { EditorView } from 'prosemirror-view';

import type { Document } from '../types/document';

// ============================================================================
// EDITOR HANDLE
// ============================================================================

/**
 * Framework-agnostic interface for an imperatively mounted editor instance.
 *
 * Returned by `renderAsync()` implementations (React, Vue, etc.).
 * Consumers use this to interact with the editor programmatically.
 */
export interface EditorHandle {
  /** Save the document and return the DOCX as a Blob. */
  save(): Promise<Blob | null>;
  /** Get the current parsed document model. */
  getDocument(): Document | null;
  /** Focus the editor. */
  focus(): void;
  /** Unmount the editor and clean up. */
  destroy(): void;
}

// ============================================================================
// AUTO-SAVE
// ============================================================================

/** Auto-save status */
export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Configuration for AutoSaveManager */
export interface AutoSaveManagerOptions {
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
export interface SavedDocumentData {
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
export interface AutoSaveSnapshot {
  status: AutoSaveStatus;
  lastSaveTime: Date | null;
  hasRecoveryData: boolean;
  isEnabled: boolean;
}

// ============================================================================
// TABLE SELECTION
// ============================================================================

/** Cell coordinates in a table */
export interface CellCoordinates {
  tableIndex: number;
  rowIndex: number;
  columnIndex: number;
}

/** TableSelectionManager snapshot */
export interface TableSelectionSnapshot {
  /** Currently selected cell, or null if no selection */
  selectedCell: CellCoordinates | null;
}

// ============================================================================
// ERROR MANAGER
// ============================================================================

/** Error severity levels */
export type ErrorSeverity = 'error' | 'warning' | 'info';

/** Error notification */
export interface ErrorNotification {
  id: string;
  message: string;
  severity: ErrorSeverity;
  details?: string;
  timestamp: number;
  dismissed?: boolean;
}

/** ErrorManager snapshot */
export interface ErrorManagerSnapshot {
  notifications: ErrorNotification[];
}

// ============================================================================
// PLUGIN LIFECYCLE
// ============================================================================

/** Plugin lifecycle configuration */
export interface PluginLifecycleConfig {
  id: string;
  styles?: string;
  initialize?: (editorView: EditorView) => unknown;
  onStateChange?: (editorView: EditorView) => unknown;
  destroy?: () => void;
}

/** PluginLifecycleManager snapshot */
export interface PluginLifecycleSnapshot {
  /** Map of plugin ID to plugin state */
  states: Map<string, unknown>;
  /** Version counter (incremented on any state change) */
  version: number;
}
