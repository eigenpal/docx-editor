/**
 * `@docx-editor.dev/core/editor` — the browser editor facade.
 *
 * CONTRACT ONLY.
 */

import type { ContentControlSummary, DocEdits, DocQueries, DocQueryResults } from '../index';
// Type-only, so the adapters reach the review vocabulary through THIS contract rather than
// naming the layout lane, which they are not allowed to import.
import type { ReviewItem, ReviewRevisionKind } from '../layout/review-model.ts';
import type { InteractionOutcome, SemanticSelection, SemanticTarget } from './interaction';
import type {
  ColorValue,
  ContentControlFilter,
  DocAnchor,
  DocLocation,
  DocRange,
  Rect,
  Revision,
  RunFormatting,
  ExecErrorCode,
  ExecResult,
  Extension,
  Unsubscribe,
  Watermark,
} from './types';
import type {
  EditorHeaderFooterCommands,
  EditorNoteCommands,
  HeaderFooterState,
  NotePropertiesState,
} from './editor-hf-notes.ts';

export type * from './types';
export type * from './interaction';
export type * from './editor-hf-notes.ts';

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
  /** `'view'` opens the document read-only even when it is otherwise editable; `'edit'`
   *  (default) mounts the editing surface for a patchable document. This is the INITIAL
   *  value only — move it afterwards with {@link Editor.setEditingMode}, which does not
   *  rebuild the editor and so keeps the undo history and the reader's place. */
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
 * A position the engine can resolve. Kept deliberately open: any accepted address form,
 * including a {@link SemanticTarget}. New forms may be added without breaking callers, so do
 * not treat this as a closed set.
 */
export type EditorPosition = DocAnchor | DocLocation | SemanticTarget;

/** A selection expressed with any accepted position form. */
export type EditorSelection =
  | DocRange
  | SemanticSelection
  | { from: EditorPosition; to: EditorPosition }
  | SemanticTarget;

/**
 * Everything a framework adapter must supply: DOM to paint into, and a way to coalesce
 * work. The adapter does not measure, lay out, or interpret the document — core owns all
 * of that, and paints it directly into the element the adapter hands over.
 *
 * IT DOES NOT RECEIVE A RENDER LIST. This interface used to declare `onDisplay`, a sink for
 * a positioned `DisplayPage[]` core would emit for the adapter to paint. Core never called
 * it, neither adapter implemented it, and rendering has always worked the other way round —
 * `Editor.attach(element)`, with core painting into the host's DOM. The declaration
 * described an architecture that lost, which is a costly thing to leave in a public
 * contract: it is the first thing someone building a new adapter reads.
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
  /**
   * Runs after the adapter has flushed its own render: `useLayoutEffect` in
   * React, `nextTick` in Vue. Two phases, because engine paint and adapter
   * commit are not the same moment. Optional; Vue may omit it.
   */
  afterCommit?(callback: () => void): void;

  onSelectionChange?(snapshot: EditorSnapshot): void;
  onTotalPages?(total: number): void;
}

export type CanResult = { ok: true } | { ok: false; code: ExecErrorCode; reason: string };

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
    readonly story?: 'body' | 'header' | 'footer';
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
  getReviewItems(): readonly ReviewItemPlacement[];

  /**
   * How edits are written: directly, as suggestions, or not at all.
   *
   * Runtime state, unlike the construction-time `EditorConfig.mode` — a reader who switches
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

  /** Card to document: select the item's range and scroll to it. `null` clears the active item. */
  setActiveReviewItem(key: string | null): void;

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
   * Reply to a review item.
   *
   * Against a comment this is a threaded reply. Against a REVISION it is a comment anchored
   * over that revision's range: OOXML gives `w:ins` and `w:del` no body and no thread, so
   * there is nowhere else for the text to live.
   *
   * The author is AMBIENT — `EditorConfig.author`, the way the rest of the authored commands
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
   */
  setZoom(zoom: number): ExecResult;

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
 * and authoring is ambient — the author comes from `EditorConfig`/the session,
 * the way the Office JS API sources it from context — so the document layer's
 * required `target` and `author` both become optional here.
 */
type EditorCommandShape<T> = {
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

export interface ReviewItemPlacement {
  /** Stable and unique per DECISION — a revision with three ranges is one entry. */
  readonly key: string;
  /** The engine's own id for the comment or the revision. */
  readonly id: string;
  readonly kind: 'comment' | 'revision';
  /** Which decision this is, when {@link kind} is `'revision'`. */
  readonly revisionKind?: ReviewRevisionKind;
  readonly author: string;
  /** Initials for an avatar: `@w:initials` when the file carries one, else from the name. */
  readonly initials: string;
  /** `@w:date`, absent when the file omits it — Word does when date stamping is off. */
  readonly date?: string;
  /**
   * The words a REPLACEMENT removes, when {@link revisionKind} is `'replace'`.
   *
   * Paired with {@link text}, which holds the words it puts in their place, so a card can
   * say `Replaced "x" with "y"` — one decision, the way Word presents it.
   */
  readonly replacedText?: string;

  /**
   * The comment's body, or the words the revision covers.
   *
   * PLAIN TEXT, and it must be rendered as text: a `.docx` is a zip of XML an attacker
   * controls end to end, so this string is untrusted and never markup.
   */
  readonly text: string;
  /** Comments only: whether `w15:commentsEx` marks the thread done. */
  readonly resolved?: boolean;
  /** Comments only: the comment this replies to, absent at the top of a thread. */
  readonly parentId?: string;
  /** Comments only: replies to this comment, in document order. */
  readonly replyIds: readonly string[];
  /**
   * True when the engine cannot resolve this kind structurally, so accept and reject must
   * not be offered. A card offering a button the engine will refuse is worse than one that
   * explains why it cannot.
   */
  readonly readOnly: boolean;
  /** Document-space Y of the anchor, or null when the item has no resolvable range. */
  readonly anchorY: number | null;
  readonly pageIndex: number | null;
  readonly isActive: boolean;
  /** The engine's `ReviewItem`, for a host that wants past the card fields. */
  readonly item: ReviewItem;
}

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

  setWatermark: { watermark: Watermark | null };
  /** Insert a generated, hyperlink-enabled TOC for heading levels 1–3 at the selection. */
  insertToc: Record<never, never>;
  refreshToc: { tocId?: string; mode?: 'entire' | 'pageNumbers' };

  undo: Record<never, never>;
  redo: Record<never, never>;
  setSelection: { anchor: EditorPosition } | { range: EditorSelection };

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
