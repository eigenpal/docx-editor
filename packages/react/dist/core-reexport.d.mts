import { D as Document } from './agentApi-BVHzyk2l.mjs';
export { f as AIAction, g as AIActionRequest, A as AgentCommand, h as AgentContext, i as AgentResponse, j as ApplyStyleCommand, l as BlockContent, ad as BookmarkEnd, ae as BookmarkStart, p as DeleteTextCommand, d as DocumentBody, r as DocxPackage, E as Endnote, af as Field, ag as FooterReference, F as Footnote, t as FormatTextCommand, ah as HeaderFooter, ai as HeaderReference, H as Hyperlink, I as Image, u as InsertHyperlinkCommand, v as InsertImageCommand, w as InsertTableCommand, x as InsertTextCommand, L as ListLevel, N as NumberingDefinitions, a as Paragraph, J as ParagraphContext, K as ParagraphFormatting, P as Position, R as Range, Q as Relationship, S as ReplaceTextCommand, b as Run, c as RunContent, V as SectionProperties, W as SelectionContext, X as SetVariableCommand, aj as Shape, Y as Style, Z as StyleDefinitions, $ as SuggestedAction, e as Table, a0 as TableCell, a1 as TableRow, ak as TextBox, a2 as TextContent, T as TextFormatting, a3 as Theme, al as ThemeColorScheme, am as ThemeFont, an as ThemeFontScheme } from './agentApi-BVHzyk2l.mjs';
export { A as AgentContextOptions, C as CreateEmptyDocumentOptions, E as ExtendedSelectionContext, P as ProcessTemplateOptions, a as ProcessTemplateResult, b as SelectionContextOptions, a0 as ThemeMatrixCell, c as blendColors, d as buildExtendedSelectionContext, e as buildSelectionContext, g as colorsEqual, h as createDocumentWithText, i as createEmptyDocument, j as createRgbColor, l as createThemeColor, m as darkenColor, n as emuToPixels, o as emuToTwips, a1 as ensureHexPrefix, p as executeCommand, q as executeCommands, r as formatPx, a2 as generateThemeTintShadeMatrix, s as getAgentContext, t as getContrastingColor, u as getDocumentSummary, x as getTemplateTags, a3 as getThemeTintShadeHex, y as halfPointsToPixels, z as isBlack, B as isWhite, D as lightenColor, G as parseColorString, H as parseDocx, I as pixelsToEmu, J as pixelsToTwips, K as pointsToPixels, M as processTemplate, O as processTemplateAsBlob, Q as processTemplateDetailed, R as resolveColor, U as resolveHighlightColor, a4 as resolveHighlightToCss, V as resolveShadingColor, W as serializeDocumentBody, X as serializeDocx, Y as serializeSectionProperties, Z as twipsToEmu, _ as twipsToPixels, $ as validateTemplate } from './colorResolver-BwI_Uxp3.mjs';
import { S as Subscribable, E as ErrorManagerSnapshot, P as PluginLifecycleSnapshot, a as PluginLifecycleConfig } from './ClipboardManager-t936d0KD.mjs';
export { A as AutoSaveManager, b as AutoSaveManagerOptions, c as AutoSaveSnapshot, d as AutoSaveStatus, C as CellCoordinates, e as ClipboardSelection, f as EditorHandle, g as EditorPluginCore, h as ErrorNotification, i as ErrorSeverity, j as PanelConfig, k as PluginPanelProps, l as PositionCoordinates, R as RenderedDomContext, m as SavedDocumentData, T as TABLE_DATA_ATTRIBUTES, n as TableSelectionManager, o as TableSelectionSnapshot, p as createSelectionFromDOM, q as deleteTableFromDocument, r as extractFormattingFromElement, s as findTableFromClick, t as formatLastSaveTime, u as formatStorageSize, v as getAutoSaveStatusLabel, w as getAutoSaveStorageSize, x as getSelectionRuns, y as getTableFromDocument, z as isAutoSaveSupported, B as rgbToHex, D as updateTableInDocument } from './ClipboardManager-t936d0KD.mjs';
export { C as CorePlugin, e as McpSession, M as McpToolDefinition, i as McpToolHandler, j as McpToolResult } from './types-B3LkfO0u.mjs';
export { D as DocumentAgent, g as DocxInput, d as attemptSelectiveSave, t as toArrayBuffer } from './DocumentAgent-BqA9EJ3F.mjs';
export { I as InsertPosition, c as canRenderFont, a as countPageBreaks, b as createColumnBreak, d as createHorizontalRule, e as createLineBreak, f as createPageBreak, g as createPageBreakParagraph, h as createPageBreakRun, i as findPageBreaks, j as getLoadedFonts, k as hasPageBreakBefore, l as insertHorizontalRule, m as insertPageBreak, n as isBreakContent, o as isColumnBreak, p as isFontLoaded, q as isFontsLoading, r as isLineBreak, s as isPageBreak, t as loadFont, u as loadFontFromBuffer, v as loadFonts, w as onFontsLoaded, x as preloadCommonFonts, y as removePageBreak } from './fontLoader-DicgJidU.mjs';
import { EditorView } from 'prosemirror-view';
export { P as PluginRegistry, p as pluginRegistry, r as registerPlugins } from './registry-DyIMyB-0.mjs';
export { V as VariableDetectionResult, a as VariableOccurrence, b as buildPatchedDocumentXml, c as createDocx, d as detectVariables, e as detectVariablesDetailed, f as detectVariablesInBody, g as detectVariablesInParagraph, h as documentHasVariables, i as extractVariablesFromText, j as formatVariable, k as hasTemplateVariables, l as isValidVariableName, p as parseVariable, r as removeVariables, m as repackDocx, n as replaceVariables, s as sanitizeVariableName, u as updateMultipleFiles, v as validatePatchSafety } from './variableDetector-CIqTek7A.mjs';
export { docxtemplaterPlugin } from './core-plugins-reexport.mjs';
import 'prosemirror-state';
import 'prosemirror-model';

