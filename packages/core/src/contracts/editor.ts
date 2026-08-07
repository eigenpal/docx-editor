/**
 * `@docx-editor.dev/core/contracts/editor` — the `Editor` contract adapters are written against.
 *
 * Commands go through `can` before `exec`; queries answer against the live, laid-out document.
 * Type-only where it can be, so an adapter can name the whole surface without importing the
 * engine.
 *
 * CONTRACT ONLY — declarations, not an implementation.
 *
 * @packageDocumentation
 * @public
 */

import type { ContentControlSummary, DocEdits, DocQueries, DocQueryResults } from './document.ts';
// Type-only, so the adapters reach the review vocabulary through THIS contract rather than
// naming the layout lane, which they are not allowed to import.
import type {
  ReviewCommentItem,
  ReviewCustomItem,
  ReviewItem,
  ReviewRevisionItem,
  ReviewRevisionKind,
} from '../layout/review-support.ts';
import type { InteractionOutcome } from './interaction';
// The selection vocabulary the painted surface actually speaks. Type-only, and re-exported
// below for the same reason the review types are: an adapter is not allowed to import the
// layout lane, so a form it must construct has to be nameable from this contract.
import type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';
import type {
  ColorValue,
  ContentControlFilter,
  DocAnchor,
  DocRange,
  Rect,
  Revision,
  RunFormatting,
  ExecErrorCode,
  ExecResult,
  Unsubscribe,
  Watermark,
} from './types';
import type {
  EditorHeaderFooterCommands,
  EditorNoteCommands,
  HeaderFooterState,
  NotePropertiesState,
} from './editor-hf-notes.ts';
import type {
  DrawingKind,
  DrawingLocks,
  DrawingPositionInput,
  ImageWrapTarget,
} from '../store/package/drawing-projection.ts';
import type { ImageCropPercent } from '../store/package/image-crop-units.ts';
import type { ImageResourceState, SupportedImageMime } from '../store/package/image-resources.ts';

export type * from './types';
export type * from './interaction';
export type * from './editor-hf-notes.ts';
export type { ImageCropPercent } from '../store/package/image-crop-units.ts';

// Everything below is named by a signature IN this file, so it has to be nameable FROM this
// file. An adapter is not allowed to import the layout or store lanes — that is the whole
// reason the review and drawing vocabulary is re-exported here rather than left where it is
// declared — so a type that leaks out through a return value but not through the export list
// is a member the adapter can call and cannot write down.
export type {
  CommentRecord,
  ReviewCommentItem,
  ReviewCustomItem,
  ReviewPosition,
  ReviewRange,
  ReviewRevisionItem,
} from '../layout/review-support.ts';
export type { RevisionAddress } from '@docx-editor.dev/core/store';
export type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';
export type {
  DrawingHorizontalReferenceFrame,
  DrawingKind,
  DrawingLocks,
  DrawingPositionInput,
  DrawingVerticalReferenceFrame,
  ImageWrapTarget,
} from '../store/package/drawing-projection.ts';
export type {
  ImageResourceState,
  PreservedImageMime,
  RenderableImageMime,
  SupportedImageMime,
  ValidatedImageBytesHandle,
  VectorImageMime,
} from '../store/package/image-resources.ts';
export type {
  ContentControlSummary,
  DocEdits,
  DocQueries,
  DocQueryResults,
  ParagraphSummary,
} from './document.ts';

/**
 * An opaque handle to a loaded document — its stable identity and current
 * revision. The canonical authored state is the engine's `PackageModel`, NOT a
 * simplified tree; advanced automation (`DocxEditor.run(handle, …)`) addresses a
 * document through this handle rather than a serialized structure. Kept
 * deliberately minimal and open so it can carry more identity later without a
 * breaking change.
 */
export interface DocumentHandle {
  /** The document's current store revision. */
  readonly revision: number;
}

/**
 * What `createDocxEditor`/`load` accept as a document: raw DOCX bytes, or an existing
 * in-memory `DocumentHandle` (shared/handed off). The engine is byte-native
 * (`PackageModel` is canonical); there is intentionally no structured-tree input,
 * which would be lossy against the canonical package.
 */
export type DocumentSource = ArrayBuffer | Uint8Array | DocumentHandle;

/** A concrete font face requested by authored document content. */
export interface FontFaceRequest {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/** Immutable, byte-backed font face supplied to layout and browser paint. */
export interface FontSource {
  readonly request: FontFaceRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly availability?: 'available' | 'forbidden';
}

/** An explicit authored-font substitution. No implicit platform fallback is performed. */
export interface FontSourceSubstitution {
  readonly from: FontFaceRequest;
  readonly to: FontFaceRequest;
}

/**
 * Public font source configuration sampled when an adapter mounts. It must be immutable for that
 * editor lifetime; remount the adapter to replace bytes or substitutions atomically.
 */
export interface FontConfiguration {
  readonly epoch: number;
  readonly maxFontBytes: number;
  readonly sources: readonly FontSource[];
  readonly substitutions?: readonly FontSourceSubstitution[];
  readonly defaultFont: {
    readonly family: string;
    readonly sizeHalfPoints: number;
  };
  readonly language?: string;
}

/**
 * Why a font was not admitted.
 *
 * Distinguished rather than collapsed because the responses differ: `overLimit` and `malformed`
 * are the caller's own bytes, while `forbidden` and `hashMismatch` mean the source was not what
 * it claimed and the load should not be retried.
 */
export type EditorFontErrorCode =
  | 'initializationFailed'
  | 'missing'
  | 'forbidden'
  | 'overLimit'
  | 'malformed'
  | 'hashMismatch'
  | 'metadataMismatch'
  | 'fontFaceLoadFailed'
  | 'unsupportedFaceIndex'
  | 'missingFont'
  | 'hashInvalid'
  | 'fontMismatch'
  | 'unsupportedFace'
  | 'loadFailed';

/** Typed adapter error reported both through `onFontError` and accessible alert UI. */
export class EditorFontError extends Error {
  readonly name: string = 'EditorFontError';
  readonly code: EditorFontErrorCode;
  readonly request?: FontFaceRequest;
  readonly diagnostic?: string;

