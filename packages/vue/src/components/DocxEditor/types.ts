/**
 * Public type surface for `<DocxEditor>`.
 *
 * Mirrors the React adapter's `DocxEditorProps` / `DocxEditorRef` / `EditorMode`
 * exports — the names match deliberately so shared docs only differ by package
 * name. `DocxEditorRef` borrows its base shape from
 * `EditorRefLike` (Decision 10) so React + Vue cannot drift on the agent SDK
 * surface they share.
 */

import type { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Document, Theme } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { SelectionState } from '@eigenpal/docx-editor-core/prosemirror';
import type { DocxInput } from '@eigenpal/docx-editor-core/utils';
import type { FontOption } from '@eigenpal/docx-editor-core/utils/fontOptions';
import type { FontDefinition } from '@eigenpal/docx-editor-core/utils';
import type { StyleValue, VNodeChild } from 'vue';
import type { EditorRefLike } from '@eigenpal/docx-editor-agents/bridge';
import type { PMContentControl } from '@eigenpal/docx-editor-core/prosemirror';
import type { ContentControlFilter, ContentControlValue } from '@eigenpal/docx-editor-core/agent';
import type { Translations } from '@eigenpal/docx-editor-i18n';

export type EditorMode = 'editing' | 'suggesting' | 'viewing';

/**
 * Public props for the Vue editor component.
 */
export interface DocxEditorProps {
  /** Document data — ArrayBuffer, Uint8Array, Blob, or File. */
  documentBuffer?: DocxInput | null;
  /** Pre-parsed document model, alternative to documentBuffer. */
  document?: Document | null;
  /** Whether to show the main formatting toolbar. */
  showToolbar?: boolean;
  /** Whether to show the title/menu bar. Vue-only chrome toggle. */
  showMenuBar?: boolean;
  /** Whether to show page rulers. */
  showRuler?: boolean;
  /** Document name shown in the title bar. */
  documentName?: string;
  /** Whether the editor is read-only. */
  readOnly?: boolean;
  /** Author name used for comments and tracked changes created in the UI. Defaults to `'User'`. */
  author?: string;
  /** Editor mode: direct editing, suggesting, or viewing. */
  mode?: EditorMode;
  /** Callback when the editing mode changes. */
  onModeChange?: (mode: EditorMode) => void;
  /** Translation overrides merged with English fallback. */
  i18n?: Translations;
  /** Theme override used for toolbar color palettes when the document has no theme. */
  theme?: Theme | null;
  /** Color theme mode for UI styling. `'system'` follows the OS preference. */
  colorMode?: 'light' | 'dark' | 'system';
  /** External ProseMirror plugins supplied by the host app. */
  externalPlugins?: Plugin[];
  /** Whether to show the zoom controls in the toolbar. */
  showZoomControl?: boolean;
  /** Initial zoom level. */
  initialZoom?: number;
  /** Custom toolbar content appended after the built-in controls. */
  toolbarExtra?: () => VNodeChild;
  /** Additional CSS class name on the editor root. */
  className?: string;
  /** Additional inline styles on the editor root. */
  style?: StyleValue;
  /** Whether to show the document outline panel initially. */
  showOutline?: boolean;
  /** Whether to show the floating outline toggle button. */
  showOutlineButton?: boolean;
  /** Custom list of fonts shown in the font-family dropdown. */
  fontFamilies?: ReadonlyArray<string | FontOption>;
  /**
   * Custom font faces to register before the editor measures text. Each entry
   * injects an `@font-face` rule. Pass a URL (woff2/woff/ttf/otf), an
   * ArrayBuffer, or omit `src` to load by name from Google Fonts. Multiple
   * entries can share `family` to register different weights/styles.
   */
  fonts?: ReadonlyArray<FontDefinition>;
  /**
   * Text-watermark presets shown in the watermark dialog's preset dropdown.
   * Omit to use the built-in MS Word phrases (`DEFAULT_WATERMARK_PRESETS`).
   * Pass an empty array to hide the preset dropdown.
   */
  watermarkPresets?: readonly string[];
  /**
   * Callback fired when the print action is triggered. Pass it to enable the
   * `File > Print` menu entry; omit to hide. The `editor.print()` ref method
   * also invokes this callback.
   */
  onPrint?: () => void;
  /** Disable Cmd/Ctrl+F and Cmd/Ctrl+H interception. */
  disableFindReplaceShortcuts?: boolean;
  /** Custom logo/icon renderer for the title bar. Slots remain preferred in templates. */
  renderLogo?: () => VNodeChild;
  /** Callback when the document name changes. */
  onDocumentNameChange?: (name: string) => void;
  /** Whether the document name is editable. */
  documentNameEditable?: boolean;
  /** Custom right-side actions renderer for the title bar. Slots remain preferred in templates. */
  renderTitleBarRight?: () => VNodeChild;
  /** Callback fired whenever the document changes. Mirrors the `@change` event. */
  onChange?: (document: Document) => void;
  /** Callback fired when the editor errors (parse/layout/font). Mirrors the `@error` event. */
  onError?: (error: Error) => void;
  /** Callback fired when the selection changes, with the current selection state (or null). */
  onSelectionChange?: (state: SelectionState | null) => void;
  /** Callback fired once the underlying ProseMirror EditorView is ready. */
  onEditorViewReady?: (view: EditorView) => void;
  /** Callback fired when a top-level comment is added via the UI. */
  onCommentAdd?: (comment: Comment) => void;
  /** Callback fired when a comment is resolved via the UI. Receives the comment with `done: true`. */
  onCommentResolve?: (comment: Comment) => void;
  /** Callback fired when a comment (and its replies) is deleted via the UI. */
  onCommentDelete?: (comment: Comment) => void;
  /** Callback fired when a reply is added to a comment via the UI. */
  onCommentReply?: (reply: Comment, parent: Comment) => void;
  /** Callback fired with the full comment array whenever it changes (add/reply/resolve/delete). */
  onCommentsChange?: (comments: Comment[]) => void;
}

