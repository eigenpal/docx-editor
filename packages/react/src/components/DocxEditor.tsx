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
import type {
  Document,
  Theme,
  HeaderFooter,
  SectionProperties,
} from '@eigenpal/docx-core/types/document';

import {
  ToolbarButton,
  ToolbarSeparator,
  type SelectionFormatting,
  type FormattingAction,
} from './Toolbar';
import { EditorToolbar } from './EditorToolbar';
import { pointsToHalfPoints } from './ui/FontSizePicker';
import { DocumentOutline } from './DocumentOutline';
import { SIDEBAR_DOCUMENT_SHIFT } from './sidebar/constants';
import { type TrackedChangeEntry } from './sidebar/cardUtils';
import { UnifiedSidebar } from './UnifiedSidebar';
import { CommentMarginMarkers } from './CommentMarginMarkers';
import { useCommentSidebarItems, type CommentCallbacks } from '../hooks/useCommentSidebarItems';
import type { ReactSidebarItem } from '../plugin-api/types';
import type { HeadingInfo } from '@eigenpal/docx-core/utils/headingCollector';
import type { Comment, BlockContent, ParagraphContent } from '@eigenpal/docx-core/types/content';
import { ErrorBoundary, ErrorProvider } from './ErrorBoundary';
import type { TableAction } from './ui/TableToolbar';
import { mapHexToHighlightName } from './toolbarUtils';
import { LocaleProvider } from '../i18n';
import type { PartialLocaleStrings } from '../i18n';
import { HorizontalRuler } from './ui/HorizontalRuler';
import { VerticalRuler } from './ui/VerticalRuler';
import { type PrintOptions } from './ui/PrintPreview';
// Dialog hooks and utilities (static imports — lightweight, no UI)
import {
  useFindReplace,
  findInDocument,
  scrollToMatch,
  type FindMatch,
  type FindOptions,
  type FindResult,
} from './dialogs/FindReplaceDialog';
import { useHyperlinkDialog, type HyperlinkData } from './dialogs/HyperlinkDialog';
import type { ImagePositionData } from './dialogs/ImagePositionDialog';
import type { ImagePropertiesData } from './dialogs/ImagePropertiesDialog';
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
import { HyperlinkPopup, type HyperlinkPopupData } from './ui/HyperlinkPopup';
import { Toaster, toast } from 'sonner';
import { getBuiltinTableStyle, type TableStylePreset } from './ui/TableStyleGallery';
import { DocumentAgent } from '@eigenpal/docx-core/agent/DocumentAgent';
import { DefaultLoadingIndicator, DefaultPlaceholder, ParseError } from './DocxEditorHelpers';
import { parseDocx } from '@eigenpal/docx-core/docx/parser';
import { type DocxInput } from '@eigenpal/docx-core/utils/docxInput';
import { onFontsLoaded, loadDocumentFonts } from '@eigenpal/docx-core/utils/fontLoader';
import { resolveColor } from '@eigenpal/docx-core/utils/colorResolver';
import { executeCommand } from '@eigenpal/docx-core/agent/executor';
import { useTableSelection } from '../hooks/useTableSelection';
import { useDocumentHistory } from '../hooks/useHistory';

// Extension system
import { createStarterKit } from '@eigenpal/docx-core/prosemirror/extensions/StarterKit';
import { ExtensionManager } from '@eigenpal/docx-core/prosemirror/extensions/ExtensionManager';
import {
  createSuggestionModePlugin,
  setSuggestionMode,
} from '@eigenpal/docx-core/prosemirror/plugins/suggestionMode';

// Conversion (for HF inline editor save)
import { proseDocToBlocks } from '@eigenpal/docx-core/prosemirror/conversion/fromProseDoc';

// ProseMirror editor
import {
  type SelectionState,
  TextSelection,
  extractSelectionState,
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrike,
  toggleSuperscript,
  toggleSubscript,
  setTextColor,
  clearTextColor,
  setHighlight,
  setFontSize,
  setFontFamily,
  setAlignment,
  setLineSpacing,
  toggleBulletList,
  toggleNumberedList,
  increaseIndent,
  decreaseIndent,
  setIndentLeft,
  setIndentRight,
  setIndentFirstLine,
  removeTabStop,
  increaseListLevel,
  decreaseListLevel,
  clearFormatting,
  applyStyle,
  createStyleResolver,
  // Hyperlink commands
  getHyperlinkAttrs,
  getSelectedText,
  setHyperlink,
  removeHyperlink,
  insertHyperlink,
  // Text direction commands
  setRtl,
  setLtr,
  // Page break command
  insertPageBreak,
  // Table of Contents command
  generateTOC,
  // Table commands
  isInTable,
  getTableContext,
  insertTable,
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
  splitCell as pmSplitCell,
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
} from '@eigenpal/docx-core/prosemirror';
import { acceptChange, rejectChange } from '@eigenpal/docx-core/prosemirror/commands/comments';
import { collectHeadings } from '@eigenpal/docx-core/utils/headingCollector';
import {
  getChangedParagraphIds,
  hasStructuralChanges,
  hasUntrackedChanges,
  clearTrackedChanges,
} from '@eigenpal/docx-core/prosemirror/extensions/features/ParagraphChangeTrackerExtension';

// Paginated editor
import { PagedEditor, type PagedEditorRef } from '../paged-editor/PagedEditor';

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
  /** Callback when a comment is added via the UI */
  onCommentAdd?: (comment: Comment) => void;
  /** Callback when a comment is resolved via the UI */
  onCommentResolve?: (comment: Comment) => void;
  /** Callback when a comment is deleted via the UI */
  onCommentDelete?: (comment: Comment) => void;
  /** Callback when a reply is added to a comment via the UI */
  onCommentReply?: (reply: Comment, parent: Comment) => void;
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
  /** Locale overrides for i18n. Deep-merged with English defaults. */
  locale?: PartialLocaleStrings;
  /** BCP 47 language tag (e.g., "pl", "de"). Used for plural rules in translations. */
  lang?: string;
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
  paragraphTabs: import('@eigenpal/docx-core/types/document').TabStop[] | null;
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
    borderStyle: string | null;
  } | null;
}

// ============================================================================
// EDITING MODE DROPDOWN (Google Docs-style)
// ============================================================================

export type EditorMode = 'editing' | 'suggesting' | 'viewing';

const EDITING_MODES: readonly { value: EditorMode; label: string; icon: string; desc: string }[] = [
  {
    value: 'editing',
    label: 'Editing',
    icon: 'edit_note',
    desc: 'Edit document directly',
  },
  {
    value: 'suggesting',
    label: 'Suggesting',
    icon: 'rate_review',
    desc: 'Edits become suggestions',
  },
  {
    value: 'viewing',
    label: 'Viewing',
    icon: 'visibility',
    desc: 'Read-only, no edits',
  },
];

