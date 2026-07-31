/**
 * `@docx-editor.dev/core/editor` — the browser editor facade.
 *
 * CONTRACT ONLY.
 */

import type { ContentControlSummary, DocEdits, DocQueries, DocQueryResults } from '../index';
import type { DisplayPage } from './geometry';
import type {
  AccessibilityObservation,
  CaretGeometry,
  HitTestOptions,
  InputHostObservation,
  InteractionFrame,
  InteractionHostMetrics,
  InteractionIntent,
  InteractionDispatchResult,
  InteractionOutcome,
  RenderedTextGeometryPort,
  SelectionGeometry,
  SelectionGeometryOptions,
  ScrollGeometry,
  SemanticHitTarget,
  SemanticSelection,
  SemanticTarget,
} from './interaction';
import type {
  ColorValue,
  ContentControlFilter,
  DocAnchor,
  DocLocation,
  DocRange,
  Point,
  Rect,
  Revision,
  RunFormatting,
  ExecErrorCode,
  ExecResult,
  Extension,
  Unsubscribe,
  Watermark,
} from './types';

export type * from './types';
export type * from './interaction';

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';

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
 * What `createEditor`/`load` accept as a document: raw DOCX bytes, or an existing
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

export interface EditorConfig {
  host: EditorHost;
  /** A document to load at construction: DOCX bytes or an existing handle. */
  document?: DocumentSource;
  /** Defaults to `createStarterKit()` from `core/plugin`. */
  extensions?: readonly Extension[];
  /** Ambient author for authored commands (comments, tracked changes), sourced
   * the way the Office JS API sources it from context. A command may still
   * override it per call. */
  author?: string;
  locale?: string;
  /** Localized accessible name for the hidden semantic projection; omit to leave the name unset. */
  accessibleName?: string;
  /** Localized read-only atom labels keyed by block kind (for example `table`); omit to leave atom names unset. */
  accessibilityAtomLabels?: Readonly<Record<string, string>>;
  zoom?: number;
  /** `'view'` opens the document read-only (no edit surface is mounted) even when it is otherwise
   *  editable; `'edit'` (default) mounts the editing surface for a patchable document. Sampled at
   *  construction only — switching mode at runtime is not reactive; recreate the editor to change it. */
  mode?: 'edit' | 'view';
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
  /** A footnote/endnote region, addressed by note id. */
  | { kind: 'note'; id: string }
  /** A text box or floating frame with its own content, addressed by id. */
  | { kind: 'frame'; id: string }
  /** Read-only aggregate across every view. Valid for queries, not for writes. */
  | { kind: 'all' };

/** A concrete editing view — every scope except the read-only `all` aggregate. */
export type ViewScope = Exclude<EditorScope, { kind: 'all' }>;

/**
 * A position the engine can resolve. Kept deliberately open: any accepted
 * address form, including a {@link SemanticTarget} or `hitTest` result. New
 * forms may be added without breaking callers, so do not treat this as a closed set.
 */
export type EditorPosition = DocAnchor | DocLocation | SemanticTarget;

/** A selection expressed with any accepted position form. */
export type EditorSelection =
  | DocRange
  | SemanticSelection
  | { from: EditorPosition; to: EditorPosition }
  | SemanticTarget;

/**
 * Everything a framework adapter must supply. The adapter is a renderer and an
 * event forwarder: it hands core DOM to paint into, schedules frames, and
 * receives a positioned `DisplayPage[]` to render. It does not measure, lay
 * out, or interpret the document — core owns all of that.
 *
 * DOM handles are getters, not values: all of them are null through first
 * render, and React's scroll container can change identity between renders.
 */
export interface EditorHost {
  getBodyHostEl(): HTMLElement | null;
  getHfHostEl(rId: string): HTMLElement | null;
  getPagesContainer(): HTMLElement | null;
  /** React returns the real scroller; Vue may return null. */
  getScrollContainer(): HTMLElement | null;

