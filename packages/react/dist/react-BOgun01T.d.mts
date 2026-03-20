import * as React$1 from 'react';
import React__default, { ReactNode, CSSProperties as CSSProperties$1, Component, ErrorInfo } from 'react';
import * as prosemirror_view from 'prosemirror-view';
import { EditorView } from 'prosemirror-view';
import * as prosemirror_state from 'prosemirror-state';
import { EditorState, Transaction } from 'prosemirror-state';
import { T as TextFormatting, K as ParagraphFormatting, D as Document, a3 as Theme, e as Table } from './agentApi-BVHzyk2l.mjs';
import { e as PrintOptions, g as TableContext, T as TableAction, P as ParsedClipboardContent } from './clipboard-BkM7Zvgs.mjs';
import { g as DocxInput, D as DocumentAgent } from './DocumentAgent-BqA9EJ3F.mjs';
import { g as EditorPluginCore, k as PluginPanelProps, R as RenderedDomContext, f as EditorHandle, h as ErrorNotification, m as SavedDocumentData, d as AutoSaveStatus, e as ClipboardSelection } from './ClipboardManager-t936d0KD.mjs';
import * as react_jsx_runtime from 'react/jsx-runtime';

/**
 * Selection State Utilities
 *
 * Extracts selection state from ProseMirror for toolbar integration.
 */

/**
 * Selection state for toolbar integration
 */
interface SelectionState {
    /** Whether there's an active selection (not just cursor) */
    hasSelection: boolean;
    /** Whether selection spans multiple paragraphs */
    isMultiParagraph: boolean;
    /** Current text formatting at selection/cursor */
    textFormatting: TextFormatting;
    /** Current paragraph formatting */
    paragraphFormatting: ParagraphFormatting;
    /** Current paragraph style ID (e.g., 'Heading1', 'Normal') */
    styleId: string | null;
    /** Start paragraph index */
    startParagraphIndex: number;
    /** End paragraph index */
    endParagraphIndex: number;
}

/**
 * Layout Engine Types
 *
 * Core types for the paginated layout engine.
 * Converts document blocks + measurements into positioned fragments on pages.
 */
/**
 * Unique identifier for a block in the document.
 * Format: typically `${index}-${type}` or just the block index.
 */
type BlockId = string | number;
/**
 * Base fragment properties common to all fragment types.
 */
type FragmentBase = {
    /** Block ID this fragment belongs to. */
    blockId: BlockId;
    /** X position on page (relative to page left). */
    x: number;
    /** Y position on page (relative to page top). */
    y: number;
    /** Width of the fragment. */
    width: number;
    /** ProseMirror start position (for click mapping). */
    pmStart?: number;
    /** ProseMirror end position (for click mapping). */
    pmEnd?: number;
};
/**
 * A paragraph fragment positioned on a page.
 * May span only part of the paragraph's lines if split across pages.
 */
type ParagraphFragment = FragmentBase & {
    kind: 'paragraph';
    /** First line index (inclusive) from the measure. */
    fromLine: number;
    /** Last line index (exclusive) from the measure. */
    toLine: number;
    /** Height of this fragment. */
    height: number;
    /** True if this continues from a previous page. */
    continuesFromPrev?: boolean;
    /** True if this continues onto the next page. */
    continuesOnNext?: boolean;
};
/**
 * A table fragment positioned on a page.
 * May span only part of the table's rows if split across pages.
 */
type TableFragment = FragmentBase & {
    kind: 'table';
    /** First row index (inclusive). */
    fromRow: number;
    /** Last row index (exclusive). */
    toRow: number;
    /** Height of this fragment. */
    height: number;
    /** True if this is a floating table. */
    isFloating?: boolean;
    /** True if this continues from a previous page. */
    continuesFromPrev?: boolean;
    /** True if this continues onto the next page. */
    continuesOnNext?: boolean;
    /** Number of header rows prepended to this continuation fragment (0 or undefined for first fragment). */
    headerRowCount?: number;
};
/**
 * An image fragment positioned on a page.
 */
type ImageFragment = FragmentBase & {
    kind: 'image';
    /** Height of the image. */
    height: number;
    /** True if this is an anchored/floating image. */
    isAnchored?: boolean;
    /** Z-index for layering. */
    zIndex?: number;
};
/**
 * A text box fragment positioned on a page.
 */
type TextBoxFragment = FragmentBase & {
    kind: 'textBox';
    /** Height of the text box. */
    height: number;
};
/**
 * Union of all fragment types.
 */
type Fragment = ParagraphFragment | TableFragment | ImageFragment | TextBoxFragment;
/**
 * Page margin configuration.
 */
type PageMargins = {
    top: number;
    right: number;
    bottom: number;
    left: number;
    /** Distance from page top to header content. */
    header?: number;
    /** Distance from page bottom to footer content. */
    footer?: number;
};
/**
 * A rendered page containing positioned fragments.
 */