function EditingModeDropdown({
  mode,
  onModeChange,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const current = EDITING_MODES.find((m) => m.value === mode)!;

  // Responsive: icon-only below 1400px
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1400px)');
    setCompact(mql.matches);
    const handler = (e: MediaQueryListEvent) => setCompact(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Align dropdown to right edge of trigger so it doesn't overflow the screen
    setPos({ top: rect.bottom + 2, left: rect.right - 220 });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [isOpen]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsOpen(!isOpen)}
        title={`${current.label} (Ctrl+Shift+E)`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 0 : 4,
          padding: compact ? '2px 4px' : '2px 6px 2px 4px',
          border: 'none',
          background: isOpen ? 'var(--doc-hover, #f3f4f6)' : 'transparent',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 400,
          color: 'var(--doc-text, #374151)',
          whiteSpace: 'nowrap',
          height: 28,
        }}
      >
        <MaterialSymbol name={current.icon} size={18} />
        {!compact && <span>{current.label}</span>}
        <MaterialSymbol name="arrow_drop_down" size={16} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            backgroundColor: 'white',
            border: '1px solid var(--doc-border, #d1d5db)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
            padding: '4px 0',
            zIndex: 10000,
            minWidth: 220,
          }}
        >
          {EDITING_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onModeChange(m.value);
                setIsOpen(false);
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  'var(--doc-hover, #f3f4f6)';
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--doc-text, #374151)',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <MaterialSymbol name={m.icon} size={20} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 500 }}>{m.label}</span>
                <span style={{ fontSize: 11, color: 'var(--doc-text-muted, #9ca3af)' }}>
                  {m.desc}
                </span>
              </span>
              {m.value === mode && (
                <MaterialSymbol
                  name="check"
                  size={18}
                  style={{ marginLeft: 'auto', color: '#1a73e8' }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// Bumped on document load to be above all existing comment + tracked change IDs
let nextCommentId = 1;
const PENDING_COMMENT_ID = -1;

/**
 * Inject commentRangeStart/End/Reference for reply comments.
 * Replies share the parent comment's text range in document.xml.
 * Without these markers, Pages/Word can't find the reply.
 */
function injectReplyRangeMarkers(content: BlockContent[], comments: Comment[]): void {
  const replies = comments.filter((c) => c.parentId != null);
  if (replies.length === 0) return;

  // Build parentId → reply IDs map
  const replyIdsByParent = new Map<number, number[]>();
  for (const r of replies) {
    const arr = replyIdsByParent.get(r.parentId!);
    if (arr) arr.push(r.id);
    else replyIdsByParent.set(r.parentId!, [r.id]);
  }

  // Walk document content and find parent commentRangeStart/End locations
  function walkBlocks(blocks: BlockContent[]): void {
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        // Skip paragraphs without any comment range markers
        if (
          !block.content.some((i) => i.type === 'commentRangeStart' || i.type === 'commentRangeEnd')
        )
          continue;
        const newItems: ParagraphContent[] = [];
        for (const item of block.content) {
          if (item.type === 'commentRangeStart') {
            newItems.push(item);
            // Add reply range starts right after parent's start
            const replyIds = replyIdsByParent.get(item.id);
            if (replyIds) {
              for (const rid of replyIds) {
                newItems.push({ type: 'commentRangeStart', id: rid });
              }
            }
          } else if (item.type === 'commentRangeEnd') {
            // Parent's rangeEnd first, then reply rangeEnds (parallel, not nested)
            newItems.push(item);
            const replyIds = replyIdsByParent.get(item.id);
            if (replyIds) {
              for (const rid of replyIds) {
                newItems.push({ type: 'commentRangeEnd', id: rid });
              }
            }
          } else {
            newItems.push(item);
          }
        }
        block.content = newItems;
      } else if (block.type === 'table') {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            walkBlocks(cell.content);
          }
        }
      }
    }
  }

  walkBlocks(content);
}

/**
 * Inject commentRangeStart/End for comments that reply to tracked changes.
 * TC replies' parents are insertion/deletion nodes (not comments), so
 * injectReplyRangeMarkers can't find them. This function finds the TC
 * content nodes and wraps them with comment range markers.
 */
function injectTCReplyRangeMarkers(content: BlockContent[], comments: Comment[]): void {
  // Find replies whose parentId is a tracked change (not a real comment)
  const commentIds = new Set(comments.map((c) => c.id));
  const tcReplies = comments.filter((c) => c.parentId != null && !commentIds.has(c.parentId));
  if (tcReplies.length === 0) return;

  // Build revisionId → reply comment IDs
  const replyIdsByRevision = new Map<number, number[]>();
  for (const r of tcReplies) {
    const arr = replyIdsByRevision.get(r.parentId!);
    if (arr) arr.push(r.id);
    else replyIdsByRevision.set(r.parentId!, [r.id]);
  }

  function walkBlocks(blocks: BlockContent[]): void {
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        // Check if any insertion/deletion in this paragraph matches a TC reply
        const hasTC = block.content.some(
          (item) =>
            (item.type === 'insertion' || item.type === 'deletion') &&
            replyIdsByRevision.has(item.info.id)
        );
        if (!hasTC) continue;

        const newItems: ParagraphContent[] = [];
        const items = block.content;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (
            (item.type === 'insertion' || item.type === 'deletion') &&
            replyIdsByRevision.has(item.info.id)
          ) {
            const replyIds = replyIdsByRevision.get(item.info.id)!;
            // Add commentRangeStart BEFORE the TC content
            for (const rid of replyIds) {
              newItems.push({ type: 'commentRangeStart', id: rid });
            }
            newItems.push(item);
            // Check if the next item is the other half of a replacement pair
            // (adjacent del+ins with same author+date). If so, include it inside
            // the comment range so we don't break del-ins adjacency.
            const next = items[i + 1];
            if (
              next &&
              (next.type === 'insertion' || next.type === 'deletion') &&
              next.type !== item.type &&
              next.info.author === item.info.author &&
              next.info.date === item.info.date
            ) {
              newItems.push(next);
              i++; // skip the paired item
            }
            // Add commentRangeEnd AFTER both TC items
            for (const rid of replyIds) {
              newItems.push({ type: 'commentRangeEnd', id: rid });
            }
          } else {
            newItems.push(item);
          }
        }
        block.content = newItems;
      } else if (block.type === 'table') {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            walkBlocks(cell.content);
          }
        }
      }
    }
  }

  walkBlocks(content);
}

const EMPTY_ANCHOR_POSITIONS = new Map<string, number>();

/**
 * Find the Y position (relative to parentEl) of the element containing the given PM position.
 * Used by both the floating comment button and the context menu comment action.
 * Queries all elements with data-pm-start (spans, divs, imgs) — not just spans,
 * since table cell content may use div fragments.
 */
function findSelectionYPosition(
  scrollContainer: HTMLElement | null,
  parentEl: HTMLElement | null,
  pmPos: number
): number | null {
  if (!scrollContainer || !parentEl) return null;
  const pagesEl = scrollContainer.querySelector('.paged-editor__pages');
  if (!pagesEl) return null;
  const elements = pagesEl.querySelectorAll('[data-pm-start]');
  for (const node of elements) {
    const el = node as HTMLElement;
    const pmStart = Number(el.dataset.pmStart);
    const pmEnd = Number(el.dataset.pmEnd);
    if (pmPos >= pmStart && pmPos <= pmEnd) {
      return el.getBoundingClientRect().top - parentEl.getBoundingClientRect().top;
    }
  }
  return null;
}

