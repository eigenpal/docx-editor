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

import { useRef, useCallback, useState, useEffect, useMemo, forwardRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Document, Theme } from '@eigenpal/docx-editor-core/types/document';

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
import { useDocxEditorRefApi } from './DocxEditor/hooks/useDocxEditorRefApi';
import { useTableDialogs } from './DocxEditor/hooks/useTableDialogs';
import { useHeaderFooterEditing } from './DocxEditor/hooks/useHeaderFooterEditing';
import { useDocumentLoader } from './DocxEditor/hooks/useDocumentLoader';
import { useContextMenus } from './DocxEditor/hooks/useContextMenus';
import { useCommentManagement } from './DocxEditor/hooks/useCommentManagement';
import { useCommentLifecycle } from './DocxEditor/hooks/useCommentLifecycle';
import { useSelectionTracker } from './DocxEditor/hooks/useSelectionTracker';
import { useFloatingCommentBtn } from './DocxEditor/hooks/useFloatingCommentBtn';
import { useActiveEditor } from './DocxEditor/hooks/useActiveEditor';
import { useScrollPageInfo } from './DocxEditor/hooks/useScrollPageInfo';
import { DocxEditorOverlays } from './DocxEditor/DocxEditorOverlays';
import { DocxEditorDialogs } from './DocxEditor/DocxEditorDialogs';
import type { FontOption } from './ui/FontPicker';
import { EditorToolbar } from './EditorToolbar';
import { undoDepth, redoDepth } from 'prosemirror-history';
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
import { LocaleProvider } from '../i18n';
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

import { MaterialSymbol } from './ui/Icons';
import { Tooltip } from './ui/Tooltip';
import { DocumentAgent } from '@eigenpal/docx-editor-core/agent';
import { DefaultLoadingIndicator, DefaultPlaceholder, ParseError } from './DocxEditorHelpers';
import { type DocxInput } from '@eigenpal/docx-editor-core/utils';
import { onFontsLoaded } from '@eigenpal/docx-editor-core/utils';
import { useTableSelection } from '../hooks/useTableSelection';
import { useDocumentHistory } from '../hooks/useHistory';

// Extension system
import { createStarterKit } from '@eigenpal/docx-editor-core/prosemirror/extensions';
import { ExtensionManager } from '@eigenpal/docx-editor-core/prosemirror/extensions';
import {
  createSuggestionModePlugin,
  setSuggestionMode,
} from '@eigenpal/docx-editor-core/prosemirror/plugins';

// Conversion (for HF inline editor save)

