/**
 * DocxEditor Component
 *
 * Main component integrating all editor features:
 * - Toolbar for formatting
 * - ProseMirror-based editor for content editing
 * - Zoom control
 * - Error boundary
 * - Loading states
 */

import {
  useRef,
  useCallback,
  useState,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  lazy,
  Suspense,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Document, Theme, HeaderFooter } from '@eigenpal/docx-editor-core/types/document';
import defaultLocale from '@eigenpal/docx-editor-i18n/en.json';

import { ToolbarSeparator, type SelectionFormatting } from './Toolbar';
import { CommentsSidebarToggle } from './DocxEditor/CommentsSidebarToggle';
import { LocalizedAgentPanel } from './DocxEditor/LocalizedAgentPanel';
import { PageIndicator } from './DocxEditor/PageIndicator';
import { AgentPanelToggle } from './DocxEditor/AgentPanelToggle';
import { OutlineToggleButton } from './DocxEditor/OutlineToggleButton';
import { EditingModeDropdown } from './DocxEditor/EditingModeDropdown';
import type { AgentPanelOptions } from './DocxEditor/types';
import { useOutlineSidebar } from './DocxEditor/hooks/useOutlineSidebar';
import { useKeyboardShortcuts } from './DocxEditor/hooks/useKeyboardShortcuts';
import { useFileIO } from './DocxEditor/hooks/useFileIO';
import { usePageSetupControls } from './DocxEditor/hooks/usePageSetupControls';
import { useHyperlinkActions } from './DocxEditor/hooks/useHyperlinkActions';
import { useFindReplaceBridge } from './DocxEditor/hooks/useFindReplaceBridge';
import { useFormattingActions } from './DocxEditor/hooks/useFormattingActions';
import { useImageActions } from './DocxEditor/hooks/useImageActions';
import type { FontOption } from './ui/FontPicker';
import { EditorToolbar } from './EditorToolbar';
import { undoDepth, redoDepth } from 'prosemirror-history';
import { pointsToHalfPoints } from './ui/FontSizePicker';
import {
  DocumentOutline,
  OUTLINE_BUTTON_RESERVED_SPACE,
  OUTLINE_RESERVED_SPACE,
} from './DocumentOutline';
import { SIDEBAR_DOCUMENT_SHIFT } from './sidebar/constants';
import { UnifiedSidebar } from './UnifiedSidebar';
import { CommentMarginMarkers } from './CommentMarginMarkers';
import { useCommentSidebarItems, type CommentCallbacks } from '../hooks/useCommentSidebarItems';
import { useTrackedChanges } from '../hooks/useTrackedChanges';
import { TextSelection, type EditorState as PMEditorState } from 'prosemirror-state';
import type { ReactSidebarItem } from '../plugin-api/types';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { ErrorBoundary, ErrorProvider } from './ErrorBoundary';
import type { TableAction } from './ui/TableToolbar';
import { mapHexToHighlightName } from './toolbarUtils';
import { LocaleProvider, useTranslation } from '../i18n';
import type { Translations } from '../i18n';
import { HorizontalRuler } from './ui/HorizontalRuler';
import { VerticalRuler } from './ui/VerticalRuler';
import { Z_INDEX } from '../styles/zIndex';
import { type PrintOptions } from './ui/PrintPreview';
// Dialog hooks and utilities (static imports — lightweight, no UI)
import { useFindReplace } from './dialogs/FindReplaceDialog';
import { useHyperlinkDialog } from './dialogs/HyperlinkDialog';
import {
  InlineHeaderFooterEditor,
  type InlineHeaderFooterEditorRef,
} from './InlineHeaderFooterEditor';

// Dialog components (lazy-loaded — only fetched when first opened)
const FindReplaceDialog = lazy(() => import('./dialogs/FindReplaceDialog'));
const HyperlinkDialog = lazy(() => import('./dialogs/HyperlinkDialog'));
const TablePropertiesDialog = lazy(() =>
  import('./dialogs/TablePropertiesDialog').then((m) => ({ default: m.TablePropertiesDialog }))
);
const SplitCellDialog = lazy(() => import('./dialogs/SplitCellDialog'));
const ImagePositionDialog = lazy(() =>
  import('./dialogs/ImagePositionDialog').then((m) => ({ default: m.ImagePositionDialog }))
);
const ImagePropertiesDialog = lazy(() =>
  import('./dialogs/ImagePropertiesDialog').then((m) => ({ default: m.ImagePropertiesDialog }))
);
const FootnotePropertiesDialog = lazy(() =>
  import('./dialogs/FootnotePropertiesDialog').then((m) => ({
    default: m.FootnotePropertiesDialog,
  }))
);
const PageSetupDialog = lazy(() =>
  import('./dialogs/PageSetupDialog').then((m) => ({ default: m.PageSetupDialog }))
);
import { MaterialSymbol } from './ui/Icons';
import { Tooltip } from './ui/Tooltip';
import {
  TextContextMenu,
  type TextContextAction,
  type TextContextMenuItem,
} from './TextContextMenu';
import { ImageContextMenu, useImageContextMenu } from './ImageContextMenu';
import {
  setImageWrapType,
  type ImageLayoutTarget,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
import { HyperlinkPopup } from './ui/HyperlinkPopup';
import { Toaster } from 'sonner';
import { getBuiltinTableStyle, type TableStylePreset } from './ui/TableStyleGallery';
import { DocumentAgent } from '@eigenpal/docx-editor-core/agent';
import { DefaultLoadingIndicator, DefaultPlaceholder, ParseError } from './DocxEditorHelpers';
import { parseDocx } from '@eigenpal/docx-editor-core/docx';
import { type DocxInput } from '@eigenpal/docx-editor-core/utils';
import { onFontsLoaded, loadDocumentFonts } from '@eigenpal/docx-editor-core/utils';
import { resolveColorToHex } from '@eigenpal/docx-editor-core/utils';
import { resolveHeaderFooter } from '@eigenpal/docx-editor-core/layout-bridge';
import { useTableSelection } from '../hooks/useTableSelection';
import { useDocumentHistory } from '../hooks/useHistory';
import {
  getSplitCellDialogConfig,
  splitActiveTableCell,
} from '@eigenpal/docx-editor-core/prosemirror/commands';

// Extension system
import { createStarterKit } from '@eigenpal/docx-editor-core/prosemirror/extensions';
import { ExtensionManager } from '@eigenpal/docx-editor-core/prosemirror/extensions';
import {
  createSuggestionModePlugin,
  setSuggestionMode,
} from '@eigenpal/docx-editor-core/prosemirror/plugins';

// Conversion (for HF inline editor save)
import { proseDocToBlocks } from '@eigenpal/docx-editor-core/prosemirror/conversion';

// ProseMirror editor
import {
  type SelectionState,
  extractSelectionState,
  applyStyle,
  createStyleResolver,
  // Table commands
  getTableContext,
  addRowAbove,
  addRowBelow,
  deleteRow as pmDeleteRow,
  addColumnLeft,
  addColumnRight,
  deleteColumn as pmDeleteColumn,
  deleteTable as pmDeleteTable,
  selectTable as pmSelectTable,
  selectRow as pmSelectRow,
  selectColumn as pmSelectColumn,
  mergeCells as pmMergeCells,
  setCellBorder,
  setCellVerticalAlign,
  setCellMargins,
  setCellTextDirection,
  toggleNoWrap,
  setRowHeight,
  toggleHeaderRow,
  distributeColumns,
  autoFitContents,
  setTableProperties,
  applyTableStyle,
  removeTableBorders,
  setAllTableBorders,
  setOutsideTableBorders,
  setInsideTableBorders,
  setCellFillColor,
  setTableBorderColor,
  setTableBorderWidth,
  type TableContextInfo,
} from '@eigenpal/docx-editor-core/prosemirror';
import { acceptChange, rejectChange } from '@eigenpal/docx-editor-core/prosemirror/commands';
import { collectHeadings } from '@eigenpal/docx-editor-core/utils';

// Paginated editor
import { PagedEditor, type PagedEditorRef, DEFAULT_PAGE_WIDTH } from './DocxEditor/PagedEditor';

// Plugin API types
import type { RenderedDomContext } from '../plugin-api/types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * DocxEditor props
 */
export interface DocxEditorProps {
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
  externalPlugins?: import('prosemirror-state').Plugin[];
  /**
   * When true, the editor treats the `document` prop as a schema seed only and
   * does not load it into ProseMirror on mount. Content is expected to come from
   * external sources — typically `externalPlugins` such as `ySyncPlugin` from
   * `y-prosemirror`, but also any code that dispatches transactions directly.
   *
   * You must still pass a `document` prop (e.g., `createEmptyDocument()`) so the
   * editor can build its schema and render the shell.
   */
  externalContent?: boolean;
  /** Callback when editor view is ready (for PluginHost) */
  onEditorViewReady?: (view: import('prosemirror-view').EditorView) => void;
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
  /**
   * When true, the editor does not intercept Cmd/Ctrl+F or Cmd/Ctrl+H.
   * This lets the browser or host app handle native find/history shortcuts.
   */
  disableFindReplaceShortcuts?: boolean;
  /** Custom toolbar actions */
  toolbarExtra?: ReactNode;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Placeholder when no document */
  placeholder?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
  /** Whether to show the document outline sidebar (default: false) */
  showOutline?: boolean;
  /** Whether to show the floating outline toggle button (default: true) */
  showOutlineButton?: boolean;
  /**
   * Custom list of fonts shown in the toolbar's font-family dropdown.
   * Strings render in the "Other" group; pass `FontOption[]` for category
   * grouping and CSS fallback chains. Omit to use the built-in 12-font
   * default. An empty array renders an empty (but enabled) dropdown.
   *
   * Pass a stable reference (memoized or module-level) — inline arrays
   * create a new identity per render and invalidate the picker's memo.
   *
   * @example fontFamilies={['Arial', 'Roboto']}
   * @example fontFamilies={[{ name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' }]}
   */
  fontFamilies?: ReadonlyArray<string | FontOption>;
  /** Print options for print preview */
  printOptions?: PrintOptions;
  /**
   * Callback when print is triggered. Pass it to enable the `File > Print`
   * menu entry; omit to hide. The imperative `ref.current.print()` also
   * invokes this callback.
   */
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
  /** Callback when a comment is added via the UI */
  onCommentAdd?: (comment: Comment) => void;
  /** Callback when a comment is resolved via the UI */
  onCommentResolve?: (comment: Comment) => void;
  /** Callback when a comment is deleted via the UI */
  onCommentDelete?: (comment: Comment) => void;
  /** Callback when a reply is added to a comment via the UI */
  onCommentReply?: (reply: Comment, parent: Comment) => void;
  /**
   * Controlled comments array. When provided, the editor reads comment thread
   * metadata (text, author, replies, resolved status) from this prop instead
   * of internal state, and emits every change through `onCommentsChange`.
   *
   * Use this with collaboration backends (Yjs, Liveblocks, Automerge, …) so
   * comment threads sync across peers — the PM document only carries the
   * range markers; thread metadata lives outside the doc and needs its own
   * sync channel.
   *
   * If omitted, the editor falls back to internal state (current behavior).
   * The granular `onCommentAdd`/`onCommentResolve`/`onCommentDelete`/
   * `onCommentReply` callbacks fire in both modes.
   */
  comments?: Comment[];
  /** Fires whenever the comments array changes (controlled mode). */
  onCommentsChange?: (comments: Comment[]) => void;
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
  /** Sidebar items from plugins (passed from PluginHost). */
  pluginSidebarItems?: ReactSidebarItem[];
  /** Rendered DOM context from PluginHost (for sidebar position resolution). */
  pluginRenderedDomContext?: RenderedDomContext | null;
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
  /** Translation overrides. Import a locale JSON file and pass it directly. */
  i18n?: Translations;
  /**
   * Mount a controllable agent panel on the right side of the editor. The
   * panel is the chrome (header, close button, drag-resize); the consumer
   * supplies whatever content goes inside via `render` — typically a chat
   * UI from `@ai-sdk/react`'s `useChat`, `assistant-ui`, or any other
   * framework. We do not ship message bubbles, a composer, or a chat engine.
   *
   * Three control patterns:
   *  - **Uncontrolled**: `agentPanel={{ render }}` — toolbar button + panel
   *    close button toggle the panel. Width persists to localStorage.
   *  - **Controlled**: `agentPanel={{ render, open, onOpenChange }}` — the
   *    consumer owns open state (e.g. tied to a global menu).
   *  - **Headless**: omit `agentPanel`, use the toolkit directly via
   *    `useDocxAgentTools` — render the panel anywhere you want.
   */
  agentPanel?: AgentPanelOptions;
}

/**
 * DocxEditor ref interface
 */
export interface DocxEditorRef {
  /** Get the DocumentAgent for programmatic access */
  getAgent: () => DocumentAgent | null;
  /** Get the current document */
  getDocument: () => Document | null;
  /** Get the editor ref */
  getEditorRef: () => PagedEditorRef | null;
  /** Save the document to buffer. Pass { selective: false } to force full repack. */
  save: (options?: { selective?: boolean }) => Promise<ArrayBuffer | null>;
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
  /**
   * Scroll the paginated view so the given page is in view.
   * Page numbers are 1-indexed (matches `getCurrentPage` / `getTotalPages`).
   * No-op for out-of-range or non-integer values.
   * @example ref.current?.scrollToPage(2)
   */
  scrollToPage: (pageNumber: number) => void;
  /**
   * Scroll the paginated view to the paragraph with the given Word `w14:paraId`.
   * @returns whether a matching paragraph exists in the ProseMirror document
   * @example ref.current?.scrollToParaId('1A2B3C4D')
   */
  scrollToParaId: (paraId: string) => boolean;
  /**
   * Scroll the paginated view to a specific ProseMirror document position.
   * Use this when you have a raw PM offset; for Word `w14:paraId` use
   * `scrollToParaId` instead.
   * @example ref.current?.scrollToPosition(42)
   */
  scrollToPosition: (pmPos: number) => void;
  /** Open print preview */
  openPrintPreview: () => void;
  /** Print the document directly */
  print: () => void;
  /** Load a pre-parsed document programmatically */
  loadDocument: (doc: Document) => void;
  /** Load a DOCX buffer programmatically (ArrayBuffer, Uint8Array, Blob, or File) */
  loadDocumentBuffer: (buffer: DocxInput) => Promise<void>;
  /** Add a comment programmatically. Anchored by Word `w14:paraId` so
   * it survives unrelated edits. Returns the comment ID, or null if
   * the paraId is unknown or the search text isn't found / is ambiguous. */
  addComment: (options: {
    paraId: string;
    text: string;
    author: string;
    /** Optional: anchor to a specific phrase within the paragraph (must be unique). */
    search?: string;
  }) => number | null;
  /** Reply to an existing comment. Returns the reply comment ID. */
  replyToComment: (commentId: number, text: string, author: string) => number | null;
  /** Resolve (mark as done) a comment. */
  resolveComment: (commentId: number) => void;
  /** Suggest a tracked change. Pass `replaceWith: ''` to delete the matched text;
   * pass `search: ''` to insert at paragraph end. Returns false on missing paraId,
   * missing/ambiguous search, or attempt to layer on an existing tracked change. */
  proposeChange: (options: {
    paraId: string;
    search: string;
    replaceWith: string;
    author: string;
  }) => boolean;
  /** Locate every paragraph containing `query` (case-insensitive substring).
   * Returns a stable handle (paraId + the matched phrase) the agent can pass
   * back to `addComment` / `proposeChange`. */
  findInDocument: (
    query: string,
    options?: { caseSensitive?: boolean; limit?: number }
  ) => Array<{ paraId: string; match: string; before: string; after: string }>;
  /**
   * Apply character formatting (bold / italic / color / size / font / etc.)
   * to a paragraph or to a unique phrase within it. This is a direct edit,
   * not a tracked change. Returns false on missing paraId or ambiguous search.
   */
  applyFormatting: (options: {
    paraId: string;
    search?: string;
    marks: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean | { style?: string };
      strike?: boolean;
      color?: { rgb?: string; themeColor?: string };
      highlight?: string;
      fontSize?: number;
      fontFamily?: { ascii?: string; hAnsi?: string };
    };
  }) => boolean;
  /**
   * Apply a paragraph style by styleId (e.g. `'Heading1'`, `'Quote'`).
   * Direct edit, not a tracked change. Returns false if paraId is unknown.
   */
  setParagraphStyle: (options: { paraId: string; styleId: string }) => boolean;
  /**
   * Read the contents of a single page. 1-indexed; returns null if the page
   * does not exist. Each paragraph is returned with its stable paraId so the
   * agent can comment on or modify it without an extra round-trip.
   */
  getPageContent: (pageNumber: number) => {
    pageNumber: number;
    text: string;
    paragraphs: Array<{ paraId: string; text: string; styleId?: string }>;
  } | null;
  /** Read the user's current cursor / selection — what's highlighted right now. */
  getSelectionInfo: () => {
    paraId: string | null;
    selectedText: string;
    paragraphText: string;
    before: string;
    after: string;
  } | null;
  /** Get all comments. */
  getComments: () => Comment[];
  /** Subscribe to document changes. Fires after every committed edit. Returns unsubscribe. */
  onContentChange: (listener: (document: Document) => void) => () => void;
  /** Subscribe to selection changes (cursor moves / selection changes). Returns unsubscribe. */
  onSelectionChange: (listener: (selection: SelectionState | null) => void) => () => void;
}

