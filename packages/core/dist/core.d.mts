export { A as AgentContextOptions, C as CreateEmptyDocumentOptions, D as DocumentAgent, at as DocxInput, E as ExtendedSelectionContext, P as ProcessTemplateOptions, e as ProcessTemplateResult, f as SelectionContextOptions, au as ThemeMatrixCell, V as VariableDetectionResult, g as VariableOccurrence, h as attemptSelectiveSave, i as blendColors, j as buildExtendedSelectionContext, k as buildPatchedDocumentXml, l as buildSelectionContext, n as colorsEqual, q as createDocumentWithText, r as createDocx, s as createEmptyDocument, t as createRgbColor, v as createThemeColor, w as darkenColor, x as detectVariables, y as detectVariablesDetailed, z as detectVariablesInBody, B as detectVariablesInParagraph, G as documentHasVariables, H as emuToPixels, J as emuToTwips, av as ensureHexPrefix, K as executeCommand, L as executeCommands, M as extractVariablesFromText, N as formatPx, O as formatVariable, aw as generateThemeTintShadeMatrix, Q as getAgentContext, R as getContrastingColor, U as getDocumentSummary, Y as getTemplateTags, ax as getThemeTintShadeHex, Z as halfPointsToPixels, _ as hasTemplateVariables, $ as isBlack, a0 as isValidVariableName, a1 as isWhite, a2 as lightenColor, a3 as parseColorString, a4 as parseDocx, a5 as parseVariable, a6 as pixelsToEmu, a7 as pixelsToTwips, a8 as pointsToPixels, aa as processTemplate, ac as processTemplateAsBlob, ad as processTemplateDetailed, ae as removeVariables, af as repackDocx, ag as replaceVariables, ah as resolveColor, ai as resolveHighlightColor, ay as resolveHighlightToCss, aj as resolveShadingColor, ak as sanitizeVariableName, al as serializeDocumentBody, am as serializeDocx, an as serializeSectionProperties, az as toArrayBuffer, ao as twipsToEmu, ap as twipsToPixels, aq as updateMultipleFiles, ar as validatePatchSafety, as as validateTemplate } from './variableDetector-BscpvKxr.mjs';
import { t as Document, av as BreakContent, d as Paragraph, R as Run, a7 as RunContent, e as Table } from './types-BhDofcWh.mjs';
export { A as AIAction, g as AIActionRequest, h as AgentCommand, i as AgentContext, j as AgentResponse, k as ApplyStyleCommand, B as BlockContent, aw as BookmarkEnd, ax as BookmarkStart, C as CorePlugin, r as DeleteTextCommand, D as DocumentBody, u as DocxPackage, E as Endnote, ay as Field, az as FooterReference, F as Footnote, w as FormatTextCommand, aA as HeaderFooter, aB as HeaderReference, H as Hyperlink, I as Image, x as InsertHyperlinkCommand, y as InsertImageCommand, z as InsertTableCommand, G as InsertTextCommand, L as ListLevel, O as McpSession, M as McpToolDefinition, V as McpToolHandler, W as McpToolResult, Z as NumberingDefinitions, $ as ParagraphContext, a0 as ParagraphFormatting, f as Position, a4 as Range, a5 as Relationship, a6 as ReplaceTextCommand, a9 as SectionProperties, aa as SelectionContext, ab as SetVariableCommand, aC as Shape, ac as Style, ad as StyleDefinitions, af as SuggestedAction, ag as TableCell, ah as TableRow, aD as TextBox, ai as TextContent, T as TextFormatting, aj as Theme, aE as ThemeColorScheme, aF as ThemeFont, aG as ThemeFontScheme } from './types-BhDofcWh.mjs';
import { Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Node } from 'prosemirror-model';
export { P as PluginRegistry, p as pluginRegistry, r as registerPlugins } from './registry-BqJilp0u.mjs';
export { docxtemplaterPlugin } from './core-plugins.mjs';