type Page = {
    /** Page number (1-indexed). */
    number: number;
    /** Fragments positioned on this page. */
    fragments: Fragment[];
    /** Page margins. */
    margins: PageMargins;
    /** Page size (width, height). */
    size: {
        w: number;
        h: number;
    };
    /** Page orientation. */
    orientation?: 'portrait' | 'landscape';
    /** Section index this page belongs to. */
    sectionIndex?: number;
    /** Header/footer references for this page. */
    headerFooterRefs?: {
        headerDefault?: string;
        headerFirst?: string;
        headerEven?: string;
        footerDefault?: string;
        footerFirst?: string;
        footerEven?: string;
    };
    /** Footnote IDs that appear on this page (for rendering). */
    footnoteIds?: number[];
    /** Height reserved for the footnote area at page bottom (pixels). */
    footnoteReservedHeight?: number;
    /** Column layout for this page (if multi-column). */
    columns?: ColumnLayout;
};
/**
 * Column layout configuration.
 */
type ColumnLayout = {
    count: number;
    gap: number;
    equalWidth?: boolean;
    /** Draw vertical separator line between columns (w:sep). */
    separator?: boolean;
};
/**
 * Header/footer layout for a specific type.
 */
type HeaderFooterLayout = {
    height: number;
    fragments: Fragment[];
};
/**
 * Final layout output ready for rendering/painting.
 */
type Layout = {
    /** Default page size for the document. */
    pageSize: {
        w: number;
        h: number;
    };
    /** All rendered pages with positioned fragments. */
    pages: Page[];
    /** Column configuration (if multi-column). */
    columns?: ColumnLayout;
    /** Header layouts by type (default, first, even). */
    headers?: Record<string, HeaderFooterLayout>;
    /** Footer layouts by type (default, first, even). */
    footers?: Record<string, HeaderFooterLayout>;
    /** Gap between pages in pixels (for rendering). */
    pageGap?: number;
};

/**
 * React Plugin Interface for the DOCX Editor
 *
 * Extends the framework-agnostic EditorPluginCore with React-specific
 * UI rendering capabilities (Panel component, renderOverlay).
 */

/**
 * React-specific editor plugin interface.
 *
 * Extends EditorPluginCore with:
 * - Panel: React component for rendering in the annotation panel
 * - renderOverlay: Function returning ReactNode for overlay rendering
 */
interface ReactEditorPlugin<TState = any> extends EditorPluginCore<TState> {
    /**
     * React component to render in the annotation panel area.
     * Receives editor state and callbacks for interaction.
     */
    Panel?: React.ComponentType<PluginPanelProps<TState>>;
    /**
     * Render an overlay on top of the rendered pages.
     * Use this for highlights, annotations, or other visual elements
     * that need to be positioned relative to the document content.
     *
     * @param context - The rendered DOM context for position lookup
     * @param state - Current plugin state
     * @param editorView - The editor view for dispatching transactions
     * @returns React node to render as overlay, or null
     */
    renderOverlay?: (context: RenderedDomContext, state: TState, editorView: EditorView | null) => ReactNode;
}
/**
 * Backwards-compatible alias — EditorPlugin is now ReactEditorPlugin.
 */
type EditorPlugin<TState = any> = ReactEditorPlugin<TState>;
/**
 * Context value provided to plugins and panels.
 */
interface PluginContext {
    /** All registered plugins */
    plugins: EditorPlugin[];
    /** Current editor view */
    editorView: EditorView | null;
    /** Set the editor view (called by editor on mount) */
    setEditorView: (view: EditorView | null) => void;
    /** Get plugin state by plugin ID */
    getPluginState: <T>(pluginId: string) => T | undefined;
    /** Update plugin state */
    setPluginState: <T>(pluginId: string, state: T) => void;
    /** Scroll to a position in the editor */
    scrollToPosition: (pos: number) => void;
    /** Select a range in the editor */
    selectRange: (from: number, to: number) => void;
}
/**
 * Props for the PluginHost component.
 */
interface PluginHostProps {
    /** Plugins to enable */
    plugins: EditorPlugin[];
    /** The editor component (passed as child) */
    children: React.ReactElement;
    /** Class name for the host container */
    className?: string;
}
/**
 * Ref interface for the PluginHost component.
 */
interface PluginHostRef {
    /** Get plugin state by plugin ID */
    getPluginState: <T>(pluginId: string) => T | undefined;
    /** Update plugin state for a plugin */
    setPluginState: <T>(pluginId: string, state: T) => void;
    /** Get the current editor view */
    getEditorView: () => EditorView | null;
    /** Force a refresh of all plugin states */
    refreshPluginStates: () => void;
}

interface PagedEditorRef {
    /** Get the current document. */
    getDocument(): Document | null;
    /** Get the ProseMirror EditorState. */
    getState(): EditorState | null;
    /** Get the ProseMirror EditorView. */
    getView(): EditorView | null;
    /** Focus the editor. */
    focus(): void;
    /** Blur the editor. */
    blur(): void;
    /** Check if focused. */
    isFocused(): boolean;
    /** Dispatch a transaction. */
    dispatch(tr: Transaction): void;
    /** Undo. */
    undo(): boolean;
    /** Redo. */
    redo(): boolean;
    /** Set selection by PM position. */
    setSelection(anchor: number, head?: number): void;
    /** Get current layout. */
    getLayout(): Layout | null;
    /** Force re-layout. */
    relayout(): void;
    /** Scroll the visible pages to bring a PM position into view. */
    scrollToPosition(pmPos: number): void;
}

