/**
 * LayoutCoordinator
 *
 * Framework-agnostic class coordinating the PM state → layout engine →
 * layout painter → selection overlay pipeline.
 *
 * Extracted from PagedEditor.tsx. Manages:
 * - Layout pipeline state (blocks, measures, layout)
 * - Selection state (selectionRects, caretPosition)
 * - Drag selection state
 * - Column resize state
 * - Image interaction state
 *
 * Usage with React:
 * ```ts
 * const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
 * ```
 *
 * NOTE: This class defines the state shape and subscription pattern.
 * Full integration with PagedEditor is done incrementally.
 */

import { Subscribable } from './Subscribable';

// ============================================================================
// TYPES
// ============================================================================

/** Selection rectangle for rendering selection overlays */
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
}

/** Caret position for rendering the blinking cursor */
export interface CaretPosition {
  x: number;
  y: number;
  height: number;
  pageIndex: number;
}

/** Info about the currently selected/hovered image */
export interface ImageSelectionInfo {
  pmPos: number;
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  widthEmu: number;
  heightEmu: number;
  isInline: boolean;
}

/** Column resize tracking state */
export interface ColumnResizeState {
  isResizing: boolean;
  startX: number;
  columnIndex: number;
  tablePmStart: number;
  originalWidths: { left: number; right: number };
}

/** The full snapshot exposed to UI frameworks */
export interface LayoutCoordinatorSnapshot {
  /** Computed page layout, null until first computation */
  hasLayout: boolean;
  /** Selection rectangles for range selection overlay */
  selectionRects: SelectionRect[];
  /** Caret position for cursor overlay */
  caretPosition: CaretPosition | null;
  /** Currently selected/hovered image */
  selectedImageInfo: ImageSelectionInfo | null;
  /** Whether the editor is focused */
  isFocused: boolean;
  /** Whether a text drag is in progress */
  isDragging: boolean;
  /** Whether a column resize is in progress */
  isResizingColumn: boolean;
  /** Whether an image interaction is in progress */
  isImageInteracting: boolean;
  /** Version counter — incremented on every state change */
  version: number;
}

// ============================================================================
// COORDINATOR
// ============================================================================

export class LayoutCoordinator extends Subscribable<LayoutCoordinatorSnapshot> {
  // Layout pipeline state
  private _hasLayout = false;

  // Selection state
  private _selectionRects: SelectionRect[] = [];
  private _caretPosition: CaretPosition | null = null;

  // Drag state
  private _isDragging = false;
  private _dragAnchor: number | null = null;

  // Column resize state
  private _columnResize: ColumnResizeState = {
    isResizing: false,
    startX: 0,
    columnIndex: 0,
    tablePmStart: 0,
    originalWidths: { left: 0, right: 0 },
  };

  // Image interaction state
  private _selectedImageInfo: ImageSelectionInfo | null = null;
  private _isImageInteracting = false;

  // Focus state
  private _isFocused = false;

  // Version counter for fine-grained change tracking
  private _version = 0;

  constructor() {
    super({
      hasLayout: false,
      selectionRects: [],
      caretPosition: null,
      selectedImageInfo: null,
      isFocused: false,
      isDragging: false,
      isResizingColumn: false,
      isImageInteracting: false,
      version: 0,
    });
  }

  // --------------------------------------------------------------------------
  // LAYOUT PIPELINE
  // --------------------------------------------------------------------------

  /** Notify that layout has been computed. */
  setLayoutReady(hasLayout: boolean): void {
    this._hasLayout = hasLayout;
    this.emitSnapshot();
  }

  // --------------------------------------------------------------------------
  // SELECTION STATE
  // --------------------------------------------------------------------------

  /** Update selection rectangles and caret position. */
  updateSelection(selectionRects: SelectionRect[], caretPosition: CaretPosition | null): void {
    this._selectionRects = selectionRects;
    this._caretPosition = caretPosition;
    this.emitSnapshot();
  }

  // --------------------------------------------------------------------------
  // DRAG SELECTION
  // --------------------------------------------------------------------------

  /** Start a drag selection from the given PM anchor position. */
  startDrag(anchor: number): void {
    this._isDragging = true;
    this._dragAnchor = anchor;
    this.emitSnapshot();
  }

  /** Update drag to the given position (if desired). */
  updateDrag(_currentPos: number): void {
    // Position tracking is done via PM selection; this is just for state flag
  }

  /** End drag selection. */
  endDrag(): void {
    this._isDragging = false;
    this._dragAnchor = null;
    this.emitSnapshot();
  }

  /** Get the drag anchor position. */
  getDragAnchor(): number | null {
    return this._dragAnchor;
  }

  // --------------------------------------------------------------------------
  // COLUMN RESIZE
  // --------------------------------------------------------------------------

  /** Start resizing a table column. */
  startColumnResize(
    tablePmStart: number,
    columnIndex: number,
    startX: number,
    originalWidths: { left: number; right: number }
  ): void {
    this._columnResize = {
      isResizing: true,
      startX,
      columnIndex,
      tablePmStart,
      originalWidths,
    };
    this.emitSnapshot();
  }

  /** End column resize. */
  endColumnResize(): void {
    this._columnResize = {
      ...this._columnResize,
      isResizing: false,
    };
    this.emitSnapshot();
  }

  /** Get current column resize state. */
  getColumnResize(): ColumnResizeState {
    return this._columnResize;
  }

  // --------------------------------------------------------------------------
  // IMAGE INTERACTION
  // --------------------------------------------------------------------------

  /** Set the currently selected image. */
  setSelectedImage(imageInfo: ImageSelectionInfo | null): void {
    this._selectedImageInfo = imageInfo;
    this.emitSnapshot();
  }

  /** Clear the image selection. */
  clearSelectedImage(): void {
    this._selectedImageInfo = null;
    this._isImageInteracting = false;
    this.emitSnapshot();
  }

  /** Set whether an image interaction (resize/move) is in progress. */
  setImageInteracting(interacting: boolean): void {
    this._isImageInteracting = interacting;
    this.emitSnapshot();
  }

  // --------------------------------------------------------------------------
  // FOCUS
  // --------------------------------------------------------------------------

  /** Update focus state. */
  setFocused(focused: boolean): void {
    this._isFocused = focused;
    this.emitSnapshot();
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private emitSnapshot(): void {
    this._version++;
    this.setSnapshot({
      hasLayout: this._hasLayout,
      selectionRects: this._selectionRects,
      caretPosition: this._caretPosition,
      selectedImageInfo: this._selectedImageInfo,
      isFocused: this._isFocused,
      isDragging: this._isDragging,
      isResizingColumn: this._columnResize.isResizing,
      isImageInteracting: this._isImageInteracting,
      version: this._version,
    });
  }
}