/**
 * Insert Operations Utility
 *
 * Utility functions for inserting content into the document.
 * Provides functions for inserting page breaks, horizontal rules, and other elements.
 */

/**
 * Insert position in the document
 */
interface InsertPosition {
    /** Paragraph index in the document body */
    paragraphIndex: number;
    /** Run index within the paragraph (optional) */
    runIndex?: number;
    /** Character offset within the run (optional) */
    offset?: number;
}
/**
 * Create a page break content element
 */
declare function createPageBreak(): BreakContent;
/**
 * Create a column break content element
 */
declare function createColumnBreak(): BreakContent;
/**
 * Create a text wrapping break (line break)
 */
declare function createLineBreak(clear?: 'none' | 'left' | 'right' | 'all'): BreakContent;
/**
 * Create a run containing a page break
 */
declare function createPageBreakRun(): Run;
/**
 * Create an empty paragraph with a page break before it
 */
declare function createPageBreakParagraph(): Paragraph;
/**
 * Insert a page break at a position in the document
 * This inserts a new paragraph with pageBreakBefore: true
 */
declare function insertPageBreak(doc: Document, position: InsertPosition): Document;
/**
 * Create a horizontal rule paragraph
 * Uses a paragraph with bottom border to simulate horizontal rule
 */
declare function createHorizontalRule(): Paragraph;
/**
 * Insert a horizontal rule at a position in the document
 */
declare function insertHorizontalRule(doc: Document, position: InsertPosition): Document;
/**
 * Check if content is a page break
 */
declare function isPageBreak(content: RunContent): boolean;
/**
 * Check if content is a column break
 */
declare function isColumnBreak(content: RunContent): boolean;
/**
 * Check if content is a line break
 */
declare function isLineBreak(content: RunContent): boolean;
/**
 * Check if content is any type of break
 */
declare function isBreakContent(content: RunContent): content is BreakContent;
/**
 * Check if a paragraph has pageBreakBefore
 */
declare function hasPageBreakBefore(paragraph: Paragraph): boolean;
/**
 * Count page breaks in a document
 */
declare function countPageBreaks(doc: Document): number;
/**
 * Find all page break positions in a document
 */
declare function findPageBreaks(doc: Document): InsertPosition[];
/**
 * Remove a page break at a specific position
 */
declare function removePageBreak(doc: Document, position: InsertPosition): Document;

/**
 * Google Fonts Loader
 *
 * Dynamically loads fonts from Google Fonts API with:
 * - Loading state tracking
 * - Duplicate prevention
 * - Callback notifications
 * - Font availability detection
 */
/**
 * Load a font from Google Fonts
 *
 * @param fontFamily - The font family name to load
 * @param options - Optional configuration
 * @returns Promise resolving to true if font loaded successfully, false otherwise
 */
declare function loadFont(fontFamily: string, options?: {
    weights?: number[];
    styles?: ('normal' | 'italic')[];
}): Promise<boolean>;
/**
 * Load multiple fonts from Google Fonts
 *
 * @param families - Array of font family names to load
 * @param options - Optional configuration
 * @returns Promise resolving when all fonts are loaded (or failed)
 */
declare function loadFonts(families: string[], options?: {
    weights?: number[];
    styles?: ('normal' | 'italic')[];
}): Promise<void>;
/**
 * Check if a font is loaded
 *
 * @param fontFamily - The font family name to check
 * @returns true if the font is loaded, false otherwise
 */
declare function isFontLoaded(fontFamily: string): boolean;
/**
 * Check if any fonts are currently loading
 *
 * @returns true if any fonts are loading, false otherwise
 */
declare function isLoading(): boolean;
/**
 * Get list of all loaded fonts
 *
 * @returns Array of loaded font family names
 */
declare function getLoadedFonts(): string[];
/**
 * Register a callback to be notified when fonts are loaded
 *
 * @param callback - Function to call when fonts are loaded
 * @returns Cleanup function to remove the callback
 */