/**
 * DocxEditor props
 */
interface DocxEditorProps {
    /** Document data — ArrayBuffer, Uint8Array, Blob, or File */
    documentBuffer?: DocxInput | null;
    /** Pre-parsed document (alternative to documentBuffer) */
    document?: Document | null;
    /** Callback when document is saved */
    onSave?: (buffer: ArrayBuffer) => void;
    /** Author name used for comments and track changes */
    author?: string;
    /** Callback when document changes */
    onChange?: (document: Document) => void;
    /** Callback when selection changes */
    onSelectionChange?: (state: SelectionState | null) => void;
    /** Callback on error */
    onError?: (error: Error) => void;
    /** Callback when fonts are loaded */
    onFontsLoaded?: () => void;
    /** External ProseMirror plugins (from PluginHost) */
    externalPlugins?: prosemirror_state.Plugin[];
    /** Callback when editor view is ready (for PluginHost) */
    onEditorViewReady?: (view: prosemirror_view.EditorView) => void;
    /** Theme for styling */
    theme?: Theme | null;
    /** Whether to show toolbar (default: true) */
    showToolbar?: boolean;
    /** Whether to show zoom control (default: true) */
    showZoomControl?: boolean;
    /** Whether to show page margin guides/boundaries (default: false) */
    showMarginGuides?: boolean;
    /** Color for margin guides (default: '#c0c0c0') */
    marginGuideColor?: string;
    /** Whether to show horizontal ruler (default: false) */
    showRuler?: boolean;
    /** Unit for ruler display (default: 'inch') */
    rulerUnit?: 'inch' | 'cm';
    /** Initial zoom level (default: 1.0) */
    initialZoom?: number;
    /** Whether the editor is read-only. When true, hides toolbar and rulers */
    readOnly?: boolean;
    /** Custom toolbar actions */
    toolbarExtra?: ReactNode;
    /** Additional CSS class name */
    className?: string;
    /** Additional inline styles */
    style?: CSSProperties$1;
    /** Placeholder when no document */
    placeholder?: ReactNode;
    /** Loading indicator */
    loadingIndicator?: ReactNode;
    /** Whether to show the document outline sidebar (default: false) */
    showOutline?: boolean;
    /** Whether to show print button in toolbar (default: true) */
    showPrintButton?: boolean;
    /** Print options for print preview */
    printOptions?: PrintOptions;
    /** Callback when print is triggered */
    onPrint?: () => void;
    /** Callback when content is copied */
    onCopy?: () => void;
    /** Callback when content is cut */
    onCut?: () => void;
    /** Callback when content is pasted */
    onPaste?: () => void;
    /** Editor mode: 'editing' (direct edits), 'suggesting' (track changes), or 'viewing' (read-only). Default: 'editing' */
    mode?: EditorMode;
    /** Callback when the editing mode changes */
    onModeChange?: (mode: EditorMode) => void;
    /**
     * Callback when rendered DOM context is ready (for plugin overlays).
     * Used by PluginHost to get access to the rendered page DOM for positioning.
     */
    onRenderedDomContextReady?: (context: RenderedDomContext) => void;
    /**
     * Plugin overlays to render inside the editor viewport.
     * Passed from PluginHost to render plugin-specific overlays.
     */
    pluginOverlays?: ReactNode;
    /** Custom logo/icon for the title bar */
    renderLogo?: () => ReactNode;
    /** Document name shown in the title bar */
    documentName?: string;
    /** Callback when document name changes */
    onDocumentNameChange?: (name: string) => void;
    /** Whether the document name is editable (default: true) */
    documentNameEditable?: boolean;
    /** Custom right-side actions for the title bar */
    renderTitleBarRight?: () => ReactNode;
}
/**
 * DocxEditor ref interface
 */
interface DocxEditorRef {
    /** Get the DocumentAgent for programmatic access */
    getAgent: () => DocumentAgent | null;
    /** Get the current document */
    getDocument: () => Document | null;
    /** Get the editor ref */
    getEditorRef: () => PagedEditorRef | null;
    /** Save the document to buffer. Pass { selective: false } to force full repack. */
    save: (options?: {
        selective?: boolean;
        clearTracked?: boolean;
    }) => Promise<ArrayBuffer | null>;
    /** Set zoom level */
    setZoom: (zoom: number) => void;
    /** Get current zoom level */
    getZoom: () => number;
    /** Focus the editor */
    focus: () => void;
    /** Get current page number */
    getCurrentPage: () => number;
    /** Get total page count */
    getTotalPages: () => number;
    /** Scroll to a specific page */
    scrollToPage: (pageNumber: number) => void;
    /** Open print preview */
    openPrintPreview: () => void;
    /** Print the document directly */
    print: () => void;
    /** Load a pre-parsed document programmatically */
    loadDocument: (doc: Document) => void;
    /** Load a DOCX buffer programmatically (ArrayBuffer, Uint8Array, Blob, or File) */
    loadDocumentBuffer: (buffer: DocxInput) => Promise<void>;
}
type EditorMode = 'editing' | 'suggesting' | 'viewing';
/**
 * DocxEditor - Complete DOCX editor component
 */