  constructor(
    code: EditorFontErrorCode,
    message: string,
    details: {
      readonly request?: FontFaceRequest;
      readonly diagnostic?: string;
      readonly cause?: unknown;
    } = {}
  ) {
    super(message, { cause: details.cause });
    this.code = code;
    this.request = details.request;
    this.diagnostic = details.diagnostic;
  }
}

/**
 * The payload of the `change` event / `onChange`. It carries revision + identity
 * deltas, NOT serialized bytes: serializing a whole DOCX on every keystroke would
 * be prohibitive for large documents. Call `save()` to get bytes on demand.
 */
export interface DocumentChange {
  /** The store revision after this change. */
  readonly revision: number;
  /** Block ids created/deleted/edited by this change, when the engine reports them. */
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
  readonly dirty?: readonly string[];
}

/**
 * The editor is N+1 editing views: one body plus one per header/footer
 * relationship, plus footnotes, text boxes, and other addressable regions.
 * Commands must say which one they target, or they silently hit the wrong
 * surface when a header is focused.
 *
 * Intentionally open-ended: this set is expected to grow (notes, frames, and
 * whatever regions later prove addressable), so treat it as non-exhaustive
 * rather than a closed enum.
 */
export type EditorScope =
  | { kind: 'body' }
  | { kind: 'headerFooter'; rId: string }
  /**
   * A footnote/endnote region.
   *
   * `id` encodes kind + signed note id as `footnote:<id>` or `endnote:<id>`
   * (e.g. `footnote:2`). Use `formatNoteScopeId` / `parseNoteScopeId` from the
   * store package. Do not invent a parallel `{ noteKind, noteId }` scope arm.
   */
  | { kind: 'note'; id: string }
  /** A text box or floating frame with its own content, addressed by id. */
  | { kind: 'frame'; id: string }
  /** Read-only aggregate across every view. Valid for queries, not for writes. */
  | { kind: 'all' };

/** A concrete editing view — every scope except the read-only `all` aggregate. */
export type ViewScope = Exclude<EditorScope, { kind: 'all' }>;

/**
 * What a fit mode fits the page to.
 *
 * One member today. It is a union rather than a boolean because Word's other two — the whole
 * sheet including its height, and the text column inside the margins — are the same
 * computation with a different numerator, and a later change adds one without breaking the
 * shape a host already stores.
 */
export type ZoomFitTarget = 'pageWidth';

/**
 * Where the display scale comes from.
 *
 * `fixed` is a number the engine holds until someone changes it. `fit` is a number the engine
 * recomputes whenever the room beside the page changes — a resized window, an opened comments
 * rail, a docked navigation pane — bounded by `minZoom`/`maxZoom`.
 *
 * The bounds are what make one mode serve both cases. The default, `'auto'`, is this fit with
 * `maxZoom: 1`: it shrinks a page that does not fit and leaves a page that does at 100%.
 */
export type ZoomMode =
  | { readonly type: 'fixed' }
  | {
      readonly type: 'fit';
      readonly fit: ZoomFitTarget;
      /** Never shrink past this. Defaults to the contract floor, 0.1. */
      readonly minZoom?: number;
      /** Never grow past this. `1` is the "shrink only" rule. Defaults to the ceiling, 5. */
      readonly maxZoom?: number;
    };

/**
 * A selection endpoint, in either vocabulary the engine resolves.
 *
 * {@link DocAnchor} addresses a paragraph by its `w14:paraId`, which is what an LLM or an
 * automation script can name in a payload. {@link SemanticPosition} addresses it by the
 * paragraph id the painted surface and the ops already use, with a UTF-16 offset inside it.
 *
 * Neither subsumes the other. A paraId survives being written to a file and read back, so it
 * is the one an out-of-process caller can hold; but it is OPTIONAL in the document, and
 * `ParagraphSummary.paraId` says so — a paragraph the file gave no `w14:paraId` cannot be
 * reached by a `DocAnchor` at all. The paragraph id reaches every paragraph.
 */
export type EditorPosition = DocAnchor | SemanticPosition;

/**
 * A selection, in one endpoint vocabulary or the other.
 *
 * The two do NOT mix: a range is a pair of paraId anchors, or a semantic anchor/head pair,
 * and `can()` refuses anything else with the engine's own reason. Spelled as two arms rather
 * than `{ from: EditorPosition; to: EditorPosition }` for exactly that reason — the looser
 * shape would type a mixed pair the engine rejects at runtime.
 */
export type EditorSelection = SemanticSelection | { from: DocAnchor; to: DocAnchor };

/**
 * Whether a command would be accepted, and why not when it would not.
 *
 * The `reason` is the ENGINE's own words, which is what lets disabled chrome explain itself
 * instead of guessing — see `toolbarCommandState`.
 */
export type CanResult = { ok: true } | { ok: false; code: ExecErrorCode; reason: string };

/**
 * The engine's whole public surface: load and save, execute and query, observe and subscribe.
 *
 * Commands go through `can` before `exec` — the same check chrome uses to decide whether a
 * control is enabled, so a button and the engine never disagree about what is possible.
 *
 * `snapshot()` is version-cached: the same reference until state actually moves, with
 * reference-stable sub-objects, which is what makes it safe as a `useSyncExternalStore` source.
 *
 * @example
 * ```ts
 * const editor = createDocxEditor({ container });
 * editor.load(bytes);
 * if (editor.can({ type: 'toggleBold' }).ok) editor.exec({ type: 'toggleBold' });
 * const bytesOut = await editor.save();
 * ```
 */
export interface Editor {
  /** Load a new document (DOCX bytes or a handle), replacing the current one. */
  load(document: DocumentSource): void;
  /** Serialize the current canonical document to DOCX bytes — on demand, never per keystroke. */
  save(): Promise<ArrayBuffer>;
  /** An opaque handle to the current document (identity + revision). Replaces the former
   *  structured `getDocument()`; the canonical state is the engine `PackageModel`, not a tree. */
  getDocumentHandle(): DocumentHandle;

  exec(command: EditorCommand, options?: { scope?: EditorScope }): ExecResult;
  /** Dry run: reports whether `exec` would apply. Never reports `changed`. */
  can(command: EditorCommand, options?: { scope?: EditorScope }): CanResult;
  /**
   * Dry run for byte commands that require {@link Editor.executeImageCommand}.
   * Generic {@link Editor.can} on `insertImage` / `replaceImage` refuses with an async-path
   * reason; this method answers whether async execution can proceed right now.
   */
  canExecuteImageCommand(
    command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>,
    options?: { scope?: EditorScope }
  ): CanResult;
  /** Insert or replace picture bytes as one package undo unit. */
  executeImageCommand(
    command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>
  ): Promise<ExecResult>;
  /**
   * Whether a formatting command is currently APPLIED at the selection — distinct from
   * `can`, which answers whether it may run.
   *
   * A toolbar must show that bold is on, and the repo's own guidance is that controls
   * reflect live editor state rather than being static. `can` cannot answer this, and the
   * legacy adapter answered it by reading a ProseMirror `EditorState` directly, which the
   * greenfield architecture forbids in adapters.
   *
   * The derivation EXISTS for marks and alignment: `toggleMark` bold/italic/underline/
   * strike answers from the snapshot's selection formatting (Word's agreement rule — true
   * only when the WHOLE selection carries the mark), and `setAlignment` compares the
   * command's `align` (with justify↔`both` mapped the way `exec` writes it) to the
   * selection's paragraph alignment. Every other command still returns `false`: it must
   * never return a value it has not actually derived from canonical state, and `false` is
   * the honest answer while a derivation does not exist.
   */
  isActive(command: EditorCommand, options?: { scope?: EditorScope }): boolean;

  // ── Capabilities the ported legacy UI asks for ──────────────────────────────────────
  //
  // The legacy React components read these from a ProseMirror `EditorState` or the old
  // document model. Adapters may do neither here, so each is a method on this contract,
  // implemented in the engine as a STUB returning the honest empty answer. The UI wires
  // to them today and lights up when the derivation lands, with no adapter change.
  //
  // Every one of these MUST return empty rather than a guess. A style list that invents
  // entries, or a comment count that is not real, is worse than a control that shows
  // nothing — see the `isActive` note above.

  /** Paragraph/character styles defined by the document, for the style picker. */
  getDocumentStyles(): readonly {
    readonly styleId: string;
    readonly name: string;
    readonly type: string;
    /**
     * How the style looks, so a picker can show each entry in its own face rather than a
     * list of identical rows. Presentation only, and already bounded for a CSS sink.
     */
    readonly preview: {
      readonly fontFamily: string | null;
      readonly fontSizePt: number | null;
      readonly bold: boolean;
      readonly italic: boolean;
      readonly color: string | null;
    };
  }[];

  /** Font families the document actually uses, for the font picker. */
  getDocumentFonts(): readonly string[];

  /**
   * Every font family the editor can offer: the configured catalog (the default face,
   * the Word-name families the substitution map stands in for, and host-registered
   * source families) merged with {@link getDocumentFonts}. Never empty — a brand-new
   * document offers the configured catalog rather than a dead picker.
   */
  getAvailableFonts(): readonly string[];

  /**
   * The document theme's ten picker colours (`a:clrScheme`) in Word's column order
   * (Background 1, Text 1, Background 2, Text 2, Accent 1-6), each a six-digit hex
   * without '#'. Empty when the document has no complete scheme — the picker then
   * falls back to a default palette.
   */
  getDocumentThemeColors(): readonly { readonly slot: string; readonly hex: string }[];