/**
 * ErrorManager
 *
 * Framework-agnostic pub/sub error notification system.
 * Replaces React's `componentDidCatch` + context pattern for error notifications.
 *
 * Usage with React:
 * ```ts
 * const { notifications } = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
 * ```
 */

declare class ErrorManager extends Subscribable<ErrorManagerSnapshot> {
    private notifications;
    private idCounter;
    private timers;
    constructor();
    /** Show an error notification (persistent, not auto-dismissed). */
    showError(message: string, details?: string): string;
    /** Show a warning notification (auto-dismissed after 5s). */
    showWarning(message: string, details?: string): string;
    /** Show an info notification (auto-dismissed after 5s). */
    showInfo(message: string, details?: string): string;
    /** Dismiss a notification by ID. */
    dismiss(id: string): void;
    /** Clear all notifications and cancel pending timers. */
    clearAll(): void;
    /** Destroy the manager and clean up all timers. */
    destroy(): void;
    private addNotification;
    private emitSnapshot;
}

/**
 * PluginLifecycleManager
 *
 * Framework-agnostic class for managing editor plugin lifecycle.
 * Extracted from React's `PluginHost.tsx`.
 *
 * Handles:
 * - Plugin initialization and state tracking
 * - Plugin state updates via `updateStates()`
 * - Plugin destroy/cleanup
 *
 * Does NOT handle (framework hosts are responsible for):
 * - CSS injection (use the exported `injectStyles` utility)
 * - DOM event listeners / dispatch wrapping
 */

/** Inject CSS styles into the document head. Returns a cleanup function. */
declare function injectStyles(pluginId: string, css: string): () => void;
declare class PluginLifecycleManager extends Subscribable<PluginLifecycleSnapshot> {
    private plugins;
    private pluginStates;
    private version;
    constructor();
    /**
     * Initialize plugins with an editor view.
     * Calls `plugin.initialize(editorView)` for each plugin.
     *
     * Note: CSS injection and DOM event listeners are the responsibility
     * of the framework-specific host (e.g. React PluginHost).
     */
    initialize(plugins: PluginLifecycleConfig[], editorView: EditorView): void;
    /**
     * Update all plugin states by calling `onStateChange` on each plugin.
     * Returns true if any plugin state changed.
     */
    updateStates(editorView: EditorView): boolean;
    /** Get plugin state by ID. */
    getPluginState<T>(pluginId: string): T | undefined;
    /** Set plugin state by ID. */
    setPluginState<T>(pluginId: string, state: T): void;
    /** Destroy all plugins and clean up. */
    destroy(): void;
    private destroyPlugins;
    private emitSnapshot;
}

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