/**
 * Editor internal state
 */
interface EditorState {
  isLoading: boolean;
  parseError: string | null;
  zoom: number;
  /** Current selection formatting for toolbar */
  selectionFormatting: SelectionFormatting;
  /** Paragraph indent data for ruler */
  paragraphIndentLeft: number;
  paragraphIndentRight: number;
  paragraphFirstLineIndent: number;
  paragraphHangingIndent: boolean;
  paragraphTabs: import('@eigenpal/docx-editor-core/types/document').TabMark[] | null;
  /** ProseMirror table context (for showing table toolbar) */
  pmTableContext: TableContextInfo | null;
  /** Image context when cursor is on an image node */
  pmImageContext: {
    pos: number;
    wrapType: string;
    displayMode: string;
    cssFloat: string | null;
    transform: string | null;
    alt: string | null;
    borderWidth: number | null;
    borderColor: string | null;
    borderKind: string | null;
    width: number | null;
    height: number | null;
  } | null;
}

export type { EditorMode } from './DocxEditor/internals/editing-modes';
import type { EditorMode } from './DocxEditor/internals/editing-modes';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// `injectReplyRangeMarkers` + `injectTCReplyRangeMarkers` live in
// `@eigenpal/docx-editor-core/docx` so React + Vue share the same
// pre-serialization range-marker injection.

import {
  findSelectionYPosition,
  getInitialSectionProperties,
  findParaIdRange,
} from './DocxEditor/internals/pmAnchors';
import {
  getVanillaNodeText,
  getVanillaTextBetween,
  findTextInPmParagraph,
} from './DocxEditor/internals/vanillaText';
import {
  PENDING_COMMENT_ID,
  EMPTY_ANCHOR_POSITIONS,
  getNextCommentId,
  bumpNextCommentIdAbove,
  createComment,
} from './DocxEditor/commentFactories';

/**
 * DocxEditor - Complete DOCX editor component
 */