  /** Heading outline for the navigation panel, in document order. */
  getOutline(): readonly {
    readonly text: string;
    readonly level: number;
    readonly blockId: string;
  }[];

  /** Comment threads anchored in the document. */
  getComments(): readonly {
    readonly id: string;
    readonly text: string;
    readonly resolved: boolean;
  }[];

  /** Formatting at the current selection, for toolbar value display (font, size, colour,
   *  alignment, list state). `null` when nothing is selected or nothing is derivable. */
  getSelectionFormatting(): {
    readonly fontFamily?: string;
    readonly fontSizeHalfPoints?: number;
    readonly styleId?: string;
    readonly alignment?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly underline?: boolean;
  } | null;

  /** Find matches for a query, for the find/replace dialog. */
  findMatches(
    query: string,
    options?: { readonly matchCase?: boolean; readonly wholeWord?: boolean }
  ): readonly TextMatch[];

  /**
   * Move the selection to a found match — what a find dialog's next/previous do.
   *
   * Separate from `findMatches` because finding is a read and selecting is a write, and
   * a caller may want the count without moving the caret.
   */
  selectMatch(match: TextMatch): ExecResult;

  /** The image at the selection, for the image toolbar and transform controls. */
  getSelectedImage(): SelectedImageState | null;

  /** The table containing the selection, for the table toolbar. `null` outside a table. */
  getSelectedTable(): {
    readonly blockId: string;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly cell: { readonly row: number; readonly column: number } | null;
  } | null;

  /** Live rectangular cell selection, if any. `null` when the caret is not in a cell rectangle. */
  getTableCellSelection(): {
    readonly tableId: string;
    readonly rows: { readonly from: number; readonly to: number };
    readonly columns: { readonly from: number; readonly to: number };
    readonly cellIds: readonly string[];
  } | null;

  /** Update table furniture aria labels without remounting the editor. */
  setTableInteractionLabel(
    resolver: (key: 'table.insertRowBelow' | 'table.insertColumnRight') => string
  ): void;

  /** Section page setup — size, orientation and margins — for the page-setup dialog. */
  getPageSetup(): PageSetup | null;

  /** The document watermark, for the watermark dialog. */
  getWatermark(): { readonly kind: 'text' | 'image'; readonly text?: string } | null;

  /** Header/footer editing state: which region is being edited, if any. */
  getHeaderFooterState(): HeaderFooterState | null;

  /** Resolved and authored note properties for the caret section — properties dialog read-model. */
  getNotePropertiesState(): NotePropertiesState | null;

  /** Plain-text note preview for hover chrome. */
  getNotePreviewText(scopeId: string): string | null;

  /** Tracked changes in the document — body AND header/footer stories. */
  getTrackedChanges(): readonly {
    readonly id: string;
    readonly kind: string;
    readonly author?: string;
    /** Which story holds the change, so a consumer can group or filter by region. */
    readonly story?: 'body' | 'header' | 'footer' | 'footnote' | 'endnote';
  }[];

  /**
   * Every pending decision in the document, with where its card belongs.
   *
   * Derived from the document TREE, not from what is painted: a queue derived from laid-out
   * spans empties by half the moment the reader switches to a resolved display mode, and the
   * changes that vanished become unreachable from the surface meant to resolve them.
   *
   * `anchorY` comes from layout records. A surface must not measure painted DOM for it — that
   * is a repaint behind the document and fails outright during pagination.
   */
  getReviewItems(query?: ReviewItemQuery): readonly ReviewItemPlacement[];

  /**
   * Custom-node definitions registered through `createDocxEditor({ modules })`, in
   * registration order.
   *
   * OPAQUE to the engine — the capability package that defined them narrows them back.
   * Published so chrome components can default to the registered definitions instead of
   * every surface taking the same `nodes` array and drifting.
   */
  getCustomNodeDefinitions(): readonly unknown[];
  /**
   * Report a custom-node diagnostic to the modules registered on THIS editor.
   *
   * The capability package raises these from its own read paths as well as from the review
   * derivation, and both have to reach the same listeners — the ones belonging to this instance.
   * Keeping the channel here rather than in the package is what stops two editors on one page
   * hearing about each other's documents.
   *
   * Opaque, like `getCustomNodeDefinitions`: what a diagnostic means belongs to whoever raised it.
   */
  reportCustomNodeDiagnostic(diagnostic: unknown): void;

  /**
   * How edits are written: directly, as suggestions, or not at all.
   *
   * Runtime state, unlike the construction-time `DocxEditorConfig.mode` — a reader who switches
   * to Viewing and back expects the same document, not a remount.
   */
  getEditingMode(): DocumentEditingMode;
  setEditingMode(mode: DocumentEditingMode): ExecResult;

  /**
   * Whether the review pane is showing its cards.
   *
   * Engine-owned, like zoom: the toolbar toggles it, the rail renders from it, and the
   * document shifts to make room for it. Three consumers, one answer.
   */
  isReviewPaneOpen(): boolean;

  /**
   * Layout points to CSS pixels, zoom included.
   *
   * Published because {@link ReviewItemPlacement.anchorY} is in the engine's own unit, and a
   * host that re-derived the factor would own a second copy of the points-to-pixels rule.
   * The first copy drifted the moment it was written: a rail that used zoom alone put every
   * card at three quarters of its true height.
   */
  getRenderScale(): number;

  /**
   * A counter that changes exactly when {@link getReviewItems} would return something new.
   *
   * Lets a subscriber re-derive on a real change rather than on every event.
   */
  getReviewRevision(): number;

  /**
   * Comment on the current selection.
   *
   * Anchored to the RETAINED range when there is one, so a compose box that took focus does
   * not lose the words it is about — that is what retention exists for. Refused on a
   * collapsed caret: a comment with no range has nothing to point at, and Word writes none.
   */
  addComment(text: string, author?: string): ExecResult;

  /**
   * Where a comment on the current selection would sit, in the same space as
   * {@link ReviewItemPlacement.anchorY}, or null when nothing is selected.
   *
   * Published so a host can place an "add a comment" affordance beside the selected text
   * without deriving document geometry, which is the one thing an adapter must not do.
   */
  getSelectionPlacement(): { readonly anchorY: number; readonly pageIndex: number } | null;

  /**
   * Card to document: select the item's range and scroll to it. `null` clears the active item.
   *
   * REPORTS, like {@link acceptReviewItem} and for the same reason. Activation is refused for
   * an item with no resolvable range, for a kind the host's rail excluded (see
   * {@link setReviewActivationExclusions}), and when the story it lives in will not open —
   * and a host walking a queue with next/previous controls has no other way to learn that a
   * step did nothing. Consult {@link ReviewItemPlacement.activatable} to avoid asking.
   */
  setActiveReviewItem(key: string | null, options?: ReviewActivationOptions): ExecResult;

  /**
   * Revision kinds the caret must never activate, or null for none.
   *
   * A host rail that hides some kinds (structural and format cards, typically) tells the
   * engine here, so a click on tracked text cannot activate a card the rail does not
   * render — the band would light and nothing on screen would answer it.
   */
  setReviewActivationExclusions(kinds: readonly ReviewRevisionKind[] | null): void;

  /**
   * Accept or reject the revision behind a card.
   *
   * Every site carrying the revision's `(id, author, date)` triple resolves in ONE transaction
   * and one undo step: a tracked row insertion is `w:trPr/w:ins` on the row plus `w:cellIns`
   * on each cell, and resolving them separately would leave the row half-tracked.
   *
   * Refused for a card whose kind the engine cannot resolve structurally, which is why
   * `readOnly` is on the item — a surface should not offer the button in the first place.
   */
  acceptReviewItem(key: string): ExecResult;
  rejectReviewItem(key: string): ExecResult;

