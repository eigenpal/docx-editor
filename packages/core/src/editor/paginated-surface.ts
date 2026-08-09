// Engine-owned paginated paragraph surface (composition root).
// Painted pages are the editable surface; seams live in sibling surface-*.ts modules.

/* eslint-disable max-lines -- composition root; seams live in surface-*.ts */

import { openTreeSession, type TreeDocxSession } from '@docx-editor.dev/core/binding';
import {
  TOC_MAX_PAGE_PASSES,
  deepParagraphOrderOfPart,
  detectBodyTocs,
  findNode,
  hyperlinkTargetOf,
  inlineControlEndingAt,
  inlineControlStartingAt,
  isContentControl,
  parseTocInstruction,
  planTocEntries,
  readViewSettings,
  resolveTocRowHeadings,
  validateTreeOp,
  type DetectedToc,
  type OoxmlElement,
  type OoxmlNode,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { syncActiveFieldShading } from './surface-field-shading.ts';
import {
  createLayoutScheduler,
  createLayoutSession,
  createParagraphLayoutCache,
  resolveDefaultSurfaceMeasurer,
  cellSelectionRects,
  keyedRangeRects,
  formatPageNumber,
  emptyTocPlaceholderParagraphIds,
  paragraphFragmentsOf,
  reviewItemKey,
  reviewItemsAt,
  reviewThreadRootOf,
  selectionRects,
  caretAt,
  cellSelectionText,
  contentControlAtSemantic,
  contentControlsInLayout,
  layoutSemanticDocument,
  paragraphsInCells,
  resolveNumberingLevel,
  paragraphTextFromLayout,
  withNumberingStyleLinks,
  wordBoundary,
  type CellSelection,
  type ContentControlBoundaryRecord,
  type KeyedRange,
  type LayoutScope,
  type NavigationCommand,
  type ReviewItem,
  type ReviewRevisionKind,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import {
  paintSelectionOverlay,
  paintSemanticLayout,
  type OverlayRect,
} from '@docx-editor.dev/core/output';
import {
  DEFAULT_DRAWING_PAINT_STRINGS,
  detachDrawingUrlRegistry,
  type DrawingPaintStrings,
} from '../output/semantic-paint-drawings.ts';
import { tryCreateBrowserCanvasContext } from './browser-canvas-context.ts';
import type {
  ContentControlOps,
  OpenPaginatedResult,
  PaginatedSurface,
  PaginatedSurfaceOptions,
  PaginatedSurfaceState,
  SurfaceEditingMode,
} from './paginated-surface-contract.ts';
import type { ExecResult } from '../contracts/editor.ts';
import type { TableCommandPlan } from './table-command-plan.ts';
import {
  clampedToDocument,
  collapsedAt,
  orderedRangeOf,
  planRangeDeletion,
  selectedTextIn,
  selectionMarkOf,
  type RangeDeletionPlan,
} from './surface-selection-ops.ts';
import {
  createBeforeInputHandler,
  createClipboardHandlers,
  createKeyDownHandler,
} from './surface-input.ts';
import { insertableText } from './clipboard-plain-text.ts';
import {
  createFurnitureSource,
  createNotesLayoutInput,
  createSurfaceStyleDeps,
  equalPageSets,
  equalSurfaceExtents,
  surfaceExtent,
  surfaceScroller,
  visiblePageSet,
  viewportPage,
  type SurfaceExtent,
} from './surface-pages.ts';
import {
  tryCreateBrowserImageDecodePort,
  createHeadlessImageDecodePort,
} from './browser-image-decode-port.ts';
import { createBrowserPaintImageUrlPort } from './browser-paint-image-url-port.ts';
import { createInlineDrawingLayoutBundle } from '../layout/inline-drawing-source.ts';
import { createSurfaceCaret } from './surface-caret.ts';
import { defaultTableLabel, type TableInteractionLabelKey } from './table-chrome.ts';
import { createSurfaceTableInteraction } from './surface-table-interaction.ts';
import { createSurfaceFormat } from './surface-format.ts';
import {
  authoredRunPropertiesAt,
  mergedProperties,
  type SurfaceProperty,
} from './surface-formatting.ts';
import { createPointerController, type PointerController } from './surface-pointer.ts';
import { createSurfaceSelectionSync } from './surface-selection-sync.ts';
import { createSurfaceStructure } from './surface-structure.ts';
// Deep import, not the store barrel: re-exporting a bound from there pulls the whole store
// namespace into the published editor-api surface for one number.
import { MIN_TABLE_COLUMN_WIDTH_TWIPS } from '../store/store/table-constraints.ts';
import { createHyperlinkOps } from './surface-hyperlinks.ts';
import { createSurfaceNavigation } from './surface-navigation.ts';
import { drawingLinkByIdFromLayout } from './drawing-link-index.ts';
import {
  furnitureCaretHost,
  navigateInActiveScope,
  noteCaretHost,
  pointerHeaderFooterState,
  scopedDocumentOrder,
  setHeaderFooterEditingChrome,
  storyScopeOf,
} from './surface-scope.ts';
import { createHeaderFooterOps } from './surface-hf-ops.ts';
import { createImageOps } from './surface-image-ops.ts';
import { createHeaderFooterScopeController } from './surface-hf-editing.ts';
import { createNoteOps } from './surface-note-ops.ts';
import { notePropertiesStateOf, notePreviewTextOf } from './surface-note-state.ts';
import type { ViewScope } from '../contracts/editor.ts';

export type {
  ContentControlOps,
  ContentControlSurfaceState,
  OpenPaginatedResult,
  PaginatedSurface,
  PaginatedSurfaceOptions,
  PaginatedSurfacePerf,
  PaginatedSurfaceState,
  SurfaceFormatting,
} from './paginated-surface-contract.ts';

type ScaleMutableSurface = PaginatedSurface & {
  setScale(nextScale: number): boolean;
};

/**
 * Rescale a mounted surface in place, or report that this one cannot be.
 *
 * Reaches an internal member rather than widening the surface contract, so it has to answer
 * for a surface that does not carry one — a stub or a foreign implementation. `false`, not a
 * TypeError: the caller is a host asking for zoom, and "cannot" is an answer it can render.
 */
export function setPaginatedSurfaceScale(surface: PaginatedSurface, scale: number): boolean {
  const rescale = (surface as Partial<ScaleMutableSurface>).setScale;
  if (typeof rescale !== 'function') return false;
  return rescale.call(surface, scale);
}

/**
 * Mount a paginated surface over DOCX bytes.
 *
 * Returns a typed rejection rather than throwing: a failure here is a property of the file,
 * and a host must be able to tell "not a package" from "no body" without parsing an error
 * message.
 */
export function mountPaginatedSurface(
  container: HTMLElement,
  bytes: Uint8Array,
  options: PaginatedSurfaceOptions = {}
): OpenPaginatedResult {
  const runtimeOptions = options as PaginatedSurfaceOptions & {
    readonly onTrackedChange?: () => void;
  };
  const opened = openTreeSession(
    bytes,
    options.reviewModel ? { reviewModel: options.reviewModel } : {}
  );
  if (!opened.ok) {
    return {
      ok: false,
      reason: opened.reason,
      ...(opened.detail ? { detail: opened.detail } : {}),
    };
  }
  const session = opened.session;
  let scale = options.scale ?? 96 / 72;
  const tableLabelState = {
    resolve:
      options.tableInteractionLabel ?? ((key: TableInteractionLabelKey) => defaultTableLabel(key)),
  };
  const VIEWING_REFUSAL = 'the document is open for viewing';
  const TOC_READ_ONLY_REFUSAL = 'the table of contents is generated and read-only';
  /** Separates a decision's key from its per-range index. A NUL cannot occur in either. */
  const RANGE_SUFFIX = '\u0000range\u0000';
  /** One timestamp per edit. The clock is the host's; the store never reads one. */
  // SECONDS precision, like Word. Milliseconds are valid `xsd:dateTime` but no other editor
  // writes them, and two revisions differing only in milliseconds never group.
  const trackedDate = (): string => `${new Date().toISOString().slice(0, 19)}Z`;
  // Editor seam creates the canvas; layout only consumes the injected context.
  let defaults = options.measurer
    ? null
    : resolveDefaultSurfaceMeasurer(scale, {
        context: tryCreateBrowserCanvasContext(container.ownerDocument),
        // Measure with the same face paint draws with.
        ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
      });
  let measurer = options.measurer ?? defaults!.measurer;
  // Incremental layout machinery — without these every keystroke re-lays out the document.
  const layoutCache = createParagraphLayoutCache<never>();
  const layoutSession = createLayoutSession();
  /**
   * Measurer identity, folded into every layout cache key so a later font resolution cannot
   * serve stale layout.
   *
   * A HOST measurer answers in POINTS, so it means the same thing at every zoom: its identity
   * is stable, and suffixing it with the scale re-measured the whole document on every zoom
   * click while telling the cache two identical answers differed. The DEFAULT measurer is
   * resolved AT a scale — the canvas one rounds against device pixels — so its identity
   * carries that scale, and it is read from the resolution currently in force rather than from
   * whichever one mount happened to get.
   */
  function producerIdentity(): string {
    if (options.measurer) return options.producer ?? 'host-measurer';
    return `${options.producer ?? defaults?.producer ?? 'fixed-measurer'}@scale:${scale}`;
  }
  let producer = producerIdentity();
  const document = container.ownerDocument;

  const pagesLayer = document.createElement('div');
  pagesLayer.className = 'docx-pages';
  pagesLayer.style.position = 'relative';

  // THE PAINTED PAGES ARE THE EDITABLE SURFACE.
  //
  // An offscreen input host cannot coexist with a selection on the page: a document has one
  // selection, so focusing the host destroys the page's, and a contenteditable host holding
  // focus with no selection inside it stops firing `beforeinput` at all — typing and
  // Backspace simply stopped working. Putting focus on the pages themselves gives the
  // browser one place for selection, caret, highlight, keystrokes and IME.
  //
  // The DOM is still a PICTURE: every mutation the browser proposes is prevented and
  // translated into a tree op, and each commit repaints from layout records, so a stray
  // edit cannot survive. Geometry still comes only from layout.
  pagesLayer.contentEditable = 'true';
  pagesLayer.spellcheck = false;
  pagesLayer.setAttribute('role', 'textbox');
  pagesLayer.setAttribute('aria-multiline', 'true');
  pagesLayer.style.outline = 'none';

  // The one highlight the browser cannot draw. A SIBLING of the pages, never a child: the
  // page painter sweeps anything it did not paint out of its own subtree, and a stray child
  // of a contenteditable is editable content a keystroke could land in.
  const overlayLayer = document.createElement('div');
  overlayLayer.className = 'docx-selection-overlay';
  overlayLayer.contentEditable = 'false';
  overlayLayer.setAttribute('aria-hidden', 'true');
  overlayLayer.style.position = 'absolute';
  overlayLayer.style.left = '0';
  overlayLayer.style.top = '0';
  overlayLayer.style.pointerEvents = 'none';

  // Commented text, highlighted the way Word highlights it. Its own layer OVER the pages —
  // under them the band is invisible, because a page paints an opaque sheet — and the band
  // multiplies rather than covers, which is what a real highlighter does: the yellow darkens
  // the paper and leaves the black glyphs black.
  const commentLayer = document.createElement('div');
  commentLayer.className = 'docx-comment-overlay';
  commentLayer.contentEditable = 'false';
  commentLayer.setAttribute('aria-hidden', 'true');
  commentLayer.style.position = 'absolute';
  commentLayer.style.left = '0';
  commentLayer.style.top = '0';
  commentLayer.style.pointerEvents = 'none';

  const tableFurnitureLayer = document.createElement('div');
  tableFurnitureLayer.className = 'docx-table-furniture';
  tableFurnitureLayer.contentEditable = 'false';
  tableFurnitureLayer.style.position = 'absolute';
  tableFurnitureLayer.style.left = '0';
  tableFurnitureLayer.style.top = '0';
  tableFurnitureLayer.style.pointerEvents = 'none';

  container.style.position = 'relative';
  container.replaceChildren(pagesLayer, tableFurnitureLayer, commentLayer, overlayLayer);

  const caret = createSurfaceCaret(
    pagesLayer,
    () => scale,
    () => {
      const active = hfScope?.getActive() ?? null;
      const activeNote = noteOps?.activeNoteScope() ?? null;
      const notePageIndex = noteOps?.activeNotePageIndex() ?? null;
      const scopedHost = active
        ? furnitureCaretHost(pagesLayer, active.pageIndex)
        : activeNote
          ? noteCaretHost(pagesLayer, activeNote.id, notePageIndex)
          : null;
      return {
        layout: currentLayout,
        selection,
        measurer,
        ...(active
          ? { preferredPageIndex: active.pageIndex }
          : notePageIndex !== null
            ? { preferredPageIndex: notePageIndex }
            : {}),
        scopedHost,
        ...(active
          ? { scopedHostKind: 'headerFooter' as const }
          : activeNote
            ? { scopedHostKind: 'note' as const }
            : {}),
      };
    }
  );

  const initialTocParagraphs = new Set(
    detectBodyTocs(session.part()).flatMap((toc) => [
      toc.beginParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ])
  );
  const paragraphIds = session.paragraphIds();
  const firstParagraph =
    paragraphIds.find((paragraphId) => !initialTocParagraphs.has(paragraphId)) ??
    paragraphIds[0] ??
    '';
  let selection: SemanticSelection = {
    anchor: { paragraphId: firstParagraph, offset: 0 },
    head: { paragraphId: firstParagraph, offset: 0 },
  };
  /** Sibling of `selection`: rectangle of table cells, or null for ordinary text. */
  let cellSelection: CellSelection | null = null;
  let lastRejection: string | null = null;
  /** Show-all content-control boundary chrome — surface furniture, never a layout input. */
  let showAllContentControls = false;
  /** Form-fill Tab navigation between editable controls. */
  let formFillMode = false;

  /**
   * A range pinned to stay VISIBLY selected while the focus is somewhere else.
   *
   * A document has one selection. The moment a panel focuses an input of its own, the browser
   * moves that selection into the input and the text the user highlighted stops looking
   * highlighted — which is exactly when they most need to see what the panel is about to act
   * on. Word and Google Docs both keep the range lit; this is how.
   *
   * It is a SIBLING of `selection`, not a replacement: the model selection is untouched, so
   * the op the panel finally runs still addresses the same characters. This only decides what
   * the overlay draws, and how long the panel is entitled to stay open.
   */
  let retainedSelection: SemanticSelection | null = null;

  /** Document-order comparison of two positions: negative, zero or positive. */
  function comparePositions(a: SemanticPosition, b: SemanticPosition): number {
    if (a.paragraphId === b.paragraphId) return a.offset - b.offset;
    const order = paragraphOrder();
    return order.indexOf(a.paragraphId) - order.indexOf(b.paragraphId);
  }

  /**
   * Drop the retained range once the caret leaves it.
   *
   * "Leaves" is inclusive of both edges, so clicking at either end of your own selection is
   * still inside it. A COLLAPSED retained position (Ctrl+K with nothing selected) is left the
   * moment the caret moves at all, which is the same rule with a zero-width range.
   */
  function releaseRetainedIfEscaped(next: SemanticSelection): void {
    if (!retainedSelection) return;
    const { from, to } = orderedRangeOf(currentLayout, retainedSelection);
    const head = next.head;
    if (comparePositions(head, from) >= 0 && comparePositions(head, to) <= 0) return;
    retainedSelection = null;
  }

  /**
   * The armed typing format: what was pressed (`properties`) over the face the caret had
   * when it was pressed (`base`). The base is CAPTURED AT ARM TIME, Word's rule — delete
   * the run beside the caret and the next characters still come out in the face you armed,
   * not in whatever run the caret drifted against.
   */
  interface ArmedFormat {
    readonly properties: readonly SurfaceProperty[];
    readonly base: readonly SurfaceProperty[];
  }

  /**
   * The stored-marks lane: run properties armed at a collapsed caret, applied to the next
   * characters typed there (Word's pending-format behavior — Bold at a caret, then type).
   *
   * Anchored to the position it was armed at: a selection change away from it discards it,
   * the caret-preserving edits (Backspace, Delete, Enter) re-anchor it, and `type()` or
   * the IME readback consumes it. The anchor is double-checked at consumption so a missed
   * clearing path degrades to "the format is forgotten", never "the wrong text is styled".
   */
  let pendingFormats: ({ readonly position: SemanticPosition } & ArmedFormat) | null = null;

  /** The armed pending properties, if the selection still sits where they were armed. */
  function pendingAtCaret(): readonly SurfaceProperty[] | null {
    return armedAtCaret()?.properties ?? null;
  }

  /** The full armed state — properties AND captured base — anchored at the current caret. */
  function armedAtCaret(): ArmedFormat | null {
    if (!pendingFormats) return null;
    const at = pendingFormats.position;
    const collapsedThere = (position: SemanticPosition): boolean =>
      position.paragraphId === at.paragraphId && position.offset === at.offset;
    return collapsedThere(selection.anchor) && collapsedThere(selection.head)
      ? pendingFormats
      : null;
  }

  /** Discard pending caret formatting when `next` is not collapsed at its anchor. */
  function reconcilePendingWith(next: SemanticSelection): void {
    if (!pendingFormats) return;
    const at = pendingFormats.position;
    const stays =
      next.anchor.paragraphId === at.paragraphId &&
      next.anchor.offset === at.offset &&
      next.head.paragraphId === at.paragraphId &&
      next.head.offset === at.offset;
    if (!stays) pendingFormats = null;
  }

  /**
   * Apply an insertion together with the armed caret format, and — if the store refuses the
   * combined transaction — apply the insertion ALONE.
   *
   * THE KEYSTROKE IS NOT THE FORMAT'S HOSTAGE. The armed op rides the insert's transaction
   * so the two are one undo step, which means a property the store rejects would take the
   * typed characters down with it, silently, on every keystroke until the caret moved. Arm
   * time already refuses names outside the vocabulary; this covers everything it cannot see
   * — a malformed attribute value, a store rule that only fails against this document — and
   * degrades to "the format is forgotten", which is the promise this lane makes.
   */
  function withoutPendingOnRejection(
    withFormat: readonly TreeDocOp[],
    withoutFormat: readonly TreeDocOp[],
    mark: ReturnType<typeof selectionMark>,
    redoMark?: { paragraphId: string; start: number; end: number }
  ): ReturnType<TreeDocxSession['applyTreeOps']> {
    const result = applyOps([...withFormat], mark, redoMark);
    if (withFormat.length === withoutFormat.length || !result.rejected) return result;
    return applyOps([...withoutFormat], mark, redoMark);
  }

  function consumePendingFormatOps(
    paragraphId: string,
    offset: number,
    length: number
  ): TreeDocOp[] {
    const armed = armedAtCaret();
    if (!armed || length === 0) return [];
    const at = pendingFormats!.position;
    if (at.paragraphId !== paragraphId || at.offset !== offset) return [];
    return [
      {
        op: 'setRunProperties',
        paragraphId,
        start: offset,
        end: offset + length,
        properties: armed.properties.reduce(
          (merged, property) => mergedProperties(merged, property),
          [...armed.base]
        ),
      },
    ];
  }

  /** Filled once selection sync exists; enter/exit need its noteModelMoved/mirror helpers. */
  let hfScope: ReturnType<typeof createHeaderFooterScopeController> | null = null;
  let noteOps: ReturnType<typeof createNoteOps> | null = null;
  let cachedNoteProperties: ReturnType<typeof notePropertiesStateOf> = null;
  let cachedNotePropertiesKey = '';
  const storyScope = () =>
    storyScopeOf(hfScope?.getActive() ?? null, noteOps?.activeNoteScope() ?? null);
  const noteScopeId = () => noteOps?.activeNoteScope()?.id ?? null;
  const paragraphOrder = () =>
    scopedDocumentOrder(currentLayout, hfScope?.getActive() ?? null, noteScopeId());
  // Phase timers, one slot per phase rather than a log: the state reports the LAST pass,
  // and a host that wants history samples `onChange`. `performance.now()` where the host
  // has one — monotonic, sub-millisecond — and wall clock where it does not (a bare test
  // runtime), which is fine for numbers only ever read by a human.
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  let lastLayoutMs = 0;
  let lastPaintMs = 0;
  let lastSelectionMs = 0;

  // Styles/numbering are immutable in-session; cascade + index are built once and shared
  // by body layout and header/footer stories.
  const { styleCascade, numberingIndex, defaultTabStopPt } = createSurfaceStyleDeps(session);
  let onDrawingResourcesChanged: (() => void) | null = null;
  const decodePort =
    options.imageDecodePort ??
    tryCreateBrowserImageDecodePort(document) ??
    createHeadlessImageDecodePort();
  const drawingBundle = createInlineDrawingLayoutBundle({
    session,
    decodePort,
    onResourcesChanged: () => onDrawingResourcesChanged?.(),
  });
  const drawingStrings: DrawingPaintStrings =
    options.drawingStrings ?? DEFAULT_DRAWING_PAINT_STRINGS;
  /**
   * The insertion point, or null when the selection is not collapsed — a range has two ends
   * and is not "inside" anything, and a second background under one of them would read as a
   * second selection.
   *
   * Collapsed-ness ONLY. Focus and IME composition are the painted caret's own state, held in
   * `surface-caret.ts`, and are not consulted here — so field shading stays lit across a blur
   * and through a composition, which is what Word does with a field the caret is in.
   */
  const collapsedCaretPosition = (): { paragraphId: string; offset: number } | null => {
    if (
      selection.anchor.paragraphId !== selection.head.paragraphId ||
      selection.anchor.offset !== selection.head.offset
    ) {
      return null;
    }
    return { paragraphId: selection.head.paragraphId, offset: selection.head.offset };
  };
  /**
   * `w:doNotShadeFormData`, memoized per package revision.
   *
   * Read on every paint otherwise, and paint runs far more often than `settings.xml` changes —
   * the same reason every other settings read in the engine is revision-keyed.
   */
  let formFieldShadingRevision = -1;
  let formFieldShading = true;
  const shadeFormFields = (): boolean => {
    const revision = session.packageRevision();
    if (formFieldShadingRevision !== revision) {
      formFieldShadingRevision = revision;
      // Inverted at the read: the setting says what NOT to do, the painter wants what to do.
      formFieldShading = !readViewSettings(session.settingsRoot()).doNotShadeFormData;
    }
    return formFieldShading;
  };
  const paintImageUrlPort = createBrowserPaintImageUrlPort({
    mintValidatedBytes: (handle, expectedContentId) =>
      drawingBundle.mintValidatedBytes(handle, expectedContentId),
  });
  let furnitureSource = createFurnitureSource({
    session,
    measurer,
    producer,
    cache: layoutCache,
    styleCascade,
    defaultTabStopPt,
    inlineDrawingLayoutForPart: (partName) => drawingBundle.contextForPart(partName),
    drawingLayoutTokenForPart: (partName) => drawingBundle.cacheTokenForPart(partName),
    drawingTokenForParagraphForPart: (partName, paragraph) =>
      drawingBundle.drawingTokenForParagraph(paragraph, partName),
  });

  /**
   * The engine's ONE hyperlink trust boundary, handed to layout.
   *
   * The resolver reads the session's live relationships, so a link inserted this session
   * resolves immediately rather than only after a save and reopen. `hyperlinkTargetOf`
   * produces the sanitized projection; everything downstream — paint, click routing, the
   * popover, the clipboard — consumes only that.
   */
  const projectLink = (link: Parameters<typeof hyperlinkTargetOf>[0]) => {
    const target = hyperlinkTargetOf(link, (id) => session.relationshipTarget(id));
    if (link.kind === 'textValue') return null;
    return {
      id: link.id,
      kind: target.kind,
      href: target.href,
      ...(target.anchor !== undefined ? { anchor: target.anchor } : {}),
      ...(target.tooltip !== undefined ? { tooltip: target.tooltip } : {}),
    };
  };

  /**
   * The session as every lane sees it: the mode rules applied to `applyTreeOps`.
   *
   * Gating one function inside this file was not enough. Breaks, lists, indent, section
   * properties, formatting, hyperlinks and the IME readback are their own lanes over the
   * SAME session, and each called `applyTreeOps` on it directly — so a "read-only" document
   * still took Ctrl-B, a page-orientation change and a bullet toggle, and suggesting mode
   * wrote an untracked tab or line break while the user believed they were proposing.
   * Wrapping the session is the only place that covers a lane nobody has written yet.
   */
  const gatedSession: TreeDocxSession = {
    ...session,
    applyTreeOps: (ops, before, after) => applyOps(ops, before, after),
    applyPmDoc: (doc) => {
      if (editingMode === 'view') {
        return { committed: false, rejected: true, opCount: 0, reason: VIEWING_REFUSAL };
      }
      if (selectionTouchesToc()) {
        return { committed: false, rejected: true, opCount: 0, reason: TOC_READ_ONLY_REFUSAL };
      }
      return session.applyPmDoc(doc);
    },
  };

  let currentLayout = layoutOnce();
  // Structural edits — breaks, lists, indent, sections — are their own lane over the same
  // session and commit path.
  const format = createSurfaceFormat({
    session: gatedSession,
    storyScope,
    paragraphOrder,
    layout: () => currentLayout,
    selection: () => selection,
    commit: (run, nextSelection, options) => commit(run, nextSelection, options),
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
    selectedCells: () => cellSelection?.cellIds,
    defaultParagraphStyleId: () => styleCascade?.defaultParagraphStyleId ?? null,
    defaultFontFamily: () => options.defaultFontFamily ?? null,
    pendingFormats: () => pendingAtCaret(),
    setPendingFormats: (next) => {
      if (next === null || next.length === 0) {
        if (!pendingFormats) return;
        pendingFormats = null;
      } else {
        // Armed only at a collapsed caret — a range selection formats directly. The base
        // is captured on the FIRST arm at this caret and kept across further presses:
        // it is the face the user saw when they started pressing buttons.
        const { anchor, head } = selection;
        if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return;
        const base =
          armedAtCaret()?.base ??
          authoredRunPropertiesAt(
            session.partFor(storyScope()) ?? session.part(),
            head.paragraphId,
            head.offset
          );
        pendingFormats = { position: head, properties: next, base };
      }
      // Not document state, but observable state: the toolbar's Bold must light up NOW,
      // and the snapshot cache invalidates on this report.
      options.onChange?.(currentState());
    },
  });
  const structure = createSurfaceStructure({
    session: gatedSession,
    storyScope,
    paragraphOrder,
    layout: () => currentLayout,
    // Structural edits at the caret KEEP the armed typing format, the way Word does: a
    // Shift+Enter line break, a Tab, a page break or turning the paragraph into a list item
    // all leave the user typing at a new caret in the face they armed. Captured before the
    // ops run, re-anchored at the post-edit caret.
    commit: (run, nextSelection) =>
      commit(run, nextSelection, { rearmPending: armedAtCaret() ?? undefined }),
    orderedStart: () => orderedStart(),
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    collapsedAt: (position) => collapsedAt(position),
    deleteSelectionPlan: () => deleteSelectionPlan(),
    paragraphTextOf: (paragraphId) => textOf(paragraphId),
    // Resolved through `w:numStyleLink` the way LAYOUT resolves markers (§17.9.21):
    // against the raw index a delegating definition has no levels of its own, so every
    // level of Word's List Bullet / List Number styles read as missing and a plain
    // `setListLevel` was refused where layout would have rendered the marker fine.
    numberingLevelExists: (numId, level) =>
      resolveNumberingLevel(
        withNumberingStyleLinks(numberingIndex(), styleCascade),
        numId,
        level
      ) !== null,
  });
  const hyperlinks = createHyperlinkOps({
    session: gatedSession,
    // Asked BEFORE the relationship is minted. The gated session refuses the ops in viewing mode
    // either way, but the mint is a package write that the refusal does not roll back — Ctrl+K in a
    // document open for reading left its target declared in `.rels`.
    refusesWrite: () => writeRefusal(true) !== null,
    storyScope,
    selection: () => selection,
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
    commit: (run, selectionAfter) => commit(run, selectionAfter),
  });
  const navigation = createSurfaceNavigation({
    pagesLayer,
    container,
    scale: () => scale,
    layout: () => currentLayout,
    bookmarks: () => session.bookmarks(),
    linkById: (linkId) => hyperlinks.linkById(linkId),
    drawingLinkById: (drawingNodeId) => drawingLinkByIdFromLayout(currentLayout, drawingNodeId),
    setSelection: (position) => setSelection(collapsedAt(position)),
    isCollapsedSelection: () =>
      selection.anchor.paragraphId === selection.head.paragraphId &&
      selection.anchor.offset === selection.head.offset,
    onScrolled: () => rematerialize(),
    ...(options.onHyperlinkPopover ? { onPopover: options.onHyperlinkPopover } : {}),
  });
  pagesLayer.addEventListener('contextmenu', onTocContextMenu);
  pagesLayer.addEventListener('click', onTocRowClick);
  pagesLayer.addEventListener('pointermove', onTocPointerMove);
  pagesLayer.addEventListener('pointerleave', onTocPointerLeave);
  let desiredX: number | null = null;

  function layoutDocument(revision: number): SemanticLayout {
    drawingBundle.sync(session);
    const notes = createNotesLayoutInput({
      session,
      measurer,
      producer,
      cache: layoutCache,
      styleCascade,
      defaultTabStopPt,
      inlineDrawingLayoutForPart: (partName) => drawingBundle.contextForPart(partName),
      drawingTokenForParagraphForPart: (partName, paragraph) =>
        drawingBundle.drawingTokenForParagraph(paragraph, partName),
    });
    return layoutSemanticDocument(session.part(), revision, {
      measurer,
      cache: layoutCache,
      session: layoutSession,
      producer,
      styleCascade,
      defaultTabStopPt,
      numberingIndex: numberingIndex(),
      sectionFurniture: furnitureSource.sectionFurniture(),
      furniture: furnitureSource.furniture(),
      projectLink,
      inlineDrawingLayout: drawingBundle.bodyContext,
      drawingTokenForParagraph: (paragraph) =>
        drawingBundle.drawingTokenForParagraph(paragraph, session.part().name),
      ...(notes ? { notes } : {}),
      // The layout context key already folds the mode in (`|rev:<mode>`), so a surface
      // constructed `proposed` never shares cached pages with an `all-markup` one.
      ...(options.revisionDisplayMode ? { displayMode: options.revisionDisplayMode } : {}),
    });
  }

  function layoutOnce(): SemanticLayout {
    const began = now();
    const layout = layoutDocument(session.packageRevision());
    lastLayoutMs = now() - began;
    return layout;
  }

  const scheduler = createLayoutScheduler({
    // The DOCUMENT's geometry, exactly as the first paint uses. Omitting it meant the first
    // paint honoured A4 and the first committed edit silently repaginated onto Letter — every
    // layout after the first comes through here rather than through `layoutOnce`.
    run: (scope: LayoutScope) => {
      const began = now();
      const layout = layoutDocument(scope.revision);
      lastLayoutMs = now() - began;
      return layout;
    },
    currentRevision: () => session.packageRevision(),
    publish: (layout) => {
      currentLayout = layout;
      // Repaint from HERE, so a commit that never went through this surface — undo, or
      // another editor sharing the store — still reaches the screen. Otherwise the painted
      // pages keep showing a revision the model has already left.
      render();
    },
  });

  // A settled image resource must reach the screen on its own — nothing else may ever
  // touch the document (a letterhead the user only reads). The flush is queued, not
  // immediate, so a burst of settles (every image of a page decoding) lays out once; after
  // destroy the scheduler is cancelled and the queued flush finds nothing pending.
  let resourceFlushQueued = false;
  onDrawingResourcesChanged = () => {
    scheduler.invalidateAll(session.packageRevision(), 'drawing-resources');
    if (resourceFlushQueued) return;
    resourceFlushQueued = true;
    setTimeout(() => {
      resourceFlushQueued = false;
      flushLayout();
    }, 0);
  };

  // Every committed transaction, whatever produced it — this surface, undo, or another
  // editor sharing the store — reaches layout the same way.
  const unsubscribe = session.subscribe((modelChange) => {
    // A commit from OUTSIDE this surface retires the armed typing format: the tree it was
    // armed against has moved, and the offsets it is anchored to no longer mean what they
    // did. This surface's own commits already cleared it before running their ops (and
    // re-arm afterwards, which happens after this fires), so this is only ever the
    // external case.
    pendingFormats = null;
    scheduler.notify(modelChange);
  });

  function visiblePages(): ReadonlySet<number> | undefined {
    const set = visiblePageSet(container, currentLayout, selection, scale);
    const occurrence = hfScope?.getActive()?.pageIndex;
    if (occurrence === undefined || set === undefined || set.has(occurrence)) return set;
    return new Set([...set, occurrence]);
  }

  /** Publish any pending layout. Returns whether it did, so callers can avoid a double paint. */
  function flushLayout(): boolean {
    // Nothing pending means nothing committed since the last pass, so the layout in hand is
    // already current and re-running it would be pure waste.
    return scheduler.pending() ? scheduler.flush() : false;
  }

  /** TOC chrome is hover-projected; never sticky from caret/click. */
  let hoveredTocControlId: string | null = null;

  function tocControlIdOf(toc: ReturnType<typeof detectBodyTocs>[number]): string {
    return toc.contentControlId ?? `toc:${toc.id}`;
  }

  function tocContainingParagraph(paragraphId: string) {
    return detectBodyTocs(session.part()).find(
      (toc) =>
        toc.beginParagraphId === paragraphId ||
        toc.endParagraphId === paragraphId ||
        toc.resultParagraphIds.includes(paragraphId)
    );
  }

  /**
   * Hover retints the chrome ALREADY PAINTED — it must never repaint the document.
   *
   * Chrome sends `mousedown` and then `contextmenu` for one right-click. Repainting on the
   * pointermove that enters a TOC replaced the node the gesture started on, and the
   * `contextmenu` that followed fired on a detached element, so it never bubbled to this
   * layer and the first right-click on a TOC did nothing at all. Painted DOM identity is
   * therefore stable across a hover change, and the attributes move instead.
   */
  function applyTocHoverChrome(): void {
    for (const chrome of pagesLayer.querySelectorAll<HTMLElement>(
      '.docx-content-control-chrome[data-docx-toc]'
    )) {
      if (chrome.getAttribute('data-docx-content-control') === hoveredTocControlId) {
        chrome.dataset.hover = '';
        chrome.dataset.boundaryVisible = '';
        continue;
      }
      delete chrome.dataset.hover;
      // Show-all keeps every boundary visible on its own account; only the hover-owned
      // visibility goes back off here.
      if (!showAllContentControls) delete chrome.dataset.boundaryVisible;
    }
  }

  function setHoveredTocControlId(next: string | null): void {
    if (hoveredTocControlId === next) return;
    hoveredTocControlId = next;
    applyTocHoverChrome();
  }

  function onTocPointerMove(event: PointerEvent): void {
    const paragraph = (event.target as Element | null)?.closest<HTMLElement>('[data-paragraph-id]');
    const paragraphId = paragraph?.dataset.paragraphId;
    const toc = paragraphId ? tocContainingParagraph(paragraphId) : null;
    setHoveredTocControlId(toc ? tocControlIdOf(toc) : null);
  }

  /**
   * The paragraph a click or right-click landed on, resolved without trusting the target.
   *
   * A gesture that begins on a node some other pass then replaces arrives with a target
   * that is no longer in the tree, so `closest` finds nothing worth acting on. Hit-testing
   * the live tree at the same point keeps the gesture rather than dropping it.
   */
  function gestureParagraphId(event: MouseEvent): string | undefined {
    const target = event.target as Element | null;
    const direct = target?.isConnected
      ? target.closest<HTMLElement>('[data-paragraph-id]')
      : undefined;
    if (direct) return direct.dataset.paragraphId;
    const view = pagesLayer.ownerDocument;
    if (typeof view.elementFromPoint !== 'function') return undefined;
    const hit = view.elementFromPoint(event.clientX, event.clientY);
    return hit?.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId;
  }

  function onTocPointerLeave(): void {
    setHoveredTocControlId(null);
  }

  function contentControlChromeOptions():
    | {
        readonly showAll?: boolean;
        readonly activeIds?: ReadonlySet<string>;
        readonly hoverIds?: ReadonlySet<string>;
        readonly checkedIds?: ReadonlySet<string>;
        readonly additionalBoundaries?: readonly ContentControlBoundaryRecord[];
        readonly tocControlIds?: ReadonlySet<string>;
        readonly suppressedIds?: ReadonlySet<string>;
      }
    | undefined {
    const active = contentControlAtCaret();
    const emptyTocBeginIds = emptyTocPlaceholderParagraphIds(session.part());
    const tocs = detectBodyTocs(session.part());
    const tocBoundaries = tocs
      .map((toc) => {
        const entry = tocBoundary(toc);
        return entry ? { ...entry, empty: emptyTocBeginIds.has(toc.beginParagraphId) } : null;
      })
      .filter((entry) => entry !== null);
    const tocControlIds = new Set(tocBoundaries.map((entry) => entry.boundary.id));
    // An empty TOC is identified by its own placeholder box, which is the ONE box the
    // region gets: a second boundary rectangle and a label chip over an empty region read
    // as a rendering fault rather than as chrome.
    const suppressedIds = new Set(
      tocBoundaries.filter((entry) => entry.empty).map((entry) => entry.boundary.id)
    );
    // TOC regions never project caret-active chrome — hoverIds own their visibility.
    const activeIds = active && !tocControlIds.has(active.id) ? new Set([active.id]) : undefined;
    const hoverIds = hoveredTocControlId ? new Set([hoveredTocControlId]) : undefined;
    const checkedIds = new Set(
      contentControlsInLayout(currentLayout)
        .filter((control) => control.controlType === 'checkbox' && checkboxChecked(control.id))
        .map((control) => control.id)
    );
    const additionalBoundaries = tocBoundaries
      .filter((entry) => entry.additional && !entry.empty)
      .map((entry) => entry.boundary);
    if (
      !showAllContentControls &&
      !activeIds &&
      !hoverIds &&
      checkedIds.size === 0 &&
      additionalBoundaries.length === 0 &&
      tocControlIds.size === 0
    ) {
      return undefined;
    }
    return {
      ...(showAllContentControls ? { showAll: true } : {}),
      ...(activeIds ? { activeIds } : {}),
      ...(hoverIds ? { hoverIds } : {}),
      ...(checkedIds.size > 0 ? { checkedIds } : {}),
      ...(additionalBoundaries.length > 0 ? { additionalBoundaries } : {}),
      ...(tocControlIds.size > 0 ? { tocControlIds } : {}),
      ...(suppressedIds.size > 0 ? { suppressedIds } : {}),
    };
  }

  function tocBoundary(toc: ReturnType<typeof detectBodyTocs>[number]): {
    readonly tocId: string;
    readonly boundary: ContentControlBoundaryRecord;
    readonly additional: boolean;
  } | null {
    const existing = toc.contentControlId
      ? contentControlsInLayout(currentLayout).find(
          (control) => control.id === toc.contentControlId
        )
      : undefined;
    if (existing) return { tocId: toc.id, boundary: existing, additional: false };

    const paragraphIds = new Set([
      toc.beginParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ]);
    const fragments = currentLayout.pages.flatMap((page) => {
      const boxes = paragraphFragmentsOf(page)
        .filter((fragment) => paragraphIds.has(fragment.paragraphId))
        .map((fragment) => fragment.box);
      if (boxes.length === 0) return [];
      const left = Math.min(...boxes.map((box) => box.x));
      const top = Math.min(...boxes.map((box) => box.y));
      const right = Math.max(...boxes.map((box) => box.x + box.width));
      const bottom = Math.max(...boxes.map((box) => box.y + box.height));
      return [
        {
          pageIndex: page.index,
          box: { x: left, y: top, width: right - left, height: bottom - top },
        },
      ];
    });
    if (fragments.length === 0) return null;
    return {
      tocId: toc.id,
      additional: true,
      boundary: {
        id: `toc:${toc.id}`,
        controlType: 'richText',
        lock: 'unlocked',
        effectiveLock: 'unlocked',
        placeholder: false,
        bound: false,
        nestingDepth: 0,
        level: 'block',
        fragments,
      },
    };
  }

  /** Innermost layout boundary under the caret, or null outside every control. */
  function contentControlAtCaret(): ContentControlBoundaryRecord | null {
    const caret = caretAt(currentLayout, selection.head, measurer);
    if (!caret) return null;
    return contentControlAtSemantic(currentLayout, {
      x: caret.x,
      y: caret.y + caret.height / 2,
      pageIndex: caret.pageIndex,
    });
  }

  function contentLockedOrBound(control: ContentControlBoundaryRecord): string | null {
    if (control.bound) return 'bound';
    if (control.effectiveLock === 'contentLocked' || control.effectiveLock === 'sdtContentLocked') {
      return 'locked';
    }
    return null;
  }

  function removalLocked(control: ContentControlBoundaryRecord): string | null {
    if (control.effectiveLock === 'sdtLocked' || control.effectiveLock === 'sdtContentLocked') {
      return 'locked';
    }
    return null;
  }

  function isContentControlElement(node: OoxmlNode): node is OoxmlElement {
    // Shared walk predicate: typed `contentControl`, or generic WML `sdt` only.
    // Foreign-namespace `<x:sdt>` stays opaque and is never treated as a Word control.
    return isContentControl(node);
  }

  function findControl(controlId: string): OoxmlElement | null {
    const node = findNode(session.part(), controlId);
    if (!node || !isContentControlElement(node)) return null;
    return node;
  }

  function tabIndexOfControl(controlId: string): number | null {
    const control = findControl(controlId);
    if (!control) return null;
    for (const child of control.children) {
      if (child.kind === 'textValue') continue;
      if (
        (child as { kind?: string }).kind === 'contentControlProperties' ||
        child.localName === 'sdtPr'
      ) {
        for (const prop of child.children) {
          if (prop.kind === 'textValue' || prop.localName !== 'tabIndex') continue;
          const raw = prop.attributes.find((a) => a.localName === 'val')?.value;
          if (raw === undefined) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        }
      }
    }
    return null;
  }

  function editableControlsInOrder(): ContentControlBoundaryRecord[] {
    const controls = [...contentControlsInLayout(currentLayout)];
    return controls
      .filter((control) => contentLockedOrBound(control) === null)
      .sort((a, b) => {
        const ta = tabIndexOfControl(a.id);
        const tb = tabIndexOfControl(b.id);
        if (ta !== null && tb !== null && ta !== tb) return ta - tb;
        if (ta !== null && tb === null) return -1;
        if (ta === null && tb !== null) return 1;
        return 0; // document order already from layout
      });
  }

  function addressableLength(node: OoxmlNode): number {
    if (node.kind === 'textValue') return node.value.length;
    if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
    if (node.kind === 'runProperties' || node.kind === 'generic') return 0;
    const kind = (node as { kind: string }).kind;
    if (kind === 'contentControl') {
      let total = 0;
      for (const child of node.children) {
        if (child.kind === 'textValue') continue;
        if (
          (child as { kind: string }).kind === 'contentControlContent' ||
          child.localName === 'sdtContent'
        ) {
          for (const inner of child.children) total += addressableLength(inner);
        }
      }
      return total;
    }
    let total = 0;
    for (const child of node.children) total += addressableLength(child);
    return total;
  }

  function contentChildrenOf(control: OoxmlElement): readonly OoxmlNode[] {
    for (const child of control.children) {
      if (child.kind === 'textValue') continue;
      if (
        (child as { kind: string }).kind === 'contentControlContent' ||
        child.localName === 'sdtContent'
      ) {
        return child.children;
      }
    }
    return [];
  }

  /** Select the control's addressable content for form-fill replacement. */
  function selectControlContent(controlId: string): boolean {
    const control = findControl(controlId);
    if (!control) return false;
    const content = contentChildrenOf(control);
    const paragraphs: { id: string; length: number }[] = [];
    const collectParagraphs = (nodes: readonly OoxmlNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'paragraph') {
          paragraphs.push({ id: node.id, length: addressableLength(node) });
          continue;
        }
        if (node.kind === 'textValue') continue;
        const kind = (node as { kind: string }).kind;
        if (kind === 'contentControl') {
          collectParagraphs(contentChildrenOf(node as OoxmlElement));
          continue;
        }
        collectParagraphs(node.children);
      }
    };
    collectParagraphs(content);

    if (paragraphs.length > 0) {
      const first = paragraphs[0]!;
      const last = paragraphs[paragraphs.length - 1]!;
      setSelection({
        anchor: { paragraphId: first.id, offset: 0 },
        head: { paragraphId: last.id, offset: last.length },
      });
      return true;
    }

    // Inline control: locate the parent paragraph and UTF-16 range.
    let hostParagraphId: string | null = null;
    let start = 0;
    let end = 0;
    const scanInline = (nodes: readonly OoxmlNode[], offset: number, paraId: string): boolean => {
      let cursor = offset;
      for (const node of nodes) {
        if (node.id === controlId) {
          hostParagraphId = paraId;
          start = cursor;
          end = cursor + addressableLength(node);
          return true;
        }
        if (node.kind === 'textValue') {
          cursor += node.value.length;
          continue;
        }
        const kind = (node as { kind: string }).kind;
        if (kind === 'contentControl') {
          const length = addressableLength(node);
          if (scanInline(contentChildrenOf(node as OoxmlElement), cursor, paraId)) return true;
          cursor += length;
          continue;
        }
        if (node.kind === 'run' || node.kind === 'hyperlink') {
          if (scanInline(node.children, cursor, paraId)) return true;
          cursor += addressableLength(node);
          continue;
        }
        if (node.kind === 'paragraph') {
          if (scanInline(node.children, 0, node.id)) return true;
          continue;
        }
        if (node.kind === 'tab' || node.kind === 'hardBreak') {
          cursor += 1;
          continue;
        }
        if (scanInline(node.children, cursor, paraId)) return true;
        cursor += addressableLength(node);
      }
      return false;
    };
    scanInline(session.part().root.children, 0, '');
    if (!hostParagraphId) return false;
    setSelection({
      anchor: { paragraphId: hostParagraphId, offset: start },
      head: { paragraphId: hostParagraphId, offset: end },
    });
    return true;
  }

  function listItemsOfControl(
    controlId: string
  ): readonly { displayText: string; value: string }[] {
    const control = findControl(controlId);
    if (!control) return [];
    for (const child of control.children) {
      if (child.kind === 'textValue') continue;
      if (
        (child as { kind?: string }).kind !== 'contentControlProperties' &&
        child.localName !== 'sdtPr'
      ) {
        continue;
      }
      for (const prop of child.children) {
        if (prop.kind === 'textValue') continue;
        if (prop.localName !== 'dropDownList' && prop.localName !== 'comboBox') continue;
        const items: { displayText: string; value: string }[] = [];
        for (const item of prop.children) {
          if (item.kind === 'textValue' || item.localName !== 'listItem') continue;
          const value = item.attributes.find((a) => a.localName === 'value')?.value ?? '';
          const displayText =
            item.attributes.find((a) => a.localName === 'displayText')?.value ?? value;
          items.push({ displayText, value });
        }
        return items;
      }
    }
    return [];
  }

  function checkboxChecked(controlId: string): boolean {
    const control = findControl(controlId);
    if (!control) return false;
    for (const child of control.children) {
      if (child.kind === 'textValue') continue;
      if (
        (child as { kind?: string }).kind !== 'contentControlProperties' &&
        child.localName !== 'sdtPr'
      ) {
        continue;
      }
      for (const prop of child.children) {
        if (prop.kind !== 'contentControlCheckbox') continue;
        for (const state of prop.children) {
          if (state.kind !== 'contentControlChecked') continue;
          const val = state.attributes.find((a) => a.localName === 'val')?.value;
          return !(val === '0' || val === 'false' || val === 'off');
        }
      }
    }
    return false;
  }

  function dateValueOfControl(controlId: string): string | undefined {
    const control = findControl(controlId);
    if (!control) return undefined;
    for (const child of control.children) {
      if (child.kind !== 'contentControlProperties') continue;
      for (const property of child.children) {
        if (property.kind !== 'contentControlDate') continue;
        return property.attributes.find((attribute) => attribute.localName === 'fullDate')?.value;
      }
    }
    return undefined;
  }

  function setContentControlWidgetOpen(controlId: string, open: boolean): void {
    for (const chrome of pagesLayer.querySelectorAll<HTMLElement>('[data-docx-content-control]')) {
      if (chrome.getAttribute('data-docx-content-control') !== controlId) continue;
      if (open) chrome.dataset.open = '';
      else delete chrome.dataset.open;
    }
  }

  function closeContentControlMenu(menu: HTMLElement): void {
    const controlId = menu.dataset.docxCcId;
    menu.remove();
    if (controlId) setContentControlWidgetOpen(controlId, false);
  }

  function removeExistingContentControlMenu(): void {
    const existing = pagesLayer.querySelector<HTMLElement>('.docx-content-control-menu');
    if (existing) closeContentControlMenu(existing);
  }

  /**
   * Record which TOC a right-click landed on, and otherwise LET IT THROUGH.
   *
   * The engine paints no menu of its own. A host's context menu is one primitive with one
   * set of rows, icons, shortcut column and keyboard model; a second panel painted here
   * would be a second place for all of that to drift, and it looked like one too. What the
   * engine owns is the part a host cannot work out for itself: a right-click does not move
   * the caret, and a TOC refuses the caret entirely, so nothing in `selection` says which
   * table of contents is under the pointer. That is what this publishes.
   */
  function onTocContextMenu(event: MouseEvent): void {
    const paragraphId = gestureParagraphId(event);
    const toc = paragraphId ? tocContainingParagraph(paragraphId) : undefined;
    setContextTocId(toc && canRefreshToc(toc.id) ? toc.id : null);
  }

  /** The TOC the last right-click addressed. Cleared by a right-click anywhere else. */
  let contextTocId: string | null = null;

  function setContextTocId(next: string | null): void {
    if (contextTocId === next) return;
    contextTocId = next;
    options.onChange?.(currentState());
  }

  function onTocRowClick(event: MouseEvent): void {
    if (event.button !== 0 || (event.target as Element | null)?.closest('a.docx-hyperlink')) return;
    if (
      selection.anchor.paragraphId !== selection.head.paragraphId ||
      selection.anchor.offset !== selection.head.offset
    ) {
      return;
    }
    const paragraphId = gestureParagraphId(event);
    if (!paragraphId) return;
    const toc = detectBodyTocs(session.part()).find((candidate) =>
      candidate.resultParagraphIds.includes(paragraphId)
    );
    if (!toc) return;
    // The row names its own target through its anchor or its title. Reading the outline entry
    // that sits at the row's INDEX sends a click to the wrong heading the moment the cached
    // rows and the outline disagree, which is the normal state of a TOC that needs refreshing.
    const headings = resolveTocRowHeadings(
      session.part(),
      toc,
      session.documentOutline(),
      tocRegionOf(toc)
    );
    const headingParagraphId = headings[toc.resultParagraphIds.indexOf(paragraphId)];
    if (!headingParagraphId) return;
    event.preventDefault();
    navigation.goToPosition({ paragraphId: headingParagraphId, offset: 0 });
  }

  function openContentControlWidget(controlId: string, kind: string): void {
    const reason = contentControlsOps.disabledReason(controlId, 'edit');
    if (reason) {
      lastRejection = reason;
      options.onChange?.(currentState());
      return;
    }
    if (kind === 'checkbox') {
      contentControlsOps.setValue(controlId, checkboxChecked(controlId) ? 'false' : 'true');
      return;
    }
    if (kind === 'dropdown' || kind === 'comboBox') {
      const items = listItemsOfControl(controlId);
      if (items.length === 0 && kind === 'dropdown') return;
      // Engine-level menu: no hardcoded English — displayText comes from the file.
      removeExistingContentControlMenu();
      const menu = document.createElement('div');
      menu.className = 'docx-content-control-menu';
      menu.dataset.docxMarker = '';
      menu.dataset.docxCcId = controlId;
      menu.setAttribute('contenteditable', 'false');
      menu.setAttribute('role', 'listbox');
      menu.style.position = 'absolute';
      menu.style.zIndex = '20';
      menu.style.pointerEvents = 'auto';
      menu.addEventListener('pointerdown', (event) => event.stopPropagation());
      const record = contentControlsInLayout(currentLayout).find((c) => c.id === controlId);
      const frag = record?.fragments[0];
      if (frag) {
        const page = currentLayout.pages[frag.pageIndex];
        const offsetX = materializedExtent?.pageOffsetX.get(frag.pageIndex) ?? 0;
        if (page) {
          const contentLeft = page.contentBox.x - page.box.x;
          const contentTop = page.contentBox.y - page.box.y;
          menu.style.left = `${(page.box.x + offsetX + contentLeft + frag.box.x + frag.box.width) * scale}px`;
          menu.style.top = `${(page.box.y + contentTop + frag.box.y + frag.box.height) * scale}px`;
          menu.style.transform = 'translateX(-100%)';
        }
      }
      for (const item of items) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'docx-content-control-menu-item';
        option.dataset.docxMarker = '';
        option.setAttribute('contenteditable', 'false');
        option.setAttribute('role', 'option');
        option.textContent = item.displayText;
        option.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeContentControlMenu(menu);
          contentControlsOps.setValue(controlId, item.value);
        });
        menu.append(option);
      }
      if (kind === 'comboBox') {
        const free = document.createElement('input');
        free.type = 'text';
        free.className = 'docx-content-control-menu-input';
        free.dataset.docxMarker = '';
        free.setAttribute('contenteditable', 'false');
        free.addEventListener('mousedown', (event) => event.stopPropagation());
        free.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          closeContentControlMenu(menu);
          contentControlsOps.setValue(controlId, free.value);
        });
        menu.append(free);
      }
      pagesLayer.append(menu);
      setContentControlWidgetOpen(controlId, true);
      const dismiss = (event: Event): void => {
        if (menu.contains(event.target as Node)) return;
        closeContentControlMenu(menu);
        document.removeEventListener('mousedown', dismiss, true);
      };
      document.addEventListener('mousedown', dismiss, true);
      return;
    }
    if (kind === 'date') {
      removeExistingContentControlMenu();
      const menu = document.createElement('div');
      menu.className = 'docx-content-control-menu';
      menu.dataset.docxMarker = '';
      menu.dataset.docxCcId = controlId;
      menu.setAttribute('contenteditable', 'false');
      menu.style.position = 'absolute';
      menu.style.zIndex = '20';
      menu.style.pointerEvents = 'auto';
      menu.addEventListener('pointerdown', (event) => event.stopPropagation());
      const record = contentControlsInLayout(currentLayout).find((c) => c.id === controlId);
      const frag = record?.fragments[0];
      if (frag) {
        const page = currentLayout.pages[frag.pageIndex];
        const offsetX = materializedExtent?.pageOffsetX.get(frag.pageIndex) ?? 0;
        if (page) {
          const contentLeft = page.contentBox.x - page.box.x;
          const contentTop = page.contentBox.y - page.box.y;
          menu.style.left = `${(page.box.x + offsetX + contentLeft + frag.box.x + frag.box.width) * scale}px`;
          menu.style.top = `${(page.box.y + contentTop + frag.box.y + frag.box.height) * scale}px`;
          menu.style.transform = 'translateX(-100%)';
        }
      }
      menu.classList.add('docx-content-control-calendar');
      const authoredDate = dateValueOfControl(controlId);
      const parsedDate = authoredDate ? new Date(authoredDate) : new Date();
      const selectedDate = Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
      const initialDate = selectedDate ?? new Date();
      let viewYear = initialDate.getFullYear();
      let viewMonth = initialDate.getMonth();
      const monthFormatter = new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      });
      const dayFormatter = new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
      const isoDate = (date: Date): string =>
        `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1)
          .toString()
          .padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
      const sameDay = (left: Date, right: Date): boolean =>
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate();
      let commitPendingManualDate: (() => boolean) | null = null;
      const renderCalendar = (): void => {
        const manual = document.createElement('input');
        manual.type = 'date';
        manual.className = 'docx-content-control-calendar-input';
        manual.value = selectedDate ? isoDate(selectedDate) : '';
        const initialManualValue = manual.value;
        if (record?.alias) manual.setAttribute('aria-label', record.alias);
        const commitManualDate = (): boolean => {
          if (!manual.value || manual.value === initialManualValue) return false;
          const value = manual.value;
          closeContentControlMenu(menu);
          contentControlsOps.setValue(controlId, value);
          return true;
        };
        commitPendingManualDate = commitManualDate;
        manual.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (!commitManualDate()) closeContentControlMenu(menu);
        });
        manual.addEventListener('blur', () => {
          queueMicrotask(() => {
            if (!menu.isConnected || menu.contains(document.activeElement)) return;
            if (!commitManualDate()) closeContentControlMenu(menu);
          });
        });
        const header = document.createElement('div');
        header.className = 'docx-content-control-calendar-header';
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'docx-content-control-calendar-nav';
        previous.textContent = '‹';
        const previousMonth = new Date(viewYear, viewMonth - 1, 1);
        previous.setAttribute('aria-label', monthFormatter.format(previousMonth));
        const title = document.createElement('div');
        title.className = 'docx-content-control-calendar-title';
        title.textContent = monthFormatter.format(new Date(viewYear, viewMonth, 1));
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'docx-content-control-calendar-nav';
        next.textContent = '›';
        const nextMonth = new Date(viewYear, viewMonth + 1, 1);
        next.setAttribute('aria-label', monthFormatter.format(nextMonth));
        previous.addEventListener('mousedown', (event) => event.stopPropagation());
        next.addEventListener('mousedown', (event) => event.stopPropagation());
        previous.addEventListener('click', () => {
          viewMonth -= 1;
          if (viewMonth < 0) {
            viewMonth = 11;
            viewYear -= 1;
          }
          renderCalendar();
        });
        next.addEventListener('click', () => {
          viewMonth += 1;
          if (viewMonth > 11) {
            viewMonth = 0;
            viewYear += 1;
          }
          renderCalendar();
        });
        header.append(previous, title, next);

        const weekdays = document.createElement('div');
        weekdays.className = 'docx-content-control-calendar-weekdays';
        for (let index = 0; index < 7; index += 1) {
          const weekday = document.createElement('span');
          weekday.textContent = weekdayFormatter.format(new Date(2024, 0, 1 + index));
          weekdays.append(weekday);
        }

        const grid = document.createElement('div');
        grid.className = 'docx-content-control-calendar-grid';
        grid.setAttribute('role', 'grid');
        const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
        const today = new Date();
        for (let index = 0; index < 42; index += 1) {
          const date = new Date(viewYear, viewMonth, index - firstWeekday + 1);
          const day = document.createElement('button');
          day.type = 'button';
          day.className = 'docx-content-control-calendar-day';
          day.textContent = String(date.getDate());
          day.setAttribute('role', 'gridcell');
          day.setAttribute('aria-label', dayFormatter.format(date));
          if (date.getMonth() !== viewMonth) day.dataset.otherMonth = '';
          if (selectedDate && sameDay(date, selectedDate)) {
            day.dataset.selected = '';
            day.setAttribute('aria-selected', 'true');
          }
          if (sameDay(date, today)) day.dataset.today = '';
          day.addEventListener('mousedown', (event) => event.stopPropagation());
          day.addEventListener('click', () => {
            closeContentControlMenu(menu);
            contentControlsOps.setValue(controlId, isoDate(date));
          });
          grid.append(day);
        }
        menu.replaceChildren(manual, header, weekdays, grid);
      };
      renderCalendar();
      pagesLayer.append(menu);
      setContentControlWidgetOpen(controlId, true);
      const dismiss = (event: Event): void => {
        if (menu.contains(event.target as Node)) return;
        if (!commitPendingManualDate?.()) closeContentControlMenu(menu);
        document.removeEventListener('mousedown', dismiss, true);
      };
      document.addEventListener('mousedown', dismiss, true);
      menu
        .querySelector<HTMLElement>(
          '[data-selected], [data-today], .docx-content-control-calendar-day'
        )
        ?.focus({ preventScroll: true });
    }
  }

  const contentControlsOps: ContentControlOps = {
    setShowAll(show) {
      if (showAllContentControls === show) return;
      showAllContentControls = show;
      // Furniture-only: rebuild paint without a layout pass.
      render();
    },
    setFormFill(active) {
      if (formFillMode === active) return;
      formFillMode = active;
      options.onChange?.(currentState());
    },
    showAll: () => showAllContentControls,
    formFill: () => formFillMode,
    atCaret: () => contentControlAtCaret(),
    navigate(direction) {
      const editable = editableControlsInOrder();
      if (editable.length === 0) return false;
      const current = contentControlAtCaret();
      let index = current ? editable.findIndex((c) => c.id === current.id) : -1;
      if (direction === 'next') {
        index = index < 0 ? 0 : (index + 1) % editable.length;
      } else {
        index = index < 0 ? editable.length - 1 : (index - 1 + editable.length) % editable.length;
      }
      const target = editable[index]!;
      return selectControlContent(target.id);
    },
    setValue(controlId, value) {
      const reason = contentControlsOps.disabledReason(controlId, 'edit');
      if (reason) {
        lastRejection = reason;
        options.onChange?.(currentState());
        return false;
      }
      let committed = false;
      commit(() => {
        const result = session.applyTreeOps(
          [{ op: 'setContentControlValue', controlId, value }],
          selectionMark()
        );
        committed = result.committed;
        return result;
      });
      return committed;
    },
    remove(controlId) {
      const id = controlId ?? contentControlAtCaret()?.id;
      if (!id) {
        lastRejection = 'notFound';
        options.onChange?.(currentState());
        return false;
      }
      const reason = contentControlsOps.disabledReason(id, 'remove');
      if (reason) {
        lastRejection = reason;
        options.onChange?.(currentState());
        return false;
      }
      let committed = false;
      commit(() => {
        const result = session.applyTreeOps(
          [{ op: 'removeContentControl', controlId: id }],
          selectionMark()
        );
        committed = result.committed;
        return result;
      });
      return committed;
    },
    disabledReason(controlId, action) {
      const record = contentControlsInLayout(currentLayout).find((c) => c.id === controlId);
      if (record) {
        return action === 'remove' ? removalLocked(record) : contentLockedOrBound(record);
      }
      const control = findControl(controlId);
      if (!control) return 'notFound';
      // Layout has not published a boundary yet — refuse conservatively from tree props.
      for (const child of control.children) {
        if (child.kind === 'textValue') continue;
        if (
          (child as { kind?: string }).kind !== 'contentControlProperties' &&
          child.localName !== 'sdtPr'
        ) {
          continue;
        }
        if (child.children.some((c) => c.kind !== 'textValue' && c.localName === 'dataBinding')) {
          if (action === 'edit') return 'bound';
        }
        for (const prop of child.children) {
          if (prop.kind === 'textValue' || prop.localName !== 'lock') continue;
          const val = prop.attributes.find((a) => a.localName === 'val')?.value;
          if (action === 'remove') {
            if (val === 'sdtLocked' || val === 'sdtContentLocked') return 'locked';
          } else if (val === 'contentLocked' || val === 'sdtContentLocked') {
            return 'locked';
          }
        }
      }
      return null;
    },
  };

  function currentState(): PaginatedSurfaceState {
    return {
      revision: session.packageRevision(),
      pageCount: currentLayout.pages.length,
      selection,
      cellSelection,
      canUndo: session.canUndo(),
      canRedo: session.canRedo(),
      lastRejection,
      // Reference-stable while unchanged: `pendingAtCaret` hands back the stored array,
      // so a host can compare states to see whether the armed format moved.
      pendingFormat: pendingAtCaret(),
      contentControls: {
        showAll: showAllContentControls,
        formFill: formFillMode,
        activeControlId: contentControlAtCaret()?.id ?? null,
      },
      contextTocId,
      perf: {
        layoutMs: lastLayoutMs,
        paintMs: lastPaintMs,
        selectionMs: lastSelectionMs,
        placed: layoutSession.stats.placed,
        total: layoutSession.stats.total,
        reusedPages: layoutSession.stats.reusedPages,
        fullPasses: layoutSession.stats.fullPasses,
        staleDiscards: scheduler.staleDiscards,
        cancelledRuns: scheduler.cancelledRuns,
      },
    };
  }

  /** The set the current paint was built with, so a scroll can tell whether it must repaint. */
  let materializedSet: ReadonlySet<number> | undefined;
  /** Sizing the last paint used, so scroll can re-centre when the visible width band moves. */
  let materializedExtent: SurfaceExtent | undefined;
  /** Last body page occupied by the focused collapsed caret. */
  let lastCaretPageIndex: number | null = null;
  /** An edit may move the caret within the same page without going through `setSelection`. */
  let caretFollowPending = false;
  /**
   * The scroller whose SIZE is being watched, and the observer watching it.
   *
   * Declared here, above the paint that re-checks them, so `watchScrollerSize` can never be
   * reached before its own state exists — the wiring below runs late, and a temporal dead
   * zone would be a ReferenceError thrown out of a repaint.
   */
  let viewportObserver: ResizeObserver | null = null;
  let observedScroller: HTMLElement | null = null;

  function applyPageOffsets(extent: SurfaceExtent): void {
    for (const page of currentLayout.pages) {
      const element = pagesLayer.querySelector<HTMLElement>(`[data-page-index="${page.index}"]`);
      if (!element) continue;
      const offsetX = extent.pageOffsetX.get(page.index) ?? 0;
      element.style.left = `${(page.box.x + offsetX) * scale}px`;
    }
  }

  function render(notifyChange = true): void {
    // Reading the DOM selection BEFORE the paint replaces the nodes it lives in is what makes
    // a repaint carry a gesture the queued `selectionchange` has not delivered yet, rather
    // than erase it — see `adoptBeforePaint`.
    const adopted = selectionSync.adoptBeforePaint();
    const paintBegan = now();
    materializedSet = visiblePages();
    // Shared furniture: keep the visual occurrence on a built page before paint marks
    // `data-docx-hf-active`, so scroll cannot leave the caret host on a dematerialized sheet.
    hfScope?.reconcileOccurrence();
    const activeHf = hfScope?.getActive() ?? null;
    const contentControlChrome = contentControlChromeOptions();
    const emptyTocIds = emptyTocPlaceholderParagraphIds(session.part());
    paintSemanticLayout(pagesLayer, currentLayout, {
      scale,
      readOnlyParagraphIds: tocParagraphIds(),
      ...(emptyTocIds.size > 0 ? { emptyTocPlaceholderIds: emptyTocIds } : {}),
      ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
      ...(options.defaultFontFamily ? { defaultFontFamily: options.defaultFontFamily } : {}),
      materialize: materializedSet,
      ariaHidden: false,
      drawingStrings,
      ...(options.fieldShading ? { fieldShading: options.fieldShading } : {}),
      shadeFormFields: shadeFormFields(),
      ...(paintImageUrlPort ? { imageUrlPort: paintImageUrlPort } : {}),
      ...(activeHf
        ? {
            activeHeaderFooterRId: activeHf.scope.rId,
            activeHeaderFooterPageIndex: activeHf.pageIndex,
          }
        : {}),
      ...(contentControlChrome ? { contentControlChrome } : {}),
    });
    // Paint just rebuilt every span, so the caret's field lost its mark with the old DOM.
    syncActiveFieldShading(pagesLayer, collapsedCaretPosition());
    setHeaderFooterEditingChrome(container, pagesLayer, activeHf != null);
    // Viewing mode hides write affordances the painter cannot know about — today the
    // blank header/footer "double-click to add" band.
    container.classList.toggle('docx-paginated-surface--viewing', editingMode === 'view');
    // The pages are absolutely positioned, so the layer has no intrinsic size and the
    // surface would collapse to zero — pages then escape whatever centres or scrolls it.
    // Size it from the records, which is the only place the extent is known.
    materializedExtent = surfaceExtent(currentLayout, materializedSet);
    applyPageOffsets(materializedExtent);
    pagesLayer.style.width = `${materializedExtent.width * scale}px`;
    pagesLayer.style.height = `${materializedExtent.height * scale}px`;
    container.style.width = `${materializedExtent.width * scale}px`;
    container.style.height = `${materializedExtent.height * scale}px`;
    overlayLayer.style.width = `${materializedExtent.width * scale}px`;
    overlayLayer.style.height = `${materializedExtent.height * scale}px`;
    commentLayer.style.width = overlayLayer.style.width;
    commentLayer.style.height = overlayLayer.style.height;
    tableFurnitureLayer.style.width = overlayLayer.style.width;
    tableFurnitureLayer.style.height = overlayLayer.style.height;
    tableInteraction.update();
    // Sizing included: the style writes above invalidate layout, and the selection sync
    // right after is what forces the browser to resolve it. Splitting the timer here would
    // book the paint's own cost to the selection phase.
    lastPaintMs = now() - paintBegan;
    renderOverlay();
    renderCommentHighlights();
    // The surface may only now have been wrapped in its viewport, so the size watcher
    // re-resolves its target here rather than trusting what existed at mount.
    watchScrollerSize();
    selectionSync.mirrorToDom();
    followCaretIntoView(caretFollowPending);
    caretFollowPending = false;
    // A scroll reports nothing — nothing about the document or the selection moved. Taking up
    // a pending gesture DID move the selection, so that pass has to report after all.
    if (notifyChange || adopted) options.onChange?.(currentState());
  }

  /**
   * Follow the viewport: scrolling must reveal BUILT pages, not shells.
   *
   * Materialization is decided at paint time, and without this it was only ever decided on a
   * COMMIT — scrolling a long document showed blank sheets until the next keystroke. A
   * scroll repaints only when the set of pages worth building actually changed, and it does
   * not report a state change: nothing about the document, selection or revision moved.
   */
  function rematerialize(): void {
    const nextSet = visiblePages();
    const nextExtent = surfaceExtent(currentLayout, nextSet);
    if (
      materializedExtent &&
      equalPageSets(nextSet, materializedSet) &&
      equalSurfaceExtents(nextExtent, materializedExtent)
    ) {
      return;
    }
    render(false);
  }

  /**
   * Keep the focused body caret inside the viewport without snapping an already-visible line.
   *
   * Geometry comes from layout because the destination page may still be virtualized. A
   * plain scroll repaint must not pull the reader back to an unchanged caret, so an ordinary
   * render follows only when layout moved the caret to another page; selection/edit paths can
   * force the same nearest-edge check for movement within one page.
   */
  function followCaretIntoView(force = false): void {
    if (hfScope?.getActive() || noteOps?.activeNoteScope()) return;
    if (
      selection.anchor.paragraphId !== selection.head.paragraphId ||
      selection.anchor.offset !== selection.head.offset
    ) {
      return;
    }
    const active = document.activeElement;
    if (active !== pagesLayer && (!active || !pagesLayer.contains(active))) return;

    const geometry = caretAt(currentLayout, selection.head, { measurer });
    if (!geometry) return;
    const changedPage = lastCaretPageIndex !== null && lastCaretPageIndex !== geometry.pageIndex;
    lastCaretPageIndex = geometry.pageIndex;
    if (!force && !changedPage) return;

    const page = currentLayout.pages[geometry.pageIndex];
    const scroller = surfaceScroller(container);
    if (!page || !scroller || scroller.clientHeight <= 0) return;

    const padding = 24;
    const contentTop = page.contentBox.y - page.box.y;
    const top = (page.box.y + contentTop + geometry.y) * scale + container.offsetTop;
    const bottom = top + geometry.height * scale;
    const viewportTop = scroller.scrollTop;
    const viewportBottom = viewportTop + scroller.clientHeight;
    let target = viewportTop;
    if (top < viewportTop + padding) {
      target = top - padding;
    } else if (bottom > viewportBottom - padding) {
      target = bottom + padding - scroller.clientHeight;
    } else {
      return;
    }

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const next = Math.max(0, Math.min(target, maxScroll));
    if (Math.abs(next - scroller.scrollTop) < 0.5) return;
    scroller.scrollTop = next;
    // The destination may have been only a shell. Build it in the next frame rather than
    // recursively repainting from inside the paint that detected the movement.
    scheduleRematerialize();
  }

  let editingMode: SurfaceEditingMode = options.editingMode ?? 'edit';

  /** The main story. Named once so the automation entry cannot drift from the session default. */
  const BODY_STORY: StoryScope = Object.freeze({ kind: 'body' as const });

  /**
   * Commit ops, attributing them when the surface is suggesting.
   *
   * ONE interception point rather than an argument threaded through a dozen emit sites: the
   * ops are built all over this file, and a site that forgot to pass the attribution would
   * silently write an untracked edit in suggesting mode — the failure nobody notices until
   * the document has already lost the proposal.
   */
  function applyOps(
    ops: readonly TreeDocOp[],
    selectionBefore?: Parameters<TreeDocxSession['applyTreeOps']>[1],
    selectionAfter?: Parameters<TreeDocxSession['applyTreeOps']>[2],
    // Defaulted, and therefore evaluated per call: every input path wants the story the
    // reader is in. Only a caller that ALREADY knows which story its ops address — an
    // automation handle names one — passes this, and then the reader's position is irrelevant.
    scope: StoryScope = storyScope(),
    checkSelection = true
  ): ReturnType<TreeDocxSession['applyTreeOps']> {
    const refusal = writeRefusal(ops.some(isDocumentEdit), ops, checkSelection);
    if (refusal !== null) return { committed: false, rejected: true, opCount: 0, reason: refusal };

    // The scope resolves to `storyScope()` unless the caller named one, so an edit inside a
    // header, a footer or a note is applied to that story rather than to the body.
    const attributed = trackedOps(ops);
    const result = session.applyTreeOps(attributed, selectionBefore, selectionAfter, scope);
    if (result.committed && editingMode === 'suggest' && attributed.some(isTrackedEdit)) {
      runtimeOptions.onTrackedChange?.();
    }
    return result;
  }

  /**
   * Why a write would be refused right now, or null when it would be allowed.
   *
   * ONE statement of the mode rules, asked by `applyOps` for every lane and asked once more by the
   * automation path — which has to know the answer BEFORE it builds its ops, because building them
   * can mint a hyperlink relationship, and a relationship survives a refusal. `edits` says whether
   * the write changes the document, which is the only thing the second rule needs from the ops.
   */
  function writeRefusal(
    edits: boolean,
    ops: readonly TreeDocOp[] = [],
    checkSelection = true
  ): string | null {
    // VIEWING refuses every write here rather than only at the facade. The keymap and
    // `beforeinput` are wired to this surface, not to `Editor.exec`, so a facade-only gate
    // left the document fully typeable while the toolbar reported it read-only.
    if (editingMode === 'view') return VIEWING_REFUSAL;
    if (
      edits &&
      ((checkSelection && selectionTouchesToc()) || ops.some((op) => opTouchesToc(op)))
    ) {
      return TOC_READ_ONLY_REFUSAL;
    }
    // SUGGESTING with no author cannot write `CT_TrackChange`, and the fallback of writing
    // an untracked edit is only tolerable when nothing is destroyed. A deletion in that
    // state removes text the reviewer was promised they could get back.
    // EVERY edit, not just the destructive ones. Letting insertions through wrote permanent
    // changes to someone else's document while the pill said Suggesting and the review pane
    // stayed empty — half the keyboard proposing and half editing outright.
    if (editingMode === 'suggest' && !options.author?.trim() && edits) {
      return 'suggesting needs an author before it can propose a change';
    }
    return null;
  }

  /** Ops that change the DOCUMENT, as opposed to reading or resolving it. */
  function isDocumentEdit(op: TreeDocOp): boolean {
    return (
      op.op !== 'acceptRevision' &&
      op.op !== 'rejectRevision' &&
      op.op !== 'acceptAllRevisions' &&
      op.op !== 'rejectAllRevisions'
    );
  }

  /** Ops that create or extend a reviewable proposal. */
  function isTrackedEdit(op: TreeDocOp): boolean {
    switch (op.op) {
      case 'insertText':
      case 'deleteText':
      case 'insertTableRow':
      case 'deleteTableRow':
        return op.revision !== undefined;
      case 'setParagraphMarkRevision':
      case 'proposeParagraphMerge':
        return true;
      default:
        return false;
    }
  }

  /** Suggesting attributes text and structural row edits as Word tracked changes. */
  function trackedOps(ops: readonly TreeDocOp[]): TreeDocOp[] {
    const author = options.author?.trim();
    // `CT_TrackChange` makes `@w:author` required, so with no author there is nothing valid
    // to write. The edit lands untracked rather than being refused: losing the user's typing
    // to a missing configuration value would be the worse failure.
    if (editingMode !== 'suggest' || !author) return [...ops];
    const revision = { author, date: trackedDate() };
    return ops.flatMap((op): TreeDocOp[] => {
      if (
        op.op === 'insertText' ||
        op.op === 'deleteText' ||
        op.op === 'insertTableRow' ||
        op.op === 'deleteTableRow'
      ) {
        return [{ ...op, revision }];
      }
      // A SPLIT becomes a real split plus a proposed mark on the first paragraph: the text
      // is already in two paragraphs, and what is being proposed is the break between them.
      // §17.13.5 puts the new mark on the FIRST paragraph, and rejecting it runs the two
      // back together.
      if (op.op === 'splitParagraph') {
        return [
          op,
          {
            op: 'setParagraphMarkRevision' as const,
            paragraphId: op.paragraphId,
            kind: 'ins' as const,
            revision,
          },
        ];
      }
      // A JOIN becomes a proposal to remove the mark BETWEEN the paragraphs, which belongs
      // to the first — and the paragraphs stay where they are. Joining them outright made
      // rejecting restore the words but not the boundary, so the original was unrecoverable.
      if (op.op === 'joinParagraphs') {
        // Addressed by the SECOND paragraph: the mark being proposed away belongs to
        // whichever paragraph precedes it, and a multi-paragraph delete emits a join per
        // paragraph with `firstId` pinned to the group head — so naming the first stamped
        // one paragraph N times and left the rest untouched.
        return [{ op: 'proposeParagraphMerge' as const, paragraphId: op.secondId, revision }];
      }
      return [op];
    });
  }

  function commit(
    run: () => ReturnType<TreeDocxSession['applyPmDoc']> | boolean,
    selectionAfter?: () => SemanticSelection | null,
    options:
      | {
          readonly keepCellSelection?: boolean;
          /**
           * Re-anchor this armed typing format at the POST-edit caret instead of retiring
           * it. Word's rule: Backspace, Delete and Enter keep the typing format — bold
           * pressed at a caret survives deleting a character or opening a new paragraph,
           * and applies to whatever is typed next there.
           */
          readonly rearmPending?: ArmedFormat;
        }
      | undefined = {}
  ): void {
    // An edit invalidates the rectangle: its cells' content has changed, and the collapsed
    // DOM selection it installed still points at the PRE-edit anchor. Left standing it kept
    // painting a highlight over text that had moved, kept suppressing selection adoption, and
    // kept feeding a stale cell list to the toolbar. Formatting is the one caller that
    // legitimately keeps it — Word leaves cells selected after Bold.
    if (!options?.keepCellSelection) cellSelection = null;
    // A committed edit retires the stored caret format unless the caller re-arms it below:
    // the consumers (`type()`, the IME readback) capture the properties BEFORE calling here,
    // and the caret-preserving edits (Backspace, Delete, Enter) pass `rearmPending`.
    pendingFormats = null;
    // Whatever the DOM selection holds, it was made against the text BEFORE this edit, so its
    // offsets stop meaning the same thing the moment the ops land. The render below must
    // write the model's selection out, never read the stale one back.
    selectionSync.noteModelMoved();
    // Ops go through the session, so the tree stays the only state. A refusal is surfaced
    // rather than silently dropped: the view is repainted from what the model actually
    // holds, so the user never keeps looking at an edit that will not be saved.
    const result = run();
    if (typeof result !== 'boolean' && result.rejected) {
      lastRejection = String(result.reason ?? 'rejected');
    } else {
      lastRejection = null;
      // The post-edit selection is installed BEFORE the paint, so the single render below
      // paints the new pages, mirrors the new caret into the DOM and reports one state
      // change. Committing first and calling `setSelection` afterwards wrote the superseded
      // caret into the fresh DOM, wrote the browser selection twice, and reported every
      // edit twice — the second-largest cost of a keystroke after layout, because a host
      // re-derives toolbar formatting from each report. Supplied as a THUNK evaluated after
      // the ops: a caret landing in a `w:p` the commit minted cannot be computed before the
      // commit runs.
      const next = selectionAfter?.();
      if (next) {
        selection = next;
        desiredX = null;
        caretFollowPending = true;
      }
      // Re-anchor AFTER the post-edit caret is installed, so the armed format follows the
      // edit (Backspace moves it one left, Enter moves it into the new paragraph). Only a
      // collapsed caret can hold one — the same invariant arming enforces.
      const rearm = options?.rearmPending;
      if (rearm && rearm.properties.length > 0) {
        const { anchor, head } = selection;
        if (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset) {
          // The new anchor LAST: `armedAtCaret()` hands back the full armed record, and
          // its stale position must not override where the edit just put the caret.
          pendingFormats = { properties: rearm.properties, base: rearm.base, position: head };
        }
      }
    }
    // A committed edit repaints through the scheduler's publish; a REFUSED one commits
    // nothing, so the surface still has to refresh the state it just changed.
    if (!flushLayout()) render();
  }

  /**
   * Whether every page the CURRENT selection touches has been built.
   *
   * Read from `materializedSet` rather than recomputed: deciding this from the viewport
   * would read `scrollTop`, and forcing a layout on a path that runs for every arrow key is
   * the kind of cost that does not show up until a long document is open. `undefined` means
   * nothing is virtualized and every page is built, which is the safe reading everywhere
   * else too.
   */
  function selectionPagesBuilt(): boolean {
    if (!materializedSet) return true;
    for (const position of [selection.anchor, selection.head]) {
      const caret = caretAt(currentLayout, position);
      if (caret && !materializedSet.has(caret.pageIndex)) return false;
    }
    return true;
  }

  function setSelection(next: SemanticSelection, keepDesiredX = false): void {
    // Moving the caret discards a stored caret format — Word's rule. Landing back on the
    // exact armed position (the mirror re-adopting the same caret) keeps it.
    reconcilePendingWith(next);
    releaseRetainedIfEscaped(next);
    const previousActive = contentControlAtCaret()?.id ?? null;
    const previousToc = tocIdAtParagraph(selection.head.paragraphId);
    selection = next;
    // Any plain selection cancels a rectangle. A caret placed by a click, a keystroke or an
    // edit is a text selection by definition, and leaving the rectangle behind would keep
    // painting cells that are no longer chosen.
    cellSelection = null;
    if (!keepDesiredX) desiredX = null;
    // THE MIRROR NEEDS NODES TO WRITE INTO, AND AN UNBUILT PAGE HAS NONE.
    //
    // A selection can land on a page virtualization has not built — an outline jump, a
    // search hit, any host driving the caret — and that is precisely the page it lands on,
    // since the reason to move the caret there is that the user is not looking at it yet.
    // The mirror then wrote into nodes that do not exist, which fails silently; the caret
    // stayed where it was, and the next repaint read the STALE DOM selection back and
    // overwrote the navigation entirely. Building the page first is what makes the write
    // land: `visiblePageSet` pins the pages the selection touches, so this paint brings the
    // target into existence wherever it is.
    if (!selectionPagesBuilt()) {
      // The MODEL is the newer of the two until that write lands, so this repaint must not
      // adopt the DOM selection it is about to replace — which is the very stale value the
      // navigation is trying to leave behind.
      selectionSync.noteModelMoved();
      render(false);
    }
    // SETTLED, not moved: this mirrors into the DOM on the next line, so the two agree before
    // any render can read them back — including a move raised earlier that no render has
    // carried out. `restoreSelection` raises the flag and only `flushLayout` takes it down, so
    // `undo` on an empty history left it up and disarmed the NEXT repaint, whenever it came.
    selectionSync.noteSelectionSettled();
    // CLAIMED: this is the programmatic entry point — a host's `setSelection`, an opened
    // review card, an outline jump. The plain write refuses whenever the browser's selection
    // sits outside these pages, which is exactly the case when the request came from the
    // host's own chrome (a rail card takes focus on mousedown), and the range the caller
    // asked to SHOW then highlighted nothing at all. A pointer or keyboard move already owns
    // the selection, so claiming changes nothing for them. Focus is never moved.
    selectionSync.mirrorToDom(true);
    followCaretIntoView(true);
    renderOverlay();
    // A dismissal is dismissed for where the caret WAS; any move re-asks the question, which
    // is how the reader reopens an item — by clicking back into its text.
    dismissedReviewKey = null;
    // The caret decides which item is OPEN, so a move re-classifies the bands. The rectangles
    // themselves are cached against the layout and are not recomputed here.
    renderCommentHighlights();
    // Content-control caret chrome is furniture keyed on the active control id. A caret move
    // into / out of a control must rebuild paint without a layout pass.
    const nextActive = contentControlAtCaret()?.id ?? null;
    const nextToc = tocIdAtParagraph(selection.head.paragraphId);
    if (previousActive !== nextActive || previousToc !== nextToc) {
      render(false);
    }
    options.onChange?.(currentState());
  }

  /**
   * The two-way selection mirror and the IME lane.
   *
   * Created HERE, after the commit path it drives and before the listeners it answers: every
   * function it is handed is a hoisted declaration, and nothing renders until the mount paint
   * at the end of this factory.
   */
  const selectionSync = createSurfaceSelectionSync({
    session,
    storyScope,
    document,
    pagesLayer,
    selection: () => selection,
    setSelection: (next) => setSelection(next),
    // The raw take-up, without the mirror or the report `setSelection` performs: the render
    // this runs inside is about to do both.
    adoptSelection: (next) => {
      reconcilePendingWith(next);
      releaseRetainedIfEscaped(next);
      selection = next;
      desiredX = null;
      caretFollowPending = true;
    },
    commit: (run) => commit(run),
    render: () => render(),
    flushLayout: () => flushLayout(),
    updateCaret: () => {
      caret.update();
      syncActiveFieldShading(pagesLayer, collapsedCaretPosition());
    },
    textOf: (paragraphId) => textOf(paragraphId),
    pendingFormatOps: (paragraphId, offset, length) =>
      consumePendingFormatOps(paragraphId, offset, length),
    selectionMark: () => selectionMark(),
    now,
    recordSelectionMs: (ms) => {
      lastSelectionMs = ms;
    },
    isGesturing: () => pointer?.dragging() ?? false,
    domSelection: () => (cellSelection ? collapsedAt(cellSelection.text.anchor) : selection),
    holdsCellSelection: () => cellSelection !== null,
  });

  hfScope = createHeaderFooterScopeController({
    session,
    layout: () => currentLayout,
    selection: () => selection,
    setScopeSelection: (next) => {
      selection = next;
      cellSelection = null;
      desiredX = null;
    },
    noteModelMoved: () => selectionSync.noteModelMoved(),
    render: () => render(),
    mirrorToDom: () => selectionSync.mirrorToDom(),
    notify: () => options.onChange?.(currentState()),
    materializedPages: () => materializedSet,
  });

  noteOps = createNoteOps({
    session,
    applyOps,
    commit,
    selection: () => selection,
    selectionMark: () => selectionMark(),
    orderedStart: () => orderedStart(),
    activeScope: () => {
      const note = noteOps?.activeNoteScope();
      if (note) return note;
      return hfScope?.activeScope() ?? { kind: 'body' };
    },
    setActiveScopeBodyOrHf: (scope) => hfScope!.setActiveScope(scope),
    setSelection: (next) => setSelection(next),
    noteModelMoved: () => selectionSync.noteModelMoved(),
    render: () => render(),
    revealNote: (scopeId) => {
      for (const page of currentLayout.pages) {
        const note = [...(page.footnotes?.notes ?? []), ...(page.endnotes?.notes ?? [])].find(
          (candidate) => candidate.scopeId === scopeId
        );
        if (!note) continue;
        scrollToContentY(note.box.y, note.box.height, {
          block: 'nearest',
          offsetPx: 48,
        });
        return page.index;
      }
      return null;
    },
    notify: () => options.onChange?.(currentState()),
    lastRejection: () => lastRejection,
    setLastRejection: (reason) => {
      lastRejection = reason;
    },
  });

  function setCellSelection(next: CellSelection | null): void {
    cellSelection = next;
    if (next) {
      reconcilePendingWith(next.text);
      selection = next.text;
    }
    desiredX = null;
    // Settled, not moved: the mirror on the next line makes the two agree before any render
    // can read them back — the same reason `setSelection` says so.
    selectionSync.noteSelectionSettled();
    selectionSync.mirrorToDom();
    renderOverlay();
    // A dismissal is dismissed for where the caret WAS; any move re-asks the question, which
    // is how the reader reopens an item — by clicking back into its text.
    dismissedReviewKey = null;
    // The caret decides which item is OPEN, so a move re-classes the bands. The rectangles
    // themselves are cached against the layout and are not recomputed here.
    renderCommentHighlights();
    options.onChange?.(currentState());
  }

  /**
   * Comment bands, computed ONCE per layout and re-classed on a caret move.
   *
   * The rectangles depend only on the layout and the comment ranges, so recomputing them
   * because the caret moved would re-walk the document on every arrow key. What the caret
   * changes is which band is the active one, and that is a class.
   */
  let commentRectCache: {
    layout: SemanticLayout;
    revision: number;
    pages: ReadonlySet<number> | undefined;
    rects: readonly (OverlayRect & { key: string })[];
  } | null = null;

  /**
   * A small window around the caret, for when the real visible set is unknown.
   *
   * Not a guess at what is on screen — a bound. A band outside it is not drawn, and the next
   * paint with a real scroller draws it.
   */
  function caretPageWindow(): ReadonlySet<number> {
    const caret = caretAt(currentLayout, selection.head);
    const centre = caret?.pageIndex ?? 0;
    const window_ = new Set<number>();
    for (let page = centre - 1; page <= centre + 1; page += 1) {
      if (page >= 0 && page < currentLayout.pages.length) window_.add(page);
    }
    return window_;
  }

  /** Paragraph id to the page it starts on, built once per layout. */
  const paragraphPageCache = new WeakMap<SemanticLayout, Map<string, number>>();
  function paragraphPagesOf(layout: SemanticLayout): Map<string, number> {
    const cached = paragraphPageCache.get(layout);
    if (cached) return cached;
    const index = new Map<string, number>();
    for (const page of layout.pages) {
      for (const fragment of paragraphFragmentsOf(page)) {
        if (!index.has(fragment.paragraphId)) index.set(fragment.paragraphId, page.index);
      }
    }
    paragraphPageCache.set(layout, index);
    return index;
  }

  function commentRects(): readonly (OverlayRect & { key: string })[] {
    const revision = session.revision();
    // When the scroller is unknown — before mount, in a hidden container, in a host that is
    // not the packaged viewport — `materializedSet` is undefined, and "measure every band on
    // every page" is 30ms per keystroke on exactly the documents that can least afford it.
    // The caret's page and its neighbours are a bound that is always available.
    const pages = materializedSet ?? caretPageWindow();
    if (
      commentRectCache?.layout === currentLayout &&
      commentRectCache.revision === revision &&
      equalPageSets(commentRectCache.pages, pages)
    ) {
      return commentRectCache.rects;
    }
    const paragraphPages = paragraphPagesOf(currentLayout);
    /** Skip an item that cannot be on screen, before measuring anything about it. */
    const onScreen = (from: string, to: string): boolean => {
      if (!pages) return true;
      // EITHER end. Testing only the start dropped the band for a comment spanning pages
      // 1–5 the moment page 1 scrolled away, so the highlight vanished from the middle of
      // its own range. `keyedRangeRects` clips to the visible pages anyway; this is only a
      // pre-filter, and a false keep costs one range's measurement.
      const start = paragraphPages.get(from);
      const end = paragraphPages.get(to);
      if (start === undefined || end === undefined) return true;
      for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) {
        if (pages.has(page)) return true;
      }
      return false;
    };
    const ranges: KeyedRange[] = [];
    for (const item of session.reviewItems()) {
      if (item.kind === 'comment') {
        if (item.range === null || item.resolved) continue;
        if (!onScreen(item.range.start.paragraphId, item.range.end.paragraphId)) continue;
        ranges.push({
          key: reviewItemKey(item),
          from: { paragraphId: item.range.start.paragraphId, offset: item.range.start.offset },
          to: { paragraphId: item.range.end.paragraphId, offset: item.range.end.offset },
        });
        continue;
      }
      // Revisions are measured in the SAME pass and drawn only when active: tracked text
      // already carries an underline, a strike and a margin bar, so banding all of it would
      // repeat what the decoration says and leave a page of edits as one solid wash.
      // Custom-node cards take the same treatment — the chip tint already marks the node
      // persistently, so its band appears only while its card is open.
      const key = reviewItemKey(item);
      const itemRanges = item.kind === 'revision' ? item.ranges : item.range ? [item.range] : [];
      for (const [index, range] of itemRanges.entries()) {
        if (!onScreen(range.start.paragraphId, range.end.paragraphId)) continue;
        ranges.push({
          key: itemRanges.length === 1 ? key : `${key}${RANGE_SUFFIX}${index}`,
          from: { paragraphId: range.start.paragraphId, offset: range.start.offset },
          to: { paragraphId: range.end.paragraphId, offset: range.end.offset },
        });
      }
    }
    const byKey = keyedRangeRects(currentLayout, ranges, pages);
    const rects: (OverlayRect & { key: string })[] = [];
    for (const [key, found] of byKey) for (const rect of found) rects.push({ ...rect, key });
    commentRectCache = { layout: currentLayout, revision, pages, rects };
    return rects;
  }

  /**
   * Paragraph id to document position over EVERY story the review queue lists — body
   * first, then each furniture part — memoized per package revision and body root.
   *
   * Deliberately NOT the open story's scoped order: `rangeCovers` looks the caret's and an
   * item's paragraphs up here, and an id the index cannot see is an item that can never
   * become active. Scoping to the open story made every header item unactivatable from
   * the body, every body item unactivatable while a header was open, and every textbox
   * item unactivatable always (the shallow order stops at the host paragraph) — the DEEP
   * order descends into `w:txbxContent`. Containment only ever compares positions within
   * one story, and furniture ranks after the body, so the merge cannot invent a cover.
   */
  let reviewOrderIndexCache: {
    readonly packageRevision: number;
    readonly bodyRoot: object;
    readonly index: Map<string, number>;
  } | null = null;
  function reviewOrderIndex(): Map<string, number> {
    const packageRevision = session.packageRevision();
    const bodyRoot = session.part().root;
    if (
      reviewOrderIndexCache &&
      reviewOrderIndexCache.packageRevision === packageRevision &&
      reviewOrderIndexCache.bodyRoot === bodyRoot
    ) {
      return reviewOrderIndexCache.index;
    }
    const index = new Map<string, number>();
    const append = (order: ReadonlyMap<string, number>): void => {
      const base = index.size;
      for (const [id, position] of order) {
        if (!index.has(id)) index.set(id, base + position);
      }
    };
    append(deepParagraphOrderOfPart(session.part()));
    const seenParts = new Set<unknown>([session.part()]);
    for (const section of session.headerFooterPartsBySection()) {
      for (const slots of [section.headers, section.footers]) {
        for (const part of slots.values()) {
          if (seenParts.has(part)) continue;
          seenParts.add(part);
          append(deepParagraphOrderOfPart(part));
        }
      }
    }
    // Note stories too, now that their revisions reach the queue: a paragraph missing from
    // this index is an item `rangeCovers` can never match, so a footnote card listed but
    // could never become the ACTIVE one — and the rail gates its reply box on that.
    for (const noteKind of ['footnote', 'endnote'] as const) {
      const part = session.partFor({ kind: 'notesPart', noteKind });
      if (!part || seenParts.has(part)) continue;
      seenParts.add(part);
      append(deepParagraphOrderOfPart(part));
    }
    reviewOrderIndexCache = { packageRevision, bodyRoot, index };
    return index;
  }

  /** Which comment the caret is in, so its band reads as the open one. */
  /**
   * A dismissed item, until the caret next moves.
   *
   * Lives HERE rather than in a host, because the band and the card must agree: the surface
   * paints one and publishes the other, and a copy of this flag on either side of that line
   * is a copy that can disagree.
   */
  let dismissedReviewKey: string | null = null;

  /**
   * Revision kinds the caret must not activate — the host rail's own exclusion filter,
   * mirrored here so the band and the visible cards stay one answer. Null means none.
   */
  let reviewActivationExclusions: ReadonlySet<ReviewRevisionKind> | null = null;

  function activeReviewAtCaret(): ReviewItem | null {
    const at = selection?.head;
    if (!at) return null;
    // The covering items, innermost first, minus the one the reader dismissed. Returning
    // null for a dismissed innermost item hid every item under it too: dismissing a comment
    // that wraps a revision meant the revision could never become active either.
    const covering = reviewItemsAt(session.reviewItems(), at, reviewOrderIndex()).filter(
      (item) =>
        !(item.kind === 'comment' && item.resolved) &&
        reviewItemKey(item) !== dismissedReviewKey &&
        // Kinds the host's rail hides must not become active from a click: the band
        // would light a card nothing on screen renders (see the contract note on
        // `setReviewActivationExclusions`).
        !(
          item.kind === 'revision' &&
          reviewActivationExclusions !== null &&
          reviewActivationExclusions.has(item.revisionKind)
        )
    );
    const found = covering[0];
    if (!found) return null;
    // A REPLY resolves to the card it renders inside — the comment it answers, or the tracked
    // change it answers. It has no card of its own, so returning it opened an item nothing on
    // screen was drawing: the reply box vanished from the very thing that had just been
    // replied to. Comment threads survived that by accident (the parent comes first in
    // `comments.xml` order and won the tie); a revision does not, because a comment outranks
    // one outright at equal width.
    if (found.kind !== 'comment') return found;
    const root = reviewThreadRootOf(session.reviewItems(), found);
    // A root the reader DISMISSED takes its whole thread with it. Falling back to the reply
    // here painted the band active over a card that is not drawn — a reply renders inside its
    // root, so dismissing the root leaves nothing on screen to be active — and the reader who
    // closed the card watched the text stay highlighted as though it were still open.
    return reviewItemKey(root) === dismissedReviewKey ? null : root;
  }

  /** The class a band draws in, or null when this range should not be drawn at all. */
  function bandClassFor(
    key: string,
    active: ReviewItem | null,
    byKey: ReadonlyMap<string, ReviewItem>
  ): string | null {
    // A revision's key is suffixed per range when one decision covers several sites, so the
    // active test compares the DECISION, not the site. Split on NUL, which an author name
    // cannot contain — `#` can, and an author called `A#b` never saw their band light up.
    const parts = key.split(RANGE_SUFFIX);
    const decision = parts[0]!;
    const isActive = active !== null && decision === reviewItemKey(active);
    if (key.startsWith('comment-')) {
      return isActive ? 'docx-comment-band docx-comment-band--active' : 'docx-comment-band';
    }
    // A custom node's band only while its card is open: the chip tint already marks the
    // node persistently, and the comment band is the right weight for "this is the one".
    if (key.startsWith('custom-')) {
      return isActive ? 'docx-comment-band docx-comment-band--active' : null;
    }
    const item = byKey.get(decision);
    if (!item || item.kind !== 'revision') return null;
    // In the revision's OWN colour — green for text arriving, red for text leaving — so the
    // band never contradicts the decoration beneath it. A REPLACEMENT is one decision in two
    // colours: its leading ranges are the struck half, the rest is what took their place, and
    // painting the pair one neutral grey said "something changed here" about an edit whose
    // two halves the page is already colouring.
    const index = parts.length > 1 ? Number(parts[1]) : 0;
    const kindOf = (revisionKind: ReviewRevisionKind): 'delete' | 'insert' | 'other' => {
      if (revisionKind === 'delete' || revisionKind === 'moveFrom') return 'delete';
      if (revisionKind === 'insert' || revisionKind === 'moveTo') return 'insert';
      if (revisionKind === 'replace' && item.replacedRangeCount !== undefined) {
        return index < item.replacedRangeCount ? 'delete' : 'insert';
      }
      return 'other';
    };
    const kind = kindOf(item.revisionKind);
    // Every pending change carries a band, faint until it is the open one. A tracked page
    // with no tint at all made "which of these is selected" a question about a 1px margin
    // bar; a page where only the active one tints made the others look resolved.
    return `docx-revision-band docx-revision-band--${kind}${isActive ? ' docx-revision-band--active' : ''}`;
  }

  function renderCommentHighlights(): void {
    const active = activeReviewAtCaret();
    // Once per paint, not once per rect: a decision spanning many lines asked the same
    // question for every one of them.
    const byKey = new Map<string, ReviewItem>();
    for (const item of session.reviewItems()) byKey.set(reviewItemKey(item), item);
    const bands: OverlayRect[] = [];
    for (const rect of commentRects()) {
      const className = bandClassFor(rect.key, active, byKey);
      if (className) bands.push({ ...rect, className });
    }
    paintSelectionOverlay(commentLayer, currentLayout, bands, {
      scale,
      ...(materializedExtent ? { pageOffsetX: materializedExtent.pageOffsetX } : {}),
    });
  }

  /** Draw the selected cells, or clear the layer when nothing is selected that way. */
  function renderOverlay(): void {
    paintSelectionOverlay(
      overlayLayer,
      currentLayout,
      cellSelection
        ? cellSelectionRects(currentLayout, cellSelection.cellIds)
        : retainedSelection
          ? selectionRects(currentLayout, retainedSelection)
          : [],
      // Pages of differing width are centred individually, so the overlay has to carry the
      // same per-page offset the painter applied or a highlight in a landscape section would
      // sit beside the cells it describes.
      {
        scale,
        pageOffsetX: materializedExtent?.pageOffsetX,
        ...(cellSelection ? {} : { className: 'docx-retained-selection-rect' }),
      }
    );
  }

  function targetToc(tocId?: string) {
    const tocs = detectBodyTocs(session.part());
    if (tocId) return tocs.find((toc) => toc.id === tocId) ?? null;
    // The right-click target first: a menu row carries no id, and in a document with two
    // tables of contents the caret cannot disambiguate them — it is never inside either.
    const pointed = contextTocId ? tocs.find((toc) => toc.id === contextTocId) : undefined;
    if (pointed) return pointed;
    const paragraphId = selection.head.paragraphId;
    return (
      tocs.find(
        (toc) =>
          toc.beginParagraphId === paragraphId ||
          toc.endParagraphId === paragraphId ||
          toc.resultParagraphIds.includes(paragraphId)
      ) ?? (tocs.length === 1 ? tocs[0]! : null)
    );
  }

  function tocIdAtParagraph(paragraphId: string): string | null {
    const toc = detectBodyTocs(session.part()).find(
      (candidate) =>
        candidate.beginParagraphId === paragraphId ||
        candidate.endParagraphId === paragraphId ||
        candidate.resultParagraphIds.includes(paragraphId)
    );
    return toc?.id ?? null;
  }

  function selectionTouchesToc(): boolean {
    return (
      tocIdAtParagraph(selection.anchor.paragraphId) !== null ||
      tocIdAtParagraph(selection.head.paragraphId) !== null
    );
  }

  function opTouchesToc(op: TreeDocOp): boolean {
    const ids = tocParagraphIds();
    const inspect = (value: unknown, key = ''): boolean => {
      if (typeof value === 'string') {
        return /(?:Id|Ids)$/.test(key) && ids.has(value);
      }
      if (Array.isArray(value)) return value.some((entry) => inspect(entry, key));
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value).some(([nestedKey, nested]) => inspect(nested, nestedKey));
    };
    return inspect(op);
  }

  function tocParagraphIds(): ReadonlySet<string> {
    return new Set(
      detectBodyTocs(session.part()).flatMap((toc) => [
        toc.beginParagraphId,
        ...toc.resultParagraphIds,
        toc.endParagraphId,
      ])
    );
  }

  /** Every paragraph one TOC owns. Re-read per pass: a replace mints new result ids. */
  function tocRegionOf(toc: DetectedToc): ReadonlySet<string> {
    return new Set([toc.beginParagraphId, toc.endParagraphId, ...toc.resultParagraphIds]);
  }

  /** Painted lines the TOC regions occupy, which bounds the caret's escape from one. */
  function tocRegionLineCount(paragraphIds: ReadonlySet<string>): number {
    let lines = 0;
    for (const page of currentLayout.pages) {
      for (const fragment of paragraphFragmentsOf(page)) {
        if (paragraphIds.has(fragment.paragraphId)) lines += fragment.lines.length;
      }
    }
    return lines;
  }

  function pageNumbersFor(
    layout: SemanticLayout,
    paragraphIds: readonly string[]
  ): ReadonlyMap<string, string> {
    const wanted = new Set(paragraphIds);
    const result = new Map<string, string>();
    for (const page of layout.pages) {
      for (const fragment of paragraphFragmentsOf(page)) {
        if (!wanted.has(fragment.paragraphId) || result.has(fragment.paragraphId)) continue;
        const source = page.pageFieldSource;
        result.set(
          fragment.paragraphId,
          formatPageNumber(source?.pageNumber ?? page.index + 1, source?.format)
        );
      }
    }
    return result;
  }

  function canRefreshToc(tocId?: string): boolean {
    if (editingMode === 'view' || !session.editable) return false;
    const toc = targetToc(tocId);
    if (!toc) return false;
    return (
      validateTreeOp(session.part(), {
        op: 'rewriteTocPageNumbers',
        tocId: toc.id,
        updates: [],
      }) === null
    );
  }

  /**
   * The op behind Insert › Table, or null when the size is not one this engine authors.
   *
   * Column width is the caret SECTION's content width divided evenly, not the document's:
   * in a mixed-orientation document the table is about to live on the caret's page, and a
   * grid sized for another section's width is a table that overhangs its own margin.
   */
  function insertTableOp(rows: number, cols: number) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return null;
    const section = structure.sectionPropertiesAt(selection.head.paragraphId);
    const contentWidth =
      section.pageSize.widthTwips -
      section.margins.leftTwips -
      section.margins.rightTwips -
      section.margins.gutterTwips;
    // A section whose margins swallow the page still gets a usable table rather than a
    // refusal: the floor is the same minimum a column resize may drag to.
    const columnWidthTwips = Math.max(
      MIN_TABLE_COLUMN_WIDTH_TWIPS,
      Math.floor(contentWidth / cols)
    );
    return {
      op: 'insertTable' as const,
      beforeParagraphId: selection.head.paragraphId,
      rows,
      cols,
      columnWidthTwips,
    };
  }

  function canInsertTable(rows: number, cols: number): boolean {
    if (editingMode === 'view' || !session.editable) return false;
    const op = insertTableOp(rows, cols);
    return op !== null && validateTreeOp(session.part(), op) === null;
  }

  function insertTable(rows: number, cols: number): boolean {
    if (!canInsertTable(rows, cols)) return false;
    const op = insertTableOp(rows, cols);
    if (!op) return false;
    // The op publishes the first cell's paragraph as its caret hint, and that hint is the
    // whole point of the gesture — Word leaves you typing in cell one. Adopting it needs the
    // committed-caret subscription, the same way a table command plan does: without it the
    // pre-edit selection mark is restored and the caret stays in the anchor paragraph
    // BELOW the new table.
    let committedCaret: { readonly paragraphId: string; readonly start: number } | null = null;
    const unsubscribe = session.subscribe((change) => {
      if (change.caret) committedCaret = change.caret;
    });
    let committed = false;
    try {
      commit(
        () => {
          const applied = applyOps([op], selectionMark());
          if (!applied.committed) {
            lastRejection = applied.reason ?? 'the table could not be inserted here';
          }
          committed = applied.committed;
          return applied;
        },
        () => {
          const caret = committedCaret;
          return caret
            ? collapsedAt({ paragraphId: caret.paragraphId, offset: caret.start })
            : null;
        }
      );
    } finally {
      unsubscribe();
    }
    return committed;
  }

  const INSERT_TOC_INSTRUCTION = 'TOC \\o "1-3" \\h';

  function insertTocOp() {
    const instruction = parseTocInstruction(INSERT_TOC_INSTRUCTION);
    if (!instruction) return null;
    const outline = session.documentOutline();
    const plan = planTocEntries(
      session.part(),
      outline,
      instruction,
      pageNumbersFor(
        surface.layout(),
        outline.map((entry) => entry.blockId)
      ),
      tocParagraphIds()
    );
    return {
      op: 'insertToc' as const,
      beforeParagraphId: selection.head.paragraphId,
      instruction: INSERT_TOC_INSTRUCTION,
      alias: options.tocLabels?.title ?? 'TOC',
      entries: plan.entries,
      bookmarksToCreate: plan.bookmarksToCreate,
    };
  }

  function canInsertToc(): boolean {
    if (editingMode === 'view' || !session.editable || selectionTouchesToc()) return false;
    const op = insertTocOp();
    return op !== null && validateTreeOp(session.part(), op) === null;
  }

  function insertToc(): boolean {
    if (!canInsertToc()) return false;
    const op = insertTocOp();
    if (!op) return false;
    const existing = new Set(detectBodyTocs(session.part()).map((toc) => toc.id));
    const inserted = session.applyTreeOps([op]);
    if (!inserted.committed) {
      lastRejection = inserted.reason ?? 'the table of contents could not be inserted';
      return false;
    }
    const created = detectBodyTocs(session.part()).find((toc) => !existing.has(toc.id));
    return created ? refreshToc(created.id, 'pageNumbers') : true;
  }

  function refreshToc(tocId?: string, mode: 'entire' | 'pageNumbers' = 'entire'): boolean {
    let toc = targetToc(tocId);
    if (!toc || !canRefreshToc(toc.id)) return false;

    let layout = surface.layout();
    const outline = session.documentOutline();
    const outlineBlockIds = outline.map((entry) => entry.blockId);

    if (mode === 'entire') {
      const plan = planTocEntries(
        session.part(),
        outline,
        toc.instruction,
        pageNumbersFor(layout, outlineBlockIds),
        tocRegionOf(toc)
      );
      const replaced = session.applyTreeOps([
        {
          op: 'replaceTocResult',
          tocId: toc.id,
          entries: plan.entries,
          bookmarksToCreate: plan.bookmarksToCreate,
        },
      ]);
      if (!replaced.committed) {
        lastRejection = replaced.reason ?? 'the table of contents could not be refreshed';
        return false;
      }
      layout = surface.layout();
      toc = targetToc(toc.id);
      if (!toc) return true;
    }

    let previousSignature = '';
    for (let pass = 0; pass < TOC_MAX_PAGE_PASSES; pass += 1) {
      const numbers = pageNumbersFor(layout, outlineBlockIds);
      // Each row is rewritten from the heading IT names, read from the row's own anchor or
      // title. Pairing rows with plan entries by POSITION looks equivalent right after a full
      // replace and is wrong everywhere else: one heading added or removed since the cache was
      // written shifts every page number by one, silently, which is the exact state that
      // "update page numbers only" exists to repair.
      const headings = resolveTocRowHeadings(session.part(), toc, outline, tocRegionOf(toc));
      const updates = toc.resultParagraphIds.flatMap((paragraphId, index) => {
        const headingId = headings[index];
        const pageNumberText = headingId ? numbers.get(headingId) : undefined;
        return pageNumberText === undefined ? [] : [{ paragraphId, pageNumberText }];
      });
      if (updates.length === 0) break;
      const signature = updates
        .map((update) => `${update.paragraphId}\u0000${update.pageNumberText}`)
        .join('\u0001');
      if (signature === previousSignature) break;
      previousSignature = signature;
      const rewritten = session.applyTreeOps([
        { op: 'rewriteTocPageNumbers', tocId: toc.id, updates },
      ]);
      if (!rewritten.committed) {
        if (rewritten.rejected) {
          lastRejection = rewritten.reason ?? 'the table of contents page numbers were refused';
          return false;
        }
        break;
      }
      layout = surface.layout();
      toc = targetToc(toc.id) ?? toc;
    }

    return true;
  }

  const surface: ScaleMutableSurface = {
    session,
    storyScope,
    imageDecodePort: () => decodePort,
    // Flushes first: a commit made straight on the session — undo, or another editor
    // sharing the store — must not leave a caller reading geometry for a revision the model
    // has left behind. Nothing pending makes this a plain read.
    layout: () => {
      flushLayout();
      return currentLayout;
    },
    state: currentState,
    currentPage: (mode = 'caret') => {
      flushLayout();
      if (mode === 'viewport') {
        const page = viewportPage(container, currentLayout, scale);
        if (page !== null) return page;
      }
      const caret = caretAt(currentLayout, selection.head);
      return caret ? caret.pageIndex + 1 : 1;
    },

    setScale(nextScale) {
      if (!(nextScale > 0) || !Number.isFinite(nextScale)) return false;
      if (nextScale === scale) return true;

      const previous = { scale, defaults, measurer, producer, furnitureSource };

      // TOTAL by construction: a zoom click gets an answer, never an exception. Everything a
      // rescale touches — the anchor read, the measurer resolution, layout, paint — is inside
      // the guard, and the rollback carries its own.
      try {
        const scroller = surfaceScroller(container);
        // The anchor is kept in LAYOUT coordinates, the frame `visiblePageSet` and
        // `viewportPage` read. The scroller is not the surface's offset parent in a real host —
        // toolbar and ruler chrome sit above it — so the container's own offset comes out
        // before the divide and goes back in on the way out, or the page under the viewport
        // centre changes as the scale does.
        const anchor = scroller
          ? {
              x: (scroller.scrollLeft - container.offsetLeft + scroller.clientWidth / 2) / scale,
              y: (scroller.scrollTop - container.offsetTop + scroller.clientHeight / 2) / scale,
            }
          : null;
        scale = nextScale;
        if (!options.measurer) {
          defaults = resolveDefaultSurfaceMeasurer(scale, {
            context: tryCreateBrowserCanvasContext(container.ownerDocument),
            ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
          });
          measurer = defaults.measurer;
        }
        // Read from the resolution just made, not from mount's: a canvas that is available at
        // mount and gone by the next zoom resolves to the fixed grid, and the identity has to
        // say so.
        producer = producerIdentity();
        furnitureSource = createFurnitureSource({
          session,
          measurer,
          producer,
          cache: layoutCache,
          styleCascade,
          defaultTabStopPt,
        });
        // Dropped rather than trusted: both describe a paint made at the OLD scale, and a
        // flush that publishes nothing (a revision already superseded) would otherwise leave
        // the overlay painting against them.
        materializedSet = undefined;
        materializedExtent = undefined;
        commentRectCache = null;
        scheduler.invalidateAll(session.packageRevision(), 'zoom');
        scheduler.flush();
        if (scroller && anchor) {
          const targetLeft = Math.max(
            0,
            anchor.x * scale + container.offsetLeft - scroller.clientWidth / 2
          );
          const targetTop = Math.max(
            0,
            anchor.y * scale + container.offsetTop - scroller.clientHeight / 2
          );
          const maxLeft = Number.isFinite(scroller.scrollWidth)
            ? Math.max(0, scroller.scrollWidth - scroller.clientWidth)
            : null;
          const maxTop = Number.isFinite(scroller.scrollHeight)
            ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
            : null;
          scroller.scrollLeft = maxLeft === null ? targetLeft : Math.min(targetLeft, maxLeft);
          scroller.scrollTop = maxTop === null ? targetTop : Math.min(targetTop, maxTop);
          // The paint above chose its pages for the scroll offset the viewport had BEFORE the
          // restore. Building the destination band here keeps the zoom to one turn; leaving it
          // to the scroll listener showed the user shells for a frame.
          rematerialize();
        }
        return true;
      } catch {
        ({ scale, defaults, measurer, producer, furnitureSource } = previous);
        materializedSet = undefined;
        materializedExtent = undefined;
        commentRectCache = null;
        // NESTED, because the rollback lays out too: whatever failed the rescale can fail the
        // recovery, and the caller still has to be told "no". The previous paint stands, and
        // the next commit or scroll repaints it.
        try {
          scheduler.invalidateAll(session.packageRevision(), 'zoom-rollback');
          scheduler.flush();
        } catch {
          /* nothing left to try; the answer below is the whole contract */
        }
        return false;
      }
    },

    type(text) {
      // Insert at the selection's START, not at its head. Deleting a selection removes the
      // range beginning at the start, so inserting at the head — which may be the far end —
      // puts the text where the removed characters used to be rather than where the user
      // was typing.
      const plan = deleteSelectionPlan();
      const start = plan.collapseTo;
      // Consume the stored caret format (armed only at a collapsed caret, so it cannot
      // coexist with the delete ops below): the typed range gets the caret run's own
      // properties plus the armed ones, in the SAME transaction — one undo step.
      const pendingOps = consumePendingFormatOps(start.paragraphId, start.offset, text.length);
      // In SUGGESTING the deletion keeps its characters, so the selection's start offset is
      // still the start of the struck words — inserting there put the replacement BEFORE
      // them. Word puts it after, and only then are the two halves adjacent, which is what
      // lets the pane fold them into one `Replaced "x" with "y"` card. Mid-sentence
      // replacements were showing as two unrelated decisions, and a reviewer could accept
      // one half.
      const struck = editingMode === 'suggest' ? orderedRange() : null;
      const insertAt =
        struck && struck.to.paragraphId === start.paragraphId ? struck.to.offset : start.offset;
      const insertOps: TreeDocOp[] = [
        ...plan.ops,
        { op: 'insertText', paragraphId: start.paragraphId, offset: insertAt, text },
      ];
      const redoMark = {
        paragraphId: start.paragraphId,
        start: insertAt + text.length,
        end: insertAt + text.length,
      };
      commit(
        () =>
          withoutPendingOnRejection(
            [...insertOps, ...pendingOps],
            insertOps,
            selectionMark(),
            redoMark
          ),
        () => collapsedAt({ paragraphId: start.paragraphId, offset: insertAt + text.length })
      );
    },

    // The newline-aware sibling of `type`, declared below in this same scope. On the
    // contract because text arriving from OUTSIDE the editor — a paste from the clipboard,
    // whether the browser's own event delivered it or a menu row did — is not a lane the
    // input handlers should own privately.
    insertPlainText: (text: string) => insertPlainText(text),

    deleteBackward() {
      const plan = deleteSelectionPlan();
      if (plan.ops.length > 0) {
        commit(
          () => applyOps(plan.ops, selectionMark()),
          () => collapsedAt(plan.collapseTo)
        );
        return;
      }
      // Word keeps the typing format across Backspace: bold armed at a caret survives
      // deleting the character before it, re-anchored where the caret lands.
      const armed = armedAtCaret() ?? undefined;
      const position = selection.head;
      if (position.offset === 0) {
        // Backspace at the start of a paragraph pulls it into the previous one. Refusing
        // here made the key look broken: a caret at the paragraph start is where a user
        // presses Backspace precisely because they want the paragraphs merged.
        const order = paragraphOrder();
        const index = order.indexOf(position.paragraphId);
        const previous = order[index - 1];
        if (!previous) return;
        const joinAt = textOf(previous).length;
        commit(
          () =>
            applyOps(
              [{ op: 'joinParagraphs', firstId: previous, secondId: position.paragraphId }],
              selectionMark()
            ),
          () => collapsedAt({ paragraphId: previous, offset: joinAt }),
          { rearmPending: armed }
        );
        return;
      }
      // Backspace at a chip's outer edge takes the WHOLE node — see `inlineControlBeside`.
      // A wrapper-locked control refuses the op and the key does nothing, which is the
      // lock doing its job rather than a bug.
      const chip = inlineControlBeside(position, 'before');
      if (chip) {
        commit(
          () =>
            applyOps(
              [{ op: 'removeContentControl', controlId: chip.controlId, keepContent: false }],
              selectionMark()
            ),
          () => collapsedAt({ paragraphId: position.paragraphId, offset: chip.start }),
          { rearmPending: armed }
        );
        return;
      }
      commit(
        () =>
          applyOps(
            [
              {
                op: 'deleteText',
                paragraphId: position.paragraphId,
                start: position.offset - 1,
                end: position.offset,
              },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...position, offset: position.offset - 1 }),
        { rearmPending: armed }
      );
    },

    splitParagraph() {
      // Enter REPLACES a selection, like every other insertion, and splits at its START —
      // splitting at the head left the selected text in place and cut the paragraph at
      // whichever end the user happened to drag to.
      const plan = deleteSelectionPlan();
      const position = plan.collapseTo;
      const before = new Set(session.paragraphIdsIn(storyScope()));
      // Word carries the typing format across Enter: bold armed before the split applies
      // to the first characters typed in the new paragraph.
      const armed = armedAtCaret() ?? undefined;
      commit(
        () =>
          applyOps(
            [
              ...plan.ops,
              {
                op: 'splitParagraph',
                paragraphId: position.paragraphId,
                offset: position.offset,
              },
            ],
            selectionMark()
          ),
        () => {
          // The tail is the id the store minted that was not there before.
          const tail = session.paragraphIdsIn(storyScope()).find((id) => !before.has(id));
          return tail ? collapsedAt({ paragraphId: tail, offset: 0 }) : null;
        },
        { rearmPending: armed }
      );
    },

    navigate(command, extend = false) {
      let moved = navigateInActiveScope(
        currentLayout,
        selection.head,
        command,
        desiredX,
        hfScope?.getActive() ?? null,
        noteScopeId(),
        measurer
      );
      if (!moved) return;
      const tocIds = tocParagraphIds();
      if (tocIds.has(moved.position.paragraphId)) {
        if (extend) return;
        const backwards = new Set<NavigationCommand>([
          'left',
          'wordLeft',
          'lineStart',
          'up',
          'pageUp',
        ]);
        // The escape steps by LINE, never by character. A character step inside a row that
        // has any text at all lands in the same paragraph, and the loop's own "we did not
        // change paragraph" bail then fired on the first iteration: the caret could neither
        // enter the region nor cross it, so everything past a table of contents was
        // unreachable from the keyboard. A line step always leaves the row it starts on.
        const escape: NavigationCommand = backwards.has(command) ? 'up' : 'down';
        // One iteration per line the region occupies, plus slack for the landing line. The
        // loop breaks the moment it is outside, so an over-generous bound costs nothing.
        const limit = tocRegionLineCount(tocIds) + 4;
        for (let step = 0; step < limit; step += 1) {
          const next = navigateInActiveScope(
            currentLayout,
            moved.position,
            escape,
            moved.desiredX,
            hfScope?.getActive() ?? null,
            noteScopeId(),
            measurer
          );
          // Only a position that does not move at all is a dead end. Comparing paragraph ids
          // alone treats ordinary movement within a row as one.
          if (
            !next ||
            (next.position.paragraphId === moved.position.paragraphId &&
              next.position.offset === moved.position.offset)
          ) {
            return;
          }
          moved = next;
          if (!tocIds.has(moved.position.paragraphId)) break;
        }
        if (tocIds.has(moved.position.paragraphId)) return;
      }
      desiredX = moved.desiredX;
      // Note continuations share one EditorScope across pages: retarget the visual
      // occurrence before selection/caret paint so the DOM host follows geometry.
      if (
        noteOps?.activeNoteScope() &&
        moved.pageIndex !== undefined &&
        Number.isInteger(moved.pageIndex)
      ) {
        noteOps.setActiveNotePageIndex(moved.pageIndex);
      }
      setSelection(
        { anchor: extend ? selection.anchor : moved.position, head: moved.position },
        true
      );
    },

    deleteWordBackward() {
      if (surface.deleteSelection()) return;
      const head = selection.head;
      const target = wordBoundary(textOf(head.paragraphId), head.offset, -1);
      if (target === head.offset) {
        surface.deleteBackward();
        return;
      }
      commit(
        () =>
          applyOps(
            [{ op: 'deleteText', paragraphId: head.paragraphId, start: target, end: head.offset }],
            selectionMark()
          ),
        () => collapsedAt({ ...head, offset: target }),
        { rearmPending: armedAtCaret() ?? undefined }
      );
    },

    deleteWordForward() {
      if (surface.deleteSelection()) return;
      const head = selection.head;
      const target = wordBoundary(textOf(head.paragraphId), head.offset, 1);
      if (target === head.offset) {
        surface.deleteForward();
        return;
      }
      commit(
        () =>
          applyOps(
            [{ op: 'deleteText', paragraphId: head.paragraphId, start: head.offset, end: target }],
            selectionMark()
          ),
        undefined,
        { rearmPending: armedAtCaret() ?? undefined }
      );
    },

    deleteForward() {
      if (surface.deleteSelection()) return;
      // Delete keeps the typing format like Backspace does — the caret does not move, so
      // the armed format re-anchors in place.
      const armed = armedAtCaret() ?? undefined;
      const position = selection.head;
      const text = textOf(position.paragraphId);
      if (position.offset < text.length) {
        // Delete at a chip's leading edge takes the WHOLE node — the forward mirror of
        // the Backspace rule above.
        const chip = inlineControlBeside(position, 'after');
        if (chip) {
          commit(
            () =>
              applyOps(
                [{ op: 'removeContentControl', controlId: chip.controlId, keepContent: false }],
                selectionMark()
              ),
            () => collapsedAt(position),
            { rearmPending: armed }
          );
          return;
        }
        commit(
          () =>
            applyOps(
              [
                {
                  op: 'deleteText',
                  paragraphId: position.paragraphId,
                  start: position.offset,
                  end: position.offset + 1,
                },
              ],
              selectionMark()
            ),
          undefined,
          { rearmPending: armed }
        );
        return;
      }
      // At the end of a paragraph, Delete pulls the NEXT one up — the mirror of Backspace at
      // offset zero, and the reason a document can be flattened without reaching for a mouse.
      const order = paragraphOrder();
      const next = order[order.indexOf(position.paragraphId) + 1];
      if (!next) return;
      commit(
        () =>
          applyOps(
            [{ op: 'joinParagraphs', firstId: position.paragraphId, secondId: next }],
            selectionMark()
          ),
        () => collapsedAt(position),
        { rearmPending: armed }
      );
    },

    ...structure,
    ...format,

    setSelection: (next) => setSelection(next),

    revealPage(pageIndex, options) {
      const page = currentLayout.pages.find((entry) => entry.index === pageIndex);
      return page ? scrollToContentY(page.box.y, page.box.height, options) : false;
    },

    revealParagraph(paragraphId, options) {
      flushLayout();
      // The paragraph's own line, not the top of its page: a heading two thirds down a
      // page is the thing the caller asked to see.
      const caret = caretAt(currentLayout, { paragraphId, offset: 0 });
      if (!caret) return false;
      const page = currentLayout.pages.find((entry) => entry.index === caret.pageIndex);
      if (!page) return false;
      // `contentBox`, not `box`: caret geometry is CONTENT-BOX relative — the painter parents
      // the caret into `.docx-page-content`, which starts one top margin down the sheet.
      // Against `box.y` every reveal undershot by exactly that margin (72pt on a 1" page), so
      // the target landed just under the fold and the reader had to scroll to see what they
      // had just jumped to.
      return scrollToContentY(page.contentBox.y + caret.y, caret.height, options);
    },

    revealPosition(position, options) {
      flushLayout();
      const caret = caretAt(currentLayout, position);
      if (!caret) return false;
      const page = currentLayout.pages.find((entry) => entry.index === caret.pageIndex);
      if (!page) return false;
      // 'nearest' by default: callers reveal on every activation, and a target already in
      // view must not yank the viewport.
      return scrollToContentY(page.contentBox.y + caret.y, caret.height, {
        block: 'nearest',
        ...options,
      });
    },

    setEditable(editable) {
      // The DOM affordance, not the document's own editability: `session.editable` says
      // whether the FILE can be round-tripped, and this says whether the user may type into
      // it right now. Both have to be true for an edit to land.
      pagesLayer.contentEditable = editable ? 'true' : 'false';
      pagesLayer.setAttribute('aria-readonly', editable ? 'false' : 'true');
    },

    selectAll() {
      const ids = paragraphOrder();
      const first = ids[0];
      const last = ids[ids.length - 1];
      if (!first || !last) return;
      setSelection({
        anchor: { paragraphId: first, offset: 0 },
        head: { paragraphId: last, offset: textOf(last).length },
      });
    },

    hyperlinks,
    contentControls: contentControlsOps,
    canInsertTable,
    insertTable,
    canInsertToc,
    insertToc,
    canRefreshToc,
    refreshToc,
    isInsideToc: (paragraphId) =>
      detectBodyTocs(session.part()).some(
        (toc) =>
          toc.beginParagraphId === paragraphId ||
          toc.endParagraphId === paragraphId ||
          toc.resultParagraphIds.includes(paragraphId)
      ),
    retainSelection: () => {
      retainedSelection = selection;
      renderOverlay();
    },
    releaseSelection: () => {
      if (!retainedSelection) return;
      retainedSelection = null;
      renderOverlay();
    },
    retainedSelection: () => retainedSelection,

    publishedLayout: () => currentLayout,

    overlayCoordinates: () =>
      Object.freeze({
        paintScale: scale,
        pageOffsetX: materializedExtent?.pageOffsetX ?? new Map<number, number>(),
      }),

    commitReviewOps: (run) =>
      commit(
        // Reported as a RESULT, not a boolean: `commit` reads the refusal reason off it, and
        // a boolean made every refused accept clear `lastRejection` instead of setting it.
        () => {
          // Resolving a revision or writing a comment is a WRITE, so viewing refuses it here
          // too. These paths reach the store through the session directly rather than
          // through `applyOps`, so the lane gate above never sees them.
          if (editingMode === 'view') {
            return { committed: false, rejected: true, opCount: 0, reason: VIEWING_REFUSAL };
          }
          const result = run();
          return {
            committed: result.committed,
            rejected: !result.committed,
            opCount: 0,
            ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
          };
        },
        () => {
          // The layout is FLUSHED first, because the clamp needs post-edit lengths and this
          // thunk runs before the repaint. Resolving a revision can remove the very characters
          // the caret was in; an offset left past the end refuses every keystroke that follows
          // it, which is what made the document look frozen after an Accept.
          flushLayout();
          // Raise the flag AGAIN. It is one-shot, `commit` raised it before this thunk ran,
          // and the flush above consumed it — so the render that follows read the stale DOM
          // selection back over the clamp and the caret jumped to the paragraph start.
          selectionSync.noteModelMoved();
          // Clamped within the story the READER is in, for the reason `applyAutomationOps`
          // states below: the body's paragraph list is the wrong ruler while a header or a
          // note is open, and clamping to it moved the caret into the document while the
          // scope stayed on the furniture — after which every keystroke was refused as
          // `unknown-paragraph`. Accepting a header card is exactly that situation.
          const order = paragraphOrder();
          if (order.length === 0) return null;
          return clampedToDocument(currentLayout, order, selection);
        }
      ),

    applyAutomationOps: (staged, scope) => {
      // THE SAME PATH A KEYSTROKE TAKES, minus the keystroke. `applyOps` is where viewing
      // refuses and where suggesting turns an edit into a proposal, and `commit` is where the
      // refusal is recorded, the caret is re-clamped and the pages are repainted. A host that
      // reached `session.applyTreeOps` instead — as this one did — typed into a document open
      // for viewing and wrote permanent text while the chrome said Suggesting.
      //
      // The scope comes from the CALLER, because the handle named a story. It defaults to the
      // body rather than to the reader's story: the input path follows the reader into a
      // header, and a scripted edit must not, or an object model holding a body paragraph
      // would write into whatever furniture happened to be open.
      let result: ReturnType<TreeDocxSession['applyTreeOps']> = {
        committed: false,
        rejected: false,
        opCount: 0,
      };
      const story = scope ?? BODY_STORY;
      commit(
        () => {
          // THE GATE BEFORE THE OPS EXIST. Building them mints the relationship an external
          // hyperlink names, which changes the PACKAGE — outside the transaction, outside the undo
          // stack, and left behind by a refusal. Viewing is asked first, so a document open for
          // reading comes out of this byte-identical; `edits: false` keeps the question to the rule
          // that holds for every op, because a batch of tracked-change DECISIONS is not an edit and
          // `applyOps` below judges it on its own ops.
          const viewing = writeRefusal(false);
          if (viewing !== null) {
            return (result = { committed: false, rejected: true, opCount: 0, reason: viewing });
          }
          // The mint carries the edit rule with it: it IS an edit, so a mode that would refuse one
          // must refuse it, and refusing here means the relationship is never written.
          let refused: string | null = null;
          const ops = staged((url) => {
            const refusal = writeRefusal(true, [], false);
            if (refusal === null) return session.ensureHyperlinkRelationship(url, story);
            refused = refusal;
            return null;
          });
          if (ops === null) {
            return (result = {
              committed: false,
              rejected: true,
              opCount: 0,
              reason: refused ?? 'this engine will not author that hyperlink target',
            });
          }
          return (result = applyOps(ops, undefined, undefined, story, false));
        },
        () => {
          // Flushed before the clamp for the same reason `commitReviewOps` does it: the clamp
          // needs post-edit lengths, and this thunk runs before the repaint.
          flushLayout();
          selectionSync.noteModelMoved();
          // Clamped within the story the READER is in, which is not necessarily the story that
          // was just written. Clamping against the body's paragraphs while a header or a
          // footnote was open moved the caret into the document while the scope stayed on the
          // furniture, and the next keystroke — applied to the furniture story with a body
          // paragraph id — was refused as `unknown-paragraph`: the reader typed and nothing
          // happened. An empty order means the story is not painted yet; leaving the caret
          // alone is right there, because a clamp with nothing to clamp to is a caret reset.
          const order = paragraphOrder();
          if (order.length === 0) return null;
          return clampedToDocument(currentLayout, order, selection);
        }
      );
      return result;
    },

    editingMode: () => editingMode,
    setEditingMode: (mode) => {
      editingMode = mode;
      // The old refusal described the old mode. Left standing, a host rendering it showed
      // "the document is open for viewing" over a document that had just become editable.
      lastRejection = null;
      options.onChange?.(currentState());
    },

    setReviewActivationExclusions(kinds) {
      reviewActivationExclusions = kinds === null ? null : new Set(kinds);
      // The active answer may have just changed with no caret move: repaint the bands and
      // tell the host, exactly as dismissing does.
      renderCommentHighlights();
      options.onChange?.(currentState());
    },

    activeReviewKey: () => {
      const active = activeReviewAtCaret();
      return active ? reviewItemKey(active) : null;
    },
    dismissActiveReview: () => {
      const active = activeReviewAtCaret();
      if (!active) return;
      dismissedReviewKey = reviewItemKey(active);
      renderCommentHighlights();
      options.onChange?.(currentState());
    },

    navigation,

    bookmarks: () => session.bookmarks(),

    selectedText() {
      // A rectangle copies as a grid — tabs between cells, newlines between rows — because
      // the text range it stands in for would paste back as one run with the grid gone.
      if (cellSelection) return cellSelectionText(currentLayout, cellSelection);
      const { from, to } = orderedRange();
      return selectedTextIn(currentLayout, from, to, paragraphOrder());
    },

    deleteSelection() {
      const plan = deleteSelectionPlan();
      if (plan.ops.length === 0) return false;
      commit(
        () => applyOps(plan.ops, selectionMark()),
        () => collapsedAt(plan.collapseTo)
      );
      return true;
    },

    setCellSelection,
    layoutSession: () => layoutSession,

    undo: () => {
      // Undo is a WRITE. It reached the session directly, so a document the toolbar called
      // read-only silently rewound under the reader's hands — the one lane that walked past
      // `applyOps`, `applyPmDoc` and `commitReviewOps` alike.
      if (editingMode === 'view') {
        lastRejection = VIEWING_REFUSAL;
        options.onChange?.(currentState());
        return;
      }
      restoreSelection(session.undo());
    },
    redo: () => {
      if (editingMode === 'view') {
        lastRejection = VIEWING_REFUSAL;
        options.onChange?.(currentState());
        return;
      }
      restoreSelection(session.redo());
    },
    activeScope: () => {
      const note = noteOps?.activeNoteScope();
      if (note) return note;
      return hfScope!.activeScope();
    },
    setActiveScope: (scope: ViewScope) => {
      if (scope.kind === 'note') return noteOps!.enterNote(scope.id);
      // REFUSED BEFORE ANYTHING IS LEFT. A scope this surface does not open — `frame`, or
      // anything a later contract adds — used to fall through to the exit below and only
      // then report false: the call failed AND closed the note the reader had open.
      if (scope.kind !== 'body' && scope.kind !== 'headerFooter') return false;
      noteOps?.exitNote();
      return hfScope!.setActiveScope(scope);
    },
    insertNote: (noteKind) => noteOps!.insertNote(noteKind),
    deleteNote: (noteKind, noteId) => noteOps!.deleteNote(noteKind, noteId),
    convertNote: (fromKind, noteId) => noteOps!.convertNote(fromKind, noteId),
    convertAllNotes: (fromKind) => noteOps!.convertAllNotes(fromKind),
    setNoteProperties: (args) => noteOps!.setNoteProperties(args),
    enterNote: (scopeId, position) => noteOps!.enterNote(scopeId, position),
    exitNote: () => noteOps!.exitNote(),
    notePropertiesState: () => {
      const paragraphId = surface.state().selection.head.paragraphId;
      const key = `${session.packageRevision()}:${paragraphId}`;
      if (key === cachedNotePropertiesKey) return cachedNoteProperties;
      const fresh = notePropertiesStateOf(surface);
      cachedNoteProperties = fresh;
      cachedNotePropertiesKey = key;
      return fresh;
    },
    notePreviewText: (scopeId) => notePreviewTextOf(session, scopeId),
    applyTableCommandPlan(plan: TableCommandPlan): ExecResult {
      if (!plan.ok) {
        return { ok: false, code: plan.code, reason: plan.reason };
      }
      let committedCaret: {
        readonly paragraphId: string;
        readonly start: number;
        readonly end: number;
      } | null = null;
      const unsub = session.subscribe((change) => {
        if (change.caret) {
          committedCaret = change.caret;
        }
      });
      try {
        const selectionBefore = selectionMark();
        const adoptCaret = plan.selection.kind === 'adoptCommittedCaret';
        commit(
          () => applyOps(plan.ops, selectionBefore),
          adoptCaret
            ? () => {
                const caret = committedCaret;
                if (!caret) return null;
                return collapsedAt({
                  paragraphId: caret.paragraphId,
                  offset: caret.start,
                });
              }
            : undefined,
          plan.selection.kind === 'preserveSelection' ? { keepCellSelection: true } : undefined
        );
      } finally {
        unsub();
      }
      if (lastRejection) {
        return { ok: false, code: 'invalidArgs', reason: lastRejection };
      }
      return { ok: true, changed: true };
    },
    enterHeaderFooter: (args) => {
      const entered = hfScope!.enterHeaderFooter(args);
      if (!entered) return entered;
      // A PROGRAMMATIC enter (review card, automation) must bring the band into view —
      // `followCaretIntoView` deliberately sits out while a furniture scope is open, and
      // the pointer path enters from a double-click that is by definition already on
      // screen. 'nearest' makes this a no-op in that already-visible case.
      const active = hfScope!.getActive();
      const page = active ? currentLayout.pages[active.pageIndex] : undefined;
      if (active && page) {
        const story = active.kind === 'header' ? page.header : page.footer;
        const bandY =
          story?.box.y ??
          (active.kind === 'header' ? page.box.y : page.box.y + page.box.height - 1);
        const bandHeight = story?.box.height ?? 1;
        scrollToContentY(bandY, bandHeight, { block: 'nearest' });
      }
      return entered;
    },
    exitHeaderFooter: () => hfScope!.exitHeaderFooter(),
    headerFooterState: () => hfScope!.headerFooterStateStable(session.packageRevision()),
    ...createHeaderFooterOps({
      applyOps,
      commit,
      deleteSelectionOps,
      orderedStart,
      selectionMark,
      collapsedAt,
      isHeaderFooterOpen: () => hfScope?.getActive() !== null,
      lastRejection: () => lastRejection,
    }),
    ...createImageOps({
      session,
      applyOps,
      commit,
      storyScope,
      selectionMark,
      editingMode: () => editingMode,
      author: () => options.author,
      trackedDate,
      decodePort: () => decodePort,
    }),

    // `preventScroll`: the pages layer is the WHOLE document tall, and focusing it scrolls
    // it into view — to its top. The first click anywhere in a long document therefore
    // threw the reader back to page 1 before the caret it had just placed could be seen.
    // The caret is positioned from layout regardless, so nothing needs the browser's scroll.
    focus: () => pagesLayer.focus({ preventScroll: true }),
    setTableInteractionLabel(resolver) {
      tableLabelState.resolve = resolver;
    },
    refreshTableInteractionLabels() {
      tableInteraction.refreshLabels();
    },
    destroy() {
      document.removeEventListener('selectionchange', onSelectionChange);
      pagesLayer.removeEventListener('keydown', onKeyDown);
      pagesLayer.removeEventListener('beforeinput', onBeforeInput as EventListener);
      pagesLayer.removeEventListener('copy', onCopy as EventListener);
      pagesLayer.removeEventListener('cut', onCut as EventListener);
      pagesLayer.removeEventListener('paste', onPaste as EventListener);
      pagesLayer.removeEventListener('compositionstart', onCompositionStart);
      pagesLayer.removeEventListener('compositionend', onCompositionEnd);
      document.removeEventListener('scroll', onScroll, { capture: true });
      container.ownerDocument.defaultView?.removeEventListener('resize', onViewportResize);
      viewportObserver?.disconnect();
      observedScroller = null;
      pointer?.destroy();
      tableInteraction.destroy();
      navigation.destroy();
      pagesLayer.removeEventListener('contextmenu', onTocContextMenu);
      pagesLayer.removeEventListener('click', onTocRowClick);
      pagesLayer.removeEventListener('pointermove', onTocPointerMove);
      pagesLayer.removeEventListener('pointerleave', onTocPointerLeave);
      // Drop pending layout work and stop listening BEFORE the DOM goes, or a commit from
      // another editor sharing this store would paint into a detached container.
      scheduler.cancel();
      drawingBundle.dispose();
      detachDrawingUrlRegistry(pagesLayer);
      caret.destroy();
      unsubscribe();
      container.replaceChildren();
    },
  };

  /**
   * Put the caret back where a reversed history entry left it.
   *
   * `null` means nothing moved — either the stack was empty or the entry recorded no
   * selection — so the caret stays where the user left it rather than jumping to the top.
   */
  function restoreSelection(
    mark: { paragraphId: string; start: number; end: number } | null
  ): void {
    // Undo and redo go straight to the session rather than through `commit`, so the armed
    // typing format is retired here. Word discards it on undo, and a history entry can
    // restore the caret to the exact position it was armed at — which would otherwise leave
    // it armed against a tree the undo has already replaced.
    pendingFormats = null;
    // The tree about to be published is not the one the DOM selection was made against, so
    // the flush below must not read it back: offsets in the reverted tree do not correspond
    // to offsets in the one that replaced it.
    selectionSync.noteModelMoved();
    flushLayout();
    if (!mark) {
      // No recorded mark — a cross-paragraph edit records none, because a mark addresses one
      // paragraph. The caret must still be CLAMPED to the tree undo just restored: leaving it
      // pointed past the end of a shortened paragraph, or at a paragraph the undo removed,
      // and every later keystroke was refused. Select All, type, undo froze the editor.
      setSelection(clampedToDocument(currentLayout, paragraphOrder(), selection));
      return;
    }
    setSelection({
      anchor: { paragraphId: mark.paragraphId, offset: mark.start },
      head: { paragraphId: mark.paragraphId, offset: mark.end },
    });
  }

  /**
   * Scroll the surface's container so a band of CONTENT space is in view.
   *
   * Layout coordinates, scaled here — never element measurement. The page a reveal is
   * asked for is usually one that has not been materialized yet, so it has no element to
   * read a position from; the records always know where it is.
   */
  function scrollToContentY(
    contentY: number,
    contentHeight: number,
    options?: {
      block?: 'start' | 'center' | 'centerIfNeeded' | 'nearest';
      offsetPx?: number;
      behavior?: ScrollBehavior;
    }
  ): boolean {
    const scroller = surfaceScroller(container);
    if (!scroller || scroller.clientHeight === 0) return false;
    const top = contentY * scale + container.offsetTop;
    const height = contentHeight * scale;
    const padding = options?.offsetPx ?? 24;
    const block = options?.block ?? 'start';
    const viewport = scroller.clientHeight;
    if (block === 'nearest' || block === 'centerIfNeeded') {
      const above = top < scroller.scrollTop;
      const below = top + height > scroller.scrollTop + viewport;
      if (!above && !below) return true;
    }
    const target =
      block === 'center' || block === 'centerIfNeeded'
        ? top - Math.max(0, (viewport - height) / 2)
        : block === 'nearest' && top > scroller.scrollTop
          ? top + height + padding - viewport
          : top - padding;
    const maxScroll = Math.max(0, scroller.scrollHeight - viewport);
    scroller.scrollTo({
      top: Math.max(0, Math.min(target, maxScroll)),
      behavior: options?.behavior ?? 'auto',
    });
    // Materialization follows the scroller, and a programmatic scroll fires `scroll`
    // asynchronously — repaint now so the revealed page is BUILT rather than a blank
    // sheet the caller has to scroll again to fill.
    rematerialize();
    return true;
  }

  /** The current selection as a history mark — one paragraph or nothing. */
  function selectionMark(): { paragraphId: string; start: number; end: number } | null {
    return selectionMarkOf(selection);
  }

  /** The selection in DOCUMENT order, whichever way the user dragged it. */
  function orderedRange(): { from: SemanticPosition; to: SemanticPosition } {
    return orderedRangeOf(currentLayout, selection, paragraphOrder());
  }

  function orderedStart(): SemanticPosition {
    return orderedRange().from;
  }

  /** Model text of a paragraph, read back from the layout records. */
  function textOf(paragraphId: string): string {
    return paragraphTextFromLayout(currentLayout, paragraphId);
  }

  /**
   * The inline content control whose content ends (Backspace) or starts (Delete) exactly
   * at the caret, in the ACTIVE story part. Consulted so the key takes the node as ONE
   * unit (pro-review-and-custom-nodes 4.6): deleting into a chip character-by-character
   * would either strip letters from a content-locked label — refused, a dead key — or
   * leave a half-deleted node whose tag still claims the full payload.
   */
  function inlineControlBeside(
    position: { readonly paragraphId: string; readonly offset: number },
    side: 'before' | 'after'
  ): { readonly controlId: string; readonly start: number; readonly end: number } | null {
    const part = session.partFor(storyScope()) ?? session.part();
    const paragraph = findNode(part, position.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') return null;
    return side === 'before'
      ? inlineControlEndingAt(paragraph, position.offset)
      : inlineControlStartingAt(paragraph, position.offset);
  }

  /**
   * The plan that removes the current selection, or an empty one when it is collapsed.
   *
   * `collapseTo` rather than `orderedStart()` is what every caller must address afterwards:
   * a plan that removes a table takes its cell paragraphs with it, so a range beginning in
   * one has no start left to insert at, and an op naming a paragraph the same transaction
   * deleted vetoes the whole transaction.
   */
  function deleteSelectionPlan(): RangeDeletionPlan {
    // A RECTANGLE is not the range it stands in for. Rows one and two of column one, read as
    // a range, run through every cell between them — so deleting through the range empties
    // cells the drag never covered, which is the exact failure the rectangle exists to
    // prevent. Clear each selected cell's own paragraphs instead, and join nothing: Word
    // empties the cells and never merges them.
    if (cellSelection) {
      const ops: TreeDocOp[] = [];
      for (const paragraphId of paragraphsInCells(currentLayout, cellSelection.cellIds)) {
        const length = paragraphTextFromLayout(currentLayout, paragraphId).length;
        if (length > 0) ops.push({ op: 'deleteText', paragraphId, start: 0, end: length });
      }
      // Nothing structural goes, so the range start is still there to collapse onto.
      return { ops, collapseTo: orderedStart() };
    }
    const { from, to } = orderedRange();
    return planRangeDeletion(
      currentLayout,
      session.partFor(storyScope()) ?? session.part(),
      from,
      to,
      paragraphOrder()
    );
  }

  function deleteSelectionOps(): readonly TreeDocOp[] {
    return deleteSelectionPlan().ops;
  }

  // Event wiring lives HERE rather than in each host, so React, Vue and a plain page get
  // identical behaviour instead of three hand-written keymaps that drift. The handlers
  // themselves are factories over the surface interface: keys, clipboard and `beforeinput` in
  // surface-input.ts, the selection mirror and the IME lane in surface-selection-sync.ts.
  const { onSelectionChange, onCompositionStart, onCompositionEnd } = selectionSync;

  /**
   * The pointer lane's handle, assigned once the surface it drives exists.
   *
   * Read by the selection mirror: the browser keeps reporting its own idea of the selection
   * while a gesture runs, and adopting one of those mid-drag snaps the caret back to whatever
   * the DOM guessed.
   */
  let pointer: PointerController | null = null;
  const dispatchKeyDown = createKeyDownHandler(
    surface,
    options.onRequestHyperlink ? { onRequestHyperlink: options.onRequestHyperlink } : {}
  );
  const onKeyDown = (event: KeyboardEvent): void => {
    // The browser may have moved its caret without delivering the queued `selectionchange`
    // yet. Close that window before a command resolves its TreeDocOp from model selection.
    if (!event.defaultPrevented) selectionSync.adoptBeforeInput();
    dispatchKeyDown(event);
  };
  const { onCopy, onCut, onPaste } = createClipboardHandlers(surface, insertPlainText);
  const dispatchBeforeInput = createBeforeInputHandler(surface, {
    isComposing: () => selectionSync.isComposing(),
    insertPlainText,
  });
  const onBeforeInput = (event: InputEvent): void => {
    selectionSync.adoptBeforeInput();
    dispatchBeforeInput(event);
  };

  /** Insert text, turning newlines into real paragraph splits rather than literal characters. */
  function insertPlainText(text: string): void {
    // Normalized first: a Windows clipboard carries CRLF, a page break arrives as a form
    // feed, and either one left in run text is a control character the store refuses —
    // which vetoes the whole transaction and makes the paste do nothing at all.
    const lines = insertableText(text).split('\n');

    // ONE COMMIT, TWO OPS, whatever the clipboard holds.
    //
    // A newline in pasted plain text is a paragraph boundary — a new `w:p`, never a
    // character in run text. Committing once per line laid out and repainted the whole
    // document per pasted paragraph, so a four-page paste cost two hundred layouts of a
    // growing document: quadratic in document size, and the reason paste lagged long
    // before typing did. The whole paste is one op list instead: the joined text lands in
    // the caret's paragraph with a single insert, and one `splitParagraphMany` cuts that
    // paragraph at every newline offset in a single pass — one rebuild of the body's child
    // sequence, however many paragraphs the clipboard carried.
    const plan = deleteSelectionPlan();
    const start = plan.collapseTo;
    const joined = lines.join('');
    const ops: TreeDocOp[] = [...plan.ops];
    // Plain text pasted at a caret takes the armed typing format, like typed text — Word
    // formats a plain paste as if you had typed it. Written over the PRE-SPLIT offsets, so
    // the op runs before `splitParagraphMany` cuts the paragraph up.
    const pendingOps = consumePendingFormatOps(start.paragraphId, start.offset, joined.length);
    if (joined.length > 0) {
      ops.push({
        op: 'insertText',
        paragraphId: start.paragraphId,
        offset: start.offset,
        text: joined,
      });
      ops.push(...pendingOps);
    }
    const boundaries: number[] = [];
    let consumed = 0;
    for (let index = 0; index < lines.length - 1; index += 1) {
      consumed += lines[index]!.length;
      boundaries.push(start.offset + consumed);
    }
    if (boundaries.length > 0) {
      ops.push({ op: 'splitParagraphMany', paragraphId: start.paragraphId, offsets: boundaries });
    }
    if (ops.length === 0) return;

    const before = new Set(session.paragraphIdsIn(storyScope()));
    const lastLine = lines[lines.length - 1]!;
    const withoutFormat = ops.filter((op) => !pendingOps.includes(op));
    commit(
      () => withoutPendingOnRejection(ops, withoutFormat, selectionMark()),
      () => {
        if (boundaries.length === 0) {
          return collapsedAt({
            paragraphId: start.paragraphId,
            offset: start.offset + lastLine.length,
          });
        }
        // The caret lands at the end of the pasted text: in the LAST minted paragraph, right
        // after the final line. Scoped story ids are in document order, so the last unfamiliar
        // id is the tail that carries the final line and whatever followed the caret.
        const minted = session.paragraphIdsIn(storyScope()).filter((id) => !before.has(id));
        const landing = minted[minted.length - 1];
        return landing ? collapsedAt({ paragraphId: landing, offset: lastLine.length }) : null;
      }
    );
  }

  // Selection lives on the document, so this is where the browser reports it changing —
  // whatever produced it: a drag, a double-click, Select All, or a caret move.
  document.addEventListener('selectionchange', onSelectionChange);
  pagesLayer.addEventListener('keydown', onKeyDown);
  pagesLayer.addEventListener('beforeinput', onBeforeInput as EventListener);
  pagesLayer.addEventListener('copy', onCopy as EventListener);
  pagesLayer.addEventListener('cut', onCut as EventListener);
  pagesLayer.addEventListener('paste', onPaste as EventListener);
  pagesLayer.addEventListener('compositionstart', onCompositionStart);
  pagesLayer.addEventListener('compositionend', onCompositionEnd);

  // Attached at mount, when the host's chrome — including the scroll container — already
  // exists. Coalesced to a frame: a wheel fires far more scroll events than there are
  // frames, and each repaint costs the same whether one event asked for it or twenty.
  // BOUND TO THE DOCUMENT, RESOLVED PER EVENT. `scroll` does not bubble, but it does fire
  // in the CAPTURE phase on every ancestor, and that is the only binding that survives the
  // mount order: a host attaches the surface and only then wraps it in its viewport, so a
  // scroller captured with `closest` at mount time is routinely null — and a null one meant
  // no listener at all, so scrolling never built the pages it revealed. Every page past the
  // first screenful stayed blank until some unrelated commit forced a repaint.
  // Also covers StrictMode / provider-first attach before the Content node sits under the
  // scroll container (footnotes and later sheets must rematerialize).
  let rematerializeScheduled = false;
  /** Coalesce to a frame: twenty events and one event cost the same repaint. */
  function scheduleRematerialize(): void {
    if (rematerializeScheduled) return;
    rematerializeScheduled = true;
    const raf = container.ownerDocument.defaultView?.requestAnimationFrame;
    const run = (): void => {
      rematerializeScheduled = false;
      rematerialize();
    };
    if (raf) raf(run);
    else queueMicrotask(run);
  }

  const onScroll = (event: Event): void => {
    const scroller = surfaceScroller(container);
    if (!scroller || event.target !== scroller) return;
    scheduleRematerialize();
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // WHICH PAGES ARE VISIBLE DEPENDS ON THE VIEWPORT'S SIZE, NOT ONLY ON ITS SCROLL OFFSET.
  //
  // `visiblePageSet` reads `clientHeight`, so a viewport that grows reveals pages the last
  // paint had no reason to build — and a resize fires no `scroll`. Nothing asked for a
  // repaint, so the newly uncovered sheets stayed blank until the user scrolled or typed:
  // maximizing the window, closing a side panel, rotating a tablet, or the browser chrome
  // collapsing on scroll-up all land there.
  const onViewportResize = (): void => {
    scheduleRematerialize();
  };
  const view = container.ownerDocument.defaultView;
  view?.addEventListener('resize', onViewportResize, { passive: true });
  // The window event covers a resized window; an observer covers everything that changes
  // the scroller WITHOUT one — a collapsing panel, a wrapping toolbar, a CSS change. The
  // scroller is resolved lazily for the same reason the scroll listener binds to the
  // document: at mount the host has routinely not wrapped the surface in its viewport yet.
  viewportObserver =
    typeof view?.ResizeObserver === 'function' ? new view.ResizeObserver(onViewportResize) : null;
  function watchScrollerSize(): void {
    if (!viewportObserver) return;
    const scroller = surfaceScroller(container);
    if (scroller === observedScroller) return;
    viewportObserver.disconnect();
    observedScroller = scroller;
    if (scroller) viewportObserver.observe(scroller);
  }
  watchScrollerSize();

  pointer = createPointerController(
    {
      pagesLayer,
      container,
      scale: () => scale,
      // Pages of differing width are centred individually, so a landscape page among
      // portrait ones is painted at an x its record does not carry. Without this the
      // transform reads every point on such a page shifted by that offset.
      pageOffsetX: (pageIndex) => materializedExtent?.pageOffsetX.get(pageIndex) ?? 0,
      layout: () => currentLayout,
      measurer: () => measurer,
      selection: () => selection,
      setSelection: (next) => setSelection(next),
      cellSelection: () => cellSelection,
      setCellSelection: (next) => setCellSelection(next),
      // `preventScroll`: the pages layer is the WHOLE document tall, and focusing it scrolls
      // it into view — to its top. The first click anywhere in a long document therefore
      // threw the reader back to page 1 before the caret it had just placed could be seen.
      // The caret is positioned from layout regardless, so nothing needs the browser's scroll.
      focus: () => pagesLayer.focus({ preventScroll: true }),
      activeHeaderFooter: () => pointerHeaderFooterState(hfScope?.getActive() ?? null),
      activeNote: () => {
        const scope = noteOps?.activeNoteScope();
        return scope
          ? { scopeId: scope.id, pageIndex: noteOps?.activeNotePageIndex() ?? null }
          : null;
      },
      enterHeaderFooter: (info) => {
        hfScope?.enterHeaderFooter({
          rId: info.rId,
          pageIndex: info.pageIndex,
          kind: info.kind,
          ...(info.position ? { position: info.position } : {}),
        });
      },
      enterNote: (scopeId, position, pageIndex) => {
        noteOps?.enterNote(scopeId, position, pageIndex);
      },
      exitNote: (restoreBody) => {
        noteOps?.exitNote(restoreBody);
      },
      exitHeaderFooter: () => hfScope?.exitHeaderFooter(),
      enterEmptyHeaderFooter: (kind, pageIndex) => {
        // Creating the part is a WRITE — viewing mode refuses it like every other lane.
        if (editingMode === 'view') return;
        // Which section owns the page, from the multi-section spans; a single-section
        // document has no spans and every page belongs to section 0.
        const spans = layoutSession.multi?.spans;
        let sectionIndex = 0;
        let sectionStart = 0;
        if (spans && spans.length > 0) {
          for (let index = 0; index < spans.length; index += 1) {
            const span = spans[index]!;
            sectionIndex = index;
            sectionStart = span.startIndex;
            if (pageIndex < span.startIndex + span.pageCount) break;
          }
        }
        const bySection = session.headerFooterResolutionBySection();
        const section = bySection[Math.min(sectionIndex, Math.max(0, bySection.length - 1))];
        // The variant this page would DISPLAY, which is the one Word creates on a blank
        // double-click: `even` on an even page only when the document separates them,
        // `first` on a section's first page only when it declares a title page.
        const pageNumber =
          currentLayout.pages[pageIndex]?.pageFieldSource?.pageNumber ?? pageIndex + 1;
        const variant: 'default' | 'first' | 'even' =
          section?.evenAndOddHeaders && pageNumber % 2 === 0
            ? 'even'
            : section?.titlePage && pageIndex === sectionStart
              ? 'first'
              : 'default';
        const slotsOf = (resolution: typeof bySection) => {
          const target = resolution[Math.min(sectionIndex, Math.max(0, resolution.length - 1))];
          return kind === 'header' ? target?.headers : target?.footers;
        };
        let rId = slotsOf(bySection)?.get(variant)?.rId;
        if (!rId) {
          const created = surface.applyHeaderFooterLifecycle?.({
            op: 'createHeaderFooter',
            sectionIndex,
            kind,
            variant,
            ...(variant === 'first' ? { titlePage: true } : {}),
            ...(variant === 'even' ? { evenAndOddHeaders: true } : {}),
          });
          if (!created?.ok) return;
          rId = slotsOf(session.headerFooterResolutionBySection())?.get(variant)?.rId;
        }
        if (!rId) return;
        hfScope?.enterHeaderFooter({ rId, pageIndex, sectionIndex, kind, variant });
      },
      onContentControlWidget: (controlId, kind) => openContentControlWidget(controlId, kind),
      isReadOnlyParagraph: (paragraphId) => tocIdAtParagraph(paragraphId) !== null,
    },
    options.pointer ? { mode: options.pointer } : {}
  );

  const tableInteraction = createSurfaceTableInteraction({
    pagesLayer,
    furnitureLayer: tableFurnitureLayer,
    scale: () => scale,
    pageOffsetX: (pageIndex) => materializedExtent?.pageOffsetX.get(pageIndex) ?? 0,
    read: () => ({
      layout: currentLayout,
      storeRevision: session.packageRevision(),
      selection,
      cellSelection,
      editingMode,
      themeColors: session.documentThemeColors(),
    }),
    session: () => session,
    applyTableCommandPlan: (plan) => surface.applyTableCommandPlan(plan),
    label: (key) => tableLabelState.resolve(key),
  });

  render();
  const originalSetEditingMode = surface.setEditingMode.bind(surface);
  surface.setEditingMode = (mode) => {
    originalSetEditingMode(mode);
    tableInteraction.update();
  };
  surface.setTableInteractionLabel = (resolver) => {
    tableLabelState.resolve = resolver;
    tableInteraction.refreshLabels();
  };
  surface.refreshTableInteractionLabels = () => {
    tableInteraction.refreshLabels();
  };
  return { ok: true, surface };
}