declare const DocxEditor: React$1.ForwardRefExoticComponent<DocxEditorProps & React$1.RefAttributes<DocxEditorRef>>;

/**
 * Simple imperative API for rendering a DOCX editor into a DOM element.
 *
 * Returns an `EditorHandle` (from @eigenpal/docx-core) that works with
 * any framework implementation.
 *
 * Usage:
 * ```ts
 * import { renderAsync } from '@eigenpal/docx-js-editor';
 *
 * const editor = await renderAsync(docxBlob, document.getElementById('container'), {
 *   readOnly: false,
 *   showToolbar: true,
 * });
 *
 * // Save the edited document
 * const blob = await editor.save();
 *
 * // Clean up
 * editor.destroy();
 * ```
 */

/**
 * Options for {@link renderAsync}. A subset of DocxEditorProps minus
 * `documentBuffer` / `document` (passed as the first argument instead).
 */
type RenderAsyncOptions = Omit<DocxEditorProps, 'documentBuffer' | 'document'>;
/**
 * React-specific handle that extends the framework-agnostic EditorHandle
 * with zoom control.
 */
interface DocxEditorHandle extends EditorHandle {
    /** Set zoom level (1.0 = 100%). */
    setZoom: (zoom: number) => void;
}
/**
 * Render a DOCX editor into a container element.
 *
 * @param input - DOCX data as ArrayBuffer, Uint8Array, Blob, or File
 * @param container - DOM element to render into
 * @param options - Editor configuration (toolbar, readOnly, callbacks, etc.)
 * @returns A handle with save / destroy / getDocument methods
 */
declare function renderAsync(input: DocxInput, container: HTMLElement, options?: RenderAsyncOptions): Promise<DocxEditorHandle>;

/**
 * Error context value
 */
interface ErrorContextValue {
    /** Current notifications */
    notifications: ErrorNotification[];
    /** Show an error notification */
    showError: (message: string, details?: string) => void;
    /** Show a warning notification */
    showWarning: (message: string, details?: string) => void;
    /** Show an info notification */
    showInfo: (message: string, details?: string) => void;
    /** Dismiss a notification */
    dismissNotification: (id: string) => void;
    /** Clear all notifications */
    clearNotifications: () => void;
}
/**
 * Error boundary props
 */
interface ErrorBoundaryProps {
    /** Child components to render */
    children: ReactNode;
    /** Custom fallback UI */
    fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
    /** Callback when error occurs */
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    /** Whether to show error details */
    showDetails?: boolean;
}
/**
 * Error boundary state
 */
interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}
/**
 * Hook to use error notifications
 */
declare function useErrorNotifications(): ErrorContextValue;
/**
 * Error notification provider
 *
 * Thin React wrapper around the framework-agnostic ErrorManager.
 * Uses useSyncExternalStore to subscribe to ErrorManager state.
 */
declare function ErrorProvider({ children }: {
    children: ReactNode;
}): react_jsx_runtime.JSX.Element;
/**
 * Error Boundary class component
 *
 * Catches render errors in child components and displays fallback UI.
 */
declare class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps);
    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState>;
    componentDidCatch(error: Error, errorInfo: ErrorInfo): void;
    resetError: () => void;
    render(): ReactNode;
}
interface ParseErrorDisplayProps {
    message: string;
    details?: string;
    onRetry?: () => void;
    className?: string;
}
/**
 * Parse error display component
 *
 * Shows a helpful message for DOCX parsing errors.
 */
declare function ParseErrorDisplay({ message, details, onRetry, className, }: ParseErrorDisplayProps): React__default.ReactElement;
interface UnsupportedFeatureWarningProps {
    feature: string;
    description?: string;
    className?: string;
}
/**
 * Unsupported feature warning component
 *
 * Shows a non-blocking warning for unsupported features.
 */
declare function UnsupportedFeatureWarning({ feature, description, className, }: UnsupportedFeatureWarningProps): React__default.ReactElement;
/**
 * Check if an error is a parse error
 */
declare function isParseError(error: Error): boolean;
/**
 * Get user-friendly error message
 */
declare function getUserFriendlyMessage(error: Error): string;

/**
 * useTableSelection Hook
 *
 * Thin React wrapper around the framework-agnostic TableSelectionManager.
 * Provides table selection tracking and table operation dispatch.
 */