  /**
   * Discard the item behind a card: the destructive half of the review verbs.
   *
   * On a COMMENT it deletes the thread — the `w:comment` body, the `w15:commentEx` record and
   * the story's range markers, in one transaction and therefore one undo step. Word deletes a
   * conversation rather than one remark, and a reply whose parent is gone has nothing left to
   * answer.
   *
   * On a REVISION it rejects the change, which is what discarding a suggestion means: the
   * proposal goes away and the document reads as it did before. Deliberately the same verb, so
   * a surface can put one "remove this" affordance on every card instead of branching.
   *
   * Refused on a custom node's card, which is informational, and on a revision kind the engine
   * cannot resolve — the same rule {@link rejectReviewItem} follows.
   */
  deleteReviewItem(key: string): ExecResult;

  /**
   * Reply to a review item.
   *
   * Against a comment this is a threaded reply. Against a REVISION it is a comment anchored
   * over that revision's range: OOXML gives `w:ins` and `w:del` no body and no thread, so
   * there is nowhere else for the text to live.
   *
   * The author is AMBIENT — `DocxEditorConfig.author`, the way the rest of the authored commands
   * source it — and the argument overrides it for one call. `CT_Comment` makes `@w:author`
   * required, so a reply with neither is refused rather than written as an empty attribute.
   */
  replyToReviewItem(key: string, text: string, author?: string): ExecResult;
  setActiveScope(scope: ViewScope): void;
  getActiveScope(): ViewScope;

  query<K extends keyof EditorQueries>(
    query: { type: K } & EditorQueries[K],
    options?: { scope?: EditorScope }
  ): EditorQueryResults[K];
  snapshot(options?: { scope?: EditorScope }): EditorSnapshot;

  getTotalPages(): number;
  /**
   * One-based page at the caret (default), or at the centre of the mounted scroll viewport.
   * Viewport mode falls back to the caret when no measurable viewport is attached.
   */
  getCurrentPage(mode?: 'viewport' | 'caret'): number;

  /**
   * Display scale of the painted pages. 1 is 100%.
   *
   * Zoom is ENGINE-OWNED rather than a host prop, so the toolbar's zoom control, the
   * scale a host paints at, and the factor hit testing divides by cannot disagree —
   * a host that scaled its own transform without telling the engine would land every
   * click at the wrong content point.
   */
  /**
   * Scroll a page or a block into view. Returns false when the target does not exist or
   * the host has no scroll container — a caller can tell "not found" from "scrolled".
   */
  scrollToPage(pageNumber: number): boolean;
  scrollToBlock(blockId: string): boolean;

  getZoom(): number;
  /**
   * Set the display scale. Values outside a sane range are rejected rather than
   * clamped silently, so a caller learns its input was refused.
   *
   * Also LEAVES any fit mode: a reader who picks 150% has said what they want, and a
   * viewport resize must not take it back off them. Call `setZoomMode` to go back.
   */
  setZoom(zoom: number): ExecResult;

  /** Whether the scale is a number the engine holds, or one it recomputes from the viewport. */
  getZoomMode(): ZoomMode;
  /**
   * Choose between holding a scale and tracking the viewport.
   *
   * `'auto'` is the shorthand for {@link ZoomMode}'s capped page-width fit and the default
   * for a new editor: a window wide enough for the sheet stays at 100%, and a narrower one
   * shrinks instead of growing a horizontal scrollbar. Refused (`invalidArgs`) for a value
   * that is not a mode, in the same spirit as `setZoom`.
   *
   * A fit tracks the scroller's CONTENT box, so anything that reserves width beside the page
   * — an open comments rail, a docked navigation pane — shrinks the document by exactly what
   * it took. Nothing else has to be told.
   */
  setZoomMode(mode: ZoomMode | 'auto'): ExecResult;

  // ─── Geometry ──────────────────────────────────────────────────────────────
  //
  // ONE MEMBER, deliberately. This contract used to carry a whole interaction and geometry
  // cluster — an interaction frame, hit testing, caret and selection rects, scroll extent,
  // typed pointer dispatch — and every one of them was a stub returning null, `[]` or
  // `unsupported`. Nothing called them, because there was nothing behind them to call.
  //
  // A stub is not a free placeholder here. `hitTest` returning `null` is indistinguishable
  // from the legitimate answer "you clicked the page margin", so a caller could not tell
  // unimplemented from no-target; `getPageGeometry` returning `[]` silently made Vue's
  // rulers render nothing at all, and nobody noticed for as long as it shipped. An API that
  // answers wrongly is worse than one that is absent, because absence is a compile error.
  //
  // The capability was never in this contract anyway: pointer hit testing lives in the
  // layout lane (`layout/semantic-hit-test.ts`) and the paginated surface calls it directly.
  // Re-exposing any of it here is a small wiring job on the day a host actually needs it.

  /** Page boxes in stack coordinates, each with the text area the engine laid out.
   *  `contentBox` is the page inset by the section margin — rulers draw margin zones from
   *  it instead of assuming a default. The engine's margin is uniform on all four sides
   *  today, so this must not be presented as per-side fidelity it does not have.
   *
   *  Empty before the first layout, which is the honest answer rather than a guessed page. */
  getPageGeometry(): readonly { index: number; box: Rect; contentBox: Rect }[];

  /** Replaces the module-scope cache-invalidation calls adapters make today. */
  relayout(options?: { sync?: boolean }): void;
  focus(scope?: EditorScope): InteractionOutcome<void>;
  destroy(): void;