declare function onFontsLoaded(callback: (fonts: string[]) => void): () => void;
/**
 * Check if a font is available on the system using canvas measurement
 *
 * This uses the technique of comparing text width with the target font
 * vs a known fallback font. If they differ, the font is available.
 *
 * @param fontFamily - The font family name to check
 * @param fallbackFont - Fallback font to compare against
 * @returns true if font is available, false otherwise
 */
declare function canRenderFont(fontFamily: string, fallbackFont?: string): boolean;
/**
 * Load a font from a raw buffer (e.g., embedded in DOCX)
 *
 * @param fontFamily - The font family name
 * @param buffer - Font file buffer (TTF, OTF, WOFF, WOFF2)
 * @param options - Font options
 * @returns Promise resolving when font is loaded
 */
declare function loadFontFromBuffer(fontFamily: string, buffer: ArrayBuffer, options?: {
    weight?: number | string;
    style?: 'normal' | 'italic';
}): Promise<boolean>;
/**
 * Preload a list of common document fonts
 *
 * This preloads fonts commonly used in DOCX documents that have
 * Google Fonts equivalents.
 */
declare function preloadCommonFonts(): Promise<void>;

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
    getRectsForRange(from: number, to: number): Array<{
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
    subscribe: (listener: () => void) => (() => void);
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
    readonly TABLE_INDEX: "data-table-index";
    readonly ROW_INDEX: "data-row";
    readonly COLUMN_INDEX: "data-col";
    readonly TABLE_CELL: "data-table-cell";
};
/**
 * Find table cell coordinates from a click target by walking up the DOM
 * and reading data attributes.
 */
declare function findTableFromClick(target: EventTarget | null, container?: HTMLElement | null): CellCoordinates | null;
/** Get a table from the document by index. */
declare function getTableFromDocument(doc: Document, tableIndex: number): Table | null;
/** Update a table in the document immutably. */
declare function updateTableInDocument(doc: Document, tableIndex: number, newTable: Table): Document;
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

export { AutoSaveManager, type AutoSaveManagerOptions, type AutoSaveSnapshot, type AutoSaveStatus, type CaretPosition, type CellCoordinates, type ClipboardSelection, type ColumnResizeState, Document, EditorCoordinator, type EditorCoordinatorOptions, type EditorCoordinatorSnapshot, type EditorHandle, type EditorLoadingState, type EditorPluginCore, ErrorManager, type ErrorManagerSnapshot, type ErrorNotification, type ErrorSeverity, type ImageSelectionInfo, type InsertPosition, LayoutCoordinator, type LayoutCoordinatorSnapshot, type PanelConfig, Paragraph, type PluginLifecycleConfig, PluginLifecycleManager, type PluginLifecycleSnapshot, type PluginPanelProps, type PositionCoordinates, type RenderedDomContext, Run, RunContent, type SavedDocumentData, type SelectionRect, Subscribable, TABLE_DATA_ATTRIBUTES, Table, TableSelectionManager, type TableSelectionSnapshot, VERSION, canRenderFont, countPageBreaks, createColumnBreak, createHorizontalRule, createLineBreak, createPageBreak, createPageBreakParagraph, createPageBreakRun, createSelectionFromDOM, deleteTableFromDocument, extractFormattingFromElement, findPageBreaks, findTableFromClick, formatLastSaveTime, formatStorageSize, getAutoSaveStatusLabel, getAutoSaveStorageSize, getLoadedFonts, getSelectionRuns, getTableFromDocument, hasPageBreakBefore, injectStyles, insertHorizontalRule, insertPageBreak, isAutoSaveSupported, isBreakContent, isColumnBreak, isFontLoaded, isLoading as isFontsLoading, isLineBreak, isPageBreak, loadFont, loadFontFromBuffer, loadFonts, onFontsLoaded, preloadCommonFonts, removePageBreak, rgbToHex, updateTableInDocument };