  /** Coalesces engine work. Returns a canceller. */
  scheduleFrame(callback: () => void): () => void;
  /** Current client scroll/zoom/origin metrics for client-coordinate interaction APIs. */
  getInteractionHostMetrics?(): InteractionHostMetrics | null;
  /** Optional browser realization of the current painted text geometry. */
  getRenderedTextGeometry?(): RenderedTextGeometryPort | null;
  /**
   * Runs after the adapter has flushed its own render: `useLayoutEffect` in
   * React, `nextTick` in Vue. Two phases, because engine paint and adapter
   * commit are not the same moment. Optional; Vue may omit it.
   */
  afterCommit?(callback: () => void): void;

  /** Core emitted a fresh positioned render list; paint it. */
  onDisplay?(pages: readonly DisplayPage[]): void;
  onScrollRestore?(pending: PendingScrollRestore): void;
  onSelectionChange?(snapshot: EditorSnapshot): void;
  onTotalPages?(total: number): void;
}

export type CanResult = { ok: true } | { ok: false; code: ExecErrorCode; reason: string };

export interface PendingScrollRestore {
  readonly top: number;
  readonly anchorParaId?: string;
}

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
  }[];

  /** Font families the document actually uses, for the font picker. */
  getDocumentFonts(): readonly string[];

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
  getSelectedImage(): {
    readonly id: string;
    readonly widthEmu: number;
    readonly heightEmu: number;
  } | null;

  /** The table containing the selection, for the table toolbar. `null` outside a table. */
  getSelectedTable(): {
    readonly blockId: string;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly cell: { readonly row: number; readonly column: number } | null;
  } | null;

  /** Section page setup — size, orientation and margins — for the page-setup dialog. */
  getPageSetup(): PageSetup | null;

  /** The document watermark, for the watermark dialog. */
  getWatermark(): { readonly kind: 'text' | 'image'; readonly text?: string } | null;

  /** Header/footer editing state: which region is being edited, if any. */
  getHeaderFooterState(): {
    readonly editing: 'header' | 'footer' | null;
    readonly sectionIndex: number;
  } | null;

  /** Tracked changes in the document, for the review sidebar. */
  getTrackedChanges(): readonly {
    readonly id: string;
    readonly kind: string;
    readonly author?: string;
  }[];
  setActiveScope(scope: ViewScope): void;
  getActiveScope(): ViewScope;

  query<K extends keyof EditorQueries>(
    query: { type: K } & EditorQueries[K],
    options?: { scope?: EditorScope }
  ): EditorQueryResults[K];
  snapshot(options?: { scope?: EditorScope }): EditorSnapshot;

  getTotalPages(): number;
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
   */
  setZoom(zoom: number): ExecResult;

  // ─── Interaction frame (coherent display + geometry projection) ────────────
  /**
   * The current immutable interaction frame. Display, page/scroll geometry,
   * semantic selection, caret/selection overlays, focus, composition, and current
   * page observations are read from this single publication.
   */
  getInteractionFrame(): InteractionFrame;

  // ─── Geometry (core owns layout; the adapter only paints and forwards) ─────
  /** The current positioned render list from {@link getInteractionFrame}. Also
   * delivered via the `display` event and `EditorHost.onDisplay`. */
  getDisplay(): readonly DisplayPage[];
  /** Selection rectangles in content-pixel space from the current frame; defaults
   * to the current selection. Empty when collapsed. */
  getSelectionRects(range?: EditorSelection, options?: SelectionGeometryOptions): readonly Rect[];
  /** Caret rectangle from the current frame; defaults to the current caret. */
  getCaretRect(pos?: EditorPosition): Rect | null;
  /** Frame-bound caret overlay geometry including page and writing direction. */
  getCaretGeometry(pos?: EditorPosition): CaretGeometry | null;
  /** Frame-bound visible selection overlay geometry. */
  getSelectionGeometry(
    range?: EditorSelection,
    options?: SelectionGeometryOptions
  ): SelectionGeometry | null;
  /**
   * Resolve client-space coordinates to a semantic hit target. Returns `null` only when no eligible
   * target exists (e.g. page margin). For typed stale, pending, read-only, invalid, or unsupported
   * outcomes callers MUST use {@link resolvePointer}; `hitTest` does not surface those rejections.
   */
  hitTest(point: Point, options?: HitTestOptions): SemanticHitTarget | null;
  /** Page boxes from the current interaction frame. */
  /** Page boxes in stack coordinates, each with the text area the engine laid out.
   *  `contentBox` is the page inset by the section margin — rulers draw margin zones from
   *  it instead of assuming a default. The engine's margin is uniform on all four sides
   *  today, so this must not be presented as per-side fidelity it does not have. */
  getPageGeometry(): readonly { index: number; box: Rect; contentBox: Rect }[];
  /** Scroll extent from the current interaction frame. */
  getScrollGeometry(): ScrollGeometry;
  /** Resolve pointer intent with typed stale/pending/read-only outcomes (see driver). */
  resolvePointer(point: Point, options?: HitTestOptions): InteractionOutcome<SemanticHitTarget>;
  /**
   * Dispatch one native interaction intent through the shared controller. Applies engine
   * effects (selection sync, focus, commands) and returns host passthrough effects for
   * adapters (capture, release, scroll).
   */
  dispatchInteraction(
    intent: InteractionIntent,
    options?: { hostMetrics?: InteractionHostMetrics }
  ): InteractionDispatchResult;
  /** PM-free accessibility observation projecting the current interaction frame. */
  getAccessibilityObservation(): AccessibilityObservation;
  /** PM-free observation of the hidden input-host clip shell when mounted. */
  getInputHostObservation(): InputHostObservation | null;
  /** Current host origin, scroll, and zoom used to map published IR geometry to client space. */
  getInteractionHostMetrics(): InteractionHostMetrics | null;
  /** Caret rectangle in client coordinates when host metrics and caret geometry exist. */
  getCaretClientRect(): Rect | null;

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
 * and authoring is ambient — the author comes from `EditorConfig`/the session,
 * the way the Office JS API sources it from context — so the document layer's
 * required `target` and `author` both become optional here.
 */