/**
 * Public ref shape for `<DocxEditor>`. Exposes the full editor-scope
 * `EditorRefLike` contract so the agent bridge can attach to either
 * React or Vue without an adapter shim.
 */
export type DocxEditorRef = EditorRefLike & {
  /** Agent instance access is React-only today; Vue returns null for API parity. */
  getAgent(): null;
  /** Save the document and return DOCX bytes, matching React's component ref. */
  save(): Promise<ArrayBuffer | null>;
  /** Set zoom level (1.0 = 100%). */
  setZoom(zoom: number): void;
  /** Get current zoom level. */
  getZoom(): number;
  /** Focus the editor's hidden ProseMirror view. Vue-only — not in EditorRefLike. */
  focus(): void;
  /** Scroll the visible pages to a 1-indexed page number. */
  scrollToPage(pageNumber: number): void;
  /** Scroll to a raw ProseMirror document position. */
  scrollToPosition(pmPos: number): void;
  /**
   * Scroll the comment with the given id into view and select its anchored
   * range so the selection overlay highlights it. False when the id no longer
   * resolves (the comment was deleted or its anchored text removed).
   */
  scrollToCommentId(commentId: number): boolean;
  /**
   * Scroll the tracked change with the given revision id into view and select
   * its range so the selection overlay highlights it. False when the id no
   * longer resolves (the change was accepted/rejected/deleted).
   */
  scrollToChangeId(revisionId: number): boolean;
  /**
   * Select the position range `[from, to]` so the selection overlay highlights
   * it, and scroll its start into view. No-op for a malformed range or a
   * `from` past the document end; `to` is clamped to the document size.
   */
  highlightRange(from: number, to: number): void;
  /** Open print preview / browser print. */
  openPrintPreview(): void;
  /** Print the document. */
  print(): void;
  /** Load a pre-parsed document programmatically. */
  loadDocument(doc: Document): void;
  /** Load a DOCX buffer programmatically. */
  loadDocumentBuffer(buffer: DocxInput): Promise<void>;
  /** Tear down the editor (destroys the PM view + frees listeners). */
  destroy(): void;
  /** List block-level content controls (SDTs), optionally filtered by tag/alias/id/type. */
  getContentControls(filter?: ContentControlFilter): PMContentControl[];
  /** Scroll the first content control matching `filter` into view. False if none. */
  scrollToContentControl(filter: ContentControlFilter): boolean;
  /** Replace a control's content by tag with `text`. False if no match; throws if locked. */
  setContentControlContent(
    filter: ContentControlFilter,
    text: string,
    options?: { force?: boolean }
  ): boolean;
  /** Remove a control by tag (or unwrap with `keepContent`). False if no match; throws if locked. */
  removeContentControl(
    filter: ContentControlFilter,
    options?: { force?: boolean; keepContent?: boolean }
  ): boolean;
  /** Set a typed value (dropdown / checkbox / date) on a control by tag. False if no match. */
  setContentControlValue(
    filter: ContentControlFilter,
    value: ContentControlValue,
    options?: { force?: boolean }
  ): boolean;
};