// ProseMirror editor
import {
  type SelectionState,
  extractSelectionState,
  createStyleResolver,
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

import { getInitialSectionProperties } from './DocxEditor/internals/pmAnchors';
import {
  PENDING_COMMENT_ID,
  EMPTY_ANCHOR_POSITIONS,
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

  // Header/footer editing state (lifted into the parent so getActiveEditorView
  // can read hfEditPosition before useHeaderFooterEditing is called).
  const [hfEditPosition, setHfEditPosition] = useState<'header' | 'footer' | null>(null);
  const [hfEditIsFirstPage, setHfEditIsFirstPage] = useState(false);

  // Comments sidebar state
  const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
  const [expandedSidebarItem, setExpandedSidebarItem] = useState<string | null>(null);
  // PagedEditor ref declared early so useCommentManagement (which reads
  // pagedEditorRef.current.getView() for orphan cleanup) can be wired before
  // the trackedChanges effect that drives `setComments`.
  const pagedEditorRef = useRef<PagedEditorRef>(null);

  const {
    comments,
    setComments,
    isAddingComment,
    setIsAddingComment,
    isAddingCommentRef,
    commentSelectionRange,
    setCommentSelectionRange,
    addCommentYPosition,
    setAddCommentYPosition,
    floatingCommentBtn,
    setFloatingCommentBtn,
    cleanOrphanedCommentsTimerRef,
    cleanOrphanedComments,
  } = useCommentManagement({
    commentsProp,
    onCommentDelete,
    onCommentsChange,
    pagedEditorRef,
  });

  // Latest PM state — mirrored from the view on every doc-changing transaction.
  // Drives `useTrackedChanges` so the sidebar derives its list directly from PM
  // (the source of truth, including remote ySync updates) rather than a debounced
  // copy in React state.
  const [pmState, setPmState] = useState<PMEditorState | null>(null);
  const { entries: trackedChanges, commentToRevision } = useTrackedChanges(pmState);
  const [anchorPositions, setAnchorPositions] =
    useState<Map<string, number>>(EMPTY_ANCHOR_POSITIONS);
  // No separate state needed — pluginRenderedDomContext comes from PluginHost

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

  // Bridge / agent event subscribers — fan-out from the existing onChange and
  // onSelectionChange paths so multiple listeners (host app, MCP server, etc.)
  // can observe edits without competing for the single React prop.
  const contentChangeSubscribersRef = useRef(new Set<(doc: Document) => void>());
  const selectionChangeSubscribersRef = useRef(new Set<(s: SelectionState | null) => void>());

  // History hook for undo/redo - start with null document
  const history = useDocumentHistory<Document | null>(initialDocument || null, {
    maxEntries: 100,
    groupingInterval: 500,
    enableKeyboardShortcuts: true,
  });

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

  // Refs (pagedEditorRef is declared earlier — useCommentManagement needs it)
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

  const { getActiveEditorView, focusActiveEditor, undoActiveEditor, redoActiveEditor } =
    useActiveEditor({
      hfEditPosition,
      hfEditorRef,
      pagedEditorRef,
    });

  // Find/Replace hook
  const findReplace = useFindReplace();

  // Hyperlink dialog hook
  const hyperlinkDialog = useHyperlinkDialog();

  // Lifted out of useDocumentLoader / useCommentLifecycle so `resetForNewDocument`
  // (declared next) can clear both on every fresh load.
  const commentsLoadedRef = useRef(false);
  const trackedChangesLoadedRef = useRef(false);

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
    setHfEditIsFirstPage(false);
    setAnchorPositions(EMPTY_ANCHOR_POSITIONS);
    findReplace.setMatches([], 0);
    if (cleanOrphanedCommentsTimerRef.current) {
      clearTimeout(cleanOrphanedCommentsTimerRef.current);
      cleanOrphanedCommentsTimerRef.current = null;
    }
  }, [findReplace.setMatches, setComments]);

  const { loadParsedDocument, loadBuffer } = useDocumentLoader({
    documentBuffer,
    initialDocument,
    externalContent,
    history,
    agentRef,
    pagedEditorRef,
    setLoadingState: useCallback((s: { isLoading: boolean; parseError: string | null }) => {
      setState((prev) => ({ ...prev, isLoading: s.isLoading, parseError: s.parseError }));
    }, []),
    setComments,
    setShowCommentsSidebar,
    onError,
    resetForNewDocument,
    commentsLoadedRef,
  });

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
  useCommentLifecycle({
    commentToRevision,
    setComments,
    pmState,
    isLoading: state.isLoading,
    trackedChangesCount: trackedChanges.length,
    setShowCommentsSidebar,
    trackedChangesLoadedRef,
  });

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
  const { recomputeFloatingCommentBtn } = useFloatingCommentBtn({
    pagedEditorRef,
    scrollContainerRef,
    editorContentRef,
    isAddingCommentRef,
    setFloatingCommentBtn,
    readOnly,
    isLoading: state.isLoading,
    zoom: state.zoom,
  });

  // Handle selection changes from ProseMirror
  const { handleSelectionChange } = useSelectionTracker({
    getActiveEditorView,
    lastSelectionRef,
    borderSpecRef,
    theme,
    historyStateRef,
    getCachedStyleResolver,
    setFloatingCommentBtn,
    applySelectionDelta: useCallback((delta) => setState((prev) => ({ ...prev, ...delta })), []),
    recomputeFloatingCommentBtn,
    onSelectionChange,
    selectionChangeSubscribersRef,
  });

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

  const {
    tablePropsOpen,
    setTablePropsOpen,
    splitCellDialogState,
    openSplitCellDialog,
    handleTableAction,
    handleSplitCellDialogClose,
    handleSplitCellDialogApply,
  } = useTableDialogs({
    getActiveEditorView,
    focusActiveEditor,
    tableSelection,
    borderSpecRef,
    historyStateRef,
    getCachedStyleResolver,
  });

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

  const {
    contextMenu,
    imageContextMenu,
    handleEditorContextMenu,
    handleContextMenu,
    handleContextMenuClose,
    handleImageWrapApply,
    imageContextMenuTextActions,
    contextMenuItems,
    handleContextMenuAction,
  } = useContextMenus({
    getActiveEditorView,
    focusActiveEditor,
    openSplitCellDialog,
    scrollContainerRef,
    editorContentRef,
    i18n,
    onAddComment: useCallback(
      ({ from, to, yPos }: { from: number; to: number; yPos: number | null }) => {
        setCommentSelectionRange({ from, to });
        setAddCommentYPosition(yPos);
        setShowCommentsSidebar(true);
        setIsAddingComment(true);
        setFloatingCommentBtn(null);
      },
      []
    ),
  });

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

  const { scrollPageInfo, setScrollPageInfo } = useScrollPageInfo({
    scrollContainerRef,
    pagedEditorRef,
  });

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
  useDocxEditorRefApi({
    ref,
    agentRef,
    document: history.state,
    historyStateRef,
    pagedEditorRef,
    handleSave,
    handleDirectPrint,
    zoom: state.zoom,
    setZoom: (zoom: number) => setState((prev) => ({ ...prev, zoom })),
    scrollPageInfo,
    loadParsedDocument,
    loadBuffer,
    comments,
    setComments,
    setShowCommentsSidebar,
    contentChangeSubscribersRef,
    selectionChangeSubscribersRef,
    getCachedStyleResolver,
  });

  const initialSectionProperties = useMemo(
    () => getInitialSectionProperties(history.state),
    [history.state]
  );
  const finalSectionProperties = history.state?.package.document?.finalSectionProperties;

  const {
    headerContent,
    footerContent,
    firstPageHeaderContent,
    firstPageFooterContent,
    handleHeaderFooterDoubleClick,
    handleHeaderFooterSave,
    handleBodyClick,
    handleRemoveHeaderFooter,
    getHfTargetElement,
  } = useHeaderFooterEditing({
    document: history.state,
    pushDocument,
    hfEditorRef,
    containerRef,
    initialSectionProperties,
    finalSectionProperties,
    hfEditPosition,
    setHfEditPosition,
    hfEditIsFirstPage,
    setHfEditIsFirstPage,
  });

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

  // PagedEditor onSelectionChange — runs on every selection movement.
  // Extracts the full selection state for the host callback, then walks the
  // marks at the cursor to detect comment / tracked-change marks so the
  // matching sidebar card opens. Comment marks are reported by either
  // $from.marks() or by storedMarks/nodeBefore/nodeAfter at boundaries; the
  // four sources get unioned. Resolved comments stay collapsed unless the
  // user explicitly clicks them, so the sidebar doesn't fill with old
  // threads as the cursor sweeps through commented text.
  const handlePagedSelectionChange = useCallback(() => {
    const view = pagedEditorRef.current?.getView();
    if (!view) {
      handleSelectionChange(null);
      return;
    }
    const selectionState = extractSelectionState(view.state);
    handleSelectionChange(selectionState);

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
        let match = commentSidebarItems.find((i) => i.id.startsWith(prefix));
        // The insertion side of a replacement has a different revisionId;
        // check the alias map to find the correct sidebar card.
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
  }, [handleSelectionChange, resolvedCommentIds, commentSidebarItems, revisionIdAliases]);

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
                        onSelectionChange={handlePagedSelectionChange}
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

            <DocxEditorOverlays
              hyperlinkPopupData={hyperlinkPopupData}
              onHyperlinkPopupNavigate={handleHyperlinkPopupNavigate}
              onHyperlinkPopupCopy={handleHyperlinkPopupCopy}
              onHyperlinkPopupEdit={handleHyperlinkPopupEdit}
              onHyperlinkPopupRemove={handleHyperlinkPopupRemove}
              onHyperlinkPopupClose={handleHyperlinkPopupClose}
              contextMenu={contextMenu}
              contextMenuItems={contextMenuItems}
              onContextMenuAction={handleContextMenuAction}
              onContextMenuClose={handleContextMenuClose}
              imageContextMenu={imageContextMenu}
              onImageWrapApply={handleImageWrapApply}
              imageContextMenuTextActions={imageContextMenuTextActions}
              onOpenImageProperties={handleOpenImageProperties}
              readOnly={readOnly}
            />

            <DocxEditorDialogs
              findReplace={findReplace}
              findResultRef={findResultRef}
              onFind={handleFind}
              onFindNext={handleFindNext}
              onFindPrevious={handleFindPrevious}
              onReplace={handleReplace}
              onReplaceAll={handleReplaceAll}
              hyperlinkDialog={hyperlinkDialog}
              onHyperlinkSubmit={handleHyperlinkSubmit}
              onHyperlinkRemove={handleHyperlinkRemove}
              tablePropsOpen={tablePropsOpen}
              onTablePropsClose={() => setTablePropsOpen(false)}
              pmTableContext={state.pmTableContext}
              getActiveEditorView={getActiveEditorView}
              splitCellDialogState={splitCellDialogState}
              onSplitCellDialogClose={handleSplitCellDialogClose}
              onSplitCellDialogApply={handleSplitCellDialogApply}
              imagePositionOpen={imagePositionOpen}
              onImagePositionClose={() => setImagePositionOpen(false)}
              onApplyImagePosition={handleApplyImagePosition}
              imagePropsOpen={imagePropsOpen}
              onImagePropsClose={() => setImagePropsOpen(false)}
              onApplyImageProperties={handleApplyImageProperties}
              pmImageContext={state.pmImageContext}
              showPageSetup={showPageSetup}
              onPageSetupClose={() => setShowPageSetup(false)}
              onPageSetupApply={handlePageSetupApply}
              document={history.state}
              footnotePropsOpen={footnotePropsOpen}
              onFootnotePropsClose={() => setFootnotePropsOpen(false)}
              onApplyFootnoteProperties={handleApplyFootnoteProperties}
            />
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
