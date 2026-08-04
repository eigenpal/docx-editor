// The engine-owned paginated paragraph surface (task 8.1).
//
// This is the composition the whole change has been building toward, and the surface that
// REPLACES the visible-ProseMirror checkpoint:
//
//   tree session -> semantic layout -> painted pages
//                                   -> semantic caret / selection / hit test
//
// There is no contenteditable holding the document. What the user sees is painted from
// layout records, and every caret, selection and hit test is answered from those same
// records — so the DOM is a picture, not a second source of truth. Keystrokes arrive through
// a small offscreen input host, which is what gives the browser somewhere to put focus, the
// IME and autofill without letting it own the document.
//
// The composition root lives here. Its seams are siblings: the host-facing contract in
// paginated-surface-contract.ts, input wiring in surface-input.ts, the two-way selection
// mirror and the IME lane in surface-selection-sync.ts, selection/op planning in
// surface-selection-ops.ts, formatting queries in surface-formatting.ts, and the page
// environment in surface-pages.ts — all re-exported or consumed from this module.

import { openTreeSession, type TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import { hyperlinkTargetOf, type TreeDocOp } from '@docx-editor.dev/core-contract/store';
import {
  createLayoutScheduler,
  createLayoutSession,
  createParagraphLayoutCache,
  resolveDefaultSurfaceMeasurer,
  cellSelectionRects,
  keyedRangeRects,
  paragraphFragmentsOf,
  reviewItemKey,
  reviewItemsAt,
  selectionRects,
  caretAt,
  cellSelectionText,
  documentOrder,
  paragraphsInCells,
  layoutSemanticDocument,
  resolveNumberingLevel,
  moveCaret,
  paragraphTextFromLayout,
  withNumberingStyleLinks,
  wordBoundary,
  type CellSelection,
  type KeyedRange,
  type LayoutScope,
  type ReviewItem,
  type ReviewRevisionKind,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import {
  paintSelectionOverlay,
  paintSemanticLayout,
  type OverlayRect,
} from '@docx-editor.dev/core-contract/output';
import { tryCreateBrowserCanvasContext } from './browser-canvas-context.ts';
import type {
  OpenPaginatedResult,
  PaginatedSurface,
  PaginatedSurfaceOptions,
  PaginatedSurfaceState,
  SurfaceEditingMode,
} from './paginated-surface-contract.ts';
import {
  clampedToDocument,
  collapsedAt,
  deleteRangeOps,
  orderedRangeOf,
  selectedTextIn,
  selectionMarkOf,
} from './surface-selection-ops.ts';
import {
  createBeforeInputHandler,
  createClipboardHandlers,
  createKeyDownHandler,
} from './surface-input.ts';
import {
  createFurnitureSource,
  createSurfaceStyleDeps,
  equalPageSets,
  equalSurfaceExtents,
  surfaceExtent,
  surfaceScroller,
  visiblePageSet,
  type SurfaceExtent,
} from './surface-pages.ts';
import { createSurfaceCaret } from './surface-caret.ts';
import { createSurfaceFormat } from './surface-format.ts';
import {
  authoredRunPropertiesAt,
  mergedProperties,
  type SurfaceProperty,
} from './surface-formatting.ts';
import { createPointerController, type PointerController } from './surface-pointer.ts';
import { createSurfaceSelectionSync } from './surface-selection-sync.ts';
import { createSurfaceStructure } from './surface-structure.ts';
import { createHyperlinkOps } from './surface-hyperlinks.ts';
import { createSurfaceNavigation } from './surface-navigation.ts';

export type {
  OpenPaginatedResult,
  PaginatedSurface,
  PaginatedSurfaceOptions,
  PaginatedSurfacePerf,
  PaginatedSurfaceState,
  SurfaceFormatting,
} from './paginated-surface-contract.ts';

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
  const opened = openTreeSession(bytes);
  if (!opened.ok) {
    return {
      ok: false,
      reason: opened.reason,
      ...(opened.detail ? { detail: opened.detail } : {}),
    };
  }
  const session = opened.session;
  const scale = options.scale ?? 96 / 72;
  const VIEWING_REFUSAL = 'the document is open for viewing';
  /** Separates a decision's key from its per-range index. A NUL cannot occur in either. */
  const RANGE_SUFFIX = '\u0000range\u0000';
  /** One timestamp per edit. The clock is the host's; the store never reads one. */
  // SECONDS precision, like Word. Milliseconds are valid `xsd:dateTime` but no other editor
  // writes them, and two revisions differing only in milliseconds never group.
  const trackedDate = (): string => `${new Date().toISOString().slice(0, 19)}Z`;
  // Editor seam creates the canvas; layout only consumes the injected context.
  const defaults = options.measurer
    ? null
    : resolveDefaultSurfaceMeasurer(scale, {
        context: tryCreateBrowserCanvasContext(container.ownerDocument),
        // Measure with the same face paint draws with.
        ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
      });
  const measurer = options.measurer ?? defaults!.measurer;
  // Incremental layout machinery — without these every keystroke re-lays out the document.
  const layoutCache = createParagraphLayoutCache<never>();
  const layoutSession = createLayoutSession();
  // Measurer identity folds into the cache key so a later font resolution cannot serve stale layout.
  const producer =
    options.producer ??
    (options.measurer ? 'host-measurer' : (defaults?.producer ?? 'fixed-measurer'));
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

  container.style.position = 'relative';
  container.replaceChildren(pagesLayer, commentLayer, overlayLayer);

  // The engine paints its own insertion point. The native caret is a single device pixel,
  // and an empty paragraph paints no text span for the browser to size one against.
  const caret = createSurfaceCaret(pagesLayer, scale, () => ({
    layout: currentLayout,
    selection,
    measurer,
  }));

  const firstParagraph = session.paragraphIds()[0] ?? '';
  let selection: SemanticSelection = {
    anchor: { paragraphId: firstParagraph, offset: 0 },
    head: { paragraphId: firstParagraph, offset: 0 },
  };
  /**
   * The rectangle of cells a table drag selected, or null for an ordinary text selection.
   *
   * A SIBLING of `selection` rather than a variant of it: `selection` always holds a valid
   * text range — the one this rectangle stands in for — so deletion, the clipboard, the DOM
   * mirror and viewport pinning keep working with no knowledge that a rectangle exists.
   */
  let cellSelection: CellSelection | null = null;
  let lastRejection: string | null = null;

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
    const order = documentOrder(currentLayout);
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
   * The op that applies the armed caret formatting to text just inserted at its anchor,
   * or nothing when no format is armed there.
   *
   * One producer for BOTH insertion lanes — `type()` and the IME composition readback —
   * so composed text takes the armed format exactly like typed text (Word's behavior).
   * The armed properties merge over the base captured at ARM time (the caret run's own
   * authored `w:rPr`, never the cascade); `setRunProperties` replaces the whole `w:rPr`
   * over the range it names, so the op is complete on its own. The anchor is matched
   * exactly; an ambiguous diff that lands the insert elsewhere degrades to "the format is
   * forgotten", never "the wrong text is styled".
   */
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
  const furnitureSource = createFurnitureSource({
    session,
    measurer,
    producer,
    cache: layoutCache,
    styleCascade,
    defaultTabStopPt,
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
      return session.applyPmDoc(doc);
    },
  };

  let currentLayout = layoutOnce();
  // Structural edits — breaks, lists, indent, sections — are their own lane over the same
  // session and commit path.
  const format = createSurfaceFormat({
    session: gatedSession,
    layout: () => currentLayout,
    selection: () => selection,
    commit: (run, nextSelection, options) => commit(run, nextSelection, options),
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
    selectedCells: () => cellSelection?.cellIds,
    defaultParagraphStyleId: () => styleCascade?.defaultParagraphStyleId ?? null,
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
          authoredRunPropertiesAt(session.part(), head.paragraphId, head.offset);
        pendingFormats = { position: head, properties: next, base };
      }
      // Not document state, but observable state: the toolbar's Bold must light up NOW,
      // and the snapshot cache invalidates on this report.
      options.onChange?.(currentState());
    },
  });
  const structure = createSurfaceStructure({
    session: gatedSession,
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
    deleteSelectionOps: () => deleteSelectionOps(),
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
    selection: () => selection,
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
    commit: (run, selectionAfter) => commit(run, selectionAfter),
  });
  const navigation = createSurfaceNavigation({
    pagesLayer,
    container,
    scale,
    layout: () => currentLayout,
    bookmarks: () => session.bookmarks(),
    linkById: (linkId) => hyperlinks.linkById(linkId),
    setSelection: (position) => setSelection(collapsedAt(position)),
    isCollapsedSelection: () =>
      selection.anchor.paragraphId === selection.head.paragraphId &&
      selection.anchor.offset === selection.head.offset,
    ...(options.onHyperlinkPopover ? { onPopover: options.onHyperlinkPopover } : {}),
  });
  let desiredX: number | null = null;

  function layoutOnce(): SemanticLayout {
    const began = now();
    const layout = layoutSemanticDocument(session.part(), session.revision(), {
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
    });
    lastLayoutMs = now() - began;
    return layout;
  }

  /**
   * Relayout goes through the SCHEDULER, not straight to `layoutSemanticDocument`.
   *
   * That is what carries the store's own account of a commit — dirty ids, split/join,
   * dependency keys, impact class — into layout, and what refuses to publish a layout whose
   * revision the model has already left behind. Running synchronously here keeps a keystroke
   * painted in the same turn; an async host swaps in its own `schedule` without changing
   * either property.
   */
  const scheduler = createLayoutScheduler({
    // The DOCUMENT's geometry, exactly as the first paint uses. Omitting it meant the first
    // paint honoured A4 and the first committed edit silently repaginated onto Letter — every
    // layout after the first comes through here rather than through `layoutOnce`.
    run: (scope: LayoutScope) => {
      const began = now();
      const layout = layoutSemanticDocument(session.part(), scope.revision, {
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
      });
      lastLayoutMs = now() - began;
      return layout;
    },
    currentRevision: () => session.revision(),
    publish: (layout) => {
      currentLayout = layout;
      // Repaint from HERE, so a commit that never went through this surface — undo, or
      // another editor sharing the store — still reaches the screen. Otherwise the painted
      // pages keep showing a revision the model has already left.
      render();
    },
  });

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

  /** The pages worth building in detail, for the current viewport and selection. */
  function visiblePages(): ReadonlySet<number> | undefined {
    return visiblePageSet(container, currentLayout, selection, scale);
  }

  /** Publish any pending layout. Returns whether it did, so callers can avoid a double paint. */
  function flushLayout(): boolean {
    // Nothing pending means nothing committed since the last pass, so the layout in hand is
    // already current and re-running it would be pure waste.
    return scheduler.pending() ? scheduler.flush() : false;
  }

  function currentState(): PaginatedSurfaceState {
    return {
      revision: session.revision(),
      pageCount: currentLayout.pages.length,
      selection,
      cellSelection,
      canUndo: session.canUndo(),
      canRedo: session.canRedo(),
      lastRejection,
      // Reference-stable while unchanged: `pendingAtCaret` hands back the stored array,
      // so a host can compare states to see whether the armed format moved.
      pendingFormat: pendingAtCaret(),
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
    paintSemanticLayout(pagesLayer, currentLayout, {
      scale,
      ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
      // Only what is on screen, plus a band either side and the pages the caret and the
      // selection touch. A five-hundred-page document has five hundred pages of records and
      // a screen holds two; building them all is the difference between opening and hanging.
      materialize: materializedSet,

      // NOT aria-hidden. That default is right when the painted pages are a picture beside
      // an editable projection — but here they ARE the projection: focus and the selection
      // live inside them. Hiding them would leave a role="textbox" whose entire content is
      // invisible to assistive technology, with the caret in a hidden subtree.
      ariaHidden: false,
    });
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

  let editingMode: SurfaceEditingMode = options.editingMode ?? 'edit';

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
    selectionAfter?: Parameters<TreeDocxSession['applyTreeOps']>[2]
  ): ReturnType<TreeDocxSession['applyTreeOps']> {
    // VIEWING refuses every write here rather than only at the facade. The keymap and
    // `beforeinput` are wired to this surface, not to `Editor.exec`, so a facade-only gate
    // left the document fully typeable while the toolbar reported it read-only.
    if (editingMode === 'view') {
      return {
        committed: false,
        rejected: true,
        opCount: 0,
        reason: 'the document is open for viewing',
      };
    }
    // SUGGESTING with no author cannot write `CT_TrackChange`, and the fallback of writing
    // an untracked edit is only tolerable when nothing is destroyed. A deletion in that
    // state removes text the reviewer was promised they could get back.
    // EVERY edit, not just the destructive ones. Letting insertions through wrote permanent
    // changes to someone else's document while the pill said Suggesting and the review pane
    // stayed empty — half the keyboard proposing and half editing outright.
    if (editingMode === 'suggest' && !options.author?.trim() && ops.some(isDocumentEdit)) {
      return {
        committed: false,
        rejected: true,
        opCount: 0,
        reason: 'suggesting needs an author before it can propose a change',
      };
    }

    return session.applyTreeOps(trackedOps(ops), selectionBefore, selectionAfter);
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

  /** Text ops become tracked ones while suggesting; everything else is untouched. */
  function trackedOps(ops: readonly TreeDocOp[]): TreeDocOp[] {
    const author = options.author?.trim();
    // `CT_TrackChange` makes `@w:author` required, so with no author there is nothing valid
    // to write. The edit lands untracked rather than being refused: losing the user's typing
    // to a missing configuration value would be the worse failure.
    if (editingMode !== 'suggest' || !author) return [...ops];
    const revision = { author, date: trackedDate() };
    return ops.flatMap((op): TreeDocOp[] => {
      if (op.op === 'insertText' || op.op === 'deleteText') return [{ ...op, revision }];
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
   * The two-way selection mirror and the IME lane.
   *
   * Created HERE, after the commit path it drives and before the listeners it answers: every
   * function it is handed is a hoisted declaration, and nothing renders until the mount paint
   * at the end of this factory.
   */
  const selectionSync = createSurfaceSelectionSync({
    session,
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
    },
    commit: (run) => commit(run),
    render: () => render(),
    flushLayout: () => flushLayout(),
    updateCaret: () => caret.update(),
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
      const key = reviewItemKey(item);
      for (const [index, range] of item.ranges.entries()) {
        if (!onScreen(range.start.paragraphId, range.end.paragraphId)) continue;
        ranges.push({
          key: item.ranges.length === 1 ? key : `${key}${RANGE_SUFFIX}${index}`,
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
   * Paragraph id to document position, memoized per layout.
   *
   * `documentOrder` publishes the ids in order; the containment test needs to compare two
   * paragraphs, which an array cannot do without a scan per comparison.
   */
  const documentOrderIndexCache = new WeakMap<SemanticLayout, Map<string, number>>();
  function documentOrderIndexOf(layout: SemanticLayout): Map<string, number> {
    const cached = documentOrderIndexCache.get(layout);
    if (cached) return cached;
    const index = new Map<string, number>();
    for (const [position, id] of documentOrder(layout).entries()) index.set(id, position);
    documentOrderIndexCache.set(layout, index);
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

  function activeReviewAtCaret(): ReviewItem | null {
    const at = selection?.head;
    if (!at) return null;
    // The covering items, innermost first, minus the one the reader dismissed. Returning
    // null for a dismissed innermost item hid every item under it too: dismissing a comment
    // that wraps a revision meant the revision could never become active either.
    const covering = reviewItemsAt(
      session.reviewItems(),
      at,
      documentOrderIndexOf(currentLayout)
    ).filter(
      (item) =>
        !(item.kind === 'comment' && item.resolved) && reviewItemKey(item) !== dismissedReviewKey
    );
    return covering[0] ?? null;
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

  const surface: PaginatedSurface = {
    session,
    // Flushes first: a commit made straight on the session — undo, or another editor
    // sharing the store — must not leave a caller reading geometry for a revision the model
    // has left behind. Nothing pending makes this a plain read.
    layout: () => {
      flushLayout();
      return currentLayout;
    },
    state: currentState,

    type(text) {
      // Insert at the selection's START, not at its head. Deleting a selection removes the
      // range beginning at the start, so inserting at the head — which may be the far end —
      // puts the text where the removed characters used to be rather than where the user
      // was typing.
      const start = orderedStart();
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
        ...deleteSelectionOps(),
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

    deleteBackward() {
      const ops = deleteSelectionOps();
      if (ops.length > 0) {
        const start = orderedStart();
        commit(
          () => applyOps(ops, selectionMark()),
          () => collapsedAt(start)
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
        const order = documentOrder(currentLayout);
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
      const position = orderedStart();
      const before = new Set(session.paragraphIds());
      // Word carries the typing format across Enter: bold armed before the split applies
      // to the first characters typed in the new paragraph.
      const armed = armedAtCaret() ?? undefined;
      commit(
        () =>
          applyOps(
            [
              ...deleteSelectionOps(),
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
          const tail = session.paragraphIds().find((id) => !before.has(id));
          return tail ? collapsedAt({ paragraphId: tail, offset: 0 }) : null;
        },
        { rearmPending: armed }
      );
    },

    navigate(command, extend = false) {
      const moved = moveCaret(currentLayout, selection.head, command, desiredX);
      if (!moved) return;
      desiredX = moved.desiredX;
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
      const order = documentOrder(currentLayout);
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
      return scrollToContentY(page.box.y + caret.y, caret.height, options);
    },

    selectAll() {
      const ids = session.paragraphIds();
      const first = ids[0];
      const last = ids[ids.length - 1];
      if (!first || !last) return;
      setSelection({
        anchor: { paragraphId: first, offset: 0 },
        head: { paragraphId: last, offset: textOf(last).length },
      });
    },

    hyperlinks,
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
          return clampedToDocument(currentLayout, session.paragraphIds(), selection);
        }
      ),

    editingMode: () => editingMode,
    setEditingMode: (mode) => {
      editingMode = mode;
      // The old refusal described the old mode. Left standing, a host rendering it showed
      // "the document is open for viewing" over a document that had just become editable.
      lastRejection = null;
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
      return selectedTextIn(currentLayout, from, to);
    },

    deleteSelection() {
      const ops = deleteSelectionOps();
      if (ops.length === 0) return false;
      const start = orderedStart();
      commit(
        () => applyOps(ops, selectionMark()),
        () => collapsedAt(start)
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
    // `preventScroll`: the pages layer is the WHOLE document tall, and focusing it scrolls
    // it into view — to its top. The first click anywhere in a long document therefore
    // threw the reader back to page 1 before the caret it had just placed could be seen.
    // The caret is positioned from layout regardless, so nothing needs the browser's scroll.
    focus: () => pagesLayer.focus({ preventScroll: true }),
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
      navigation.destroy();
      // Drop pending layout work and stop listening BEFORE the DOM goes, or a commit from
      // another editor sharing this store would paint into a detached container.
      scheduler.cancel();
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
      setSelection(clampedToDocument(currentLayout, session.paragraphIds(), selection));
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
      block?: 'start' | 'center' | 'nearest';
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
    if (block === 'nearest') {
      const above = top < scroller.scrollTop;
      const below = top + height > scroller.scrollTop + viewport;
      if (!above && !below) return true;
    }
    const target =
      block === 'center'
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
    return orderedRangeOf(currentLayout, selection);
  }

  function orderedStart(): SemanticPosition {
    return orderedRange().from;
  }

  /** Model text of a paragraph, read back from the layout records. */
  function textOf(paragraphId: string): string {
    return paragraphTextFromLayout(currentLayout, paragraphId);
  }

  /** Ops that remove the current selection, or none when it is collapsed. */
  function deleteSelectionOps(): Parameters<TreeDocxSession['applyTreeOps']>[0] {
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
      return ops;
    }
    const { from, to } = orderedRange();
    return deleteRangeOps(currentLayout, session.part(), from, to);
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
  const onKeyDown = createKeyDownHandler(
    surface,
    options.onRequestHyperlink ? { onRequestHyperlink: options.onRequestHyperlink } : {}
  );
  const { onCopy, onCut, onPaste } = createClipboardHandlers(surface, insertPlainText);
  const onBeforeInput = createBeforeInputHandler(surface, {
    isComposing: () => selectionSync.isComposing(),
    insertPlainText,
  });

  /** Insert text, turning newlines into real paragraph splits rather than literal characters. */
  function insertPlainText(text: string): void {
    // Normalized first: a Windows clipboard carries CRLF, and a literal CR in run text is
    // not a paragraph break in OOXML — it is a stray control character.
    const lines = text.replace(/\r\n?/g, '\n').split('\n');

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
    const start = orderedStart();
    const joined = lines.join('');
    const ops: TreeDocOp[] = [...deleteSelectionOps()];
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

    const before = new Set(session.paragraphIds());
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
        // after the final line. `paragraphIds` is in document order, so the last unfamiliar
        // id is the tail that carries the final line and whatever followed the caret.
        const minted = session.paragraphIds().filter((id) => !before.has(id));
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
    },
    options.pointer ? { mode: options.pointer } : {}
  );

  render();
  return { ok: true, surface };
}