interface TableSelectionState {
    context: TableContext | null;
    table: Table | null;
    tableIndex: number | null;
    rowIndex: number | null;
    columnIndex: number | null;
}
interface UseTableSelectionReturn {
    state: TableSelectionState;
    handleCellClick: (tableIndex: number, rowIndex: number, columnIndex: number) => void;
    handleAction: (action: TableAction) => void;
    clearSelection: () => void;
    isCellSelected: (tableIndex: number, rowIndex: number, columnIndex: number) => boolean;
    tableContext: TableContext | null;
}
interface UseTableSelectionOptions {
    document: Document | null;
    onChange?: (document: Document) => void;
    onSelectionChange?: (context: TableContext | null) => void;
}
declare function useTableSelection({ document: doc, onChange, onSelectionChange, }: UseTableSelectionOptions): UseTableSelectionReturn;

/**
 * useAutoSave Hook
 *
 * Thin React wrapper around the framework-agnostic AutoSaveManager.
 * Bridges AutoSaveManager's subscribe/getSnapshot pattern with React state.
 */

/** Options for useAutoSave hook */
interface UseAutoSaveOptions {
    /** Storage key for localStorage (default: 'docx-editor-autosave') */
    storageKey?: string;
    /** Save interval in milliseconds (default: 30000 - 30 seconds) */
    interval?: number;
    /** Whether auto-save is enabled (default: true) */
    enabled?: boolean;
    /** Maximum age of auto-save in milliseconds before it's considered stale (default: 24 hours) */
    maxAge?: number;
    /** Callback when save succeeds */
    onSave?: (timestamp: Date) => void;
    /** Callback when save fails */
    onError?: (error: Error) => void;
    /** Callback when recovery data is found */
    onRecoveryAvailable?: (savedDocument: SavedDocumentData) => void;
    /** Whether to save immediately when document changes (debounced) */
    saveOnChange?: boolean;
    /** Debounce delay for saveOnChange in milliseconds (default: 2000) */
    debounceDelay?: number;
}
/** Return value of useAutoSave hook */
interface UseAutoSaveReturn {
    status: AutoSaveStatus;
    lastSaveTime: Date | null;
    save: () => Promise<boolean>;
    clearAutoSave: () => void;
    hasRecoveryData: boolean;
    getRecoveryData: () => SavedDocumentData | null;
    acceptRecovery: () => Document | null;
    dismissRecovery: () => void;
    isEnabled: boolean;
    enable: () => void;
    disable: () => void;
}
declare function useAutoSave(document: Document | null | undefined, options?: UseAutoSaveOptions): UseAutoSaveReturn;

/**
 * useWheelZoom Hook
 *
 * Enables Ctrl+scroll (or Cmd+scroll on Mac) to zoom in/out.
 * Features:
 * - Configurable zoom range and step
 * - Smooth zoom transitions
 * - Pinch-to-zoom support on trackpads
 * - Zoom reset (Ctrl+0)
 * - Zoom in/out shortcuts (Ctrl++, Ctrl+-)
 */
/**
 * Options for useWheelZoom hook
 */
interface UseWheelZoomOptions {
    /** Initial zoom level (default: 1.0) */
    initialZoom?: number;
    /** Minimum zoom level (default: 0.25) */
    minZoom?: number;
    /** Maximum zoom level (default: 4.0) */
    maxZoom?: number;
    /** Zoom step for each scroll event (default: 0.1) */
    zoomStep?: number;
    /** Whether zoom is enabled (default: true) */
    enabled?: boolean;
    /** Container element ref to attach wheel listener */
    containerRef?: React.RefObject<HTMLElement>;
    /** Callback when zoom changes */
    onZoomChange?: (zoom: number) => void;
    /** Whether to enable keyboard shortcuts (Ctrl++, Ctrl+-, Ctrl+0) */
    enableKeyboardShortcuts?: boolean;
    /** Whether to prevent default browser zoom behavior */
    preventDefault?: boolean;
}
/**
 * Return value of useWheelZoom hook
 */
interface UseWheelZoomReturn {
    /** Current zoom level */
    zoom: number;
    /** Set zoom level directly */
    setZoom: (zoom: number) => void;
    /** Zoom in by step */
    zoomIn: () => void;
    /** Zoom out by step */
    zoomOut: () => void;
    /** Reset zoom to initial level */
    resetZoom: () => void;
    /** Reset zoom to 100% */
    zoomTo100: () => void;
    /** Zoom to fit width */
    zoomToFit: (containerWidth: number, contentWidth: number) => void;
    /** Whether currently at minimum zoom */
    isMinZoom: boolean;
    /** Whether currently at maximum zoom */
    isMaxZoom: boolean;
    /** Zoom percentage (e.g., 100 for zoom level 1.0) */
    zoomPercent: number;
    /** Wheel event handler (for manual attachment) */
    handleWheel: (event: WheelEvent) => void;
    /** Keyboard event handler (for manual attachment) */
    handleKeyDown: (event: KeyboardEvent) => void;
}
/**
 * Preset zoom levels for snapping
 */
declare const ZOOM_PRESETS: number[];
/**
 * React hook for Ctrl+scroll zoom functionality
 */
declare function useWheelZoom(options?: UseWheelZoomOptions): UseWheelZoomReturn;
/**
 * Get zoom presets
 */
declare function getZoomPresets(): number[];
/**
 * Find nearest zoom preset
 */