function createComment(text: string, authorName: string, parentId?: number): Comment {
  return {
    id: nextCommentId++,
    author: authorName,
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        formatting: {},
        content: [{ type: 'run', formatting: {}, content: [{ type: 'text', text }] }],
      },
    ],
    ...(parentId !== undefined && { parentId }),
  };
}

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
    toolbarExtra,
    className = '',
    style,
    placeholder,
    loadingIndicator,
    showOutline: showOutlineProp = false,
    showOutlineButton = true,
    showPrintButton = true,
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
    externalPlugins,
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
    locale,
    lang,
  },
  ref
) {
  // State
  const [state, setState] = useState<EditorState>({
    isLoading: !!documentBuffer,
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
  // Image position dialog state
  const [imagePositionOpen, setImagePositionOpen] = useState(false);
  // Image properties dialog state
  const [imagePropsOpen, setImagePropsOpen] = useState(false);
  // Footnote properties dialog state
  const [footnotePropsOpen, setFootnotePropsOpen] = useState(false);
  // Header/footer editing state
  const [hfEditPosition, setHfEditPosition] = useState<'header' | 'footer' | null>(null);
  const [hfEditIsFirstPage, setHfEditIsFirstPage] = useState(false);
  // Document outline sidebar state
  const [showOutline, setShowOutline] = useState(showOutlineProp);
  const showOutlineRef = useRef(false);
  showOutlineRef.current = showOutline;
  const [outlineHeadings, setHeadingInfos] = useState<HeadingInfo[]>([]);

  // Comments sidebar state
  const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
  const [expandedSidebarItem, setExpandedSidebarItem] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [trackedChanges, setTrackedChanges] = useState<TrackedChangeEntry[]>([]);
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
  }>({ isOpen: false, position: { x: 0, y: 0 }, hasSelection: false, cursorInTable: false });

  // Debounce timers (avoid full doc walk on every keystroke)
  const extractTrackedChangesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanOrphanedCommentsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const isAddingCommentRef = useRef(isAddingComment);
  isAddingCommentRef.current = isAddingComment;
  const onCommentDeleteRef = useRef(onCommentDelete);
  onCommentDeleteRef.current = onCommentDelete;

  // Extract tracked changes from ProseMirror state
  const extractTrackedChanges = useCallback(() => {
    const view = pagedEditorRef.current?.getView();
    if (!view) return;
    const { doc, schema } = view.state;
    const insertionType = schema.marks.insertion;
    const deletionType = schema.marks.deletion;
    if (!insertionType && !deletionType) return;

    const raw: TrackedChangeEntry[] = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type === insertionType || mark.type === deletionType) {
          raw.push({
            type: mark.type === insertionType ? 'insertion' : 'deletion',
            text: node.text || '',
            author: (mark.attrs.author as string) || '',
            date: mark.attrs.date as string | undefined,
            from: pos,
            to: pos + node.nodeSize,
            revisionId: mark.attrs.revisionId as number,
          });
        }
      }
    });

    // Merge adjacent entries with the same revisionId and type into one
    const merged: TrackedChangeEntry[] = [];
    for (const entry of raw) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.revisionId === entry.revisionId &&
        last.type === entry.type &&
        last.to === entry.from
      ) {
        last.text += entry.text;
        last.to = entry.to;
      } else {
        merged.push({ ...entry });
      }
    }

    // Detect replacement pairs: adjacent deletion + insertion from the same author/date
    // Word assigns different w:id values but same author+date for a single replace operation
    const final: TrackedChangeEntry[] = [];
    for (let i = 0; i < merged.length; i++) {
      const curr = merged[i];
      const next = merged[i + 1];
      if (
        curr.type === 'deletion' &&
        next &&
        next.type === 'insertion' &&
        curr.author === next.author &&
        curr.date === next.date &&
        curr.to === next.from
      ) {
        final.push({
          type: 'replacement',
          text: next.text,
          deletedText: curr.text,
          author: curr.author,
          date: curr.date,
          from: curr.from,
          to: next.to,
          revisionId: curr.revisionId,
        });
        i++; // skip the insertion entry
      } else {
        final.push(curr);
      }
    }
    setTrackedChanges(final);

    // Detect comments whose range overlaps with tracked changes and thread them.
    // When a comment mark covers the same text as a tracked change mark,
    // the comment is a reply to the tracked change.
    const commentType = schema.marks.comment;
    if (commentType && final.length > 0) {
      // Build a map: commentId → overlapping revisionId
      const commentToRevision = new Map<number, number>();
      doc.descendants((node) => {
        if (!node.isText) return;
        const commentMark = node.marks.find((m) => m.type === commentType);
        const tcMark = node.marks.find((m) => m.type === insertionType || m.type === deletionType);
        if (commentMark && tcMark) {
          const cid = commentMark.attrs.commentId as number;
          const rid = tcMark.attrs.revisionId as number;
          if (!commentToRevision.has(cid)) {
            commentToRevision.set(cid, rid);
          }
        }
      });

      if (commentToRevision.size > 0) {
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
      }
    }
  }, []);

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
      if (extractTrackedChangesTimerRef.current) {
        clearTimeout(extractTrackedChangesTimerRef.current);
      }
      if (cleanOrphanedCommentsTimerRef.current) {
        clearTimeout(cleanOrphanedCommentsTimerRef.current);
      }
    };
  }, []);

  // Sync outline visibility when prop changes
  useEffect(() => {
    setShowOutline(showOutlineProp);
    if (showOutlineProp) {
      const view = pagedEditorRef.current?.getView();
      if (view) {
        setHeadingInfos(collectHeadings(view.state.doc));
      }
    }
  }, [showOutlineProp]);

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
      // Ensure nextCommentId is above all loaded comment IDs AND tracked change
      // revisionIds to avoid collisions (they share the same ID space in OOXML)
      let maxId = bodyComments.reduce((max, c) => Math.max(max, c.id), 0);
      // Also check tracked change revisionIds from the PM document
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
      if (maxId >= nextCommentId) nextCommentId = maxId + 1;
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const toolbarWrapperRef = useRef<HTMLDivElement>(null);
  const toolbarRoRef = useRef<ResizeObserver | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
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

  // Measure toolbar height for positioning the outline panel below it
  const toolbarRefCallback = useCallback((el: HTMLDivElement | null) => {
    toolbarWrapperRef.current = el;
    // Clean up previous observer
    if (toolbarRoRef.current) {
      toolbarRoRef.current.disconnect();
      toolbarRoRef.current = null;
    }
    if (!el) {
      setToolbarHeight(0);
      return;
    }
    setToolbarHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => {
      setToolbarHeight(el.offsetHeight);
    });
    ro.observe(el);
    toolbarRoRef.current = ro;
  }, []);

  // Cleanup ResizeObserver on unmount
  useEffect(() => {
    return () => {
      toolbarRoRef.current?.disconnect();
    };
  }, []);

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

  // Page setup dialog state
  const [showPageSetup, setShowPageSetup] = useState(false);
  const handleOpenPageSetup = useCallback(() => setShowPageSetup(true), []);

  // Hyperlink popup state (Google Docs-style floating popup on link click)
  const [hyperlinkPopupData, setHyperlinkPopupData] = useState<HyperlinkPopupData | null>(null);

  // Monotonically increasing generation counter to discard stale async loads
  const loadGenerationRef = useRef(0);

  // Reset internal state when loading a new document (clears stale refs, comments, tracked changes, etc.)
  const resetForNewDocument = useCallback(() => {
    commentsLoadedRef.current = false;
    trackedChangesLoadedRef.current = false;
    setComments([]);
    setTrackedChanges([]);
    setHeadingInfos([]);
    setShowCommentsSidebar(false);
    setIsAddingComment(false);
    setCommentSelectionRange(null);
    setAddCommentYPosition(null);
    setFloatingCommentBtn(null);
    setHfEditPosition(null);
    setAnchorPositions(EMPTY_ANCHOR_POSITIONS);
    findReplace.setMatches([], 0);
    if (extractTrackedChangesTimerRef.current) {
      clearTimeout(extractTrackedChangesTimerRef.current);
      extractTrackedChangesTimerRef.current = null;
    }
    if (cleanOrphanedCommentsTimerRef.current) {
      clearTimeout(cleanOrphanedCommentsTimerRef.current);
      cleanOrphanedCommentsTimerRef.current = null;
    }
  }, [findReplace.setMatches]);

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

  // React to document/documentBuffer prop changes
  useEffect(() => {
    if (!documentBuffer) {
      if (initialDocument) {
        loadParsedDocument(initialDocument);
      }
      return;
    }

    loadBuffer(documentBuffer);
  }, [documentBuffer, initialDocument]); // eslint-disable-line react-hooks/exhaustive-deps

  // Create/update agent when document changes
  useEffect(() => {
    if (history.state) {
      agentRef.current = new DocumentAgent(history.state);
    } else {
      agentRef.current = null;
    }
  }, [history.state]);

  // Extract tracked changes once PM view is ready (after loading completes)
  const trackedChangesLoadedRef = useRef(false);
  useEffect(() => {
    if (!state.isLoading && history.state) {
      const timer = setTimeout(() => {
        extractTrackedChanges();
        // Auto-open sidebar once on initial load
        if (!trackedChangesLoadedRef.current) {
          trackedChangesLoadedRef.current = true;
          // Check if we just populated tracked changes
          setTrackedChanges((prev) => {
            if (prev.length > 0) setShowCommentsSidebar(true);
            return prev;
          });
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [state.isLoading, history.state, extractTrackedChanges]);

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
      // Update outline headings if sidebar is open
      if (showOutlineRef.current) {
        const view = pagedEditorRef.current?.getView();
        if (view) {
          setHeadingInfos(collectHeadings(view.state.doc));
        }
      }
      // Re-extract tracked changes after document change (debounced to avoid
      // full-document walk on every keystroke in suggestion mode)
      if (extractTrackedChangesTimerRef.current) {
        clearTimeout(extractTrackedChangesTimerRef.current);
      }
      extractTrackedChangesTimerRef.current = setTimeout(extractTrackedChanges, 300);
      // Clean up orphaned comments (debounced)
      if (cleanOrphanedCommentsTimerRef.current) {
        clearTimeout(cleanOrphanedCommentsTimerRef.current);
      }
      cleanOrphanedCommentsTimerRef.current = setTimeout(cleanOrphanedComments, 300);
    },
    [onChange, pushDocument, extractTrackedChanges, cleanOrphanedComments]
  );

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
        const colorVal = pmTableCtx.cellBorderColor;
        // Resolve theme/auto colors to hex
        let rgb = colorVal.rgb;
        if (!rgb || rgb === 'auto') {
          const resolved = resolveColor(colorVal, theme);
          rgb = resolved.replace(/^#/, '');
        }
        borderSpecRef.current = {
          ...borderSpecRef.current,
          color: { rgb },
        };
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
            borderStyle: (selectedNode.attrs.borderStyle as string) ?? null,
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

      // Extract text color as hex string
      const textColor = textFormatting.color?.rgb ? `#${textFormatting.color.rgb}` : undefined;

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
      if (view && selectionState.hasSelection && !isAddingComment && !readOnly) {
        const container = scrollContainerRef.current;
        const parentEl = editorContentRef.current;
        const { from: selFrom } = view.state.selection;
        const top = findSelectionYPosition(container, parentEl, selFrom);
        if (top != null && container && parentEl) {
          const pagesEl = container.querySelector('.paged-editor__pages');
          const pageEl = pagesEl?.querySelector('.layout-page') as HTMLElement | null;
          const left = pageEl
            ? pageEl.getBoundingClientRect().right - parentEl.getBoundingClientRect().left
            : parentEl.getBoundingClientRect().width / 2 + 408;
          setFloatingCommentBtn({ top, left });
        }
      } else {
        setFloatingCommentBtn(null);
      }

      // Notify parent
      onSelectionChange?.(selectionState);
    },
    [onSelectionChange, isAddingComment, readOnly]
  );

  // Table selection hook
  const tableSelection = useTableSelection({
    document: history.state,
    onChange: handleDocumentChange,
    onSelectionChange: (_context) => {
      // Could notify parent of table selection changes
    },
  });

  // Keyboard shortcuts for Find/Replace (Ctrl+F, Ctrl+H) and delete table selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+F (Find) or Ctrl+H (Replace)
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Delete selected table from layout selection (non-ProseMirror selection)
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // If full table is selected via ProseMirror CellSelection, delete it.
          const view = pagedEditorRef.current?.getView();
          if (view) {
            const sel = view.state.selection as { $anchorCell?: unknown; forEachCell?: unknown };
            const isCellSel = '$anchorCell' in sel && typeof sel.forEachCell === 'function';
            if (isCellSel) {
              const context = getTableContext(view.state);
              if (context.isInTable && context.table) {
                let totalCells = 0;
                context.table.descendants((node) => {
                  if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                    totalCells += 1;
                  }
                });
                let selectedCells = 0;
                (sel as { forEachCell: (fn: () => void) => void }).forEachCell(() => {
                  selectedCells += 1;
                });
                if (totalCells > 0 && selectedCells >= totalCells) {
                  e.preventDefault();
                  pmDeleteTable(view.state, view.dispatch);
                  return;
                }
              }
            }
          }

          if (tableSelection.state.tableIndex !== null) {
            e.preventDefault();
            tableSelection.handleAction('deleteTable');
            return;
          }
        }
      }

      if (cmdOrCtrl && !e.shiftKey && !e.altKey) {
        if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          // Get selected text if any
          const selection = window.getSelection();
          const selectedText = selection && !selection.isCollapsed ? selection.toString() : '';
          findReplace.openFind(selectedText);
        } else if (e.key.toLowerCase() === 'h') {
          e.preventDefault();
          // Get selected text if any
          const selection = window.getSelection();
          const selectedText = selection && !selection.isCollapsed ? selection.toString() : '';
          findReplace.openReplace(selectedText);
        } else if (e.key.toLowerCase() === 'k') {
          e.preventDefault();
          // Open hyperlink dialog
          const view = pagedEditorRef.current?.getView();
          if (view) {
            const selectedText = getSelectedText(view.state);
            const existingLink = getHyperlinkAttrs(view.state);
            if (existingLink) {
              hyperlinkDialog.openEdit({
                url: existingLink.href,
                displayText: selectedText,
                tooltip: existingLink.tooltip,
              });
            } else {
              hyperlinkDialog.openInsert(selectedText);
            }
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [findReplace, hyperlinkDialog, tableSelection]);

  // Handle table insert from toolbar
  const handleInsertTable = useCallback(
    (rows: number, columns: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      insertTable(rows, columns)(view.state, view.dispatch);
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor]
  );

  // Insert a page break at cursor
  const handleInsertPageBreak = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    insertPageBreak(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

  // Insert a table of contents at cursor
  const handleInsertTOC = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    generateTOC(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

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

  // Trigger file picker for image insert
  const handleInsertImageClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  // Handle file selection for image insert
  const handleImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const view = getActiveEditorView();
      if (!view) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;

        // Create an Image element to get natural dimensions
        const img = new Image();
        img.onload = () => {
          let width = img.naturalWidth;
          let height = img.naturalHeight;

          // Constrain to reasonable max width (content area of US Letter page at 96dpi)
          const maxWidth = 612; // ~6.375 inches
          if (width > maxWidth) {
            const scale = maxWidth / width;
            width = maxWidth;
            height = Math.round(height * scale);
          }

          const rId = `rId_img_${Date.now()}`;
          const imageNode = view.state.schema.nodes.image.create({
            src: dataUrl,
            alt: file.name,
            width,
            height,
            rId,
            wrapType: 'inline',
            displayMode: 'inline',
          });

          const { from } = view.state.selection;
          const tr = view.state.tr.insert(from, imageNode);
          view.dispatch(tr.scrollIntoView());
          focusActiveEditor();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);

      // Reset the input so the same file can be selected again
      e.target.value = '';
    },
    [getActiveEditorView, focusActiveEditor]
  );

  // Handle shape insertion
  // Handle image wrap type change
  const handleImageWrapType = useCallback(
    (wrapType: string) => {
      const view = getActiveEditorView();
      if (!view || !state.pmImageContext) return;

      const pos = state.pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      // Map wrap type to display mode + cssFloat
      let displayMode = 'inline';
      let cssFloat: string | null = null;

      switch (wrapType) {
        case 'inline':
          displayMode = 'inline';
          cssFloat = null;
          break;
        case 'square':
        case 'tight':
        case 'through':
          displayMode = 'float';
          cssFloat = 'left';
          break;
        case 'topAndBottom':
          displayMode = 'block';
          cssFloat = null;
          break;
        case 'behind':
        case 'inFront':
          displayMode = 'float';
          cssFloat = 'none';
          break;
        case 'wrapLeft':
          displayMode = 'float';
          cssFloat = 'right';
          wrapType = 'square';
          break;
        case 'wrapRight':
          displayMode = 'float';
          cssFloat = 'left';
          wrapType = 'square';
          break;
      }

      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        wrapType,
        displayMode,
        cssFloat,
      });
      view.dispatch(tr.scrollIntoView());
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, state.pmImageContext]
  );

  // Handle image transform (rotate/flip)
  const handleImageTransform = useCallback(
    (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => {
      const view = getActiveEditorView();
      if (!view || !state.pmImageContext) return;

      const pos = state.pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      const currentTransform = (node.attrs.transform as string) || '';

      // Parse current rotation and flip state
      const rotateMatch = currentTransform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
      let rotation = rotateMatch ? parseFloat(rotateMatch[1]) : 0;
      let hasFlipH = /scaleX\(-1\)/.test(currentTransform);
      let hasFlipV = /scaleY\(-1\)/.test(currentTransform);

      switch (action) {
        case 'rotateCW':
          rotation = (rotation + 90) % 360;
          break;
        case 'rotateCCW':
          rotation = (rotation - 90 + 360) % 360;
          break;
        case 'flipH':
          hasFlipH = !hasFlipH;
          break;
        case 'flipV':
          hasFlipV = !hasFlipV;
          break;
      }

      // Build new transform string
      const parts: string[] = [];
      if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
      if (hasFlipH) parts.push('scaleX(-1)');
      if (hasFlipV) parts.push('scaleY(-1)');
      const newTransform = parts.length > 0 ? parts.join(' ') : null;

      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        transform: newTransform,
      });
      view.dispatch(tr.scrollIntoView());
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, state.pmImageContext]
  );

  // Apply image position changes
  const handleApplyImagePosition = useCallback(
    (data: ImagePositionData) => {
      const view = getActiveEditorView();
      if (!view || !state.pmImageContext) return;

      const pos = state.pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        position: {
          horizontal: data.horizontal,
          vertical: data.vertical,
        },
        distTop: data.distTop ?? node.attrs.distTop,
        distBottom: data.distBottom ?? node.attrs.distBottom,
        distLeft: data.distLeft ?? node.attrs.distLeft,
        distRight: data.distRight ?? node.attrs.distRight,
      });
      view.dispatch(tr.scrollIntoView());
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, state.pmImageContext]
  );

  // Open image properties dialog
  const handleOpenImageProperties = useCallback(() => {
    setImagePropsOpen(true);
  }, []);

  // Apply image properties (alt text + border)
  const handleApplyImageProperties = useCallback(
    (data: ImagePropertiesData) => {
      const view = getActiveEditorView();
      if (!view || !state.pmImageContext) return;

      const pos = state.pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        alt: data.alt ?? null,
        borderWidth: data.borderWidth ?? null,
        borderColor: data.borderColor ?? null,
        borderStyle: data.borderStyle ?? null,
      });
      view.dispatch(tr.scrollIntoView());
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, state.pmImageContext]
  );

  // Handle footnote/endnote properties update
  const handleApplyFootnoteProperties = useCallback(
    (
      footnotePr: import('@eigenpal/docx-core/types/document').FootnoteProperties,
      endnotePr: import('@eigenpal/docx-core/types/document').EndnoteProperties
    ) => {
      if (!history.state?.package) return;
      const newDoc = {
        ...history.state.package.document,
        finalSectionProperties: {
          ...history.state.package.document.finalSectionProperties,
          footnotePr,
          endnotePr,
        },
      };
      pushDocument({
        ...history.state,
        package: {
          ...history.state.package,
          document: newDoc,
        },
      });
    },
    [history, pushDocument]
  );

  // Handle table action from Toolbar - use ProseMirror commands
  const handleTableAction = useCallback(
    (action: TableAction) => {
      const view = getActiveEditorView();
      if (!view) return;

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
          pmSplitCell(view.state, view.dispatch);
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
    [tableSelection, getActiveEditorView, focusActiveEditor]
  );

  // Context menu handler
  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const view = pagedEditorRef.current?.getView();
    const inTable = view ? isInTable(view.state) : false;
    const { from, to } = view?.state.selection ?? { from: 0, to: 0 };
    const hasSel = from !== to;
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      hasSelection: hasSel,
      cursorInTable: inTable,
    });
  }, []);

  // Handle formatting action from toolbar
  const handleFormat = useCallback(
    (action: FormattingAction) => {
      const view = getActiveEditorView();
      if (!view) return;

      // Focus editor first to ensure we can dispatch commands
      view.focus();

      // Restore selection if it was lost during toolbar interaction
      // This happens when user clicks on dropdown menus (font picker, style picker, etc.)
      // Only restore for the body editor — HF editor manages its own selection
      const isBodyEditor = view === pagedEditorRef.current?.getView();
      const { from, to } = view.state.selection;
      const savedSelection = lastSelectionRef.current;

      if (
        isBodyEditor &&
        savedSelection &&
        (from !== savedSelection.from || to !== savedSelection.to)
      ) {
        // Selection was lost (focus moved to dropdown portal) - restore it
        try {
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, savedSelection.from, savedSelection.to)
          );
          view.dispatch(tr);
        } catch (e) {
          // If restoration fails (e.g., positions are invalid after doc change), continue with current selection
          console.warn('Could not restore selection:', e);
        }
      }

      // Handle simple toggle actions
      if (action === 'bold') {
        toggleBold(view.state, view.dispatch);
        return;
      }
      if (action === 'italic') {
        toggleItalic(view.state, view.dispatch);
        return;
      }
      if (action === 'underline') {
        toggleUnderline(view.state, view.dispatch);
        return;
      }
      if (action === 'strikethrough') {
        toggleStrike(view.state, view.dispatch);
        return;
      }
      if (action === 'superscript') {
        toggleSuperscript(view.state, view.dispatch);
        return;
      }
      if (action === 'subscript') {
        toggleSubscript(view.state, view.dispatch);
        return;
      }
      if (action === 'bulletList') {
        toggleBulletList(view.state, view.dispatch);
        return;
      }
      if (action === 'numberedList') {
        toggleNumberedList(view.state, view.dispatch);
        return;
      }
      if (action === 'indent') {
        // Try list indent first, then paragraph indent
        if (!increaseListLevel(view.state, view.dispatch)) {
          increaseIndent()(view.state, view.dispatch);
        }
        return;
      }
      if (action === 'outdent') {
        // Try list outdent first, then paragraph outdent
        if (!decreaseListLevel(view.state, view.dispatch)) {
          decreaseIndent()(view.state, view.dispatch);
        }
        return;
      }
      if (action === 'clearFormatting') {
        clearFormatting(view.state, view.dispatch);
        return;
      }
      if (action === 'setRtl') {
        setRtl(view.state, view.dispatch);
        return;
      }
      if (action === 'setLtr') {
        setLtr(view.state, view.dispatch);
        return;
      }
      if (action === 'insertLink') {
        // Get the selected text for the hyperlink dialog
        const selectedText = getSelectedText(view.state);
        // Check if we're editing an existing link
        const existingLink = getHyperlinkAttrs(view.state);
        if (existingLink) {
          hyperlinkDialog.openEdit({
            url: existingLink.href,
            displayText: selectedText,
            tooltip: existingLink.tooltip,
          });
        } else {
          hyperlinkDialog.openInsert(selectedText);
        }
        return;
      }

      // Handle object-based actions
      if (typeof action === 'object') {
        switch (action.type) {
          case 'alignment':
            setAlignment(action.value)(view.state, view.dispatch);
            break;
          case 'textColor': {
            // action.value can be a ColorValue object or a string like "#FF0000"
            const colorVal = action.value;
            if (typeof colorVal === 'string') {
              setTextColor({ rgb: colorVal.replace('#', '') })(view.state, view.dispatch);
            } else if (colorVal.auto) {
              // "Automatic" — remove text color
              clearTextColor(view.state, view.dispatch);
            } else {
              setTextColor(colorVal)(view.state, view.dispatch);
            }
            break;
          }
          case 'highlightColor': {
            // Convert hex to OOXML named highlight value (e.g., 'FFFF00' → 'yellow')
            const highlightName = action.value ? mapHexToHighlightName(action.value) : '';
            setHighlight(highlightName || action.value)(view.state, view.dispatch);
            break;
          }
          case 'fontSize':
            // Convert points to half-points (OOXML uses half-points for font sizes)
            setFontSize(pointsToHalfPoints(action.value))(view.state, view.dispatch);
            break;
          case 'fontFamily':
            setFontFamily(action.value)(view.state, view.dispatch);
            break;
          case 'lineSpacing':
            setLineSpacing(action.value)(view.state, view.dispatch);
            break;
          case 'applyStyle': {
            // Resolve style to get its formatting properties
            // Use ref to avoid stale closure (handleFormat has [] deps)
            const currentDoc = historyStateRef.current;
            const styleResolver = currentDoc?.package.styles
              ? getCachedStyleResolver(currentDoc.package.styles)
              : null;

            if (styleResolver) {
              const resolved = styleResolver.resolveParagraphStyle(action.value);
              applyStyle(action.value, {
                paragraphFormatting: resolved.paragraphFormatting,
                runFormatting: resolved.runFormatting,
              })(view.state, view.dispatch);
            } else {
              // No styles available, just set the styleId
              applyStyle(action.value)(view.state, view.dispatch);
            }
            break;
          }
        }
      }
    },
    [getActiveEditorView]
  );

  // Handle zoom change
  const handleZoomChange = useCallback((zoom: number) => {
    setState((prev) => ({ ...prev, zoom }));
  }, []);

  // Handle hyperlink dialog submit
  const handleHyperlinkSubmit = useCallback(
    (data: HyperlinkData) => {
      const view = getActiveEditorView();
      if (!view) return;

      const url = data.url || '';
      const tooltip = data.tooltip;

      // Check if we have a selection
      const { empty } = view.state.selection;

      if (empty && data.displayText) {
        // No selection but display text provided - insert new linked text
        insertHyperlink(data.displayText, url, tooltip)(view.state, view.dispatch);
      } else if (!empty) {
        // Have selection - apply hyperlink to it
        setHyperlink(url, tooltip)(view.state, view.dispatch);
      } else if (data.displayText) {
        // Empty selection but display text provided
        insertHyperlink(data.displayText, url, tooltip)(view.state, view.dispatch);
      }

      hyperlinkDialog.close();
      focusActiveEditor();
    },
    [hyperlinkDialog, getActiveEditorView, focusActiveEditor]
  );

  // Shared: remove hyperlink mark and refocus editor
  const doRemoveHyperlink = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    removeHyperlink(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

  // Handle hyperlink removal (from dialog)
  const handleHyperlinkRemove = useCallback(() => {
    doRemoveHyperlink();
    hyperlinkDialog.close();
  }, [hyperlinkDialog, doRemoveHyperlink]);

  // Handle hyperlink popup (Google Docs-style)
  const handleHyperlinkClick = useCallback(
    (data: HyperlinkPopupData) => setHyperlinkPopupData(data),
    []
  );

  const handleHyperlinkPopupNavigate = useCallback((href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

  const handleHyperlinkPopupCopy = useCallback((href: string) => {
    navigator.clipboard.writeText(href).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = href;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }, []);

  const handleHyperlinkPopupEdit = useCallback(
    (displayText: string, href: string) => {
      const view = getActiveEditorView();
      if (!view) return;

      // Find the full hyperlink mark range at current cursor position
      const hlType = view.state.schema.marks.hyperlink;
      if (!hlType) return;

      const { $from } = view.state.selection;
      const linkMark = $from.marks().find((m) => m.type === hlType);

      if (linkMark) {
        // Collect all contiguous text nodes with the same hyperlink mark
        const parent = $from.parent;
        const parentStart = $from.start();

        // Build ranges of consecutive hyperlink-marked nodes
        type Range = { start: number; end: number };
        const ranges: Range[] = [];
        let currentRange: Range | null = null;

        parent.forEach((node, offset) => {
          const nodeStart = parentStart + offset;
          const nodeEnd = nodeStart + node.nodeSize;
          const hlMark = node.isText
            ? node.marks.find((m) => m.type === hlType && m.attrs.href === linkMark.attrs.href)
            : null;

          if (hlMark) {
            if (currentRange) {
              currentRange.end = nodeEnd;
            } else {
              currentRange = { start: nodeStart, end: nodeEnd };
            }
          } else {
            if (currentRange) {
              ranges.push(currentRange);
              currentRange = null;
            }
          }
        });
        if (currentRange) ranges.push(currentRange);

        // Find the range that contains the cursor
        const cursorPos = $from.pos;
        const targetRange = ranges.find((r) => r.start <= cursorPos && cursorPos <= r.end);
        if (!targetRange) return;

        // Replace the text and mark
        const tr = view.state.tr;
        const newMark = hlType.create({ href, tooltip: linkMark.attrs.tooltip });
        const textNode = view.state.schema.text(displayText, [
          ...$from.marks().filter((m) => m.type !== hlType),
          newMark,
        ]);
        tr.replaceWith(targetRange.start, targetRange.end, textNode);
        view.dispatch(tr.scrollIntoView());
      }

      setHyperlinkPopupData(null);
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor]
  );

  const handleHyperlinkPopupRemove = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;

    const hlType = view.state.schema.marks.hyperlink;
    if (!hlType) return;

    const { $from } = view.state.selection;

    // Try $from.marks() first, then check the node after the cursor
    // (ProseMirror may not report marks at boundary positions)
    let linkMark = $from.marks().find((m) => m.type === hlType);
    if (!linkMark && $from.nodeAfter) {
      linkMark = $from.nodeAfter.marks.find((m) => m.type === hlType);
    }
    if (!linkMark && $from.nodeBefore) {
      linkMark = $from.nodeBefore.marks.find((m) => m.type === hlType);
    }

    // Fall back to searching by href from popup data
    if (!linkMark && hyperlinkPopupData) {
      const parent = $from.parent;
      parent.forEach((node) => {
        if (!linkMark && node.isText) {
          const m = node.marks.find(
            (mk) => mk.type === hlType && mk.attrs.href === hyperlinkPopupData.href
          );
          if (m) linkMark = m;
        }
      });
    }

    if (!linkMark) return;

    // Find contiguous range of nodes with matching hyperlink mark
    const parent = $from.parent;
    const parentStart = $from.start();
    type Range = { start: number; end: number };
    const ranges: Range[] = [];
    let currentRange: Range | null = null;

    parent.forEach((node, offset) => {
      const nodeStart = parentStart + offset;
      const nodeEnd = nodeStart + node.nodeSize;
      const hlMark = node.isText
        ? node.marks.find((m) => m.type === hlType && m.attrs.href === linkMark!.attrs.href)
        : null;

      if (hlMark) {
        if (currentRange) {
          currentRange.end = nodeEnd;
        } else {
          currentRange = { start: nodeStart, end: nodeEnd };
        }
      } else {
        if (currentRange) {
          ranges.push(currentRange);
          currentRange = null;
        }
      }
    });
    if (currentRange) ranges.push(currentRange);

    const cursorPos = $from.pos;
    const targetRange = ranges.find((r) => r.start <= cursorPos && cursorPos <= r.end);
    if (!targetRange) return;

    const tr = view.state.tr;
    tr.removeMark(targetRange.start, targetRange.end, hlType);
    view.dispatch(tr.scrollIntoView());

    setHyperlinkPopupData(null);
    focusActiveEditor();
    toast('Link removed');
  }, [getActiveEditorView, focusActiveEditor, hyperlinkPopupData]);

  const handleHyperlinkPopupClose = useCallback(() => {
    setHyperlinkPopupData(null);
  }, []);

  // Right-click context menu handlers
  const handleContextMenu = useCallback((data: { x: number; y: number; hasSelection: boolean }) => {
    const view = pagedEditorRef.current?.getView();
    const inTable = view ? isInTable(view.state) : false;
    setContextMenu({
      isOpen: true,
      position: data,
      hasSelection: data.hasSelection,
      cursorInTable: inTable,
    });
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu({
      isOpen: false,
      position: { x: 0, y: 0 },
      hasSelection: false,
      cursorInTable: false,
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
        { action: 'deleteColumn', label: 'Delete column', dividerAfter: true }
      );
    }
    items.push({ action: 'selectAll', label: 'Select All', shortcut: `${mod}+A` });
    return items;
  }, [contextMenu.hasSelection, contextMenu.cursorInTable]);

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
    [getActiveEditorView, focusActiveEditor]
  );

  // Handle margin changes from rulers
  const createMarginHandler = useCallback(
    (property: 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom') =>
      (marginTwips: number) => {
        if (!history.state || readOnly) return;
        const newDoc = {
          ...history.state,
          package: {
            ...history.state.package,
            document: {
              ...history.state.package.document,
              finalSectionProperties: {
                ...history.state.package.document.finalSectionProperties,
                [property]: marginTwips,
              },
            },
          },
        };
        handleDocumentChange(newDoc);
      },
    [history.state, readOnly, handleDocumentChange]
  );

  const handleLeftMarginChange = useMemo(
    () => createMarginHandler('marginLeft'),
    [createMarginHandler]
  );
  const handleRightMarginChange = useMemo(
    () => createMarginHandler('marginRight'),
    [createMarginHandler]
  );
  const handleTopMarginChange = useMemo(
    () => createMarginHandler('marginTop'),
    [createMarginHandler]
  );
  const handleBottomMarginChange = useMemo(
    () => createMarginHandler('marginBottom'),
    [createMarginHandler]
  );

  // Page setup apply handler
  const handlePageSetupApply = useCallback(
    (props: Partial<SectionProperties>) => {
      if (!history.state || readOnly) return;
      const newDoc = {
        ...history.state,
        package: {
          ...history.state.package,
          document: {
            ...history.state.package.document,
            finalSectionProperties: {
              ...history.state.package.document.finalSectionProperties,
              ...props,
            },
          },
        },
      };
      handleDocumentChange(newDoc);
    },
    [history.state, readOnly, handleDocumentChange]
  );

  // Paragraph indent handlers (for ruler)
  const handleIndentLeftChange = useCallback(
    (twips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      setIndentLeft(twips)(view.state, view.dispatch);
    },
    [getActiveEditorView]
  );

  const handleIndentRightChange = useCallback(
    (twips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      setIndentRight(twips)(view.state, view.dispatch);
    },
    [getActiveEditorView]
  );

  const handleFirstLineIndentChange = useCallback(
    (twips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      // If twips is negative, it's a hanging indent
      if (twips < 0) {
        setIndentFirstLine(-twips, true)(view.state, view.dispatch);
      } else {
        setIndentFirstLine(twips, false)(view.state, view.dispatch);
      }
    },
    [getActiveEditorView]
  );

  const handleTabStopRemove = useCallback(
    (positionTwips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      removeTabStop(positionTwips)(view.state, view.dispatch);
    },
    [getActiveEditorView]
  );

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
  const handleSave = useCallback(
    async (options?: { selective?: boolean }): Promise<ArrayBuffer | null> => {
      if (!agentRef.current) return null;

      try {
        const agentDoc = agentRef.current.getDocument();

        // Get the document from the PM editor state — this runs fromProseDoc which
        // converts PM comment marks into commentRangeStart/End in the document body.
        // The agent's internal document has the original parsed content and won't
        // include markers for newly added comments.
        const pmDoc = pagedEditorRef.current?.getDocument();
        if (pmDoc?.package?.document) {
          agentDoc.package.document.content = pmDoc.package.document.content;
        }

        // Sync React comments state (including new replies) back to the document model
        agentDoc.package.document.comments = comments;

        // Inject commentRangeStart/End for reply comments that share the parent's range.
        // Pages/Word require every comment (including replies) to have range markers in document.xml.
        injectReplyRangeMarkers(agentDoc.package.document.content, comments);
        // Also inject range markers for comments that reply to tracked changes.
        injectTCReplyRangeMarkers(agentDoc.package.document.content, comments);

        // Build selective save options from change tracker state
        const useSelective = options?.selective !== false;
        const view = pagedEditorRef.current?.getView();
        let selectiveOptions: Parameters<typeof agentRef.current.toBuffer>[0] = undefined;

        if (useSelective && view) {
          const editorState = view.state;
          // Force full repack if any reply comments exist (both comment replies and
          // tracked-change replies need range markers injected into document.xml,
          // which selective save can't handle since the affected paragraphs may not
          // be in changedParaIds)
          const hasInjectedReplies = comments.some((c) => c.parentId != null);
          selectiveOptions = {
            selective: {
              changedParaIds: getChangedParagraphIds(editorState),
              structuralChange: hasStructuralChanges(editorState) || hasInjectedReplies,
              hasUntrackedChanges: hasUntrackedChanges(editorState),
            },
          };
        }

        const buffer = await agentRef.current.toBuffer(selectiveOptions);

        // Clear change tracker after successful save
        if (view) {
          view.dispatch(clearTrackedChanges(view.state));
        }

        onSave?.(buffer);
        return buffer;
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Failed to save document'));
        return null;
      }
    },
    [onSave, onError, comments]
  );

  // Handle error from editor
  const handleEditorError = useCallback(
    (error: Error) => {
      onError?.(error);
    },
    [onError]
  );

  const handleDirectPrint = useCallback(() => {
    // Find the pages container and clone its content into a clean print window
    const pagesEl = containerRef.current?.querySelector('.paged-editor__pages');
    if (!pagesEl) {
      window.print();
      onPrint?.();
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      // Popup blocked — fall back to window.print()
      window.print();
      onPrint?.();
      return;
    }

    // Collect all @font-face rules from the current page
    const fontFaceRules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule instanceof CSSFontFaceRule) {
            fontFaceRules.push(rule.cssText);
          }
        }
      } catch {
        // Cross-origin stylesheets can't be read — skip
      }
    }

    // Clone pages and remove transforms/shadows
    const pagesClone = pagesEl.cloneNode(true) as HTMLElement;
    pagesClone.style.cssText = 'display: block; margin: 0; padding: 0;';
    for (const page of Array.from(pagesClone.querySelectorAll('.layout-page'))) {
      const el = page as HTMLElement;
      el.style.boxShadow = 'none';
      el.style.margin = '0';
    }

    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Print</title>