type EditorCommandShape<T> = {
  [K in keyof T]: Omit<T[K], 'target' | 'author'> &
    (T[K] extends { target: infer G } ? { target?: G } : unknown) &
    (T[K] extends { author: infer A } ? { author?: A } : unknown);
};

export interface EditorCommands extends EditorCommandShape<DocEdits> {
  toggleMark: { mark: string };
  setMarkAttr: { mark: string; attr: string; value: unknown };
  setAlignment: { align: 'left' | 'center' | 'right' | 'justify' };
  setIndent: { left?: number; right?: number; firstLine?: number; hanging?: number };
  toggleList: { kind: 'bullet' | 'ordered' };

  insertRow: { where: 'above' | 'below' };
  insertColumn: { where: 'left' | 'right' };
  deleteRow: Record<never, never>;
  deleteColumn: Record<never, never>;
  deleteTable: Record<never, never>;
  mergeCells: Record<never, never>;
  splitCell: { rows: number; cols: number };
  setCellFill: { color: ColorValue };
  toggleHeaderRow: Record<never, never>;
  /**
   * Table and cell borders, in the vocabulary legacy's table toolbar uses: a scope
   * (every edge, the outside ring, the inside grid, one named edge, or none) plus the
   * border spec the toolbar carries — style, size in eighths of a point, and colour.
   * `scope: 'none'` removes borders and ignores `spec`.
   */
  setTableBorders: {
    scope: 'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right';
    spec?: { style: string; size: number; color: ColorValue };
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
   * as it is rather than reset.
   */
  setPageSetup: {
    pageWidth?: number;
    pageHeight?: number;
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
    orientation?: 'portrait' | 'landscape';
  };

  /** Remove the tab stop at this position (twips) from the current paragraph. */
  removeTabMark: { positionTwips: number };

  /**
   * Open a header or footer for editing, materialising an empty one if the section has
   * none — which is what a double-click on the header band means in Word. `firstPage`
   * selects the `w:titlePg` variant.
   */
  editHeaderFooter: { position: 'header' | 'footer'; firstPage?: boolean; sectionIndex?: number };

  /** Leave header/footer editing and return to the body. */
  exitHeaderFooter: Record<never, never>;

  /** Delete the header or footer being edited, and its relationship. */
  removeHeaderFooter: { position: 'header' | 'footer'; firstPage?: boolean };

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
  transformImage: { action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV' };

  /** Anchor position of the selected floating image, from the position dialog. */
  setImagePosition: {
    horizontalEmu?: number;
    verticalEmu?: number;
    relativeToH?: string;
    relativeToV?: string;
  };

  /** Size, alt text and border of the selected image, from the properties dialog. */
  setImageProperties: {
    widthEmu?: number;
    heightEmu?: number;
    alt?: string;
    borderWidthEmu?: number;
    borderColor?: ColorValue;
  };

  /**
   * Footnote and endnote properties for the section — numbering format, restart rule
   * and position, as Word's dialog offers them.
   */
  setNoteProperties: {
    footnote?: { numFmt?: string; numRestart?: string; position?: string; numStart?: number };
    endnote?: { numFmt?: string; numRestart?: string; position?: string; numStart?: number };
  };

  setWatermark: { watermark: Watermark | null };
  refreshToc: { tocId?: string };

  undo: Record<never, never>;
  redo: Record<never, never>;
  setSelection: { anchor: EditorPosition } | { range: EditorSelection };
}

export type EditorCommand = {
  [K in keyof EditorCommands]: { type: K } & EditorCommands[K];
}[keyof EditorCommands];

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
  pageContent: { page: number };
}

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
  pageContent: DisplayPage | null;
}