  on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe;
}

/**
 * Open by declaration merging: extensions contribute keys from `core/plugin`.
 * `exec` resolves `{ type, ... }` through the extension registry, which is
 * already the production dispatch path.
 */
/**
 * In the editor a command targets the current selection unless told otherwise,
 * and authoring is ambient — the author comes from `DocxEditorConfig`/the session,
 * the way the Office JS API sources it from context — so the document layer's
 * required `target` and `author` both become optional here.
 */
export type EditorCommandShape<T> = {
  [K in keyof T]: Omit<T[K], 'target' | 'author'> &
    (T[K] extends { target: infer G } ? { target?: G } : unknown) &
    (T[K] extends { author: infer A } ? { author?: A } : unknown);
};

/**
 * One review card's data plus where it sits beside the page.
 *
 * Flat and presentation-ready ON PURPOSE. A card needs an author, initials, a date and some
 * text; deriving those from the canonical tree means walking runs and reading `w15:commentsEx`,
 * which is engine work. Handing an adapter the raw node and letting it walk would put document
 * derivation in the hosts — the one thing they are not allowed to own — and would have to be
 * written twice, once per framework. {@link item} stays for a host that wants more.
 */
export type { ReviewItem, ReviewRevisionKind };

/**
 * Narrows what `getReviewItems` returns.
 *
 * Both fields exist to keep the review rail cheap: filtering revision kinds is how a host hides
 * structural cards it has no UI for, and `placement: false` skips the layout pass entirely when
 * only metadata is wanted.
 */
export interface ReviewItemQuery {
  readonly excludeRevisionKinds?: readonly ReviewRevisionKind[];
  /** When false, skip layout geometry; metadata is unchanged and anchors are null. Default true. */
  readonly placement?: boolean;
}

/**
 * What every review card carries, whatever kind of decision it represents.
 *
 * Presentation-ready by design: author, initials, date and text are derived by the ENGINE,
 * because deriving them means walking runs and reading `w15:commentsEx`. An adapter doing that
 * walk would put document derivation in the host and would have to be written once per
 * framework.
 */
export interface ReviewItemPlacementBase {
  /** Stable and unique per DECISION — a revision with three ranges is one entry. */
  readonly key: string;
  /** The engine's own id for the comment, the revision, or the custom node. */
  readonly id: string;
  readonly author: string;
  /** Initials for an avatar: `@w:initials` when the file carries one, else from the name. */
  readonly initials: string;
  /** `@w:date`, absent when the file omits it — Word does when date stamping is off. */
  readonly date?: string;
  /**
   * The comment's body, the words the revision covers, or the custom card's detail.
   *
   * PLAIN TEXT, and it must be rendered as text: a `.docx` is a zip of XML an attacker
   * controls end to end, so this string is untrusted and never markup.
   */
  readonly text: string;
  /**
   * Replies to this item, in document order.
   *
   * Comments AND revisions carry them: OOXML gives `w:ins` and `w:del` no body, so replying
   * to a tracked change writes a comment over the change's own range, and the reply belongs
   * inside the card for the change rather than beside it.
   */
  readonly replyIds: readonly string[];
  /**
   * True when the engine cannot resolve this kind structurally, so accept and reject must
   * not be offered. A card offering a button the engine will refuse is worse than one that
   * explains why it cannot.
   */
  readonly readOnly: boolean;
  /**
   * Whether {@link Editor.setActiveReviewItem} would take this key.
   *
   * False for an item with no resolvable range, and for a revision kind the host's rail
   * excluded through {@link Editor.setReviewActivationExclusions} — the queue still LISTS
   * those, because `getReviewItems` answers "what does this document hold" rather than "what
   * may be clicked", and a host filtering the two apart needs to be told which is which. A
   * card drawn for an item that cannot be activated is a card that does nothing when clicked.
   */
  readonly activatable: boolean;
  /** Document-space Y of the anchor, or null when the item has no resolvable range. */
  readonly anchorY: number | null;
  readonly pageIndex: number | null;
  readonly isActive: boolean;
}

/**
 * How activating a review item places it in the viewport.
 *
 * @public
 */
export interface ReviewActivationOptions {
  /**
   * Where the item lands, or `false` to select it without scrolling at all.
   *
   * Default `'centerIfNeeded'`: silent while the item is already on screen, centred when it
   * has to travel. `'nearest'` scrolls the minimum instead, which parks the item flush
   * against the edge it came in from; `'start'` puts it near the top, the way a jump to a
   * heading reads. `false` is for a host whose own list already drives the scroll and does
   * not want the engine competing with it.
   *
   * It governs the reveal of the ITEM. An item in a header, a footer or a note also opens
   * that story, and opening one always brings its band into view — a story the reader cannot
   * see is one they cannot read the change in, which is the whole point of activating it.
   */
  readonly reveal?: 'start' | 'center' | 'centerIfNeeded' | 'nearest' | false;
}

/** A comment thread's card. @public */
export interface ReviewCommentPlacement extends ReviewItemPlacementBase {
  readonly kind: 'comment';
  /** Whether `w15:commentsEx` marks the thread done. */
  readonly resolved: boolean;
  /** The comment this replies to, absent at the top of a thread. */
  readonly parentId?: string;
  /**
   * The REVISION this comment answers, absent unless it does.
   *
   * A surface listing top-level cards must skip these as well as the ones with a
   * {@link parentId}: the card is rendered inside the change it answers, and a rail that
   * only checked `parentId` drew the reply twice.
   */
  readonly parentRevisionId?: string;
  readonly item: ReviewCommentItem;
}

/** A tracked change's card. @public */
export interface ReviewRevisionPlacement extends ReviewItemPlacementBase {
  readonly kind: 'revision';
  /** Which decision this is. */
  readonly revisionKind: ReviewRevisionKind;
  /**
   * The words a REPLACEMENT removes, when {@link revisionKind} is `'replace'`.
   *
   * Paired with {@link ReviewItemPlacementBase.text}, which holds the words it puts in
   * their place, so a card can say `Replaced "x" with "y"` — one decision, the way Word
   * presents it.
   */
  readonly replacedText?: string;
  readonly item: ReviewRevisionItem;
}

/** A custom node's card (`defineCustomNode` with a `reviewCard` hook). @public */
export interface ReviewCustomPlacement extends ReviewItemPlacementBase {
  readonly kind: 'custom';
  readonly item: ReviewCustomItem;
}

/**
 * A DISCRIMINATED union on {@link ReviewItemPlacementBase.kind}: narrowing the kind
 * narrows `item` and the kind-specific fields with it, so a consumer never writes the
 * `placement.kind === 'custom' && placement.item.kind === 'custom'` double check.
 */
export type ReviewItemPlacement =
  | ReviewCommentPlacement
  | ReviewRevisionPlacement
  | ReviewCustomPlacement;

/**
 * How a keystroke reaches the document.
 *
 * `'suggesting'` changes what an edit MEANS rather than whether it is allowed: typing writes
 * `w:ins` and deleting writes `w:del` over the words it would have removed, so every change
 * arrives as a proposal somebody else accepts or rejects.
 */
export type DocumentEditingMode = 'editing' | 'suggesting' | 'viewing';

/** Which cell edges a table border command targets. */
export type TableBorderTarget =
  | 'all'
  | 'outside'
  | 'inside'
  | 'none'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right';

/** Concrete scopes that apply a complete border spec. */
export type TableBorderEdgeTarget = Exclude<TableBorderTarget, 'none'>;

/**
 * Allowlisted OOXML table border line styles.
 *
 * Kept identical to `store/table-border-style.ts`; `table-border-style-parity.test-d.ts`
 * fails if the contract and store vocabularies drift.
 */
export type TableBorderStyle = 'single' | 'dashed' | 'dotted' | 'double' | 'triple' | 'thick';

/** Complete border spec for {@link EditorCommands.setTableBorders}. Size is in eighths of a point. */
export interface TableBorderSpec {
  readonly style: TableBorderStyle;
  readonly size: number;
  readonly color: ColorValue;
}

/** Vertical placement of content inside selected table cells. @public */
export type TableCellVerticalAlignment = 'top' | 'center' | 'bottom';

/**
 * Adjacent grid columns addressed by an internal divider resize gesture.
 *
 * `sourceRevision` is captured from the store revision when the target is built.
 * Commit MUST refuse when it does not equal the current store revision, even if an older layout
 * remains published for geometry.
 */
export interface TableColumnDividerResizeTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly leftGridColumnId: string;
  readonly rightGridColumnId: string;
  readonly isHeaderRepeat: boolean;
}

/**
 * Last grid column and table width addressed by an outer-right-edge resize gesture.
 *
 * `sourceRevision` is captured from the store revision when the target is built.
 * Commit MUST refuse when it does not equal the current store revision, even if an older layout
 * remains published for geometry.
 */
export interface TableRightEdgeResizeTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly gridColumnId: string;
  readonly isHeaderRepeat: boolean;
}

/** Explicit row occurrence for furniture/context commands. */
export interface TableRowOccurrenceTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly rowId: string;
  readonly isHeaderRepeat: boolean;
}

/** Explicit column occurrence for furniture/context commands. */
export interface TableColumnOccurrenceTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly gridColumnId: string;
  readonly isHeaderRepeat: boolean;
}

/**
 * Every command the editor accepts, keyed by name with its payload as the value.
 *
 * Extends the document-level {@link DocEdits} vocabulary with the things only a LIVE editor has:
 * selection, view state, chrome modes, header/footer and note editing. An interface rather than a
 * closed union so an extension can widen it by declaration merging.
 */