declare function findNearestZoomPreset(zoom: number): number;
/**
 * Get next zoom preset (for zoom in)
 */
declare function getNextZoomPreset(zoom: number): number;
/**
 * Get previous zoom preset (for zoom out)
 */
declare function getPreviousZoomPreset(zoom: number): number;
/**
 * Format zoom level for display
 */
declare function formatZoom(zoom: number): string;
/**
 * Parse zoom from percentage string
 */
declare function parseZoom(zoomString: string): number | null;
/**
 * Check if zoom level is at a preset
 */
declare function isZoomPreset(zoom: number): boolean;
/**
 * Clamp zoom to valid range
 */
declare function clampZoom(zoom: number, minZoom?: number, maxZoom?: number): number;

/**
 * Selection Highlight Utilities
 *
 * Provides visual highlighting for text selection across multiple runs.
 * Browsers handle ::selection pseudo-element differently, especially when
 * selection spans multiple elements with different backgrounds or styling.
 *
 * This module provides:
 * - Custom selection highlight rendering
 * - Programmatic selection range marking
 * - Visual feedback for selection across runs
 */
/** Framework-agnostic CSS properties type (compatible with React.CSSProperties) */
type CSSProperties = Record<string, any>;
/**
 * Highlight rectangle representing a selected region
 */
interface HighlightRect {
    /** Left position in pixels */
    left: number;
    /** Top position in pixels */
    top: number;
    /** Width in pixels */
    width: number;
    /** Height in pixels */
    height: number;
}
/**
 * Selection highlight configuration
 */
interface SelectionHighlightConfig {
    /** Background color for selection */
    backgroundColor: string;
    /** Optional border color for selection */
    borderColor?: string;
    /** Optional border radius */
    borderRadius?: number;
    /** Z-index for overlay */
    zIndex?: number;
    /** Opacity for highlight */
    opacity?: number;
    /** Mix blend mode */
    mixBlendMode?: CSSProperties['mixBlendMode'];
}
/**
 * Selection range in document coordinates
 */
interface SelectionRange {
    /** Start position */
    start: {
        paragraphIndex: number;
        contentIndex: number;
        offset: number;
    };
    /** End position */
    end: {
        paragraphIndex: number;
        contentIndex: number;
        offset: number;
    };
}
/**
 * Default selection highlight style (matches Word/Google Docs)
 */
declare const DEFAULT_SELECTION_STYLE: SelectionHighlightConfig;
/**
 * High contrast selection style
 */
declare const HIGH_CONTRAST_SELECTION_STYLE: SelectionHighlightConfig;
/**
 * Selection highlight CSS custom properties
 */
declare const SELECTION_CSS_VARS: {
    readonly backgroundColor: "--docx-selection-bg";
    readonly borderColor: "--docx-selection-border";
    readonly textColor: "--docx-selection-text";
};
/**
 * Get all selection rectangles from the current DOM selection
 *
 * Uses getClientRects() to get accurate rectangles even when
 * selection spans multiple inline elements.
 */
declare function getSelectionRects(containerElement?: HTMLElement | null): HighlightRect[];
/**
 * Merge adjacent or overlapping rectangles
 *
 * This reduces the number of highlight elements needed and creates
 * a cleaner visual appearance.
 */
declare function mergeAdjacentRects(rects: HighlightRect[], tolerance?: number): HighlightRect[];
/**
 * Get selection rectangles with merging applied
 */
declare function getMergedSelectionRects(containerElement?: HTMLElement | null): HighlightRect[];
/**
 * Generate CSS styles for a highlight rectangle
 */
declare function getHighlightRectStyle(rect: HighlightRect, config?: SelectionHighlightConfig): CSSProperties;
/**
 * Generate inline CSS for selection pseudo-elements
 *
 * This is used to inject consistent selection styling
 * across all editable elements.
 */
declare function generateSelectionCSS(selector: string, config?: SelectionHighlightConfig): string;
/**
 * Check if there is an active text selection (not collapsed)
 */
declare function hasActiveSelection(): boolean;
/**
 * Get the selected text
 */
declare function getSelectedText(): string;
/**
 * Check if selection is within a specific element
 */
declare function isSelectionWithin(element: HTMLElement): boolean;
/**
 * Get the bounding rect of the current selection
 */
declare function getSelectionBoundingRect(): DOMRect | null;
/**
 * Create a selection highlight for a specific text range
 *
 * This is useful for find/replace highlighting, AI action previews, etc.
 */