export interface TableContext {
  readonly rows: number;
  readonly columns: number;
  readonly rowIndex: number;
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
}

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
 * A read model of the current editor state, safe to hand to framework
 * rendering. Named `EditorSnapshot` rather than `EditorState` so it never
 * collides with an editing engine's own state type.
 */
/**
 * Section page setup — size, orientation and margins, in twips — as `getPageSetup()`
 * and `snapshot().pageSetup` report it and the `setPageSetup` command writes it.
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
}

export interface EditorSnapshot {
  readonly scope: EditorScope;
  readonly isLoading: boolean;
  readonly parseError: string | null;
  /** Whether the loaded document is being edited: a patchable document opened in edit mode. A
   *  read-only document (tables/SDTs/unpreservable) or `mode: 'view'` reports false. */
  readonly editable: boolean;
  readonly zoom: number;
  readonly selection: DocRange | null;
  readonly formatting: RunFormatting | null;
  readonly table: TableContext | null;
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
}

export interface ImageContext {
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly wrap: 'inline' | 'square' | 'tight' | 'topAndBottom' | 'behind' | 'inFront';
}

export interface EditorError extends Error {
  readonly code?: string;
}

export interface EditorEvents {
  change: (change: DocumentChange) => void;
  selectionChange: (snapshot: EditorSnapshot) => void;
  display: (pages: readonly DisplayPage[]) => void;
  error: (error: EditorError) => void;
}

/**
 * CONTRACT-ONLY stub. The production implementation lives in
 * `@docx-editor.dev/engine-editor` (it composes the engine packages, which this
 * declaration package may not import) and is what the React/Vue adapters call;
 * it becomes `@docx-editor.dev/core/editor` at the section 7/14 migration. This
 * throwing stub only exists so the contract package typechecks standalone.
 */
export function createEditor(_config: EditorConfig): Editor {
  throw new Error(NOT_IMPLEMENTED);
}