export interface EditorCommands
  extends EditorCommandShape<DocEdits>, EditorHeaderFooterCommands, EditorNoteCommands {
  /** Switch how edits are written. A view command: it changes no document state. */
  setEditingMode: { mode: DocumentEditingMode };
  /**
   * Show or hide the review pane.
   *
   * A view command rather than a document edit, and a COMMAND rather than a host flag so the
   * toolbar button gets its pressed state from the same place every other button does. Both
   * adapters and any host chrome read one answer.
   */
  toggleReviewPane: Record<never, never>;
  toggleMark: { mark: string };
  setMarkAttr: { mark: string; attr: string; value: unknown };
  /**
   * Word's Clear All Formatting (Home > Font > the eraser).
   *
   * Takes direct CHARACTER formatting off the selected text, and resets every paragraph the
   * selection touches to the document's default paragraph style with its direct paragraph
   * properties dropped — alignment, indents, spacing, list membership. Character formatting
   * is a range and paragraph formatting is not, so a partial selection clears the text it
   * covers and still resets the paragraph it sits in, which is Word's split.
   *
   * Formatting inherited from a style is not touched: this removes what the document states
   * DIRECTLY, so the text falls back to what its style gives it rather than to nothing.
   *
   * A CHARACTER STYLE survives, and so do paragraph borders and hidden text. Those live
   * outside the property vocabulary an edit can name — a run's `w:rStyle`, `w:vanish` and
   * `w:bdr`, a paragraph's `w:pBdr` and `w:outlineLvl` — and are preserved rather than
   * dropped, which is where this stops short of Word: clearing a run that carries a
   * character style leaves that style's face on it.
   */
  clearFormatting: Record<never, never>;
  setAlignment: { align: 'left' | 'center' | 'right' | 'justify' };
  /**
   * Word's Line Spacing, on every paragraph the selection touches.
   *
   * `value` is in the unit the RULE implies, which is the unit Word's own dialog uses:
   * LINES for `multiple` (1, 1.15, 1.5, 2), points for `exact` and `atLeast`. The
   * OOXML attribute is one number meaning two different quantities depending on
   * `w:lineRule`, and a caller should not have to know which.
   */
  setLineSpacing: { rule: 'multiple' | 'exact' | 'atLeast'; value: number };
  /**
   * Space above and below a paragraph, in points, on every paragraph the selection
   * touches. Omitting a field leaves it as authored; `null` clears it, which is how
   * Word's "Remove space before/after paragraph" differs from setting it to zero.
   */
  setParagraphSpacing: { beforePt?: number | null; afterPt?: number | null };
  /**
   * Exact paragraph indent, in twips, on every paragraph the selection touches.
   *
   * Omitting a field leaves it as authored; `null` clears it so the paragraph falls back to
   * its style, the same distinction `setParagraphSpacing` draws — a zero blocks the cascade,
   * a missing attribute does not.
   *
   * `firstLine` is ONE SIGNED offset from the left indent: negative IS the hanging indent.
   * OOXML spells it as two mutually exclusive attributes (`w:firstLine`/`w:hanging`, where
   * hanging wins per §17.3.1.12); collapsing them here means a caller cannot state a
   * contradiction, and matches the single signed value Word's own model keeps.
   */
  setIndent: {
    left?: number | null;
    right?: number | null;
    firstLine?: number | null;
  };
  toggleList: { kind: 'bullet' | 'ordered' };

  insertRow: { where: 'above' | 'below'; target?: TableRowOccurrenceTarget };
  insertColumn: { where: 'left' | 'right'; target?: TableColumnOccurrenceTarget };
  deleteRow: { target?: TableRowOccurrenceTarget };
  deleteColumn: { target?: TableColumnOccurrenceTarget };
  deleteTable: Record<never, never>;
  mergeCells: Record<never, never>;
  splitCell: { rows: number; cols: number };
  /** Selected-cell fill. `null` clears direct fill so the table-style cascade applies again. */
  setCellFill: { color: ColorValue | null };
  /** Vertically align content inside the selected table cells. */
  setTableCellVerticalAlignment: { alignment: TableCellVerticalAlignment };
  toggleHeaderRow: Record<never, never>;
  /**
   * Selected-cell borders. Concrete edge scopes require a complete spec;
   * `{ scope: 'none', target }` clears only that active edge target and MUST NOT carry `spec`.
   */
  setTableBorders:
    | { scope: 'none'; target: TableBorderEdgeTarget }
    | { scope: TableBorderEdgeTarget; spec: TableBorderSpec };

  /**
   * Commit an internal column-divider resize from an explicit pointer target.
   * Widths are twips for the adjacent pair; their sum must match the pre-drag total.
   */
  commitTableColumnDividerResize: {
    target: TableColumnDividerResizeTarget;
    leftWidthTwips: number;
    rightWidthTwips: number;
  };

  /**
   * Commit an outer-right table-edge resize from an explicit pointer target.
   * Updates the last grid column and overall table width together.
   */
  commitTableRightEdgeResize: {
    target: TableRightEdgeResizeTarget;
    columnWidthTwips: number;
    tableWidthTwips: number;
  };

  /**
   * Select a table region — the whole table, the current row, or the current column.
   * Legacy's table toolbar offers all three.
   */
  selectTableRegion: { region: 'table' | 'row' | 'column' };

  /**
   * Table-level properties from the table properties dialog: preferred width and
   * its unit (`dxa`, `pct`, `auto`), and horizontal justification. `null` clears a
   * property; omitting it leaves the current value alone.
   */
  setTableProperties: {
    width?: number | null;
    widthType?: string | null;
    justification?: 'left' | 'center' | 'right' | null;
  };

  // Page/section breaks go through the inherited `insertBreak`. The Office JS
  // API we intend to expose has a single insertBreak(breakType); section
  // subtypes (continuous / next-page / even / odd) ride that open breakType
  // when it lands, not a separate command here.
  /**
   * Section-level page setup: the fields Word's Page Setup dialog and the rulers'
   * margin drags change. Twips throughout, matching OOXML. Every field is optional —
   * a margin drag sends one, the dialog sends several — and an omitted field is left
   * as it is rather than reset. `scope` is Word's "Apply to": `'document'` (the
   * default) writes every section; `'section'` writes only the section the selection
   * is in. An orientation change without explicit dimensions swaps each written
   * section's own dimensions, preserving distinct paper sizes.
   */
  setPageSetup: {
    pageWidth?: number;
    pageHeight?: number;
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
    orientation?: 'portrait' | 'landscape';
    scope?: 'document' | 'section';
  };

  /** Remove the tab stop at this position (twips) from the current paragraph. */
  removeTabMark: { positionTwips: number };

  /**
   * Replace one found match with `text`. Addressed by {@link TextMatch} rather than a
   * `DocTarget` because that is what `findMatches` hands back, and re-deriving a target
   * from it in the caller is where an off-by-one would come from. An empty `text`
   * deletes the match, which is what a find/replace dialog means by replacing with
   * nothing.
   */
  replaceMatch: { match: TextMatch; text: string };

  /**
   * Replace EVERY match of `query` in one undoable step. Separate from looping
   * `replaceMatch` because each replacement shifts the offsets of the ones after it —
   * legacy applied its edits back-to-front for exactly this reason, and that ordering
   * belongs with whoever owns the offsets.
   */
  replaceAllMatches: {
    query: string;
    text: string;
    matchCase?: boolean;
    wholeWord?: boolean;
  };

  /**
   * How the selected image sits relative to text. `inline` flows in the line; the rest
   * are `wp:anchor` variants, with `squareLeft`/`squareRight` distinguishing which side
   * text wraps on. Legacy's vocabulary, unchanged.
   */
  setImageWrapType: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
    target:
      | 'inline'
      | 'square'
      | 'squareLeft'
      | 'squareRight'
      | 'tight'
      | 'through'
      | 'topAndBottom'
      | 'behind'
      | 'inFront';
    /** Where an inline image sat, so promoting it to an anchor keeps its place. */
    initialPositionEmu?: { horizontalEmu: number; verticalEmu: number };
  };

  /** Rotate or flip the selected image. Legacy composed these into a CSS transform. */
  transformImage: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
    action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';
  };

  /** Anchor position of the selected floating image, from the position dialog. */
  setImagePosition: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
    horizontalEmu?: number;
    verticalEmu?: number;
    relativeToH?: string;
    relativeToV?: string;
  };

  /** Size, alt text, crop, position, and border of the selected image, from the properties dialog. */
  setImageProperties: {
    /** Expected drawing node id captured when the dialog opened. */
    drawingNodeId?: string;
    /** Package revision captured when the dialog opened. */
    expectedPackageRevision?: number;
    /** Selection anchor captured when the dialog opened. */
    selectionParagraphId?: string;
    /** Selection offset captured when the dialog opened. */
    selectionOffset?: number;
    widthEmu?: number;
    heightEmu?: number;
    alt?: string;
    title?: string;
    description?: string;
    hyperlink?: string | null;
    crop?: ImageCropPercent;
    resetToNaturalSize?: boolean;
    wrap?: ImageWrapTarget;
    horizontalEmu?: number;
    verticalEmu?: number;
    relativeToH?: string;
    relativeToV?: string;
    borderWidthEmu?: number;
    borderColor?: ColorValue;
  };

  /** Insert a raster image at the caret as one package undo unit. */
  insertImage: {
    data: Uint8Array;
    mime: SupportedImageMime;
    widthPoints: number;
    heightPoints: number;
    expectedPackageRevision?: number;
    title?: string;
    description?: string;
    hyperlink?: string;
  };

  /** Replace the selected picture's bytes as one package undo unit. */
  replaceImage: {
    data: Uint8Array;
    mime?: SupportedImageMime;
    drawingNodeId?: string;
    expectedPackageRevision?: number;
  };

  /** Delete the selected picture drawing as one package undo unit. */
  deleteImage: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
  };

  setWatermark: { watermark: Watermark | null };
  /** Insert a generated, hyperlink-enabled TOC for heading levels 1–3 at the selection. */
  insertToc: Record<never, never>;
  refreshToc: { tocId?: string; mode?: 'entire' | 'pageNumbers' };

  undo: Record<never, never>;
  redo: Record<never, never>;
  /**
   * Move the selection. Three accepted forms, and `can()` names all three when it refuses:
   * a collapsed paraId anchor, a range of two paraId anchors, or a semantic anchor/head pair.
   *
   * `{ anchor }` takes a {@link DocAnchor} rather than an {@link EditorPosition} because a
   * collapsed SEMANTIC position is spelled as a range whose anchor and head are equal, which
   * is what a caret already is.
   */
  setSelection: { anchor: DocAnchor } | { range: EditorSelection };

  // ── Selection and clipboard ─────────────────────────────────────────────────────────
  //
  // None of these is new capability: the surface has selected the whole document, read its
  // selected text and deleted a selection since it was written, and the browser's own
  // `copy`/`cut`/`paste` events on the pages layer already service the keyboard. They are
  // here so that a caller NAMING the operation — a right-click menu, a host's own button —
  // gets one honest `can()` for it, instead of composing it from `selectedText` +
  // `deleteText` and re-deriving enablement itself, differently, every time.

  /** Select the whole body. Word's Ctrl+A, as a command rather than only a keystroke. */
  selectAll: Record<never, never>;

  /**
   * Put the selected text on the clipboard. Reports `changed: false` — the document is
   * untouched.
   *
   * Refused at a collapsed selection: there is nothing to copy, and a live Copy row over an
   * empty selection silently no-ops.
   */
  copy: Record<never, never>;

  /**
   * Put the selected text on the clipboard and delete it. Refused at a collapsed selection,
   * and — unlike `copy` — in a read-only document.
   *
   * The clipboard write is dispatched but NOT awaited, and its failure does not fail the
   * command: the deletion has already happened by then, and reporting an edit as failed
   * because a clipboard write lost a race would be a lie about the document.
   */
  cut: Record<never, never>;

  /**
   * Insert `text` at the selection, replacing it, with newlines becoming real paragraph
   * boundaries.
   *
   * TEXT COMES IN. `exec` is synchronous and reading the clipboard is not — it prompts in
   * Chrome and is refused outright by Firefox and Safari — so an engine-owned read would
   * have to either turn every command's result into a promise or lie about this one's. The
   * caller reads the clipboard inside the click or keystroke that asked for the paste,
   * which is where the permission gesture belongs, and hands the engine a string.
   *
   * Plain text only. There is no rich lane and no `pastePlain` twin, because a second
   * command would be a second name for exactly this behavior.
   */
  paste: { text: string };
}