<style>
${fontFaceRules.join('\n')}
* { margin: 0; padding: 0; }
body { background: white; }
.layout-page { break-after: page; }
.layout-page:last-child { break-after: auto; }
@page { margin: 0; size: auto; }
</style>
</head><body>${pagesClone.outerHTML}</body></html>`);
    printWindow.document.close();

    // Wait for fonts/images then print
    printWindow.onload = () => {
      printWindow.print();
      printWindow.close();
    };

    // Fallback if onload doesn't fire (some browsers)
    setTimeout(() => {
      if (!printWindow.closed) {
        printWindow.print();
        printWindow.close();
      }
    }, 1000);

    onPrint?.();
  }, [onPrint]);

  // ============================================================================
  // FIND/REPLACE HANDLERS
  // ============================================================================

  // Store the current find result for navigation
  const findResultRef = useRef<FindResult | null>(null);

  // Handle find operation
  const handleFind = useCallback(
    (searchText: string, options: FindOptions): FindResult | null => {
      if (!history.state || !searchText.trim()) {
        findResultRef.current = null;
        return null;
      }

      const matches = findInDocument(history.state, searchText, options);
      const result: FindResult = {
        matches,
        totalCount: matches.length,
        currentIndex: 0,
      };

      findResultRef.current = result;
      findReplace.setMatches(matches, 0);

      // Scroll to first match
      if (matches.length > 0 && containerRef.current) {
        scrollToMatch(containerRef.current, matches[0]);
      }

      return result;
    },
    [history.state, findReplace]
  );

  // Handle find next
  const handleFindNext = useCallback((): FindMatch | null => {
    if (!findResultRef.current || findResultRef.current.matches.length === 0) {
      return null;
    }

    const newIndex = findReplace.goToNextMatch();
    const match = findResultRef.current.matches[newIndex];

    // Scroll to the match
    if (match && containerRef.current) {
      scrollToMatch(containerRef.current, match);
    }

    return match || null;
  }, [findReplace]);

  // Handle find previous
  const handleFindPrevious = useCallback((): FindMatch | null => {
    if (!findResultRef.current || findResultRef.current.matches.length === 0) {
      return null;
    }

    const newIndex = findReplace.goToPreviousMatch();
    const match = findResultRef.current.matches[newIndex];

    // Scroll to the match
    if (match && containerRef.current) {
      scrollToMatch(containerRef.current, match);
    }

    return match || null;
  }, [findReplace]);

  // Handle replace current match
  const handleReplace = useCallback(
    (replaceText: string): boolean => {
      if (!history.state || !findResultRef.current || findResultRef.current.matches.length === 0) {
        return false;
      }

      const currentMatch = findResultRef.current.matches[findResultRef.current.currentIndex];
      if (!currentMatch) return false;

      // Execute replace command
      try {
        const newDoc = executeCommand(history.state, {
          type: 'replaceText',
          range: {
            start: {
              paragraphIndex: currentMatch.paragraphIndex,
              offset: currentMatch.startOffset,
            },
            end: {
              paragraphIndex: currentMatch.paragraphIndex,
              offset: currentMatch.endOffset,
            },
          },
          text: replaceText,
        });

        handleDocumentChange(newDoc);
        return true;
      } catch (error) {
        console.error('Replace failed:', error);
        return false;
      }
    },
    [history.state, handleDocumentChange]
  );

  // Handle replace all matches
  const handleReplaceAll = useCallback(
    (searchText: string, replaceText: string, options: FindOptions): number => {
      if (!history.state || !searchText.trim()) {
        return 0;
      }

      // Find all matches first
      const matches = findInDocument(history.state, searchText, options);
      if (matches.length === 0) return 0;

      // Replace from end to start to maintain correct indices
      let doc = history.state;
      const sortedMatches = [...matches].sort((a, b) => {
        if (a.paragraphIndex !== b.paragraphIndex) {
          return b.paragraphIndex - a.paragraphIndex;
        }
        return b.startOffset - a.startOffset;
      });

      for (const match of sortedMatches) {
        try {
          doc = executeCommand(doc, {
            type: 'replaceText',
            range: {
              start: {
                paragraphIndex: match.paragraphIndex,
                offset: match.startOffset,
              },
              end: {
                paragraphIndex: match.paragraphIndex,
                offset: match.endOffset,
              },
            },
            text: replaceText,
          });
        } catch (error) {
          console.error('Replace failed for match:', match, error);
        }
      }

      handleDocumentChange(doc);
      findResultRef.current = null;
      findReplace.setMatches([], 0);

      return matches.length;
    },
    [history.state, handleDocumentChange, findReplace]
  );

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
      scrollToPage: (_pageNumber: number) => {
        // TODO: Implement page navigation in ProseMirror
      },
      openPrintPreview: handleDirectPrint,
      print: handleDirectPrint,
      loadDocument: loadParsedDocument,
      loadDocumentBuffer: loadBuffer,
    }),
    [
      history.state,
      state.zoom,
      scrollPageInfo,
      handleSave,
      handleDirectPrint,
      loadParsedDocument,
      loadBuffer,
    ]
  );

  // Get header and footer content from document
  const { headerContent, footerContent, firstPageHeaderContent, firstPageFooterContent } = useMemo<{
    headerContent: HeaderFooter | null;
    footerContent: HeaderFooter | null;
    firstPageHeaderContent: HeaderFooter | null;
    firstPageFooterContent: HeaderFooter | null;
  }>(() => {
    if (!history.state?.package) {
      return {
        headerContent: null,
        footerContent: null,
        firstPageHeaderContent: null,
        firstPageFooterContent: null,
      };
    }

    const pkg = history.state.package;
    const sectionProps = pkg.document?.finalSectionProperties;
    const headers = pkg.headers;
    const footers = pkg.footers;

    let header: HeaderFooter | null = null;
    let footer: HeaderFooter | null = null;
    let firstHeader: HeaderFooter | null = null;
    let firstFooter: HeaderFooter | null = null;

    if (headers && sectionProps?.headerReferences) {
      const defaultRef = sectionProps.headerReferences.find((r) => r.type === 'default');
      if (defaultRef?.rId) {
        header = headers.get(defaultRef.rId) ?? null;
      }
      const firstRef = sectionProps.headerReferences.find((r) => r.type === 'first');
      if (firstRef?.rId) {
        firstHeader = headers.get(firstRef.rId) ?? null;
      }
    }

    if (footers && sectionProps?.footerReferences) {
      const defaultRef = sectionProps.footerReferences.find((r) => r.type === 'default');
      if (defaultRef?.rId) {
        footer = footers.get(defaultRef.rId) ?? null;
      }
      const firstRef = sectionProps.footerReferences.find((r) => r.type === 'first');
      if (firstRef?.rId) {
        firstFooter = footers.get(firstRef.rId) ?? null;
      }
    }

    // When titlePg is not set but only 'first' headers exist, use them as default
    if (!sectionProps?.titlePg) {
      if (!header && firstHeader) header = firstHeader;
      if (!footer && firstFooter) footer = firstFooter;
    }

    return {
      headerContent: header,
      footerContent: footer,
      firstPageHeaderContent: firstHeader,
      firstPageFooterContent: firstFooter,
    };
  }, [history.state]);

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
        | import('@eigenpal/docx-core/types/document').Paragraph
        | import('@eigenpal/docx-core/types/document').Table
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
    backgroundColor: 'var(--doc-bg-subtle)',
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
      if (view) {
        acceptChange(from, to)(view.state, view.dispatch);
        extractTrackedChanges();
      }
    },
    onRejectChange: (from, to) => {
      const view = pagedEditorRef.current?.getView();
      if (view) {
        rejectChange(from, to)(view.state, view.dispatch);
        extractTrackedChanges();
      }
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

  const sidebarOpen = allSidebarItems.length > 0;

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
      <ToolbarButton
        onClick={() => setShowCommentsSidebar(!showCommentsSidebar)}
        active={showCommentsSidebar}
        title="Toggle comments sidebar"
        ariaLabel="Toggle comments sidebar"
      >
        <MaterialSymbol name="comment" size={20} />
      </ToolbarButton>
      {/* Resolved comments use margin markers instead of toolbar toggle */}
      <ToolbarSeparator />
      <EditingModeDropdown
        mode={editingMode}
        onModeChange={(mode) => {
          setEditingMode(mode);
          if (mode === 'suggesting') setShowCommentsSidebar(true);
        }}
      />
      {toolbarExtra}
    </>
  );

  return (
    <LocaleProvider locale={locale} lang={lang}>
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
                  <div
                    ref={toolbarRefCallback}
                    className="z-50 flex flex-col gap-0 bg-white shadow-sm flex-shrink-0"
                  >
                    <EditorToolbar
                      currentFormatting={state.selectionFormatting}
                      onFormat={handleFormat}
                      onUndo={undoActiveEditor}
                      onRedo={redoActiveEditor}
                      canUndo={true}
                      canRedo={true}
                      disabled={readOnly}
                      documentStyles={history.state?.package.styles?.styles}
                      theme={history.state?.package.theme || theme}
                      showPrintButton={showPrintButton}
                      onPrint={handleDirectPrint}
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
                      <EditorToolbar.FormattingBar>{toolbarChildren}</EditorToolbar.FormattingBar>
                    </EditorToolbar>

                    {/* Horizontal Ruler - sticky with toolbar */}
                    {showRuler && (
                      <div
                        className="flex justify-center px-5 py-1 overflow-x-auto flex-shrink-0 bg-doc-bg"
                        style={{
                          paddingRight: sidebarOpen
                            ? `calc(20px + ${SIDEBAR_DOCUMENT_SHIFT * 2}px)`
                            : undefined,
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
                          tabStops={state.paragraphTabs}
                          onTabStopRemove={handleTabStopRemove}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Editor container - this is the scroll container (toolbar is above, not inside) */}
                <div ref={scrollContainerRef} style={editorContainerStyle}>
                  {/* Editor content wrapper */}
                  <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
                    {/* Editor content area */}
                    <div
                      ref={editorContentRef}
                      style={{ position: 'relative', flex: 1, minWidth: 0 }}
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
                      {/* Vertical Ruler - fixed on left edge (hidden when readOnly prop is set) */}
                      {showRuler && !readOnlyProp && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            zIndex: 10,
                            paddingTop: 48, // paged-editor__pages and layout padding-top
                          }}
                        >
                          <VerticalRuler
                            sectionProps={history.state?.package.document?.finalSectionProperties}
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
                      {expandedSidebarItem?.startsWith('tc-') && (
                        <style>{`
                          .paged-editor__pages .docx-insertion[data-revision-id="${expandedSidebarItem.split('-')[1]}"] { background-color: rgba(52, 168, 83, 0.2) !important; border-bottom: 2px solid #2e7d32 !important; }
                          .paged-editor__pages .docx-deletion[data-revision-id="${expandedSidebarItem.split('-')[1]}"] { background-color: rgba(211, 47, 47, 0.2) !important; text-decoration-thickness: 2px !important; }
                        `}</style>
                      )}
                      <PagedEditor
                        ref={pagedEditorRef}
                        document={history.state}
                        styles={history.state?.package.styles}
                        theme={history.state?.package.theme || theme}
                        sectionProperties={history.state?.package.document?.finalSectionProperties}
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
                          } else {
                            handleSelectionChange(null);
                          }
                        }}
                        externalPlugins={allExternalPlugins}
                        onReady={(ref) => {
                          onEditorViewReady?.(ref.getView()!);
                        }}
                        onRenderedDomContextReady={onRenderedDomContextReady}
                        pluginOverlays={pluginOverlays}
                        onHyperlinkClick={handleHyperlinkClick}
                        onContextMenu={handleContextMenu}
                        commentsSidebarOpen={sidebarOpen}
                        onAnchorPositionsChange={setAnchorPositions}
                        resolvedCommentIds={resolvedIdsForRender}
                        scrollContainerRef={scrollContainerRef}
                        sidebarOverlay={
                          <>
                            {allSidebarItems.length > 0 && (
                              <UnifiedSidebar
                                items={allSidebarItems}
                                anchorPositions={anchorPositions}
                                renderedDomContext={pluginRenderedDomContext ?? null}
                                pageWidth={(() => {
                                  const sp =
                                    history.state?.package?.document?.finalSectionProperties;
                                  return sp?.pageWidth ? Math.round(sp.pageWidth / 15) : 816;
                                })()}
                                zoom={state.zoom}
                                editorContainerRef={scrollContainerRef}
                                onExpandedItemChange={setExpandedSidebarItem}
                              />
                            )}
                            <CommentMarginMarkers
                              comments={comments}
                              anchorPositions={anchorPositions}
                              zoom={state.zoom}
                              pageWidth={(() => {
                                const sp = history.state?.package?.document?.finalSectionProperties;
                                return sp?.pageWidth ? Math.round(sp.pageWidth / 15) : 816;
                              })()}
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

                      {/* Right-click context menu */}
                      <TextContextMenu
                        isOpen={contextMenu.isOpen}
                        position={contextMenu.position}
                        hasSelection={contextMenu.hasSelection}
                        isEditable={!readOnly}
                        items={contextMenuItems}
                        onAction={handleContextMenuAction}
                        onClose={() => setContextMenu((prev) => ({ ...prev, isOpen: false }))}
                      />

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

                {/* Page indicator — Google Docs style, next to scrollbar while scrolling */}
                {scrollPageInfo.totalPages > 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 24,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontFamily:
                        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      zIndex: 1000,
                      opacity: scrollPageInfo.visible ? 1 : 0,
                      transition: 'opacity 0.3s ease',
                      userSelect: 'none',
                    }}
                    aria-live="polite"
                    role="status"
                  >
                    {scrollPageInfo.currentPage} of {scrollPageInfo.totalPages}
                  </div>
                )}

                {/* Document outline sidebar — absolutely positioned, doesn't scroll */}
                {showOutline && (
                  <DocumentOutline
                    headings={outlineHeadings}
                    onHeadingClick={handleHeadingInfoClick}
                    onClose={() => setShowOutline(false)}
                    topOffset={toolbarHeight}
                  />
                )}

                {/* Unified sidebar (comments + plugin items) rendered inside PagedEditor via sidebarOverlay prop */}

                {/* Outline toggle button — absolutely positioned below toolbar */}
                {showOutlineButton && !showOutline && (
                  <button
                    className="docx-outline-nav"
                    onClick={handleToggleOutline}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Show document outline"
                    style={{
                      position: 'absolute',
                      left: 48,
                      top: toolbarHeight + 12,
                      zIndex: 20,
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '50%',
                      padding: 6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <MaterialSymbol
                      name="format_list_bulleted"
                      size={20}
                      style={{ color: '#444746' }}
                    />
                  </button>
                )}
              </div>
              {/* end wrapper for scroll container + outline */}
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
                          borderStyle: state.pmImageContext.borderStyle ?? undefined,
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