/** Selection rectangle for rendering selection overlays */
interface SelectionRect {
    x: number;
    y: number;
    width: number;
    height: number;
    pageIndex: number;
}
/** Caret position for rendering the blinking cursor */
interface CaretPosition {
    x: number;
    y: number;
    height: number;
    pageIndex: number;
}
/** Info about the currently selected/hovered image */
interface ImageSelectionInfo {
    pmPos: number;
    pageIndex: number;
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    widthEmu: number;
    heightEmu: number;
    isInline: boolean;
}
/** Column resize tracking state */
interface ColumnResizeState {
    isResizing: boolean;
    startX: number;
    columnIndex: number;
    tablePmStart: number;
    originalWidths: {
        left: number;
        right: number;
    };
}
/** The full snapshot exposed to UI frameworks */
interface LayoutCoordinatorSnapshot {
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
declare class LayoutCoordinator extends Subscribable<LayoutCoordinatorSnapshot> {
    private _hasLayout;
    private _selectionRects;
    private _caretPosition;
    private _isDragging;
    private _dragAnchor;
    private _columnResize;
    private _selectedImageInfo;
    private _isImageInteracting;
    private _isFocused;
    private _version;
    constructor();
    /** Notify that layout has been computed. */
    setLayoutReady(hasLayout: boolean): void;
    /** Update selection rectangles and caret position. */
    updateSelection(selectionRects: SelectionRect[], caretPosition: CaretPosition | null): void;
    /** Start a drag selection from the given PM anchor position. */
    startDrag(anchor: number): void;
    /** End drag selection. */
    endDrag(): void;
    /** Get the drag anchor position. */
    getDragAnchor(): number | null;
    /** Start resizing a table column. */
    startColumnResize(tablePmStart: number, columnIndex: number, startX: number, originalWidths: {
        left: number;
        right: number;
    }): void;
    /** End column resize. */
    endColumnResize(): void;
    /** Get current column resize state. */
    getColumnResize(): ColumnResizeState;
    /** Set the currently selected image. */
    setSelectedImage(imageInfo: ImageSelectionInfo | null): void;
    /** Clear the image selection. */
    clearSelectedImage(): void;
    /** Set whether an image interaction (resize/move) is in progress. */
    setImageInteracting(interacting: boolean): void;
    /** Update focus state. */
    setFocused(focused: boolean): void;
    private emitSnapshot;
}

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

/** Editor loading state */
type EditorLoadingState = 'idle' | 'parsing' | 'loading-fonts' | 'ready' | 'error';
/** Configuration for EditorCoordinator */
interface EditorCoordinatorOptions {
    /** Initial zoom level (default: 1.0) */
    initialZoom?: number;
    /** Callback when the document changes */
    onChange?: (document: Document) => void;
    /** Callback when an error occurs */
    onError?: (error: Error) => void;
}
/** The full snapshot exposed to UI frameworks */
interface EditorCoordinatorSnapshot {
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
declare class EditorCoordinator extends Subscribable<EditorCoordinatorSnapshot> {
    private _loadingState;
    private _parseError;
    private _zoom;
    private _fontsLoaded;
    private _document;
    private _version;
    private onChangeCallback?;
    private onErrorCallback?;
    constructor(options?: EditorCoordinatorOptions);
    /** Signal that document parsing has started. */
    setParsingStarted(): void;
    /** Signal that document parsing completed successfully. */
    setDocumentLoaded(document: Document): void;
    /** Signal that font loading completed. */
    setFontsLoaded(): void;
    /** Signal that an error occurred during loading. */
    setLoadError(error: Error): void;
    /** Get the current document. */
    getDocument(): Document | null;
    /** Update the document (after edits). */
    updateDocument(document: Document): void;
    /** Set the zoom level (1.0 = 100%). */
    setZoom(zoom: number): void;
    /** Get the current zoom level. */
    getZoom(): number;
    private emitSnapshot;
}

/**
 * @eigenpal/docx-js-editor/core
 *
 * Core entry point — types, parser, serializer, and utilities.
 * No React or ProseMirror dependencies.
 *
 * @example
 * ```ts
 * import { parseDocx, serializeDocx, resolveColor } from '@eigenpal/docx-js-editor/core';
 * ```
 */
declare const VERSION = "0.0.2";

export { type CaretPosition, type ColumnResizeState, Document, EditorCoordinator, type EditorCoordinatorOptions, type EditorCoordinatorSnapshot, type EditorLoadingState, ErrorManager, ErrorManagerSnapshot, type ImageSelectionInfo, LayoutCoordinator, type LayoutCoordinatorSnapshot, PluginLifecycleConfig, PluginLifecycleManager, PluginLifecycleSnapshot, type SelectionRect, Subscribable, VERSION, injectStyles };