/**
 * One command, as a discriminated union derived from {@link EditorCommands}.
 *
 * This is what `can` and `exec` take. Widening `EditorCommands` widens it automatically.
 */
export type EditorCommand = {
  [K in keyof EditorCommands]: { type: K } & EditorCommands[K];
}[keyof EditorCommands];

/**
 * Every query the editor answers, keyed by name with its arguments as the value.
 *
 * Extends {@link DocQueries} with the reads that only mean something against a live, laid-out
 * document: the selection, its formatting, the table or hyperlink under the caret.
 */
export interface EditorQueries extends DocQueries {
  selection: Record<never, never>;
  selectionFormatting: Record<never, never>;
  tableContext: Record<never, never>;
  hyperlinkAt: { pos?: number; fallbackHref?: string };
  selectedText: Record<never, never>;
  watermark: Record<never, never>;
  splitCellConfig: Record<never, never>;
  contentControlAt: { filter?: ContentControlFilter };
  isInsideToc: { pos: number };
  trackedChanges: Record<never, never>;
}

/**
 * One query, as a discriminated union derived from {@link EditorQueries}.
 *
 * This is what `query` takes; {@link EditorQueryResults} says what each answers.
 */
export type EditorQuery = {
  [K in keyof EditorQueries]: { type: K } & EditorQueries[K];
}[keyof EditorQueries];

/** What each editor query returns. Keyed identically to `EditorQueries`. */
export interface EditorQueryResults extends DocQueryResults {
  selection: DocRange | null;
  selectionFormatting: RunFormatting | null;
  tableContext: TableContext | null;
  hyperlinkAt: HyperlinkInfo | null;
  selectedText: string;
  watermark: Watermark | null;
  splitCellConfig: { maxRows: number; maxCols: number } | null;
  contentControlAt: ContentControlSummary | null;
  isInsideToc: boolean;
  trackedChanges: readonly Revision[];
}

/**
 * Where the caret sits inside a table: the table's shape, and the cell holding it.
 *
 * Null from the `tableContext` query when the selection is not in a table at all, which is how
 * table-only chrome decides whether to render.
 */
export interface TableContext {
  readonly rows: number;
  readonly columns: number;
  /** Zero-based, within the table. */
  readonly rowIndex: number;
  /** Zero-based, within the row. */
  readonly columnIndex: number;
}

/**
 * One occurrence of a search query in the document.
 *
 * Carries TWO addresses on purpose. `blockId` + `start` is the engine's own: stable
 * across edits and independent of ordering. `paragraphIndex` + `runIndex` + `runOffset`
 * is the positional one a find/replace UI needs to show and navigate results, and it is
 * derived from the same walk rather than left to the caller to reconstruct — a caller
 * guessing at run boundaries would send the selection to the wrong place.
 *
 * A match can span runs when formatting changes mid-word; the run address is where it
 * STARTS.
 */
export interface TextMatch {
  readonly blockId: string;
  /** Character offset within the paragraph's concatenated run text. */
  readonly start: number;
  readonly length: number;
  /** Ordinal among PARAGRAPHS in the body, skipping tables and other non-paragraph blocks. */
  readonly paragraphIndex: number;
  /** Index of the run the match starts in, and the offset within that run. */
  readonly runIndex: number;
  readonly runOffset: number;
  /** The matched text as it appears in the document. */
  readonly text: string;
  /**
   * Paragraph text immediately before and after the match, bounded at the derivation
   * boundary. A results list shows the match in its sentence — "…as described in this
   * **Exhi**bit A" — and nothing else in the contract can reach paragraph text, so a
   * caller would otherwise have to re-read the document to render one row.
   *
   * Optional and additive: an implementation that has not derived them omits them, and a
   * consumer treats absent as empty.
   */
  readonly contextBefore?: string;
  readonly contextAfter?: string;
}