declare function highlightTextRange(_containerElement: HTMLElement, startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range | null;
/**
 * Select a text range programmatically
 */
declare function selectRange(range: Range): void;
/**
 * Clear the current selection
 */
declare function clearSelection(): void;
/**
 * Check if selection is backwards (focus before anchor)
 */
declare function isSelectionBackwards(): boolean;
/**
 * Normalize selection to always be forward (start before end)
 */
declare function normalizeSelectionDirection(): void;
/**
 * Inject selection highlight CSS into document
 */
declare function injectSelectionStyles(config?: SelectionHighlightConfig): void;
/**
 * Remove injected selection styles
 */
declare function removeSelectionStyles(): void;
/**
 * Check if selection styles are injected
 */
declare function areSelectionStylesInjected(): boolean;
/**
 * Create a selection change handler that updates highlight rects
 */
declare function createSelectionChangeHandler(containerElement: HTMLElement | null, onRectsChange: (rects: HighlightRect[]) => void, merge?: boolean): () => void;

/**
 * Selection Highlight Hook
 *
 * A React hook that manages visual selection highlighting across multiple runs.
 * Uses a combination of CSS ::selection pseudo-element styling and optional
 * overlay rectangles for complex scenarios.
 *
 * Features:
 * - Consistent selection highlighting across all text runs
 * - Support for text with different backgrounds (highlighted, dark bg)
 * - Optional overlay rectangles for custom highlight effects
 * - Debounced updates for performance
 */

/**
 * Options for the useSelectionHighlight hook
 */
interface UseSelectionHighlightOptions {
    /** Reference to the container element */
    containerRef: React__default.RefObject<HTMLElement>;
    /** Whether to enable selection highlighting */
    enabled?: boolean;
    /** Custom highlight configuration */
    config?: SelectionHighlightConfig;
    /** Whether to use overlay rectangles (default: false, uses CSS) */
    useOverlay?: boolean;
    /** Debounce delay for rect updates in ms (default: 16) */
    debounceMs?: number;
    /** Callback when selection changes */
    onSelectionChange?: (hasSelection: boolean, text: string) => void;
}
/**
 * Return value from the useSelectionHighlight hook
 */
interface UseSelectionHighlightReturn {
    /** Whether there is an active selection */
    hasSelection: boolean;
    /** The selected text */
    selectedText: string;
    /** Highlight rectangles (only populated if useOverlay is true) */
    highlightRects: HighlightRect[];
    /** Whether selection is within the container */
    isSelectionInContainer: boolean;
    /** Refresh the highlight state */
    refresh: () => void;
    /** Get styles for a highlight rect overlay */
    getOverlayStyle: (rect: HighlightRect) => CSSProperties$1;
}
/**
 * Hook to manage selection highlighting in the editor
 */
declare function useSelectionHighlight(options: UseSelectionHighlightOptions): UseSelectionHighlightReturn;
/**
 * Props for selection overlay component
 */
interface SelectionOverlayProps {
    /** Highlight rectangles to render */
    rects: HighlightRect[];
    /** Style configuration */
    config?: SelectionHighlightConfig;
    /** Additional class name */
    className?: string;
}
/**
 * Generate selection overlay elements (for use in JSX)
 *
 * Usage:
 * ```tsx
 * const { highlightRects } = useSelectionHighlight({ ... });
 * return (
 *   <div style={{ position: 'relative' }}>
 *     {generateOverlayElements(highlightRects)}
 *     <div>... content ...</div>
 *   </div>
 * );
 * ```
 */
declare function generateOverlayElements(rects: HighlightRect[], config?: SelectionHighlightConfig): React__default.ReactNode[];

/**
 * useClipboard Hook
 *
 * Thin React wrapper around the framework-agnostic ClipboardManager.
 * Handles clipboard operations with formatting preservation.
 */

interface UseClipboardOptions {
    onCopy?: (selection: ClipboardSelection) => void;
    onCut?: (selection: ClipboardSelection) => void;
    onPaste?: (content: ParsedClipboardContent, asPlainText: boolean) => void;
    cleanWordFormatting?: boolean;
    editable?: boolean;
    onError?: (error: Error) => void;
}
interface UseClipboardReturn {
    copy: (selection: ClipboardSelection) => Promise<boolean>;
    cut: (selection: ClipboardSelection) => Promise<boolean>;
    paste: (asPlainText?: boolean) => Promise<ParsedClipboardContent | null>;
    handleCopy: (event: ClipboardEvent) => void;
    handleCut: (event: ClipboardEvent) => void;
    handlePaste: (event: ClipboardEvent) => void;
    handleKeyDown: (event: KeyboardEvent) => void;
    isProcessing: boolean;
    lastPastedContent: ParsedClipboardContent | null;
}
declare function useClipboard(options?: UseClipboardOptions): UseClipboardReturn;

declare const PLUGIN_HOST_STYLES = "\n.plugin-host {\n  display: flex;\n  width: 100%;\n  height: 100%;\n  overflow: visible;\n  position: relative;\n}\n\n.plugin-host-editor {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  overflow: visible;\n}\n\n\n.plugin-panels-left,\n.plugin-panels-right {\n  display: flex;\n  flex-direction: column;\n  flex-shrink: 0;\n  background: #f8f9fa;\n  border-color: #e9ecef;\n}\n\n.plugin-panels-left {\n  border-right: 1px solid #e9ecef;\n}\n\n.plugin-panels-right {\n  border-left: 1px solid #e9ecef;\n}\n\n.plugin-panels-bottom {\n  border-top: 1px solid #e9ecef;\n  background: #f8f9fa;\n}\n\n.plugin-panel {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  transition: width 0.2s ease, height 0.2s ease;\n}\n\n.plugin-panel.collapsed {\n  overflow: visible;\n}\n\n.plugin-panel-toggle {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  padding: 6px 8px;\n  background: transparent;\n  border: none;\n  cursor: pointer;\n  font-size: 12px;\n  color: #6c757d;\n  white-space: nowrap;\n}\n\n.plugin-panel.collapsed .plugin-panel-toggle {\n  writing-mode: vertical-rl;\n  text-orientation: mixed;\n  flex-direction: column;\n  height: 100%;\n  padding: 8px 6px;\n}\n\n.plugin-panel-toggle:hover {\n  background: #e9ecef;\n  color: #495057;\n}\n\n.plugin-panel-toggle-icon {\n  font-weight: bold;\n  font-size: 14px;\n}\n\n.plugin-panel.collapsed .plugin-panel-toggle-icon {\n  transform: rotate(90deg);\n}\n\n.plugin-panel-toggle-label {\n  font-weight: 500;\n}\n\n.plugin-panel-content {\n  flex: 1;\n  overflow: auto;\n}\n\n/* Right panel rendered inside viewport - scrolls with content */\n.plugin-panel-in-viewport {\n  position: absolute;\n  top: 0;\n  /* Position is set dynamically via inline styles based on page edge */\n  width: 220px;\n  pointer-events: auto;\n  z-index: 10;\n  overflow: visible;\n}\n\n.plugin-panel-in-viewport.collapsed {\n  width: 32px;\n}\n\n.plugin-panel-in-viewport .plugin-panel-toggle {\n  position: sticky;\n  top: 0;\n  background: rgba(255, 255, 255, 0.95);\n  border-radius: 4px;\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);\n}\n\n.plugin-panel-in-viewport-content {\n  overflow: visible;\n  position: relative;\n}\n\n/* Plugin overlay container for rendering highlights/decorations */\n.plugin-overlays-container {\n  position: absolute;\n  top: 0;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  pointer-events: none;\n  overflow: visible;\n  z-index: 5;\n}\n\n.plugin-overlay {\n  position: absolute;\n  top: 0;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  pointer-events: none;\n}\n\n/* Individual overlay children manage their own pointer-events.\n   Do NOT set pointer-events: auto here \u2014 it overrides overlay containers\n   that need pointer-events: none to let clicks pass through to the editor. */\n";
/**
 * PluginHost Component
 *
 * Wraps the editor and provides:
 * - Plugin state management
 * - Panel rendering for each plugin
 * - CSS injection for plugin styles
 * - Callbacks for editor interaction
 */
declare const PluginHost: React$1.ForwardRefExoticComponent<PluginHostProps & React$1.RefAttributes<PluginHostRef>>;

export { getSelectionBoundingRect as $, type UseSelectionHighlightReturn as A, type UseTableSelectionOptions as B, type UseTableSelectionReturn as C, DEFAULT_SELECTION_STYLE as D, type EditorMode as E, type UseWheelZoomOptions as F, type UseWheelZoomReturn as G, HIGH_CONTRAST_SELECTION_STYLE as H, areSelectionStylesInjected as I, clampZoom as J, clearSelection as K, createSelectionChangeHandler as L, findNearestZoomPreset as M, formatZoom as N, generateOverlayElements as O, PLUGIN_HOST_STYLES as P, generateSelectionCSS as Q, type ReactEditorPlugin as R, SELECTION_CSS_VARS as S, type TableSelectionState as T, UnsupportedFeatureWarning as U, getHighlightRectStyle as V, getMergedSelectionRects as W, getNextZoomPreset as X, getPreviousZoomPreset as Y, ZOOM_PRESETS as Z, getSelectedText as _, DocxEditor as a, getSelectionRects as a0, getUserFriendlyMessage as a1, getZoomPresets as a2, hasActiveSelection as a3, highlightTextRange as a4, injectSelectionStyles as a5, isParseError as a6, isSelectionBackwards as a7, isSelectionWithin as a8, isZoomPreset as a9, mergeAdjacentRects as aa, normalizeSelectionDirection as ab, parseZoom as ac, removeSelectionStyles as ad, renderAsync as ae, selectRange as af, useAutoSave as ag, useClipboard as ah, useErrorNotifications as ai, useSelectionHighlight as aj, useTableSelection as ak, useWheelZoom as al, type DocxEditorHandle as b, type DocxEditorProps as c, type DocxEditorRef as d, type EditorPlugin as e, ErrorBoundary as f, type ErrorBoundaryProps as g, type ErrorContextValue as h, ErrorProvider as i, type HighlightRect as j, ParseErrorDisplay as k, type ParseErrorDisplayProps as l, type PluginContext as m, PluginHost as n, type PluginHostProps as o, type PluginHostRef as p, type RenderAsyncOptions as q, type SelectionHighlightConfig as r, type SelectionOverlayProps as s, type SelectionRange as t, type UnsupportedFeatureWarningProps as u, type UseAutoSaveOptions as v, type UseAutoSaveReturn as w, type UseClipboardOptions as x, type UseClipboardReturn as y, type UseSelectionHighlightOptions as z };
