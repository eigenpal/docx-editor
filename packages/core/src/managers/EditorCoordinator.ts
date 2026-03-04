/**
 * EditorCoordinator
 *
 * Framework-agnostic class managing the document editor lifecycle:
 * - Document parsing and loading
 * - Font loading coordination
 * - Zoom level management
 * - Extension manager initialization
 * - Agent command execution
 *
 * Extracted from DocxEditor.tsx.
 *
 * Usage with React:
 * ```ts
 * const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
 * ```
 *
 * NOTE: This class defines the state shape and coordination logic.
 * Full integration with DocxEditor is done incrementally.
 */

import { Subscribable } from './Subscribable';
import type { Document } from '../types/document';

// ============================================================================
// TYPES
// ============================================================================

/** Editor loading state */
export type EditorLoadingState = 'idle' | 'parsing' | 'loading-fonts' | 'ready' | 'error';

/** Configuration for EditorCoordinator */
export interface EditorCoordinatorOptions {
  /** Initial zoom level (default: 1.0) */
  initialZoom?: number;
  /** Callback when the document changes */
  onChange?: (document: Document) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
}

/** The full snapshot exposed to UI frameworks */
export interface EditorCoordinatorSnapshot {
  /** Current loading state */
  loadingState: EditorLoadingState;
  /** Error message if loadingState is 'error' */
  parseError: string | null;
  /** Whether the editor is ready for interaction */
  isReady: boolean;
  /** Current zoom level (1.0 = 100%) */
  zoom: number;
  /** Whether fonts have been loaded */
  fontsLoaded: boolean;
  /** Version counter */
  version: number;
}

// ============================================================================
// COORDINATOR
// ============================================================================

export class EditorCoordinator extends Subscribable<EditorCoordinatorSnapshot> {
  private _loadingState: EditorLoadingState = 'idle';
  private _parseError: string | null = null;
  private _zoom: number;
  private _fontsLoaded = false;
  private _document: Document | null = null;
  private _version = 0;

  private onChangeCallback?: (document: Document) => void;
  private onErrorCallback?: (error: Error) => void;

  constructor(options: EditorCoordinatorOptions = {}) {
    const zoom = options.initialZoom ?? 1.0;
    super({
      loadingState: 'idle',
      parseError: null,
      isReady: false,
      zoom,
      fontsLoaded: false,
      version: 0,
    });

    this._zoom = zoom;
    this.onChangeCallback = options.onChange;
    this.onErrorCallback = options.onError;
  }

  // --------------------------------------------------------------------------
  // DOCUMENT LIFECYCLE
  // --------------------------------------------------------------------------

  /** Signal that document parsing has started. */
  setParsingStarted(): void {
    this._loadingState = 'parsing';
    this._parseError = null;
    this.emitSnapshot();
  }

  /** Signal that document parsing completed successfully. */
  setDocumentLoaded(document: Document): void {
    this._document = document;
    this._loadingState = 'loading-fonts';
    this._parseError = null;
    this.emitSnapshot();
  }

  /** Signal that font loading completed. */
  setFontsLoaded(): void {
    this._fontsLoaded = true;
    this._loadingState = 'ready';
    this.emitSnapshot();
  }

  /** Signal that an error occurred during loading. */
  setLoadError(error: Error): void {
    this._loadingState = 'error';
    this._parseError = error.message;
    this.onErrorCallback?.(error);
    this.emitSnapshot();
  }

  /** Get the current document. */
  getDocument(): Document | null {
    return this._document;
  }

  /** Update the document (after edits). */
  updateDocument(document: Document): void {
    this._document = document;
    this.onChangeCallback?.(document);
    this.emitSnapshot();
  }

  // --------------------------------------------------------------------------
  // ZOOM
  // --------------------------------------------------------------------------

  /** Set the zoom level (1.0 = 100%). */
  setZoom(zoom: number): void {
    this._zoom = Math.max(0.25, Math.min(4.0, zoom));
    this.emitSnapshot();
  }

  /** Get the current zoom level. */
  getZoom(): number {
    return this._zoom;
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private emitSnapshot(): void {
    this._version++;
    this.setSnapshot({
      loadingState: this._loadingState,
      parseError: this._parseError,
      isReady: this._loadingState === 'ready',
      zoom: this._zoom,
      fontsLoaded: this._fontsLoaded,
      version: this._version,
    });
  }
}