/**
 * The hyperlink under a position: where it points, how far it reaches, and what Word shows on
 * hover.
 *
 * `href` has already been through `sanitizeHref` — it comes from a file, so a `javascript:` or
 * `data:` target is dropped at the parse boundary rather than here.
 */
export interface HyperlinkInfo {
  readonly href: string;
  readonly range: DocRange;
  /**
   * `w:tooltip` on the `w:hyperlink` — the text Word shows on hover, and what the
   * hyperlink dialog seeds its tooltip field with when editing an existing link.
   */
  readonly tooltip?: string;
}

/**
 * Section page setup — size, orientation and margins, in twips — as `getPageSetup()`
 * and `snapshot().pageSetup` report it and the `setPageSetup` command writes it. In a
 * multi-section document this is the setup of the section the SELECTION is in, which
 * is what a ruler or a dialog reflects — Word's behaviour.
 */
export interface PageSetup {
  readonly pageWidthTwips: number;
  readonly pageHeightTwips: number;
  readonly orientation: 'portrait' | 'landscape';
  readonly marginsTwips: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  /** Binding gutter (`w:gutter`), folded into the left margin by layout. */
  readonly gutterTwips?: number;
}

/**
 * A read model of the current editor state, safe to hand to framework
 * rendering. Named `EditorSnapshot` rather than `EditorState` so it never
 * collides with an editing engine's own state type.
 */
export interface EditorSnapshot {
  readonly scope: EditorScope;
  /** Whether the editor is still waiting for a document: no bytes handed over yet, and no
   *  parse failure. Bytes count from the moment they are supplied, not from the moment
   *  pages paint, so this stays false across a detach and remount. Safe to gate a mount
   *  point on — it never depends on one existing. */
  readonly isLoading: boolean;
  readonly parseError: string | null;
  /** Whether the loaded document is being edited: a patchable document opened in edit mode. A
   *  read-only document (tables/SDTs/unpreservable) or `mode: 'view'` reports false. */
  readonly editable: boolean;
  readonly zoom: number;
  /**
   * Where {@link EditorSnapshot.zoom} came from.
   *
   * Both are needed, and neither implies the other: `zoom` is the resolved scale a ruler
   * multiplies by, `zoomMode` is what a zoom control has to show as selected. A menu that
   * ticked the entry matching the percentage would tick "75%" while the editor was tracking
   * the viewport and about to move off it.
   *
   * Optional and additive like `pageSetup`; absent means the implementation has not derived
   * it, and a consumer reads absent as a plain fixed scale.
   */
  readonly zoomMode?: ZoomMode;
  readonly selection: DocRange | null;
  /**
   * Whether the selection is a CARET rather than a range. `true` when nothing is loaded.
   *
   * Separate from `selection` because `DocRange` addresses paragraphs by paraId and carries
   * no offsets, so a caret and a range inside one paragraph are the same value there.
   * Answering this from `query({ type: 'selectedText' })` builds the whole selected string
   * to produce one bit, on every tick a host's selector runs.
   */
  readonly selectionCollapsed: boolean;
  readonly formatting: RunFormatting | null;
  readonly table: TableContext | null;
  /**
   * The table of contents the last right-click landed on, or null.
   *
   * NOT caret context, unlike `table`: a right-click leaves the selection where it was, and
   * a generated TOC refuses the caret outright, so a host's context menu could otherwise
   * never tell which table of contents it was opened over. Cleared by a right-click
   * anywhere else.
   */
  readonly tocContext: { readonly id: string } | null;
  readonly image: ImageContext | null;
  readonly page: { readonly current: number; readonly total: number };
  /**
   * Whether undo/redo have anything to apply, derived from the session's history.
   * Optional and additive: an implementation that has not derived them omits them,
   * and a consumer treats absent as `false` — the honest empty answer.
   */
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  /**
   * The section's page setup, reference-stable across ticks that did not change it.
   * Optional and additive like `canUndo`: absent means the implementation has not
   * derived it, `null` means no document is loaded.
   */
  readonly pageSetup?: PageSetup | null;
  /**
   * Whether the review pane is showing its cards.
   *
   * In the SNAPSHOT because chrome reflects it: the toolbar's comments button is pressed
   * while it is open, and a button reads its pressed state from the snapshot like every
   * other button. Kept off the snapshot it stayed pressed after the pane closed, because a
   * value-equal snapshot correctly refuses to re-render.
   */
  readonly reviewPaneOpen?: boolean;
  /**
   * Whether the document carries review content — tracked changes or comment
   * anchors — independent of any registered review module.
   *
   * The free tier's honest signal: revisions render in their final-state
   * projection there, so without this a host cannot tell its user "this
   * document has tracked changes" — the one fact the upsell hint needs.
   * Optional and additive like `canUndo`; derived cheaply from store
   * vocabulary and memoized per revision.
   */
  readonly hasReviewContent?: boolean;
  /**
   * How edits are written right now.
   *
   * In the snapshot for the same reason `reviewPaneOpen` is: the editing-mode control shows
   * it, and a control reads what it shows from the snapshot like every other control.
   */
  readonly editingMode?: DocumentEditingMode;
  /**
   * Why the last edit was refused, or null.
   *
   * The engine knew — `lastRejection` has been on the surface all along — and nothing
   * published it, so a keystroke refused because the document is open for viewing, or
   * because suggesting has no author to attribute a proposal to, looked to the user like
   * the editor had simply stopped responding.
   */
  readonly lastRejection?: string | null;
  /**
   * Document font families rendering in a substitute face: declared by the document but
   * not resolvable on this platform, not embedded in the file, and not supplied by the
   * app's font configuration. Chrome shows a compatibility notice from this the way Word
   * does. Optional and additive like `canUndo`: absent means the implementation has not
   * derived it; empty means every family resolved (or no document is loaded).
   */
  readonly fontSubstitutions?: readonly string[];
}

/**
 * Canonical selected-image read model shared by {@link EditorSnapshot.image} and
 * {@link Editor.getSelectedImage}.
 *
 * @public
 */
export interface SelectedImageState {
  readonly id: string;
  readonly kind: DrawingKind;
  readonly widthEmu: number;
  readonly heightEmu: number;
  /** Crop inset per edge in UI percent (0–100); OOXML stores permille (×1000). */
  readonly crop: ImageCropPercent;
  readonly rotationDegrees: number;
  readonly wrap: ImageWrapTarget;
  readonly position: DrawingPositionInput | null;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly hyperlink: string | null;
  readonly locks: DrawingLocks;
  readonly hidden: boolean;
  readonly resourceStatus: ImageResourceState['kind'];
  readonly intrinsic: Readonly<{
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly dpiX: number;
    readonly dpiY: number;
  }> | null;
  readonly canResize: boolean;
  readonly canMove: boolean;
  readonly canChangeWrap: boolean;
  readonly canCrop: boolean;
}

/**
 * The selected image and what may be done to it — the `imageContext` query's answer.
 *
 * An alias of `SelectedImageState`, kept as its own name because it is the query's result type
 * and chrome is written against it.
 *
 * @public
 */
export type ImageContext = SelectedImageState;

/**
 * An error the engine raised, carrying a machine-readable `code` alongside the message.
 *
 * `code` is optional because an `Error` from deeper down (a parser, a codec) is surfaced as-is
 * rather than wrapped in a fabricated code.
 */
export interface EditorError extends Error {
  readonly code?: string;
}

/**
 * What `editor.on(...)` can be subscribed to, and what each handler receives.
 *
 * These are PUSH notifications and are not interchangeable with reading `snapshot()`: a snapshot
 * read cannot observe an event that was never emitted, which is why adapter behaviour is asserted
 * against these rather than against the snapshot.
 */
export interface EditorEvents {
  /** A document mutation committed, with the ids it touched. */
  change: (change: DocumentChange) => void;
  /** The selection or its derived formatting moved. */
  selectionChange: (snapshot: EditorSnapshot) => void;
  error: (error: EditorError) => void;
}