export const DocxEditor = forwardRef<DocxEditorRef, DocxEditorProps>(function DocxEditor(
  {
    documentBuffer,
    document: initialDocument,
    onSave,
    author = 'User',
    onChange,
    onSelectionChange,
    onError,
    onFontsLoaded: onFontsLoadedCallback,
    theme,
    showToolbar = true,
    showZoomControl = true,
    showMarginGuides: _showMarginGuides = false,
    marginGuideColor: _marginGuideColor,
    showRuler = false,
    rulerUnit = 'inch',
    initialZoom = 1.0,
    readOnly: readOnlyProp = false,
    disableFindReplaceShortcuts = false,
    toolbarExtra,
    className = '',
    style,
    placeholder,
    loadingIndicator,
    showOutline: showOutlineProp = false,
    showOutlineButton = true,
    fontFamilies,
    printOptions: _printOptions,
    onPrint,
    onCopy: _onCopy,
    onCut: _onCut,
    onPaste: _onPaste,
    mode: modeProp,
    onModeChange,
    onCommentAdd,
    onCommentResolve,
    onCommentDelete,
    onCommentReply,
    comments: commentsProp,
    onCommentsChange,
    externalPlugins,
    externalContent = false,
    onEditorViewReady,
    onRenderedDomContextReady,
    pluginOverlays,
    pluginSidebarItems,
    pluginRenderedDomContext,
    renderLogo,
    documentName,
    onDocumentNameChange,
    documentNameEditable = true,
    renderTitleBarRight,
    i18n,
    agentPanel,
  },
  ref
) {
  const { t } = useTranslation();
  // State
  const [state, setState] = useState<EditorState>({
    isLoading: !!documentBuffer && !externalContent,
    parseError: null,
    zoom: initialZoom,
    selectionFormatting: {},
    paragraphIndentLeft: 0,
    paragraphIndentRight: 0,
    paragraphFirstLineIndent: 0,
    paragraphHangingIndent: false,
    paragraphTabs: null,
    pmTableContext: null,
    pmImageContext: null,
  });

  // Table properties dialog state
  const [tablePropsOpen, setTablePropsOpen] = useState(false);
  const [splitCellDialogState, setSplitCellDialogState] = useState({
    isOpen: false,
    initialRows: 1,
    initialCols: 2,
    minRows: 1,
    minCols: 1,
    source: null as 'pm' | 'legacy' | null,
    /** Captured cell coordinates at dialog-open time (PM path) */
    capturedCellRow: null as number | null,
    capturedCellCol: null as number | null,
  });
  // Header/footer editing state
  const [hfEditPosition, setHfEditPosition] = useState<'header' | 'footer' | null>(null);
  const [hfEditIsFirstPage, setHfEditIsFirstPage] = useState(false);

  // Comments sidebar state
  const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
  const [expandedSidebarItem, setExpandedSidebarItem] = useState<string | null>(null);
  // Comments live in internal state by default; if the consumer passes
  // `comments` as a prop, we treat the editor as controlled — `setComments`
  // routes mutations through `onCommentsChange` instead of touching internal
  // state. Keeps the controlled/uncontrolled API symmetric with React inputs.
  const [internalComments, setInternalComments] = useState<Comment[]>([]);
  const isControlledComments = commentsProp !== undefined;
  const comments = isControlledComments ? commentsProp : internalComments;
  // Latest PM state — mirrored from the view on every doc-changing transaction.
  // Drives `useTrackedChanges` so the sidebar derives its list directly from PM
  // (the source of truth, including remote ySync updates) rather than a debounced
  // copy in React state.
  const [pmState, setPmState] = useState<PMEditorState | null>(null);
  const { entries: trackedChanges, commentToRevision } = useTrackedChanges(pmState);
  const [anchorPositions, setAnchorPositions] =
    useState<Map<string, number>>(EMPTY_ANCHOR_POSITIONS);
  // No separate state needed — pluginRenderedDomContext comes from PluginHost

  const [isAddingComment, setIsAddingComment] = useState(false);
  const [commentSelectionRange, setCommentSelectionRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [addCommentYPosition, setAddCommentYPosition] = useState<number | null>(null);
  const [editingModeInternal, setEditingModeInternal] = useState<EditorMode>(modeProp ?? 'editing');
  const editingMode = modeProp ?? editingModeInternal;
  const setEditingMode = (mode: EditorMode) => {
    if (!modeProp) setEditingModeInternal(mode);
    onModeChange?.(mode);
  };
  // 'viewing' mode acts as read-only
  const readOnly = readOnlyProp || editingMode === 'viewing';

  // Agent panel open state (uncontrolled fallback when `agentPanel.open` is undefined).
  const [agentPanelInternalOpen, setAgentPanelInternalOpen] = useState(false);
  const isAgentPanelControlled = agentPanel?.open !== undefined;
  const agentPanelOpen = !agentPanel
    ? false
    : isAgentPanelControlled
      ? !!agentPanel.open
      : agentPanelInternalOpen;
  const setAgentPanelOpen = useCallback(
    (next: boolean) => {
      agentPanel?.onOpenChange?.(next);
      if (!isAgentPanelControlled) setAgentPanelInternalOpen(next);
    },
    [agentPanel, isAgentPanelControlled]
  );

  // Accessed by the stable recomputeFloatingCommentBtn callback below.
  // Kept in sync below after that callback is declared.
  // Floating "add comment" button position (relative to scroll container, null = hidden)
  const [floatingCommentBtn, setFloatingCommentBtn] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    hasSelection: boolean;
    cursorInTable: boolean;
    tableContext: TableContextInfo | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    hasSelection: false,
    cursorInTable: false,
    tableContext: null,
  });

  // Debounce timer for orphaned-comment cleanup (still needed: orphan detection
  // requires a post-edit settle so the user doesn't see comments vanish mid-edit).
  const cleanOrphanedCommentsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const isAddingCommentRef = useRef(isAddingComment);
  isAddingCommentRef.current = isAddingComment;
  const onCommentDeleteRef = useRef(onCommentDelete);
  onCommentDeleteRef.current = onCommentDelete;

  // Bridge / agent event subscribers — fan-out from the existing onChange and
  // onSelectionChange paths so multiple listeners (host app, MCP server, etc.)
  // can observe edits without competing for the single React prop.
  const contentChangeSubscribersRef = useRef(new Set<(doc: Document) => void>());
  const selectionChangeSubscribersRef = useRef(new Set<(s: SelectionState | null) => void>());
  const onCommentsChangeRef = useRef(onCommentsChange);
  onCommentsChangeRef.current = onCommentsChange;

  // Unified setter — routes to internal state in uncontrolled mode and/or to
  // the parent's onCommentsChange callback in controlled mode.
  //
  // In uncontrolled mode we mutate `commentsRef.current` synchronously
  // *before* queuing the React update so rapid sequential calls in the
  // same tick (e.g. an agent loop calling `addComment` 30 times back-to-
  // back) see the latest accumulated state. Without this, every functional
  // updater reads the same stale ref and only the last comment survives.
  //
  // In controlled mode the parent's prop is the source of truth — we don't
  // mutate the ref here because the parent might transform / reject the
  // value before echoing it back via `commentsProp`. The `commentsRef.current = comments`
  // assignment one effect above keeps the ref in sync with the prop.
  const setComments = useCallback(
    (next: Comment[] | ((prev: Comment[]) => Comment[])) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: Comment[]) => Comment[])(commentsRef.current)
          : next;
      if (resolved === commentsRef.current) return;
      if (!isControlledComments) {
        commentsRef.current = resolved;
        setInternalComments(resolved);
      }
      onCommentsChangeRef.current?.(resolved);
    },
    [isControlledComments]
  );

  // Thread comments under their overlapping tracked change (parentId = revisionId).
  // The overlap map is computed in the same doc walk as `extractTrackedChanges`
  // so we don't pay for a second descendants() pass per transaction.
  useEffect(() => {
    if (commentToRevision.size === 0) return;
    setComments((prev) => {
      let changed = false;
      const updated = prev.map((c) => {
        if (c.parentId != null) return c; // already threaded
        const rid = commentToRevision.get(c.id);
        if (rid != null) {
          changed = true;
          return { ...c, parentId: rid };
        }
        return c;
      });
      return changed ? updated : prev;
    });
  }, [commentToRevision, setComments]);

  // Remove comments whose marks no longer exist in the document
  const cleanOrphanedComments = useCallback(() => {
    if (isAddingCommentRef.current) return;
    const view = pagedEditorRef.current?.getView();
    if (!view) return;
    const { doc, schema } = view.state;
    const commentMarkType = schema.marks.comment;
    if (!commentMarkType) return;

    const liveIds = new Set<number>();
    doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type === commentMarkType) {
          const id = mark.attrs.commentId as number;
          if (id !== PENDING_COMMENT_ID) liveIds.add(id);
        }
      }
    });

    const currentComments = commentsRef.current;
    const orphanedIds = new Set<number>();
    for (const c of currentComments) {
      if (c.parentId == null && !liveIds.has(c.id)) {
        orphanedIds.add(c.id);
      }
    }
    if (orphanedIds.size === 0) return;

    for (const c of currentComments) {
      if (orphanedIds.has(c.id)) onCommentDeleteRef.current?.(c);
    }
    setComments((prev) =>
      prev.filter((c) => !orphanedIds.has(c.id) && !orphanedIds.has(c.parentId!))
    );
  }, []);

  // Clean up debounce timers on unmount
  useEffect(() => {
    return () => {
      if (cleanOrphanedCommentsTimerRef.current) {
        clearTimeout(cleanOrphanedCommentsTimerRef.current);
      }
    };
  }, []);

  // History hook for undo/redo - start with null document
  const history = useDocumentHistory<Document | null>(initialDocument || null, {
    maxEntries: 100,
    groupingInterval: 500,
    enableKeyboardShortcuts: true,
  });

  // Extract comments from document model on initial load
  const commentsLoadedRef = useRef(false);
  useEffect(() => {
    if (commentsLoadedRef.current) return;
    const doc = history.state;
    if (!doc) return;
    const bodyComments = doc.package?.document?.comments;
    if (bodyComments && bodyComments.length > 0) {
      setComments(bodyComments);
      setShowCommentsSidebar(true);
      commentsLoadedRef.current = true;
      // Bump the shared comment/revision ID counter above all loaded IDs to
      // avoid collisions (comments and tracked changes share the OOXML ID space).
      let maxId = bodyComments.reduce((max, c) => Math.max(max, c.id), 0);
      const view = pagedEditorRef.current?.getView();
      if (view) {
        view.state.doc.descendants((node) => {
          for (const mark of node.marks) {
            if (mark.attrs.revisionId != null) {
              maxId = Math.max(maxId, mark.attrs.revisionId as number);
            }
          }
        });
      }
      bumpNextCommentIdAbove(maxId);
    }
  }, [history.state]);

  // Extension manager — built once, provides schema + plugins + commands
  const extensionManager = useMemo(() => {
    const mgr = new ExtensionManager(createStarterKit());
    mgr.buildSchema();
    mgr.initializeRuntime();
    return mgr;
  }, []);

  // Suggestion mode plugin — merged with external plugins
  const suggestionPlugin = useMemo(
    () => createSuggestionModePlugin(editingMode === 'suggesting', author),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const allExternalPlugins = useMemo(
    () => [suggestionPlugin, ...(externalPlugins ?? [])],
    [suggestionPlugin, externalPlugins]
  );

  // Refs
  const pagedEditorRef = useRef<PagedEditorRef>(null);
  const hfEditorRef = useRef<InlineHeaderFooterEditorRef>(null);
  const agentRef = useRef<DocumentAgent | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Save the last known selection for restoring after toolbar interactions
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const {
    showOutline,
    setShowOutline,
    showOutlineRef,
    outlineHeadings,
    setHeadingInfos,
    toolbarHeight,
    toolbarRefCallback,
    editorScrollLeft,
  } = useOutlineSidebar({
    showOutlineProp,
    pagedEditorRef,
    scrollContainerRef,
    isLoading: state.isLoading,
  });
  // Keep history.state accessible in stable callbacks without stale closures
  const historyStateRef = useRef(history.state);
  historyStateRef.current = history.state;
  // Track current border color/width for border presets (like Google Docs)
  const borderSpecRef = useRef({ style: 'single', size: 4, color: { rgb: '000000' } });
  // Cache style resolver to avoid recreating on every selection change
  const styleResolverCacheRef = useRef<{
    styles: unknown;
    resolver: ReturnType<typeof createStyleResolver>;
  } | null>(null);
  const getCachedStyleResolver = useCallback(
    (styles: Parameters<typeof createStyleResolver>[0]) => {
      const cached = styleResolverCacheRef.current;
      if (cached && cached.styles === styles) {
        return cached.resolver;
      }
      const resolver = createStyleResolver(styles);
      styleResolverCacheRef.current = { styles, resolver };
      return resolver;
    },
    []
  );

  // Scroll-based page indicator (Google Docs style)
  const [scrollPageInfo, setScrollPageInfo] = useState<{
    currentPage: number;
    totalPages: number;
    visible: boolean;
  }>({ currentPage: 1, totalPages: 1, visible: false });
  const scrollFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to get the active editor's view — returns HF editor view when in HF editing mode
  const getActiveEditorView = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      return hfEditorRef.current.getView();
    }
    return pagedEditorRef.current?.getView();
  }, [hfEditPosition]);

  // Helper to focus the active editor
  const focusActiveEditor = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      hfEditorRef.current.focus();
    } else {
      pagedEditorRef.current?.focus();
    }
  }, [hfEditPosition]);

  // Helper to undo in the active editor
  const undoActiveEditor = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      hfEditorRef.current.undo();
    } else {
      pagedEditorRef.current?.undo();
    }
  }, [hfEditPosition]);

  // Helper to redo in the active editor
  const redoActiveEditor = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      hfEditorRef.current.redo();
    } else {
      pagedEditorRef.current?.redo();
    }
  }, [hfEditPosition]);

  // Find/Replace hook
  const findReplace = useFindReplace();

  // Hyperlink dialog hook
  const hyperlinkDialog = useHyperlinkDialog();

  // Monotonically increasing generation counter to discard stale async loads
  const loadGenerationRef = useRef(0);

  // Reset internal state when loading a new document (clears stale refs, comments, tracked changes, etc.)
  const resetForNewDocument = useCallback(() => {
    commentsLoadedRef.current = false;
    trackedChangesLoadedRef.current = false;
    setComments([]);
    setHeadingInfos([]);
    setShowCommentsSidebar(false);
    setIsAddingComment(false);
    setCommentSelectionRange(null);
    setAddCommentYPosition(null);
    setFloatingCommentBtn(null);
    setHfEditPosition(null);
    setAnchorPositions(EMPTY_ANCHOR_POSITIONS);
    findReplace.setMatches([], 0);
    if (cleanOrphanedCommentsTimerRef.current) {
      clearTimeout(cleanOrphanedCommentsTimerRef.current);
      cleanOrphanedCommentsTimerRef.current = null;
    }
  }, [findReplace.setMatches, setComments]);

  // Load a pre-parsed document (used by ref method and internally)
  const loadParsedDocument = useCallback(
    (doc: Document) => {
      resetForNewDocument();
      history.reset(doc);
      setState((prev) => ({ ...prev, isLoading: false, parseError: null }));
      loadDocumentFonts(doc).catch((err) => {
        console.warn('Failed to load document fonts:', err);
      });
    },
    [resetForNewDocument, history]
  );

  // Load a DOCX buffer (used by ref method and internally)
  const loadBuffer = useCallback(
    async (buffer: DocxInput) => {
      const generation = ++loadGenerationRef.current;
      resetForNewDocument();
      setState((prev) => ({ ...prev, isLoading: true, parseError: null }));
      try {
        const doc = await parseDocx(buffer);
        // Discard result if a newer load was started while we were parsing
        if (loadGenerationRef.current !== generation) return;
        loadParsedDocument(doc);
      } catch (error) {
        if (loadGenerationRef.current !== generation) return;
        const message = error instanceof Error ? error.message : 'Failed to parse document';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          parseError: message,
        }));
        onError?.(error instanceof Error ? error : new Error(message));
      }
    },
    [resetForNewDocument, loadParsedDocument, onError]
  );

  const {
    imageInputRef,
    docxInputRef,
    handleSave,
    handleDirectPrint,
    handleDownloadDocument,
    handleOpenDocument,
    handleDocxFileChange,
    handleInsertImageClick,
    handleImageFileChange,
  } = useFileIO({
    agentRef,
    pagedEditorRef,
    containerRef,
    comments,
    documentName,
    onSave,
    onError,
    onPrint,
    onDocumentNameChange,
    loadBuffer,
    getActiveEditorView,
    focusActiveEditor,
  });

  // React to document/documentBuffer prop changes
  useEffect(() => {
    // External content mode: caller (e.g. ySyncPlugin) populates PM directly — skip the load.
    if (externalContent) return;

    if (!documentBuffer) {
      if (initialDocument) {
        loadParsedDocument(initialDocument);
      }
      return;
    }

    loadBuffer(documentBuffer);
  }, [documentBuffer, initialDocument, externalContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Create/update agent when document changes
  useEffect(() => {
    if (history.state) {
      agentRef.current = new DocumentAgent(history.state);
    } else {
      agentRef.current = null;
    }
  }, [history.state]);

  // Mirror PM state on each external document load (mount-time view creation
  // is handled by PagedEditor's `onReady` below; this effect catches subsequent
  // loads via `document`/`documentBuffer` prop changes, which go through
  // OffscreenEditorHost's `updateState` and never fire `handleDocumentChange`).
  // Effects run child-first, so `view.state` already reflects the new doc by
  // the time this runs.
  useEffect(() => {
    if (state.isLoading || !history.state) return;
    const view = pagedEditorRef.current?.getView();
    if (view) setPmState(view.state);
  }, [state.isLoading, history.state]);

  // Auto-open the sidebar once if the loaded document already has tracked changes.
  const trackedChangesLoadedRef = useRef(false);
  useEffect(() => {
    if (trackedChangesLoadedRef.current) return;
    if (state.isLoading || !pmState) return;
    trackedChangesLoadedRef.current = true;
    if (trackedChanges.length > 0) setShowCommentsSidebar(true);
  }, [pmState, state.isLoading, trackedChanges.length]);

  // Listen for font loading
  useEffect(() => {
    const cleanup = onFontsLoaded(() => {
      onFontsLoadedCallback?.();
    });
    return cleanup;
  }, [onFontsLoadedCallback]);

  // Sync editing mode to ProseMirror suggestion mode plugin
  useEffect(() => {
    const view = pagedEditorRef.current?.getView();
    if (view) {
      setSuggestionMode(editingMode === 'suggesting', view.state, view.dispatch, author);
    }
  }, [editingMode, author]);

  const pushDocument = useCallback(
    (document: Document) => {
      history.push(document);
      return document;
    },
    [history]
  );

  // Handle document change
  const handleDocumentChange = useCallback(
    (newDocument: Document) => {
      pushDocument(newDocument);
      onChange?.(newDocument);
      // Fan out to bridge subscribers (errors in one don't break the others).
      for (const cb of contentChangeSubscribersRef.current) {
        try {
          cb(newDocument);
        } catch (e) {
          console.error('contentChange subscriber threw:', e);
        }
      }
      // Update outline headings if sidebar is open
      if (showOutlineRef.current) {
        const view = pagedEditorRef.current?.getView();
        if (view) {
          setHeadingInfos(collectHeadings(view.state.doc));
        }
      }
      // Mirror latest PM state so `useTrackedChanges` (and the threading effect)
      // re-derive from the new doc — including for transactions that came in
      // remotely via ySyncPlugin in collab mode.
      const view = pagedEditorRef.current?.getView();
      if (view) setPmState(view.state);
      // Clean up orphaned comments (debounced — avoid yanking comments mid-edit)
      if (cleanOrphanedCommentsTimerRef.current) {
        clearTimeout(cleanOrphanedCommentsTimerRef.current);
      }
      cleanOrphanedCommentsTimerRef.current = setTimeout(cleanOrphanedComments, 300);
    },
    [onChange, pushDocument, cleanOrphanedComments]
  );

  // Recompute the floating "add comment" button position from the current PM
  // selection + page/container geometry. Called from handleSelectionChange and
  // from the geometry-change effects below (resize, zoom), because PagedEditor's
  // onSelectionChange no longer fires on mere overlay redraws after the
  // state-identity dedup in #268.
  const readOnlyForFloatingBtnRef = useRef(false);
  const recomputeFloatingCommentBtn = useCallback(() => {
    const view = pagedEditorRef.current?.getView();
    if (!view) return;
    if (isAddingCommentRef.current || readOnlyForFloatingBtnRef.current) {
      setFloatingCommentBtn(null);
      return;
    }
    const { from, to } = view.state.selection;
    if (from === to) {
      setFloatingCommentBtn(null);
      return;
    }
    const container = scrollContainerRef.current;
    const parentEl = editorContentRef.current;
    if (!container || !parentEl) return;
    const top = findSelectionYPosition(container, parentEl, from);
    if (top == null) return;
    const pagesEl = container.querySelector('.paged-editor__pages');
    const pageEl = pagesEl?.querySelector('.layout-page') as HTMLElement | null;
    const left = pageEl
      ? pageEl.getBoundingClientRect().right - parentEl.getBoundingClientRect().left
      : parentEl.getBoundingClientRect().width / 2 + 408;
    setFloatingCommentBtn({ top, left });
  }, []);
  // Keep the readOnly ref used by recomputeFloatingCommentBtn in sync
  readOnlyForFloatingBtnRef.current = readOnly;

  // Reposition the floating "add comment" button when the editor container
  // resizes (window resize, sidebar toggle, loading→ready transition) or when
  // zoom changes. Both move the page edges without changing PM selection, so
  // the onSelectionChange path no longer covers them after the dedup fix in
  // #268. The scroll container may not be mounted on the first render (loading
  // state renders a different subtree), so re-run the effect whenever that
  // state flips — that's the point at which the container first becomes
  // available.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => recomputeFloatingCommentBtn());
    ro.observe(container);
    const onWinResize = () => recomputeFloatingCommentBtn();
    window.addEventListener('resize', onWinResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, [state.isLoading, recomputeFloatingCommentBtn]);
  useEffect(() => {
    recomputeFloatingCommentBtn();
  }, [state.zoom, recomputeFloatingCommentBtn]);

  // Handle selection changes from ProseMirror
  const handleSelectionChange = useCallback(
    (selectionState: SelectionState | null) => {
      // Save selection for restoring after toolbar interactions
      const view = getActiveEditorView();
      if (view) {
        const { from, to } = view.state.selection;
        lastSelectionRef.current = { from, to };
      }

      // Also check table context from ProseMirror
      let pmTableCtx: TableContextInfo | null = null;
      if (view) {
        pmTableCtx = getTableContext(view.state);
        if (!pmTableCtx.isInTable) {
          pmTableCtx = null;
        }
      }

      // Sync borderSpecRef with the current cell's actual border color
      if (pmTableCtx?.cellBorderColor) {
        const rgb = resolveColorToHex(pmTableCtx.cellBorderColor, theme);
        if (rgb) {
          borderSpecRef.current = { ...borderSpecRef.current, color: { rgb } };
        }
      }

      // Check if cursor is on an image (NodeSelection)
      let pmImageCtx: typeof state.pmImageContext = null;
      if (view) {
        const sel = view.state.selection;
        // NodeSelection has a `node` property
        const selectedNode = (
          sel as { node?: { type: { name: string }; attrs: Record<string, unknown> } }
        ).node;
        if (selectedNode?.type.name === 'image') {
          pmImageCtx = {
            pos: sel.from,
            wrapType: (selectedNode.attrs.wrapType as string) ?? 'inline',
            displayMode: (selectedNode.attrs.displayMode as string) ?? 'inline',
            cssFloat: (selectedNode.attrs.cssFloat as string) ?? null,
            transform: (selectedNode.attrs.transform as string) ?? null,
            alt: (selectedNode.attrs.alt as string) ?? null,
            borderWidth: (selectedNode.attrs.borderWidth as number) ?? null,
            borderColor: (selectedNode.attrs.borderColor as string) ?? null,
            borderKind: (selectedNode.attrs.borderKind as string) ?? null,
            width: (selectedNode.attrs.width as number) ?? null,
            height: (selectedNode.attrs.height as number) ?? null,
          };
        }
      }

      if (!selectionState) {
        setFloatingCommentBtn(null);
        setState((prev) => ({
          ...prev,
          selectionFormatting: {},
          pmTableContext: pmTableCtx,
          pmImageContext: pmImageCtx,
        }));
        return;
      }

      // Update toolbar formatting from ProseMirror selection
      const { textFormatting, paragraphFormatting } = selectionState;

      // Extract font family (prefer ascii, fall back to hAnsi)
      let fontFamily = textFormatting.fontFamily?.ascii || textFormatting.fontFamily?.hAnsi;
      let fontSize = textFormatting.fontSize;

      // If no explicit font/size marks, resolve from paragraph style or document defaults
      if (!fontFamily || !fontSize) {
        const currentDoc = historyStateRef.current;
        const paraStyleId = selectionState.styleId;
        if (currentDoc?.package.styles && paraStyleId) {
          const resolver = getCachedStyleResolver(currentDoc.package.styles);
          const resolved = resolver.resolveParagraphStyle(paraStyleId);
          if (!fontFamily && resolved.runFormatting?.fontFamily) {
            fontFamily =
              resolved.runFormatting.fontFamily.ascii || resolved.runFormatting.fontFamily.hAnsi;
          }
          if (!fontSize && resolved.runFormatting?.fontSize) {
            fontSize = resolved.runFormatting.fontSize;
          }
        }
      }

      const textColorHex = resolveColorToHex(textFormatting.color, theme);
      const textColor = textColorHex ? `#${textColorHex}` : undefined;

      // Build list state from numPr
      const numPr = paragraphFormatting.numPr;
      const listState = numPr
        ? {
            type: (numPr.numId === 1 ? 'bullet' : 'numbered') as 'bullet' | 'numbered',
            level: numPr.ilvl ?? 0,
            isInList: true,
            numId: numPr.numId,
          }
        : undefined;

      const formatting: SelectionFormatting = {
        bold: textFormatting.bold,
        italic: textFormatting.italic,
        underline: !!textFormatting.underline,
        strike: textFormatting.strike,
        superscript: textFormatting.vertAlign === 'superscript',
        subscript: textFormatting.vertAlign === 'subscript',
        fontFamily,
        fontSize,
        color: textColor,
        highlight: textFormatting.highlight,
        alignment: paragraphFormatting.alignment,
        lineSpacing: paragraphFormatting.lineSpacing,
        listState,
        styleId: selectionState.styleId ?? undefined,
        indentLeft: paragraphFormatting.indentLeft,
        bidi: !!paragraphFormatting.bidi,
      };
      setState((prev) => ({
        ...prev,
        selectionFormatting: formatting,
        paragraphIndentLeft: paragraphFormatting.indentLeft ?? 0,
        paragraphIndentRight: paragraphFormatting.indentRight ?? 0,
        paragraphFirstLineIndent: paragraphFormatting.indentFirstLine ?? 0,
        paragraphHangingIndent: paragraphFormatting.hangingIndent ?? false,
        paragraphTabs: paragraphFormatting.tabs ?? null,
        pmTableContext: pmTableCtx,
        pmImageContext: pmImageCtx,
      }));

      // Update floating comment button position
      recomputeFloatingCommentBtn();

      // Notify parent
      onSelectionChange?.(selectionState);
      // Fan out to bridge subscribers.
      for (const cb of selectionChangeSubscribersRef.current) {
        try {
          cb(selectionState);
        } catch (e) {
          console.error('selectionChange subscriber threw:', e);
        }
      }
    },
    // getActiveEditorView's return depends on hfEditPosition; theme drives
    // color resolution. Both must be in deps to avoid stale-closure reads.
    [onSelectionChange, isAddingComment, readOnly, getActiveEditorView, theme]
  );

  // Table selection hook
  const tableSelection = useTableSelection({
    document: history.state,
    onChange: handleDocumentChange,
    onSelectionChange: (_context) => {
      // Could notify parent of table selection changes
    },
  });

  useKeyboardShortcuts({
    pagedEditorRef,
    disableFindReplaceShortcuts,
    findReplace,
    hyperlinkDialog,
    tableSelection,
  });

  // Handle table insert from toolbar
  // Toggle document outline sidebar
  const handleToggleOutline = useCallback(() => {
    setShowOutline((prev) => {
      if (!prev) {
        // Opening: collect headings immediately
        const view = pagedEditorRef.current?.getView();
        if (view) {
          setHeadingInfos(collectHeadings(view.state.doc));
        }
      }
      return !prev;
    });
  }, []);

  // Navigate to a heading from the outline
  const handleHeadingInfoClick = useCallback((pmPos: number) => {
    pagedEditorRef.current?.scrollToPosition(pmPos);
    // Also set selection to the heading
    pagedEditorRef.current?.setSelection(pmPos + 1);
    pagedEditorRef.current?.focus();
  }, []);

  // Handle shape insertion
  // Handle image wrap type change
  const {
    imagePositionOpen,
    setImagePositionOpen,
    imagePropsOpen,
    setImagePropsOpen,
    footnotePropsOpen,
    setFootnotePropsOpen,
    handleImageWrapType,
    handleImageTransform,
    handleApplyImagePosition,
    handleOpenImageProperties,
    handleApplyImageProperties,
    handleApplyFootnoteProperties,
  } = useImageActions({
    document: history.state,
    pmImageContext: state.pmImageContext,
    zoom: state.zoom,
    getActiveEditorView,
    focusActiveEditor,
    pushDocument,
  });

  const openSplitCellDialog = useCallback(() => {
    const view = getActiveEditorView();
    const pmConfig = view ? getSplitCellDialogConfig(view.state) : null;
    const legacyConfig = pmConfig ? null : tableSelection.getSplitCellConfig();
    const config = pmConfig ?? legacyConfig;
    if (!config) return;

    setSplitCellDialogState({
      isOpen: true,
      ...config,
      source: pmConfig ? 'pm' : 'legacy',
      capturedCellRow: pmConfig?.capturedCellRow ?? null,
      capturedCellCol: pmConfig?.capturedCellCol ?? null,
    });
  }, [getActiveEditorView, tableSelection]);

  // Handle table action from Toolbar - use ProseMirror commands
  const handleTableAction = useCallback(
    (action: TableAction) => {
      const view = getActiveEditorView();
      if (!view) {
        if (action === 'splitCell') {
          openSplitCellDialog();
        } else if (typeof action !== 'object') {
          tableSelection.handleAction(action);
        }
        return;
      }

      switch (action) {
        case 'addRowAbove':
          addRowAbove(view.state, view.dispatch);
          break;
        case 'addRowBelow':
          addRowBelow(view.state, view.dispatch);
          break;
        case 'addColumnLeft':
          addColumnLeft(view.state, view.dispatch);
          break;
        case 'addColumnRight':
          addColumnRight(view.state, view.dispatch);
          break;
        case 'deleteRow':
          pmDeleteRow(view.state, view.dispatch);
          break;
        case 'deleteColumn':
          pmDeleteColumn(view.state, view.dispatch);
          break;
        case 'deleteTable':
          pmDeleteTable(view.state, view.dispatch);
          break;
        case 'selectTable':
          pmSelectTable(view.state, view.dispatch);
          break;
        case 'selectRow':
          pmSelectRow(view.state, view.dispatch);
          break;
        case 'selectColumn':
          pmSelectColumn(view.state, view.dispatch);
          break;
        case 'mergeCells':
          pmMergeCells(view.state, view.dispatch);
          break;
        case 'splitCell':
          openSplitCellDialog();
          break;
        // Border actions — use current border spec from toolbar
        case 'borderAll':
          setAllTableBorders(view.state, view.dispatch, borderSpecRef.current);
          break;
        case 'borderOutside':
          setOutsideTableBorders(view.state, view.dispatch, borderSpecRef.current);
          break;
        case 'borderInside':
          setInsideTableBorders(view.state, view.dispatch, borderSpecRef.current);
          break;
        case 'borderNone':
          removeTableBorders(view.state, view.dispatch);
          break;
        // Per-side border actions (use current border spec)
        case 'borderTop':
          setCellBorder('top', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        case 'borderBottom':
          setCellBorder('bottom', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        case 'borderLeft':
          setCellBorder('left', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        case 'borderRight':
          setCellBorder('right', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        default:
          // Handle complex actions (with parameters)
          if (typeof action === 'object') {
            if (action.type === 'cellFillColor') {
              setCellFillColor(action.color)(view.state, view.dispatch);
            } else if (action.type === 'borderColor') {
              const rgb = action.color.replace(/^#/, '');
              borderSpecRef.current = { ...borderSpecRef.current, color: { rgb } };
              setTableBorderColor(action.color)(view.state, view.dispatch);
            } else if (action.type === 'borderWidth') {
              borderSpecRef.current = { ...borderSpecRef.current, size: action.size };
              setTableBorderWidth(action.size)(view.state, view.dispatch);
            } else if (action.type === 'cellBorder') {
              setCellBorder(action.side, {
                style: action.style,
                size: action.size,
                color: { rgb: action.color.replace(/^#/, '') },
              })(view.state, view.dispatch);
            } else if (action.type === 'cellVerticalAlign') {
              setCellVerticalAlign(action.align)(view.state, view.dispatch);
            } else if (action.type === 'cellMargins') {
              setCellMargins(action.margins)(view.state, view.dispatch);
            } else if (action.type === 'cellTextDirection') {
              setCellTextDirection(action.direction)(view.state, view.dispatch);
            } else if (action.type === 'toggleNoWrap') {
              toggleNoWrap()(view.state, view.dispatch);
            } else if (action.type === 'rowHeight') {
              setRowHeight(action.height, action.rule)(view.state, view.dispatch);
            } else if (action.type === 'toggleHeaderRow') {
              toggleHeaderRow()(view.state, view.dispatch);
            } else if (action.type === 'distributeColumns') {
              distributeColumns()(view.state, view.dispatch);
            } else if (action.type === 'autoFitContents') {
              autoFitContents()(view.state, view.dispatch);
            } else if (action.type === 'openTableProperties') {
              setTablePropsOpen(true);
            } else if (action.type === 'tableProperties') {
              setTableProperties(action.props)(view.state, view.dispatch);
            } else if (action.type === 'applyTableStyle') {
              // Resolve style data from built-in presets or document styles
              let preset: TableStylePreset | undefined = getBuiltinTableStyle(action.styleId);
              const currentDocForTable = historyStateRef.current;
              if (!preset && currentDocForTable?.package.styles) {
                const styleResolver = getCachedStyleResolver(currentDocForTable.package.styles);
                const docStyle = styleResolver.getStyle(action.styleId);
                if (docStyle) {
                  // Convert to preset inline (same as documentStyleToPreset)
                  preset = { id: docStyle.styleId, name: docStyle.name ?? docStyle.styleId };
                  if (docStyle.tblPr?.borders) {
                    const b = docStyle.tblPr.borders;
                    preset.tableBorders = {};
                    for (const side of [
                      'top',
                      'bottom',
                      'left',
                      'right',
                      'insideH',
                      'insideV',
                    ] as const) {
                      const bs = b[side];
                      if (bs) {
                        preset.tableBorders[side] = {
                          style: bs.style,
                          size: bs.size,
                          color: bs.color?.rgb ? { rgb: bs.color.rgb } : undefined,
                        };
                      }
                    }
                  }
                  if (docStyle.tblStylePr) {
                    preset.conditionals = {};
                    for (const cond of docStyle.tblStylePr) {
                      const entry: Record<string, unknown> = {};
                      if (cond.tcPr?.shading?.fill)
                        entry.backgroundColor = `#${cond.tcPr.shading.fill}`;
                      if (cond.tcPr?.borders) {
                        const borders: Record<string, unknown> = {};
                        for (const s of ['top', 'bottom', 'left', 'right'] as const) {
                          const bs2 = cond.tcPr.borders[s];
                          if (bs2)
                            borders[s] = {
                              style: bs2.style,
                              size: bs2.size,
                              color: bs2.color?.rgb ? { rgb: bs2.color.rgb } : undefined,
                            };
                        }
                        entry.borders = borders;
                      }
                      if (cond.rPr?.bold) entry.bold = true;
                      if (cond.rPr?.color?.rgb) entry.color = `#${cond.rPr.color.rgb}`;
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (preset.conditionals as any)[cond.type] = entry;
                    }
                  }
                  preset.look = { firstRow: true, lastRow: false, noHBand: false, noVBand: true };
                }
              }
              if (preset) {
                applyTableStyle({
                  styleId: preset.id,
                  tableBorders: preset.tableBorders,
                  conditionals: preset.conditionals,
                  look: preset.look,
                })(view.state, view.dispatch);
              }
            }
          } else {
            // Fallback to legacy table selection handler for other actions
            tableSelection.handleAction(action);
          }
      }

      focusActiveEditor();
    },
    [tableSelection, getActiveEditorView, focusActiveEditor, openSplitCellDialog]
  );

  // Context menu handler. Body content has its own context-menu plumbing
  // wired through PagedEditor (handleContextMenu below), so we early-out
  // when the right-click landed in the body's pages region — *unless* the
  // inline HF editor is open, in which case we need to show the menu for
  // the HF view since body's plumbing won't fire for HF clicks.
  const handleEditorContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.paged-editor__pages') && !target.closest('.hf-inline-editor')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const view = getActiveEditorView();
      const tableContext = view ? getTableContext(view.state) : { isInTable: false };
      const { from, to } = view?.state.selection ?? { from: 0, to: 0 };
      const hasSel = from !== to;
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        hasSelection: hasSel,
        cursorInTable: tableContext.isInTable,
        tableContext: tableContext.isInTable ? tableContext : null,
      });
    },
    [getActiveEditorView]
  );

  // Handle formatting action from toolbar
  const { handleFormat, handleInsertTable, handleInsertPageBreak, handleInsertTOC } =
    useFormattingActions({
      getActiveEditorView,
      focusActiveEditor,
      pagedEditorRef,
      lastSelectionRef,
      hyperlinkDialog,
      historyStateRef,
      getCachedStyleResolver,
    });

  const handleSplitCellDialogClose = useCallback(() => {
    setSplitCellDialogState((prev) => ({
      ...prev,
      isOpen: false,
      source: null,
      capturedCellRow: null,
      capturedCellCol: null,
    }));
  }, []);

  const handleSplitCellDialogApply = useCallback(
    (rows: number, cols: number) => {
      if (splitCellDialogState.source === 'legacy') {
        tableSelection.applySplitCell(rows, cols);
        focusActiveEditor();
        return;
      }

      const view = getActiveEditorView();
      if (!view) return;
      splitActiveTableCell(
        view.state,
        view.dispatch,
        rows,
        cols,
        splitCellDialogState.capturedCellRow ?? undefined,
        splitCellDialogState.capturedCellCol ?? undefined
      );
      focusActiveEditor();
    },
    [
      focusActiveEditor,
      getActiveEditorView,
      splitCellDialogState.source,
      splitCellDialogState.capturedCellRow,
      splitCellDialogState.capturedCellCol,
      tableSelection,
    ]
  );

  // Handle zoom change
  const handleZoomChange = useCallback((zoom: number) => {
    setState((prev) => ({ ...prev, zoom }));
  }, []);

  const {
    hyperlinkPopupData,
    handleHyperlinkSubmit,
    handleHyperlinkRemove,
    handleHyperlinkClick,
    handleHyperlinkPopupNavigate,
    handleHyperlinkPopupCopy,
    handleHyperlinkPopupEdit,
    handleHyperlinkPopupRemove,
    handleHyperlinkPopupClose,
  } = useHyperlinkActions({
    hyperlinkDialog,
    getActiveEditorView,
    focusActiveEditor,
  });

  // Image-specific right-click menu state.
  const imageContextMenu = useImageContextMenu();

  // Right-click context menu handlers. Use the active view so the menu
  // reflects HF state when the inline editor is open.
  const handleContextMenu = useCallback(
    (data: {
      x: number;
      y: number;
      hasSelection: boolean;
      image?: {
        pos: number;
        wrapType: WrapType;
        cssFloat?: 'left' | 'right' | 'none' | null;
        inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
      } | null;
    }) => {
      // Image right-click takes priority over the text context menu.
      if (data.image) {
        imageContextMenu.openForImage({
          x: data.x,
          y: data.y,
          wrapType: data.image.wrapType,
          cssFloat: data.image.cssFloat,
          pos: data.image.pos,
          inlinePositionEmu: data.image.inlinePositionEmu,
        });
        return;
      }
      const view = getActiveEditorView();
      const tableContext = view ? getTableContext(view.state) : { isInTable: false };
      setContextMenu({
        isOpen: true,
        position: data,
        hasSelection: data.hasSelection,
        cursorInTable: tableContext.isInTable,
        tableContext: tableContext.isInTable ? tableContext : null,
      });
    },
    [getActiveEditorView, imageContextMenu]
  );

  const handleImageWrapApply = useCallback(
    (target: ImageLayoutTarget) => {
      const view = getActiveEditorView();
      if (!view || imageContextMenu.imagePos === null) return;
      // For inline → anchor, hand the captured EMU offset to the command so
      // the new float lands where the inline glyph used to sit.
      const opts = imageContextMenu.inlinePositionEmu
        ? { initialPositionEmu: imageContextMenu.inlinePositionEmu }
        : undefined;
      setImageWrapType(imageContextMenu.imagePos, target, opts)(view.state, view.dispatch);
    },
    [getActiveEditorView, imageContextMenu.imagePos, imageContextMenu.inlinePositionEmu]
  );

  // Text actions that ride along inside the image context menu — Word shows
  // Cut / Copy / Paste / Delete underneath the layout choices, so users don't
  // need to flip menus to do basic clipboard work on the selected image.
  const imageContextMenuTextActions = useMemo(
    () => [
      {
        action: 'cut' as TextContextAction,
        label: t('contextMenu.cut'),
        shortcut: t('contextMenu.cutShortcut'),
      },
      {
        action: 'copy' as TextContextAction,
        label: t('contextMenu.copy'),
        shortcut: t('contextMenu.copyShortcut'),
      },
      {
        action: 'paste' as TextContextAction,
        label: t('contextMenu.paste'),
        shortcut: t('contextMenu.pasteShortcut'),
        dividerAfter: true,
      },
      {
        action: 'delete' as TextContextAction,
        label: t('contextMenu.delete'),
        shortcut: t('contextMenu.deleteShortcut'),
      },
    ],
    [t]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu({
      isOpen: false,
      position: { x: 0, y: 0 },
      hasSelection: false,
      cursorInTable: false,
      tableContext: null,
    });
  }, []);

  const contextMenuItems = useMemo((): TextContextMenuItem[] => {
    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
    const mod = isMac ? '⌘' : 'Ctrl';
    const items: TextContextMenuItem[] = [
      { action: 'cut', label: 'Cut', shortcut: `${mod}+X` },
      { action: 'copy', label: 'Copy', shortcut: `${mod}+C` },
      { action: 'paste', label: 'Paste', shortcut: `${mod}+V` },
      {
        action: 'pasteAsPlainText',
        label: 'Paste as Plain Text',
        shortcut: `${mod}+Shift+V`,
        dividerAfter: true,
      },
      {
        action: 'delete',
        label: 'Delete',
        shortcut: 'Del',
        dividerAfter: !contextMenu.hasSelection && !contextMenu.cursorInTable,
      },
    ];
    if (contextMenu.hasSelection) {
      items.push({
        action: 'addComment',
        label: 'Comment',
        dividerAfter: !contextMenu.cursorInTable,
      });
    }
    if (contextMenu.cursorInTable) {
      items.push(
        { action: 'addRowAbove', label: 'Insert row above' },
        { action: 'addRowBelow', label: 'Insert row below' },
        { action: 'deleteRow', label: 'Delete row', dividerAfter: true },
        { action: 'addColumnLeft', label: 'Insert column left' },
        { action: 'addColumnRight', label: 'Insert column right' },
        { action: 'deleteColumn', label: 'Delete column' },
        {
          action: 'mergeCells',
          label: i18n?.table?.mergeCells ?? defaultLocale.table.mergeCells,
          disabled: !contextMenu.tableContext?.hasMultiCellSelection,
        },
        {
          action: 'splitCell',
          label: i18n?.table?.splitCell ?? defaultLocale.table.splitCell,
          disabled: !contextMenu.tableContext?.canSplitCell,
          dividerAfter: true,
        }
      );
    }
    items.push({ action: 'selectAll', label: 'Select All', shortcut: `${mod}+A` });
    return items;
  }, [contextMenu.hasSelection, contextMenu.cursorInTable, contextMenu.tableContext]);

  const handleContextMenuAction = useCallback(
    async (action: TextContextAction) => {
      const view = getActiveEditorView();
      if (!view) return;

      // Focus the hidden PM so execCommand targets the right element
      focusActiveEditor();

      switch (action) {
        case 'cut':
          document.execCommand('cut');
          break;
        case 'copy':
          document.execCommand('copy');
          break;
        case 'paste': {
          // Use Clipboard API — document.execCommand('paste') is blocked in modern browsers
          try {
            const items = await navigator.clipboard.read();
            let html = '';
            let text = '';
            for (const item of items) {
              if (item.types.includes('text/html')) {
                html = await (await item.getType('text/html')).text();
              }
              if (item.types.includes('text/plain')) {
                text = await (await item.getType('text/plain')).text();
              }
            }
            const dt = new DataTransfer();
            if (html) dt.items.add(html, 'text/html');
            if (text) dt.items.add(text, 'text/plain');
            const pasteEvent = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
            });
            view.dom.dispatchEvent(pasteEvent);
          } catch {
            try {
              const text = await navigator.clipboard.readText();
              if (text) view.dispatch(view.state.tr.insertText(text));
            } catch {
              // Clipboard access denied
            }
          }
          break;
        }
        case 'pasteAsPlainText':
          try {
            const text = await navigator.clipboard.readText();
            if (text) view.dispatch(view.state.tr.insertText(text));
          } catch {
            // Clipboard access denied
          }
          break;
        case 'delete': {
          const { from, to } = view.state.selection;
          if (from !== to) {
            view.dispatch(view.state.tr.deleteRange(from, to));
          }
          break;
        }
        case 'selectAll':
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, 0, view.state.doc.content.size)
            )
          );
          break;
        // Table operations
        case 'addRowAbove':
          addRowAbove(view.state, view.dispatch);
          break;
        case 'addRowBelow':
          addRowBelow(view.state, view.dispatch);
          break;
        case 'deleteRow':
          pmDeleteRow(view.state, view.dispatch);
          break;
        case 'addColumnLeft':
          addColumnLeft(view.state, view.dispatch);
          break;
        case 'addColumnRight':
          addColumnRight(view.state, view.dispatch);
          break;
        case 'deleteColumn':
          pmDeleteColumn(view.state, view.dispatch);
          break;
        case 'mergeCells':
          pmMergeCells(view.state, view.dispatch);
          break;
        case 'splitCell':
          openSplitCellDialog();
          break;
        // Comment — same flow as floating comment button
        case 'addComment': {
          const { from, to } = view.state.selection;
          if (from === to) break;
          // Compute Y position BEFORE dispatching — dispatch triggers re-layout
          // which rebuilds page DOM and invalidates the old span elements
          const yPos = findSelectionYPosition(
            scrollContainerRef.current,
            editorContentRef.current,
            from
          );
          setCommentSelectionRange({ from, to });
          const pendingMark = view.state.schema.marks.comment.create({
            commentId: PENDING_COMMENT_ID,
          });
          const tr = view.state.tr.addMark(from, to, pendingMark);
          tr.setSelection(TextSelection.create(tr.doc, to));
          view.dispatch(tr);
          setAddCommentYPosition(yPos);
          setShowCommentsSidebar(true);
          setIsAddingComment(true);
          setFloatingCommentBtn(null);
          break;
        }
      }
      // TextContextMenu calls onClose after onAction, so no need to close here
    },
    [getActiveEditorView, focusActiveEditor, openSplitCellDialog]
  );

  // Handle margin changes from rulers
  const {
    showPageSetup,
    setShowPageSetup,
    handleOpenPageSetup,
    handleLeftMarginChange,
    handleRightMarginChange,
    handleTopMarginChange,
    handleBottomMarginChange,
    handlePageSetupApply,
    handleIndentLeftChange,
    handleIndentRightChange,
    handleFirstLineIndentChange,
    handleTabMarkRemove,
  } = usePageSetupControls({
    document: history.state,
    readOnly,
    handleDocumentChange,
    getActiveEditorView,
  });

  // Scroll-based page tracking: calculate current page from scroll position.
  // Re-attaches when the scroll container mounts (after loading completes).
  const scrollContainerEl = scrollContainerRef.current;
  useEffect(() => {
    if (!scrollContainerEl) return;

    const handleScroll = () => {
      const layout = pagedEditorRef.current?.getLayout();
      if (!layout || layout.pages.length === 0) return;

      const scrollTop = scrollContainerEl.scrollTop;
      const totalPages = layout.pages.length;
      const pageGap = 24; // DEFAULT_PAGE_GAP from PagedEditor
      const paddingTop = 24; // top padding in paged-editor__pages

      // Calculate which page is visible at the viewport center
      const viewportCenter = scrollTop + scrollContainerEl.clientHeight / 2;
      let accumulatedY = paddingTop;
      let currentPage = 1;

      for (let i = 0; i < layout.pages.length; i++) {
        const pageHeight = layout.pages[i].size.h;
        const pageEnd = accumulatedY + pageHeight;
        if (viewportCenter < pageEnd) {
          currentPage = i + 1;
          break;
        }
        accumulatedY = pageEnd + pageGap;
        currentPage = i + 2; // next page
      }
      currentPage = Math.min(currentPage, totalPages);

      setScrollPageInfo({ currentPage, totalPages, visible: true });

      // Clear existing fade timer
      if (scrollFadeTimerRef.current) {
        clearTimeout(scrollFadeTimerRef.current);
      }
      // Hide after 0.6s of no scrolling
      scrollFadeTimerRef.current = setTimeout(() => {
        setScrollPageInfo((prev) => ({ ...prev, visible: false }));
      }, 600);
    };

    scrollContainerEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainerEl.removeEventListener('scroll', handleScroll);
      if (scrollFadeTimerRef.current) {
        clearTimeout(scrollFadeTimerRef.current);
      }
    };
  }, [scrollContainerEl]);

  // Handle save
  // Handle error from editor
  const handleEditorError = useCallback(
    (error: Error) => {
      onError?.(error);
    },
    [onError]
  );

  const {
    findResultRef,
    handleFind,
    handleFindNext,
    handleFindPrevious,
    handleReplace,
    handleReplaceAll,
  } = useFindReplaceBridge({
    document: history.state,
    containerRef,
    findReplace,
    handleDocumentChange,
  });

  // Expose ref methods
  useImperativeHandle(
    ref,
    () => ({
      getAgent: () => agentRef.current,
      getDocument: () => history.state,
      getEditorRef: () => pagedEditorRef.current,
      save: handleSave,
      setZoom: (zoom: number) => setState((prev) => ({ ...prev, zoom })),
      getZoom: () => state.zoom,
      focus: () => {
        pagedEditorRef.current?.focus();
      },
      getCurrentPage: () => scrollPageInfo.currentPage,
      getTotalPages: () => scrollPageInfo.totalPages,
      scrollToPage: (pageNumber: number) => {
        pagedEditorRef.current?.scrollToPage(pageNumber);
      },
      scrollToPosition: (pmPos: number) => {
        pagedEditorRef.current?.scrollToPosition(pmPos);
      },
      openPrintPreview: handleDirectPrint,
      print: handleDirectPrint,
      loadDocument: loadParsedDocument,
      loadDocumentBuffer: loadBuffer,

      addComment: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return null;
        const { schema } = view.state;
        if (!schema.marks.comment) return null;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return null;

        let from = range.from;
        let to = range.to;

        if (options.search) {
          const textRange = findTextInPmParagraph(
            view.state.doc,
            range.from,
            range.to,
            options.search
          );
          if (!textRange) return null;
          from = textRange.from;
          to = textRange.to;
        }

        const comment = createComment(options.text, options.author);
        const commentMark = schema.marks.comment.create({ commentId: comment.id });
        view.dispatch(view.state.tr.addMark(from, to, commentMark));
        setComments((prev) => [...prev, comment]);
        setShowCommentsSidebar(true);
        return comment.id;
      },

      replyToComment: (commentId, text, authorName) => {
        if (!comments.some((c) => c.id === commentId)) return null;
        const reply = createComment(text, authorName, commentId);
        setComments((prev) => [...prev, reply]);
        return reply.id;
      },

      resolveComment: (commentId) => {
        setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, done: true } : c)));
      },

      proposeChange: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        const { schema } = view.state;
        if (!schema.marks.deletion || !schema.marks.insertion) return false;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return false;

        const isInsertion = options.search === '';
        const isDeletion = options.replaceWith === '';

        let textFrom: number;
        let textTo: number;

        if (isInsertion) {
          // Insert at end of paragraph (just before closing token).
          textFrom = range.to - 1;
          textTo = range.to - 1;
        } else {
          const textRange = findTextInPmParagraph(
            view.state.doc,
            range.from,
            range.to,
            options.search
          );
          if (!textRange) return false;
          textFrom = textRange.from;
          textTo = textRange.to;
        }

        // Refuse to layer onto an existing tracked change.
        let overlapsTrackedChange = false;
        if (textFrom < textTo) {
          view.state.doc.nodesBetween(textFrom, textTo, (node) => {
            for (const m of node.marks) {
              if (m.type === schema.marks.insertion || m.type === schema.marks.deletion) {
                overlapsTrackedChange = true;
                return false;
              }
            }
            return true;
          });
          if (overlapsTrackedChange) return false;
        }

        const revisionId = getNextCommentId();
        const date = new Date().toISOString();

        const deletionMark = schema.marks.deletion.create({
          revisionId,
          author: options.author,
          date,
        });
        const insertionMark = schema.marks.insertion.create({
          revisionId,
          author: options.author,
          date,
        });

        let tr = view.state.tr;
        if (!isInsertion) {
          tr = tr.addMark(textFrom, textTo, deletionMark);
        }
        if (!isDeletion) {
          const insertedNode = schema.text(options.replaceWith, [insertionMark]);
          tr = tr.insert(textTo, insertedNode);
        }

        if (isInsertion && isDeletion) return false; // nothing to do
        view.dispatch(tr);

        setShowCommentsSidebar(true);
        return true;
      },

      applyFormatting: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        const { schema } = view.state;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return false;

        // Default range: the paragraph's text content (skip open/close tokens).
        let from = range.from + 1;
        let to = range.to - 1;

        if (options.search) {
          const textRange = findTextInPmParagraph(
            view.state.doc,
            range.from,
            range.to,
            options.search
          );
          if (!textRange) return false;
          from = textRange.from;
          to = textRange.to;
        }

        if (from >= to) return true;

        let tr = view.state.tr;
        const m = options.marks;

        if (m.bold !== undefined && schema.marks.bold) {
          tr = m.bold
            ? tr.addMark(from, to, schema.marks.bold.create())
            : tr.removeMark(from, to, schema.marks.bold);
        }
        if (m.italic !== undefined && schema.marks.italic) {
          tr = m.italic
            ? tr.addMark(from, to, schema.marks.italic.create())
            : tr.removeMark(from, to, schema.marks.italic);
        }
        if (m.underline !== undefined && schema.marks.underline) {
          if (m.underline) {
            const style = typeof m.underline === 'object' ? m.underline.style : undefined;
            tr = tr.addMark(from, to, schema.marks.underline.create({ style: style ?? 'single' }));
          } else {
            tr = tr.removeMark(from, to, schema.marks.underline);
          }
        }
        if (m.strike !== undefined && schema.marks.strike) {
          tr = m.strike
            ? tr.addMark(from, to, schema.marks.strike.create())
            : tr.removeMark(from, to, schema.marks.strike);
        }
        if (m.color !== undefined && schema.marks.textColor) {
          if (m.color && (m.color.rgb || m.color.themeColor)) {
            tr = tr.addMark(
              from,
              to,
              schema.marks.textColor.create({
                rgb: m.color.rgb ?? null,
                themeColor: m.color.themeColor ?? null,
              })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.textColor);
          }
        }
        if (m.highlight !== undefined && schema.marks.highlight) {
          if (m.highlight) {
            const name = mapHexToHighlightName(m.highlight);
            tr = tr.addMark(
              from,
              to,
              schema.marks.highlight.create({ color: name || m.highlight })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.highlight);
          }
        }
        if (m.fontSize !== undefined && schema.marks.fontSize) {
          if (m.fontSize > 0) {
            tr = tr.addMark(
              from,
              to,
              schema.marks.fontSize.create({ size: pointsToHalfPoints(m.fontSize) })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.fontSize);
          }
        }
        if (m.fontFamily !== undefined && schema.marks.fontFamily) {
          if (m.fontFamily && (m.fontFamily.ascii || m.fontFamily.hAnsi)) {
            tr = tr.addMark(
              from,
              to,
              schema.marks.fontFamily.create({
                ascii: m.fontFamily.ascii ?? null,
                hAnsi: m.fontFamily.hAnsi ?? m.fontFamily.ascii ?? null,
              })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.fontFamily);
          }
        }

        view.dispatch(tr);
        return true;
      },

      setParagraphStyle: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return false;

        const currentDoc = historyStateRef.current;
        const styleResolver = currentDoc?.package?.styles
          ? getCachedStyleResolver(currentDoc.package.styles)
          : null;

        // Refuse unknown styleIds so the agent gets a clear error
        // instead of silently writing `<w:pStyle w:val="NoSuchStyle"/>`.
        // We only enforce this when we have a resolver — without one,
        // we can't know which styles are defined, so fall through.
        if (styleResolver && !styleResolver.hasParagraphStyle(options.styleId)) {
          return false;
        }

        // Build a synthetic state with selection inside the target paragraph
        // so applyStyle's cursor-driven walk lands on it. We restore the
        // original selection on the dispatched transaction.
        const $from = view.state.doc.resolve(range.from + 1);
        const $to = view.state.doc.resolve(range.to - 1);
        const paraSelection = TextSelection.between($from, $to);
        const stateWithSel = view.state.apply(view.state.tr.setSelection(paraSelection));

        const cmd = styleResolver
          ? (() => {
              const r = styleResolver.resolveParagraphStyle(options.styleId);
              return applyStyle(options.styleId, {
                paragraphFormatting: r.paragraphFormatting,
                runFormatting: r.runFormatting,
              });
            })()
          : applyStyle(options.styleId);

        let didApply = false;
        cmd(stateWithSel, (newTr) => {
          didApply = true;
          newTr.setSelection(view.state.selection.map(newTr.doc, newTr.mapping));
          view.dispatch(newTr);
        });

        return didApply;
      },

      getPageContent: (pageNumber) => {
        const layout = pagedEditorRef.current?.getLayout();
        if (!layout) return null;
        const page = layout.pages[pageNumber - 1];
        if (!page) return null;
        const view = pagedEditorRef.current?.getView();
        if (!view) return null;
        const doc = view.state.doc;

        const seen = new Set<string>();
        const paragraphs: Array<{ paraId: string; text: string; styleId?: string }> = [];

        for (const frag of page.fragments) {
          if (frag.kind !== 'paragraph') continue;
          // `docFrom` is the position immediately before the paragraph node;
          // `doc.nodeAt(docFrom)` resolves to the paragraph itself.
          const docFrom = frag.docFrom;
          if (docFrom == null) continue;
          const node = doc.nodeAt(docFrom);
          if (!node || !node.isTextblock) continue;

          const paraId = node.attrs?.paraId as string | undefined;
          if (!paraId || seen.has(paraId)) continue;
          seen.add(paraId);
          paragraphs.push({
            paraId,
            text: getVanillaNodeText(node),
            styleId: (node.attrs?.styleId as string | undefined) ?? undefined,
          });
        }

        const text = paragraphs.map((p) => `[${p.paraId}] ${p.text}`).join('\n');
        return { pageNumber, text, paragraphs };
      },

      scrollToParaId: (paraId) => pagedEditorRef.current?.scrollToParaId(paraId) ?? false,

      findInDocument: (query, opts) => {
        const view = pagedEditorRef.current?.getView();
        if (!view || !query) return [];
        const caseSensitive = opts?.caseSensitive ?? false;
        const limit = opts?.limit ?? 20;
        const needle = caseSensitive ? query : query.toLowerCase();
        const results: Array<{
          paraId: string;
          match: string;
          before: string;
          after: string;
        }> = [];

        view.state.doc.descendants((node) => {
          if (results.length >= limit) return false;
          if (!node.isTextblock) return true;
          const paraId = node.attrs?.paraId as string | undefined;
          if (!paraId) return false;
          const text = getVanillaNodeText(node);
          const haystack = caseSensitive ? text : text.toLowerCase();
          const at = haystack.indexOf(needle);
          if (at === -1) return false;

          // Reject ambiguous matches in the same paragraph — agent should narrow query.
          if (haystack.indexOf(needle, at + 1) !== -1) return false;

          const match = text.slice(at, at + query.length);
          const CONTEXT = 40;
          results.push({
            paraId,
            match,
            before: text.slice(Math.max(0, at - CONTEXT), at),
            after: text.slice(at + query.length, at + query.length + CONTEXT),
          });
          return false;
        });

        return results;
      },

      getSelectionInfo: () => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return null;
        const { selection, doc } = view.state;
        const $from = selection.$from;
        // Walk up to nearest textblock
        let depth = $from.depth;
        while (depth > 0 && !$from.node(depth).isTextblock) depth--;
        const para = depth > 0 ? $from.node(depth) : null;
        if (!para) return null;
        const paraId = (para.attrs?.paraId as string | undefined) ?? null;
        const paraStart = $from.start(depth);
        const paraEnd = paraStart + para.content.size;
        // Vanilla view: build before/selectedText/after independently from the
        // doc so the result matches what the agent reads via read_document and
        // can anchor via add_comment. Insertion-marked text never appears.
        const before = getVanillaTextBetween(doc, paraStart, selection.from);
        const selectedText = getVanillaTextBetween(doc, selection.from, selection.to);
        const after = getVanillaTextBetween(doc, selection.to, paraEnd);
        return {
          paraId,
          selectedText,
          paragraphText: before + selectedText + after,
          before,
          after,
        };
      },

      getComments: () => comments,

      onContentChange: (listener) => {
        contentChangeSubscribersRef.current.add(listener);
        return () => {
          contentChangeSubscribersRef.current.delete(listener);
        };
      },

      onSelectionChange: (listener) => {
        selectionChangeSubscribersRef.current.add(listener);
        return () => {
          selectionChangeSubscribersRef.current.delete(listener);
        };
      },
    }),
    [
      history.state,
      state.zoom,
      scrollPageInfo,
      handleSave,
      handleDirectPrint,
      loadParsedDocument,
      loadBuffer,
      comments,
    ]
  );

  const initialSectionProperties = useMemo(
    () => getInitialSectionProperties(history.state),
    [history.state]
  );
  const finalSectionProperties = history.state?.package.document?.finalSectionProperties;

  // Get header and footer content from document
  const { headerContent, footerContent, firstPageHeaderContent, firstPageFooterContent } =
    useMemo(() => {
      const { header, footer, firstHeader, firstFooter } = resolveHeaderFooter(
        history.state ?? null,
        finalSectionProperties ?? initialSectionProperties
      );
      return {
        headerContent: header,
        footerContent: footer,
        firstPageHeaderContent: firstHeader,
        firstPageFooterContent: firstFooter,
      };
    }, [history.state, initialSectionProperties, finalSectionProperties]);

  // Handle header/footer double-click — open editing overlay
  // If no header/footer exists, create an empty one so the user can add content
  const handleHeaderFooterDoubleClick = useCallback(
    (position: 'header' | 'footer', pageNumber?: number) => {
      const sectProps = history.state?.package?.document?.finalSectionProperties;
      const isFirstPage = sectProps?.titlePg === true && (pageNumber ?? 1) === 1;
      const hf = isFirstPage
        ? position === 'header'
          ? firstPageHeaderContent
          : firstPageFooterContent
        : position === 'header'
          ? headerContent
          : footerContent;
      setHfEditIsFirstPage(isFirstPage);
      if (hf) {
        setHfEditPosition(position);
        return;
      }

      // Create empty header/footer for docs that don't have one yet
      if (!history.state?.package) return;
      const pkg = history.state.package;
      const sectionProps = pkg.document?.finalSectionProperties;
      if (!sectionProps) return;

      const hdrFtrType = isFirstPage ? 'first' : 'default';
      const rId = `rId_new_${position}_${hdrFtrType}`;
      const emptyHf: HeaderFooter = {
        type: position === 'header' ? 'header' : 'footer',
        hdrFtrType,
        content: [{ type: 'paragraph', content: [] }],
      };

      const mapKey = position === 'header' ? 'headers' : 'footers';
      const newMap = new Map(pkg[mapKey] ?? []);
      newMap.set(rId, emptyHf);

      const refKey = position === 'header' ? 'headerReferences' : 'footerReferences';
      const existingRefs = sectionProps[refKey] ?? [];
      const newRef = { type: hdrFtrType as 'default' | 'first', rId };

      // Register the rel so the serializer wires up content types + doc rels (#274).
      const existingRels = pkg.relationships;
      const usedTargets = new Set<string>();
      for (const rel of existingRels?.values() ?? []) {
        if (rel.target) usedTargets.add(rel.target);
      }
      let targetNum = 1;
      while (usedTargets.has(`${position}${targetNum}.xml`)) targetNum++;
      const relType =
        position === 'header'
          ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
          : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
      const newRelationships = new Map(existingRels);
      newRelationships.set(rId, {
        id: rId,
        type: relType,
        target: `${position}${targetNum}.xml`,
      });

      const newDoc: Document = {
        ...history.state,
        package: {
          ...pkg,
          [mapKey]: newMap,
          relationships: newRelationships,
          document: pkg.document
            ? {
                ...pkg.document,
                finalSectionProperties: {
                  ...sectionProps,
                  [refKey]: [...existingRefs, newRef],
                },
              }
            : pkg.document,
        },
      };
      pushDocument(newDoc);
      setHfEditPosition(position);
    },
    [
      headerContent,
      footerContent,
      firstPageHeaderContent,
      firstPageFooterContent,
      history,
      pushDocument,
    ]
  );

  // Handle header/footer save — update document package with edited content
  const handleHeaderFooterSave = useCallback(
    (
      content: (
        | import('@eigenpal/docx-editor-core/types/document').Paragraph
        | import('@eigenpal/docx-editor-core/types/document').Table
      )[]
    ) => {
      if (!hfEditPosition || !history.state?.package) {
        setHfEditPosition(null);
        return;
      }

      const pkg = history.state.package;
      const sectionProps = pkg.document?.finalSectionProperties;
      const refs =
        hfEditPosition === 'header'
          ? sectionProps?.headerReferences
          : sectionProps?.footerReferences;
      const targetType = hfEditIsFirstPage ? 'first' : 'default';
      const activeRef =
        refs?.find((r) => r.type === targetType) ??
        refs?.find((r) => r.type === 'default') ??
        refs?.find((r) => r.type === 'first') ??
        refs?.[0];
      const mapKey = hfEditPosition === 'header' ? 'headers' : 'footers';
      const map = pkg[mapKey];

      if (activeRef?.rId && map) {
        const existing = map.get(activeRef.rId);
        const updated: HeaderFooter = {
          type: hfEditPosition,
          hdrFtrType: activeRef.type as 'default' | 'first' | 'even',
          ...existing,
          content,
        };
        const newMap = new Map(map);
        newMap.set(activeRef.rId, updated);

        const newDoc: Document = {
          ...history.state,
          package: {
            ...pkg,
            [mapKey]: newMap,
          },
        };
        pushDocument(newDoc);
      }

      setHfEditPosition(null);
    },
    [hfEditPosition, history, pushDocument]
  );

  // Handle body click while in HF editing mode — save + close
  const handleBodyClick = useCallback(() => {
    if (!hfEditPosition) return;
    // Save if dirty, then close
    const view = hfEditorRef.current?.getView();
    if (view) {
      const blocks = proseDocToBlocks(view.state.doc);
      handleHeaderFooterSave(blocks);
    } else {
      setHfEditPosition(null);
    }
  }, [hfEditPosition, handleHeaderFooterSave]);

  // Handle removing the header/footer entirely
  const handleRemoveHeaderFooter = useCallback(() => {
    if (!hfEditPosition || !history.state?.package) {
      setHfEditPosition(null);
      return;
    }

    const pkg = history.state.package;
    const sectionProps = pkg.document?.finalSectionProperties;
    const refKey = hfEditPosition === 'header' ? 'headerReferences' : 'footerReferences';
    const mapKey = hfEditPosition === 'header' ? 'headers' : 'footers';
    const refs = sectionProps?.[refKey];
    const delTargetType = hfEditIsFirstPage ? 'first' : 'default';
    const activeRef =
      refs?.find((r) => r.type === delTargetType) ??
      refs?.find((r) => r.type === 'default') ??
      refs?.find((r) => r.type === 'first') ??
      refs?.[0];

    if (activeRef?.rId) {
      const newMap = new Map(pkg[mapKey] ?? []);
      newMap.delete(activeRef.rId);

      const newRefs = (refs ?? []).filter((r) => r.rId !== activeRef.rId);

      const newDoc: Document = {
        ...history.state,
        package: {
          ...pkg,
          [mapKey]: newMap,
          document: pkg.document
            ? {
                ...pkg.document,
                finalSectionProperties: {
                  ...sectionProps,
                  [refKey]: newRefs,
                },
              }
            : pkg.document,
        },
      };
      pushDocument(newDoc);
    }

    setHfEditPosition(null);
  }, [hfEditPosition, history, pushDocument]);

  // Get the DOM element for the header/footer area on the first page
  const getHfTargetElement = useCallback((pos: 'header' | 'footer'): HTMLElement | null => {
    const pagesContainer = containerRef.current?.querySelector('.paged-editor__pages');
    if (!pagesContainer) return null;
    const className = pos === 'header' ? '.layout-page-header' : '.layout-page-footer';
    return pagesContainer.querySelector(className);
  }, []);

  // Container styles - using overflow: auto so sticky toolbar works
  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    backgroundColor: 'var(--doc-bg)',
    ...style,
  };

  const mainContentStyle: CSSProperties = {
    display: 'flex',
    flex: 1,
    minHeight: 0, // Allow flex item to shrink below content size
    minWidth: 0, // Allow flex item to shrink below content width on narrow viewports
    flexDirection: 'row',
  };

  // --- Unified sidebar items ---
  const commentCallbacksRef = useRef<CommentCallbacks>({});
  commentCallbacksRef.current = {
    onCommentReply: (id, text) => {
      const reply = createComment(text, author, id);
      const parent = comments.find((c) => c.id === id);
      setComments((prev) => [...prev, reply]);
      if (parent) onCommentReply?.(reply, parent);
    },
    onCommentResolve: (id) => {
      const target = comments.find((c) => c.id === id);
      setComments((prev) => prev.map((c) => (c.id === id ? { ...c, done: true } : c)));
      // Collapse the card to its checkmark marker immediately. Resolving
      // doesn't go through a PM transaction, so the cursor-based collapse
      // path wouldn't fire; do it explicitly. Cascades into the highlight
      // hide via resolvedIdsForRender.
      if (expandedSidebarItem === `comment-${id}`) {
        setExpandedSidebarItem(null);
      }
      if (target) onCommentResolve?.({ ...target, done: true });
    },
    onCommentUnresolve: (id) => {
      setComments((prev) => prev.map((c) => (c.id === id ? { ...c, done: undefined } : c)));
    },
    onCommentDelete: (id) => {
      const target = comments.find((c) => c.id === id);
      setComments((prev) => prev.filter((c) => c.id !== id && c.parentId !== id));
      // Remove the comment mark from PM to clear the yellow highlight
      const view = pagedEditorRef.current?.getView();
      if (view) {
        const mark = view.state.schema.marks.comment?.create({ commentId: id });
        if (mark) {
          const tr = view.state.tr.removeMark(0, view.state.doc.content.size, mark);
          if (tr.docChanged) view.dispatch(tr);
        }
      }
      if (target) onCommentDelete?.(target);
    },
    onAddComment: (addText) => {
      const comment = createComment(addText, author);
      const view = pagedEditorRef.current?.getView();
      if (view && commentSelectionRange) {
        const { from, to } = commentSelectionRange;
        const pendingMark = view.state.schema.marks.comment.create({
          commentId: PENDING_COMMENT_ID,
        });
        const realMark = view.state.schema.marks.comment.create({
          commentId: comment.id,
        });
        const tr = view.state.tr.removeMark(from, to, pendingMark).addMark(from, to, realMark);
        view.dispatch(tr);
      }
      setComments((prev) => [...prev, comment]);
      setIsAddingComment(false);
      setCommentSelectionRange(null);
      setAddCommentYPosition(null);
      onCommentAdd?.(comment);
    },
    onCancelAddComment: () => {
      const view = pagedEditorRef.current?.getView();
      if (view && commentSelectionRange) {
        const { from, to } = commentSelectionRange;
        const pendingMark = view.state.schema.marks.comment.create({
          commentId: PENDING_COMMENT_ID,
        });
        view.dispatch(view.state.tr.removeMark(from, to, pendingMark));
      }
      setIsAddingComment(false);
      setCommentSelectionRange(null);
      setAddCommentYPosition(null);
    },
    onAcceptChange: (from, to) => {
      const view = pagedEditorRef.current?.getView();
      if (view) acceptChange(from, to)(view.state, view.dispatch);
      // No explicit re-extract: the dispatch fires `handleDocumentChange`,
      // which mirrors the new PM state into `pmState` and `useTrackedChanges`
      // re-derives.
    },
    onRejectChange: (from, to) => {
      const view = pagedEditorRef.current?.getView();
      if (view) rejectChange(from, to)(view.state, view.dispatch);
    },
    onTrackedChangeReply: (revisionId, text) => {
      setComments((prev) => [...prev, createComment(text, author, revisionId)]);
    },
  };

  // Stable callbacks wrapper that delegates to ref (avoids recreating items on every render)
  const stableCallbacks = useMemo<CommentCallbacks>(
    () => ({
      onCommentReply: (...args) => commentCallbacksRef.current.onCommentReply?.(...args),
      onCommentResolve: (...args) => commentCallbacksRef.current.onCommentResolve?.(...args),
      onCommentUnresolve: (...args) => commentCallbacksRef.current.onCommentUnresolve?.(...args),
      onCommentDelete: (...args) => commentCallbacksRef.current.onCommentDelete?.(...args),
      onAddComment: (...args) => commentCallbacksRef.current.onAddComment?.(...args),
      onCancelAddComment: (...args) => commentCallbacksRef.current.onCancelAddComment?.(...args),
      onAcceptChange: (...args) => commentCallbacksRef.current.onAcceptChange?.(...args),
      onRejectChange: (...args) => commentCallbacksRef.current.onRejectChange?.(...args),
      onTrackedChangeReply: (...args) =>
        commentCallbacksRef.current.onTrackedChangeReply?.(...args),
    }),
    []
  );

  const commentSidebarItems = useCommentSidebarItems({
    comments,
    trackedChanges,
    callbacks: stableCallbacks,
    showResolved: showCommentsSidebar,
    isAddingComment: showCommentsSidebar ? isAddingComment : false,
    addCommentYPosition,
  });

  const allSidebarItems = useMemo(() => {
    const items: ReactSidebarItem[] = [];
    if (showCommentsSidebar) items.push(...commentSidebarItems);
    if (pluginSidebarItems) items.push(...pluginSidebarItems);
    return items;
  }, [showCommentsSidebar, commentSidebarItems, pluginSidebarItems]);

  // Build a map from insertion revisionIds to sidebar item IDs for replacement tracked changes.
  // This allows clicking the insertion part of a replacement to activate the same sidebar card.
  const revisionIdAliases = useMemo(() => {
    const map = new Map<string, string>();
    trackedChanges.forEach((change, idx) => {
      if (change.type === 'replacement' && change.insertionRevisionId != null) {
        map.set(String(change.insertionRevisionId), `tc-${change.revisionId}-${idx}`);
      }
    });
    return map;
  }, [trackedChanges]);

  const sidebarOpen = allSidebarItems.length > 0;
  // Reserve 2× the left-edge allowance so the centered page clears whatever
  // outline UI is showing, without forcing a shift on wide viewports.
  const outlineLeftAllowance = showOutline
    ? OUTLINE_RESERVED_SPACE
    : showOutlineButton
      ? OUTLINE_BUTTON_RESERVED_SPACE
      : 20;
  const minLayoutWidth =
    2 * outlineLeftAllowance + DEFAULT_PAGE_WIDTH + (sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0);

  const sectionPropsPageWidth = history.state?.package?.document?.finalSectionProperties?.pageWidth;
  const pageWidthPx = sectionPropsPageWidth
    ? Math.round(sectionPropsPageWidth / 15)
    : DEFAULT_PAGE_WIDTH;

  const resolvedCommentIds = useMemo(() => {
    const ids = new Set<number>();
    for (const c of comments) {
      if (c.done && c.parentId == null) ids.add(c.id);
    }
    return ids;
  }, [comments]);

  // Exclude expanded resolved comment from hide-set so its text gets highlighted
  const resolvedIdsForRender = useMemo(() => {
    if (!expandedSidebarItem?.startsWith('comment-')) return resolvedCommentIds;
    const expandedId = parseInt(expandedSidebarItem.slice(8), 10);
    if (isNaN(expandedId) || !resolvedCommentIds.has(expandedId)) return resolvedCommentIds;
    const ids = new Set(resolvedCommentIds);
    ids.delete(expandedId);
    return ids;
  }, [resolvedCommentIds, expandedSidebarItem]);

  const editorContainerStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    minWidth: 0, // Allow flex item to shrink below content width on narrow viewports
    overflow: 'auto', // Sole scroll container — PagedEditor sizes to content
    position: 'relative',
    overflowAnchor: 'none',
  };

  // Render loading state
  if (state.isLoading) {
    return (
      <div
        className={`ep-root docx-editor docx-editor-loading ${className}`}
        style={containerStyle}
        data-testid="docx-editor"
      >
        {loadingIndicator || <DefaultLoadingIndicator />}
      </div>
    );
  }

  // Render error state
  if (state.parseError) {
    return (
      <div
        className={`ep-root docx-editor docx-editor-error ${className}`}
        style={containerStyle}
        data-testid="docx-editor"
      >
        <ParseError message={state.parseError} />
      </div>
    );
  }

  // Render placeholder when no document
  if (!history.state) {
    return (
      <div
        className={`ep-root docx-editor docx-editor-empty ${className}`}
        style={containerStyle}
        data-testid="docx-editor"
      >
        {placeholder || <DefaultPlaceholder />}
      </div>
    );
  }

  const toolbarChildren = (
    <>
      <ToolbarSeparator />
      <CommentsSidebarToggle
        active={showCommentsSidebar}
        onClick={() => {
          // Also reset expansion so reshowing the sidebar lands on the default
          // collapsed state — resolved threads stay as checkmarks, not opened.
          setShowCommentsSidebar((v) => !v);
          setExpandedSidebarItem(null);
        }}
      />
      {/* Resolved comments use margin markers instead of toolbar toggle */}
      <ToolbarSeparator />
      <EditingModeDropdown
        mode={editingMode}
        onModeChange={(mode) => {
          setEditingMode(mode);
          if (mode === 'suggesting') setShowCommentsSidebar(true);
        }}
      />
      {agentPanel && agentPanel.showToolbarButton !== false && (
        <>
          <ToolbarSeparator />
          <AgentPanelToggle
            active={agentPanelOpen}
            badge={agentPanel.toolbarBadge}
            onClick={() => setAgentPanelOpen(!agentPanelOpen)}
          />
        </>
      )}
      {toolbarExtra}
    </>
  );

  return (
    <LocaleProvider i18n={i18n}>
      <ErrorProvider>
        <ErrorBoundary onError={handleEditorError}>
          <div
            ref={containerRef}
            className={`ep-root docx-editor ${className}`}
            style={containerStyle}
            data-testid="docx-editor"
          >
            {/* Main content area */}
            <div style={mainContentStyle}>
              {/* Wrapper for toolbar + scroll container + outline overlay */}
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Toolbar - above the scroll container so scrollbar doesn't extend behind it */}
                {/* Hide toolbar only when readOnly prop is explicitly set (not from viewing mode) */}
                {showToolbar && !readOnlyProp && (
                  <div ref={toolbarRefCallback} className="z-50 flex flex-col gap-0 flex-shrink-0">
                    <EditorToolbar
                      // When the agent panel is open, round the toolbar's
                      // bottom-right corner so it mirrors the panel's top-left.
                      // The radius transition (inline style on the inner div)
                      // makes opening / closing ease instead of snap.
                      className={agentPanelOpen ? 'rounded-br-2xl' : undefined}
                      style={{
                        transition: 'border-radius 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                      currentFormatting={state.selectionFormatting}
                      onFormat={handleFormat}
                      onUndo={undoActiveEditor}
                      onRedo={redoActiveEditor}
                      canUndo={pmState ? undoDepth(pmState) > 0 : false}
                      canRedo={pmState ? redoDepth(pmState) > 0 : false}
                      disabled={readOnly}
                      documentStyles={history.state?.package.styles?.styles}
                      theme={history.state?.package.theme || theme}
                      fontFamilies={fontFamilies}
                      onPrint={handleDirectPrint}
                      onOpen={handleOpenDocument}
                      onSave={handleDownloadDocument}
                      showZoomControl={showZoomControl}
                      zoom={state.zoom}
                      onZoomChange={handleZoomChange}
                      onRefocusEditor={focusActiveEditor}
                      onInsertTable={handleInsertTable}
                      showTableInsert={true}
                      onInsertImage={handleInsertImageClick}
                      onInsertPageBreak={handleInsertPageBreak}
                      onInsertTOC={handleInsertTOC}
                      imageContext={state.pmImageContext}
                      onImageWrapType={handleImageWrapType}
                      onImageTransform={handleImageTransform}
                      onOpenImageProperties={handleOpenImageProperties}
                      onPageSetup={handleOpenPageSetup}
                      tableContext={state.pmTableContext}
                      onTableAction={handleTableAction}
                    >
                      <EditorToolbar.TitleBar>
                        {renderLogo && <EditorToolbar.Logo>{renderLogo()}</EditorToolbar.Logo>}
                        {documentName !== undefined && (
                          <EditorToolbar.DocumentName
                            value={documentName}
                            onChange={onDocumentNameChange}
                            editable={documentNameEditable}
                          />
                        )}
                        {renderTitleBarRight && (
                          <EditorToolbar.TitleBarRight>
                            {renderTitleBarRight()}
                          </EditorToolbar.TitleBarRight>
                        )}
                        <EditorToolbar.MenuBar />
                      </EditorToolbar.TitleBar>
                      <EditorToolbar.Toolbar>{toolbarChildren}</EditorToolbar.Toolbar>
                    </EditorToolbar>
                  </div>
                )}

                {/* Editor container - this is the scroll container (toolbar is above, not inside) */}
                <div
                  ref={scrollContainerRef}
                  style={editorContainerStyle}
                  onMouseDown={(e) => {
                    // Click in the grey gutter around the page → collapse any
                    // expanded sidebar card. Clicks on the doc body already
                    // collapse via the cursor-mark detector; clicks inside the
                    // sidebar are user interactions with the card itself.
                    const target = e.target as HTMLElement;
                    if (
                      target.closest('.paged-editor__pages') ||
                      target.closest('.docx-unified-sidebar') ||
                      target.closest('.docx-comment-margin-markers')
                    ) {
                      return;
                    }
                    setExpandedSidebarItem(null);
                  }}
                >
                  {/* Horizontal Ruler - inside the scroll container so it
                      scrolls horizontally with the doc, sticky-top so it stays
                      visible during vertical scroll. min-width keeps the ruler
                      and the page area on the same horizontal axis when the
                      viewport is too narrow to fit page + outline + sidebar. */}
                  {showRuler && (
                    <div
                      className="flex justify-center py-1 flex-shrink-0 bg-doc-bg"
                      style={{
                        position: 'sticky',
                        top: 0,
                        // Must sit above the inline header/footer editor
                        // (Z_INDEX.hfInlineEditor) so the ruler stays readable
                        // when the HF editor is active near the viewport top.
                        zIndex: Z_INDEX.ruler,
                        // paddingRight biases the centered ruler so it tracks
                        // the page when the comments sidebar (translateX)
                        // shifts the page left. Outline doesn't bias here —
                        // the page stays centered until minLayoutWidth forces
                        // horizontal scroll, and the ruler centers with it.
                        paddingLeft: 20,
                        paddingRight: 20 + (sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0),
                        minWidth: minLayoutWidth,
                        transition: 'padding 0.2s ease',
                      }}
                    >
                      <HorizontalRuler
                        sectionProps={history.state?.package.document?.finalSectionProperties}
                        zoom={state.zoom}
                        unit={rulerUnit}
                        editable={!readOnly}
                        onLeftMarginChange={handleLeftMarginChange}
                        onRightMarginChange={handleRightMarginChange}
                        indentLeft={state.paragraphIndentLeft}
                        indentRight={state.paragraphIndentRight}
                        onIndentLeftChange={handleIndentLeftChange}
                        onIndentRightChange={handleIndentRightChange}
                        showFirstLineIndent={true}
                        firstLineIndent={state.paragraphFirstLineIndent}
                        hangingIndent={state.paragraphHangingIndent}
                        onFirstLineIndentChange={handleFirstLineIndentChange}
                        tabMarks={state.paragraphTabs}
                        onTabMarkRemove={handleTabMarkRemove}
                      />
                    </div>
                  )}
                  {/* Editor content wrapper. min-width matches the ruler so
                      the page and ruler scroll horizontally as a single unit
                      when the viewport is too narrow to fit them. When the
                      outline is open, min-width grows to keep the centered
                      page clear of the panel — but on wide viewports the
                      page stays put (centered, or translated left by the
                      comments sidebar) instead of shifting. */}
                  <div
                    style={{
                      display: 'flex',
                      flex: 1,
                      minHeight: 0,
                      position: 'relative',
                      minWidth: minLayoutWidth,
                    }}
                  >
                    {/* Editor content area */}
                    <div
                      ref={editorContentRef}
                      style={{
                        position: 'relative',
                        flex: 1,
                        minWidth: 0,
                      }}
                      onMouseDown={(e) => {
                        // Focus editor when clicking on the background area (not the editor itself)
                        // Using mouseDown for immediate response before focus can be lost
                        if (e.target === e.currentTarget) {
                          e.preventDefault();
                          pagedEditorRef.current?.focus();
                        }
                      }}
                      onContextMenu={handleEditorContextMenu}
                    >
                      {/* Vertical Ruler - sits at the editor content's left
                          edge so it scrolls horizontally with the page instead
                          of pinning to the viewport (which would lay over the
                          doc when the user scrolls right). */}
                      {showRuler && !readOnlyProp && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            // Above the inline HF editor (Z_INDEX.hfInlineEditor)
                            // so it stays readable on horizontal scroll.
                            zIndex: Z_INDEX.ruler,
                            // Must match `.paged-editor__pages` padding-top in
                            // editor.css (24 viewport + 24 pages container);
                            // update both together or the ruler misaligns.
                            paddingTop: 48,
                          }}
                        >
                          <VerticalRuler
                            sectionProps={initialSectionProperties}
                            zoom={state.zoom}
                            unit={rulerUnit}
                            editable={!readOnly}
                            onTopMarginChange={handleTopMarginChange}
                            onBottomMarginChange={handleBottomMarginChange}
                          />
                        </div>
                      )}
                      {/* Brighten highlight for the focused/expanded sidebar item */}
                      {expandedSidebarItem && expandedSidebarItem.startsWith('comment-') && (
                        <style>{`.paged-editor__pages [data-comment-id="${expandedSidebarItem.replace('comment-', '')}"] { background-color: rgba(255, 212, 0, 0.35) !important; border-bottom: 2px solid rgba(255, 212, 0, 0.7) !important; }`}</style>
                      )}
                      {expandedSidebarItem?.startsWith('tc-') &&
                        (() => {
                          const revId = expandedSidebarItem.split('-')[1];
                          const tc = trackedChanges.find((c) => String(c.revisionId) === revId);
                          const insRevId = tc?.insertionRevisionId;
                          return (
                            <style>{`
                            .paged-editor__pages .docx-insertion[data-revision-id="${insRevId ?? revId}"] { background-color: rgba(52, 168, 83, 0.2) !important; border-bottom: 2px solid #2e7d32 !important; }
                            .paged-editor__pages .docx-deletion[data-revision-id="${revId}"] { background-color: rgba(211, 47, 47, 0.2) !important; text-decoration-thickness: 2px !important; }
                          `}</style>
                          );
                        })()}
                      <PagedEditor
                        ref={pagedEditorRef}
                        document={history.state}
                        styles={history.state?.package.styles}
                        theme={history.state?.package.theme || theme}
                        sectionProperties={initialSectionProperties}
                        finalSectionProperties={finalSectionProperties}
                        headerContent={headerContent}
                        footerContent={footerContent}
                        firstPageHeaderContent={firstPageHeaderContent}
                        firstPageFooterContent={firstPageFooterContent}
                        onHeaderFooterDoubleClick={handleHeaderFooterDoubleClick}
                        hfEditMode={hfEditPosition}
                        onBodyClick={handleBodyClick}
                        zoom={state.zoom}
                        readOnly={readOnly}
                        extensionManager={extensionManager}
                        onDocumentChange={handleDocumentChange}
                        onSelectionChange={(_from, _to) => {
                          // Extract full selection state from PM and use the standard handler
                          const view = pagedEditorRef.current?.getView();
                          if (view) {
                            const selectionState = extractSelectionState(view.state);
                            handleSelectionChange(selectionState);

                            // Detect comment/tracked-change marks at cursor to open sidebar card.
                            // Collect marks from all sources — inclusive:false marks aren't
                            // reported by $from.marks() at boundaries, and empty arrays are
                            // truthy so an OR chain would short-circuit.
                            const $from = view.state.selection.$from;
                            const marks = [
                              ...(view.state.storedMarks ?? []),
                              ...($from.nodeAfter?.marks ?? []),
                              ...($from.nodeBefore?.marks ?? []),
                              ...$from.marks(),
                            ];
                            let cursorSidebarItem: string | null = null;
                            for (const mark of marks) {
                              if (mark.type.name === 'comment' && mark.attrs.commentId != null) {
                                // Skip resolved comments — they stay collapsed as a checkmark
                                // marker unless the user explicitly clicks it. Otherwise the
                                // sidebar fills up with old threads every time the cursor
                                // passes through commented text.
                                const commentId = mark.attrs.commentId as number;
                                if (resolvedCommentIds.has(commentId)) continue;
                                cursorSidebarItem = `comment-${commentId}`;
                                break;
                              }
                              if (
                                (mark.type.name === 'insertion' || mark.type.name === 'deletion') &&
                                mark.attrs.revisionId != null
                              ) {
                                const revId = String(mark.attrs.revisionId);
                                const prefix = `tc-${revId}-`;
                                let match = commentSidebarItems.find((i) =>
                                  i.id.startsWith(prefix)
                                );
                                // Insertion side of a replacement has a different revisionId;
                                // check alias map to find the correct sidebar card.
                                if (!match && revisionIdAliases) {
                                  const aliasedId = revisionIdAliases.get(revId);
                                  if (aliasedId) {
                                    match = commentSidebarItems.find((i) => i.id === aliasedId);
                                  }
                                }
                                if (match) {
                                  cursorSidebarItem = match.id;
                                  break;
                                }
                              }
                            }
                            if (cursorSidebarItem) {
                              setShowCommentsSidebar(true);
                            }
                            setExpandedSidebarItem(cursorSidebarItem);
                          } else {
                            handleSelectionChange(null);
                          }
                        }}
                        externalPlugins={allExternalPlugins}
                        onReady={(ref) => {
                          const view = ref.getView();
                          if (view) setPmState(view.state);
                          if (view) onEditorViewReady?.(view);
                        }}
                        onRenderedDomContextReady={onRenderedDomContextReady}
                        pluginOverlays={pluginOverlays}
                        onHyperlinkClick={handleHyperlinkClick}
                        onContextMenu={handleContextMenu}
                        commentsSidebarOpen={sidebarOpen}
                        onAnchorPositionsChange={setAnchorPositions}
                        onTotalPagesChange={(totalPages) => {
                          setScrollPageInfo((prev) =>
                            prev.totalPages === totalPages ? prev : { ...prev, totalPages }
                          );
                        }}
                        resolvedCommentIds={resolvedIdsForRender}
                        scrollContainerRef={scrollContainerRef}
                        sidebarOverlay={
                          <>
                            {allSidebarItems.length > 0 && (
                              <UnifiedSidebar
                                items={allSidebarItems}
                                anchorPositions={anchorPositions}
                                renderedDomContext={pluginRenderedDomContext ?? null}
                                pageWidth={pageWidthPx}
                                zoom={state.zoom}
                                editorContainerRef={scrollContainerRef}
                                onExpandedItemChange={setExpandedSidebarItem}
                                activeItemId={expandedSidebarItem}
                              />
                            )}
                            <CommentMarginMarkers
                              comments={comments}
                              anchorPositions={anchorPositions}
                              zoom={state.zoom}
                              pageWidth={pageWidthPx}
                              sidebarOpen={sidebarOpen}
                              resolvedCommentIds={resolvedCommentIds}
                              onMarkerClick={() => {
                                setShowCommentsSidebar(true);
                              }}
                            />
                          </>
                        }
                      />

                      {/* Floating "add comment" button — appears on right edge of page at selection */}
                      {floatingCommentBtn != null && !isAddingComment && !readOnly && (
                        <Tooltip content="Add comment" side="bottom" delayMs={300}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const view = pagedEditorRef.current?.getView();
                              if (view) {
                                const { from, to } = view.state.selection;
                                if (from !== to) {
                                  setCommentSelectionRange({ from, to });
                                  const pendingMark = view.state.schema.marks.comment.create({
                                    commentId: PENDING_COMMENT_ID,
                                  });
                                  const tr = view.state.tr.addMark(from, to, pendingMark);
                                  tr.setSelection(TextSelection.create(tr.doc, to));
                                  view.dispatch(tr);
                                }
                              }
                              setAddCommentYPosition(floatingCommentBtn.top);
                              setShowCommentsSidebar(true);
                              setIsAddingComment(true);
                              setFloatingCommentBtn(null);
                            }}
                            style={{
                              position: 'absolute',
                              top: floatingCommentBtn.top,
                              left: floatingCommentBtn.left,
                              transform: 'translate(-50%, -50%)',
                              zIndex: 50,
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              border: '1px solid rgba(26, 115, 232, 0.3)',
                              backgroundColor: '#fff',
                              color: '#1a73e8',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 1px 3px rgba(60,64,67,0.2)',
                              transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
                            }}
                            onMouseOver={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                                'rgba(26, 115, 232, 0.08)';
                              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                                '0 1px 4px rgba(26, 115, 232, 0.3)';
                            }}
                            onMouseOut={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fff';
                              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                                '0 1px 3px rgba(60,64,67,0.2)';
                            }}
                          >
                            <MaterialSymbol name="add_comment" size={16} />
                          </button>
                        </Tooltip>
                      )}

                      {/* Inline Header/Footer Editor — positioned over the target area */}
                      {hfEditPosition &&
                        (() => {
                          const activeHf = hfEditIsFirstPage
                            ? hfEditPosition === 'header'
                              ? firstPageHeaderContent
                              : firstPageFooterContent
                            : hfEditPosition === 'header'
                              ? headerContent
                              : footerContent;
                          if (!activeHf) return null;
                          const targetEl = getHfTargetElement(hfEditPosition);
                          const parentEl = editorContentRef.current;
                          if (!targetEl || !parentEl) return null;
                          return (
                            <InlineHeaderFooterEditor
                              ref={hfEditorRef}
                              headerFooter={activeHf}
                              position={hfEditPosition}
                              styles={history.state?.package.styles}
                              targetElement={targetEl}
                              parentElement={parentEl}
                              onSave={handleHeaderFooterSave}
                              onClose={() => setHfEditPosition(null)}
                              onSelectionChange={handleSelectionChange}
                              onRemove={handleRemoveHeaderFooter}
                            />
                          );
                        })()}
                    </div>
                  </div>
                  {/* end editor flex wrapper */}
                </div>
                {/* end scroll container */}

                {/* Floating page indicator next to the scrollbar */}
                {scrollPageInfo.totalPages > 1 && (
                  <PageIndicator
                    currentPage={scrollPageInfo.currentPage}
                    totalPages={scrollPageInfo.totalPages}
                    visible={scrollPageInfo.visible}
                  />
                )}

                {/* Document outline sidebar — absolutely positioned, doesn't scroll */}
                {showOutline && (
                  <DocumentOutline
                    headings={outlineHeadings}
                    onHeadingClick={handleHeadingInfoClick}
                    onClose={() => setShowOutline(false)}
                    topOffset={toolbarHeight}
                    scrollLeft={editorScrollLeft}
                  />
                )}

                {/* Unified sidebar (comments + plugin items) rendered inside PagedEditor via sidebarOverlay prop */}

                {/* Outline toggle button — absolutely positioned below toolbar */}
                {showOutlineButton && !showOutline && (
                  <OutlineToggleButton
                    onClick={handleToggleOutline}
                    // Aligns with the page top: toolbar + horizontal ruler row
                    // (22 ruler + 8 py-1 padding) + PagedEditor viewport
                    // padding-top (24) + pages container padding (24).
                    topPx={toolbarHeight + (showRuler ? 30 : 0) + 48}
                    scrollLeft={editorScrollLeft}
                  />
                )}
              </div>
              {/* end wrapper for scroll container + outline */}

              {/* Agent panel (right-side dock) — always mounted when the
                  prop is set so chat state survives close/reopen.
                  `closed={!agentPanelOpen}` triggers the slide / fade. */}
              {agentPanel && (
                <LocalizedAgentPanel
                  agentPanel={agentPanel}
                  closed={!agentPanelOpen}
                  onClose={() => setAgentPanelOpen(false)}
                />
              )}
            </div>

            {/* Hyperlink popup (Google Docs-style) */}
            <HyperlinkPopup
              data={hyperlinkPopupData}
              onNavigate={handleHyperlinkPopupNavigate}
              onCopy={handleHyperlinkPopupCopy}
              onEdit={handleHyperlinkPopupEdit}
              onRemove={handleHyperlinkPopupRemove}
              onClose={handleHyperlinkPopupClose}
              readOnly={readOnly}
            />

            {/* Right-click context menu */}
            <TextContextMenu
              isOpen={contextMenu.isOpen}
              position={contextMenu.position}
              hasSelection={contextMenu.hasSelection}
              isEditable={!readOnly}
              items={contextMenuItems}
              onAction={handleContextMenuAction}
              onClose={handleContextMenuClose}
            />

            {/* Image-specific right-click menu — layout options + text actions */}
            <ImageContextMenu
              isOpen={imageContextMenu.isOpen}
              position={imageContextMenu.position}
              currentWrapType={imageContextMenu.currentWrapType}
              currentCssFloat={imageContextMenu.currentCssFloat}
              onApplyLayout={handleImageWrapApply}
              textActions={imageContextMenuTextActions}
              onTextAction={handleContextMenuAction}
              onOpenProperties={handleOpenImageProperties}
              onClose={imageContextMenu.closeMenu}
            />

            {/* Toast notifications */}
            <Toaster position="bottom-right" />

            {/* Lazy-loaded dialogs — only fetched when first opened */}
            <Suspense fallback={null}>
              {findReplace.state.isOpen && (
                <FindReplaceDialog
                  isOpen={findReplace.state.isOpen}
                  onClose={findReplace.close}
                  onFind={handleFind}
                  onFindNext={handleFindNext}
                  onFindPrevious={handleFindPrevious}
                  onReplace={handleReplace}
                  onReplaceAll={handleReplaceAll}
                  initialSearchText={findReplace.state.searchText}
                  replaceMode={findReplace.state.replaceMode}
                  currentResult={findResultRef.current}
                />
              )}
              {hyperlinkDialog.state.isOpen && (
                <HyperlinkDialog
                  isOpen={hyperlinkDialog.state.isOpen}
                  onClose={hyperlinkDialog.close}
                  onSubmit={handleHyperlinkSubmit}
                  onRemove={hyperlinkDialog.state.isEditing ? handleHyperlinkRemove : undefined}
                  initialData={hyperlinkDialog.state.initialData}
                  selectedText={hyperlinkDialog.state.selectedText}
                  isEditing={hyperlinkDialog.state.isEditing}
                />
              )}
              {tablePropsOpen && (
                <TablePropertiesDialog
                  isOpen={tablePropsOpen}
                  onClose={() => setTablePropsOpen(false)}
                  onApply={(props) => {
                    const view = getActiveEditorView();
                    if (view) {
                      setTableProperties(props)(view.state, view.dispatch);
                    }
                  }}
                  currentProps={
                    state.pmTableContext?.table?.attrs as Record<string, unknown> | undefined
                  }
                />
              )}
              {splitCellDialogState.isOpen && (
                <SplitCellDialog
                  isOpen={splitCellDialogState.isOpen}
                  onClose={handleSplitCellDialogClose}
                  onApply={handleSplitCellDialogApply}
                  initialRows={splitCellDialogState.initialRows}
                  initialCols={splitCellDialogState.initialCols}
                  minRows={splitCellDialogState.minRows}
                  minCols={splitCellDialogState.minCols}
                />
              )}
              {imagePositionOpen && (
                <ImagePositionDialog
                  isOpen={imagePositionOpen}
                  onClose={() => setImagePositionOpen(false)}
                  onApply={handleApplyImagePosition}
                />
              )}
              {imagePropsOpen && (
                <ImagePropertiesDialog
                  isOpen={imagePropsOpen}
                  onClose={() => setImagePropsOpen(false)}
                  onApply={handleApplyImageProperties}
                  currentData={
                    state.pmImageContext
                      ? {
                          alt: state.pmImageContext.alt ?? undefined,
                          borderWidth: state.pmImageContext.borderWidth ?? undefined,
                          borderColor: state.pmImageContext.borderColor ?? undefined,
                          borderKind: state.pmImageContext.borderKind ?? undefined,
                          width: state.pmImageContext.width ?? undefined,
                          height: state.pmImageContext.height ?? undefined,
                        }
                      : undefined
                  }
                />
              )}
              {showPageSetup && (
                <PageSetupDialog
                  isOpen={showPageSetup}
                  onClose={() => setShowPageSetup(false)}
                  onApply={handlePageSetupApply}
                  currentProps={history.state?.package.document?.finalSectionProperties}
                />
              )}
              {footnotePropsOpen && (
                <FootnotePropertiesDialog
                  isOpen={footnotePropsOpen}
                  onClose={() => setFootnotePropsOpen(false)}
                  onApply={handleApplyFootnoteProperties}
                  footnotePr={history.state?.package.document?.finalSectionProperties?.footnotePr}
                  endnotePr={history.state?.package.document?.finalSectionProperties?.endnotePr}
                />
              )}
            </Suspense>
            {/* InlineHeaderFooterEditor is rendered inside the editor content area (position:relative div) */}
            {/* Hidden file input for image insertion */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageFileChange}
            />
            {/* Hidden file input for File → Open */}
            <input
              ref={docxInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }}
              onChange={handleDocxFileChange}
            />
          </div>
        </ErrorBoundary>
      </ErrorProvider>
    </LocaleProvider>
  );
});

// ============================================================================
// EXPORTS
// ============================================================================

export default DocxEditor;
