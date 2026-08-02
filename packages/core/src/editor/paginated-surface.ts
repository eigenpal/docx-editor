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
import type { TreeDocOp } from '@docx-editor.dev/core-contract/store';
import {
  createLayoutScheduler,
  createLayoutSession,
  createParagraphLayoutCache,
  resolveDefaultSurfaceMeasurer,
  cellSelectionRects,
  documentOrder,
  layoutSemanticDocument,
  resolveNumberingLevel,
  moveCaret,
  paragraphTextFromLayout,
  wordBoundary,
  type CellSelection,
  type LayoutScope,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import { paintSelectionOverlay, paintSemanticLayout } from '@docx-editor.dev/core-contract/output';
import { tryCreateBrowserCanvasContext } from './browser-canvas-context.ts';
import type {
  OpenPaginatedResult,
  PaginatedSurface,
  PaginatedSurfaceOptions,
  PaginatedSurfaceState,
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
  visiblePageSet,
  type SurfaceExtent,
} from './surface-pages.ts';
import { createSurfaceCaret } from './surface-caret.ts';
import { createSurfaceFormat } from './surface-format.ts';
import { createPointerController, type PointerController } from './surface-pointer.ts';
import { createSurfaceSelectionSync } from './surface-selection-sync.ts';
import { createSurfaceStructure } from './surface-structure.ts';

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

  container.style.position = 'relative';
  container.replaceChildren(pagesLayer, overlayLayer);

  // The engine paints its own insertion point. The native caret is a single device pixel,
  // and an empty paragraph paints no text span for the browser to size one against.
  const caret = createSurfaceCaret(pagesLayer, scale, () => ({ layout: currentLayout, selection }));

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

  let currentLayout = layoutOnce();
  // Structural edits — breaks, lists, indent, sections — are their own lane over the same
  // session and commit path.
  const format = createSurfaceFormat({
    session,
    layout: () => currentLayout,
    selection: () => selection,
    commit: (run, nextSelection) => commit(run, nextSelection),
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
  });
  const structure = createSurfaceStructure({
    session,
    layout: () => currentLayout,
    commit: (run, nextSelection) => commit(run, nextSelection),
    orderedStart: () => orderedStart(),
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    collapsedAt: (position) => collapsedAt(position),
    deleteSelectionOps: () => deleteSelectionOps(),
    paragraphTextOf: (paragraphId) => textOf(paragraphId),
    numberingLevelExists: (numId, level) =>
      resolveNumberingLevel(numberingIndex(), numId, level) !== null,
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
  const unsubscribe = session.subscribe((modelChange) => scheduler.notify(modelChange));

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
    // Sizing included: the style writes above invalidate layout, and the selection sync
    // right after is what forces the browser to resolve it. Splitting the timer here would
    // book the paint's own cost to the selection phase.
    lastPaintMs = now() - paintBegan;
    renderOverlay();
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

  function commit(
    run: () => ReturnType<TreeDocxSession['applyPmDoc']> | boolean,
    selectionAfter?: () => SemanticSelection | null
  ): void {
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
    }
    // A committed edit repaints through the scheduler's publish; a REFUSED one commits
    // nothing, so the surface still has to refresh the state it just changed.
    if (!flushLayout()) render();
  }

  function setSelection(next: SemanticSelection, keepDesiredX = false): void {
    selection = next;
    // Any plain selection cancels a rectangle. A caret placed by a click, a keystroke or an
    // edit is a text selection by definition, and leaving the rectangle behind would keep
    // painting cells that are no longer chosen.
    cellSelection = null;
    if (!keepDesiredX) desiredX = null;
    // SETTLED, not moved: this mirrors into the DOM on the next line, so the two agree before
    // any render can read them back — including a move raised earlier that no render has
    // carried out. `restoreSelection` raises the flag and only `flushLayout` takes it down, so
    // `undo` on an empty history left it up and disarmed the NEXT repaint, whenever it came.
    selectionSync.noteSelectionSettled();
    selectionSync.mirrorToDom();
    renderOverlay();
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
      selection = next;
      desiredX = null;
    },
    commit: (run) => commit(run),
    render: () => render(),
    flushLayout: () => flushLayout(),
    updateCaret: () => caret.update(),
    textOf: (paragraphId) => textOf(paragraphId),
    selectionMark: () => selectionMark(),
    now,
    recordSelectionMs: (ms) => {
      lastSelectionMs = ms;
    },
    isGesturing: () => pointer?.dragging() ?? false,
    domSelection: () => (cellSelection ? collapsedAt(cellSelection.text.anchor) : selection),
  });

  function setCellSelection(next: CellSelection | null): void {
    cellSelection = next;
    if (next) selection = next.text;
    desiredX = null;
    selectionSync.mirrorToDom();
    renderOverlay();
    options.onChange?.(currentState());
  }

  /** Draw the selected cells, or clear the layer when nothing is selected that way. */
  function renderOverlay(): void {
    paintSelectionOverlay(
      overlayLayer,
      currentLayout,
      cellSelection ? cellSelectionRects(currentLayout, cellSelection.cellIds) : [],
      // Pages of differing width are centred individually, so the overlay has to carry the
      // same per-page offset the painter applied or a highlight in a landscape section would
      // sit beside the cells it describes.
      { scale, pageOffsetX: materializedExtent?.pageOffsetX }
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
      commit(
        () =>
          session.applyTreeOps(
            [
              ...deleteSelectionOps(),
              { op: 'insertText', paragraphId: start.paragraphId, offset: start.offset, text },
            ],
            selectionMark(),
            // Where the caret ENDS, so redo puts it back there rather than leaving it
            // addressing the tree the undo discarded.
            {
              paragraphId: start.paragraphId,
              start: start.offset + text.length,
              end: start.offset + text.length,
            }
          ),
        () => collapsedAt({ paragraphId: start.paragraphId, offset: start.offset + text.length })
      );
    },

    deleteBackward() {
      const ops = deleteSelectionOps();
      if (ops.length > 0) {
        const start = orderedStart();
        commit(
          () => session.applyTreeOps(ops, selectionMark()),
          () => collapsedAt(start)
        );
        return;
      }
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
            session.applyTreeOps(
              [{ op: 'joinParagraphs', firstId: previous, secondId: position.paragraphId }],
              selectionMark()
            ),
          () => collapsedAt({ paragraphId: previous, offset: joinAt })
        );
        return;
      }
      commit(
        () =>
          session.applyTreeOps(
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
        () => collapsedAt({ ...position, offset: position.offset - 1 })
      );
    },

    splitParagraph() {
      // Enter REPLACES a selection, like every other insertion, and splits at its START —
      // splitting at the head left the selected text in place and cut the paragraph at
      // whichever end the user happened to drag to.
      const position = orderedStart();
      const before = new Set(session.paragraphIds());
      commit(
        () =>
          session.applyTreeOps(
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
        }
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
          session.applyTreeOps(
            [{ op: 'deleteText', paragraphId: head.paragraphId, start: target, end: head.offset }],
            selectionMark()
          ),
        () => collapsedAt({ ...head, offset: target })
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
      commit(() =>
        session.applyTreeOps(
          [{ op: 'deleteText', paragraphId: head.paragraphId, start: head.offset, end: target }],
          selectionMark()
        )
      );
    },

    deleteForward() {
      if (surface.deleteSelection()) return;
      const position = selection.head;
      const text = textOf(position.paragraphId);
      if (position.offset < text.length) {
        commit(() =>
          session.applyTreeOps(
            [
              {
                op: 'deleteText',
                paragraphId: position.paragraphId,
                start: position.offset,
                end: position.offset + 1,
              },
            ],
            selectionMark()
          )
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
          session.applyTreeOps(
            [{ op: 'joinParagraphs', firstId: position.paragraphId, secondId: next }],
            selectionMark()
          ),
        () => collapsedAt(position)
      );
    },

    ...structure,
    ...format,

    setSelection: (next) => setSelection(next),

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

    selectedText() {
      const { from, to } = orderedRange();
      return selectedTextIn(currentLayout, from, to);
    },

    deleteSelection() {
      const ops = deleteSelectionOps();
      if (ops.length === 0) return false;
      const start = orderedStart();
      commit(
        () => session.applyTreeOps(ops, selectionMark()),
        () => collapsedAt(start)
      );
      return true;
    },

    setCellSelection,
    layoutSession: () => layoutSession,

    undo: () => restoreSelection(session.undo()),
    redo: () => restoreSelection(session.redo()),
    focus: () => pagesLayer.focus(),
    destroy() {
      document.removeEventListener('selectionchange', onSelectionChange);
      pagesLayer.removeEventListener('keydown', onKeyDown);
      pagesLayer.removeEventListener('beforeinput', onBeforeInput as EventListener);
      pagesLayer.removeEventListener('copy', onCopy as EventListener);
      pagesLayer.removeEventListener('cut', onCut as EventListener);
      pagesLayer.removeEventListener('paste', onPaste as EventListener);
      pagesLayer.removeEventListener('compositionstart', onCompositionStart);
      pagesLayer.removeEventListener('compositionend', onCompositionEnd);
      scroller?.removeEventListener('scroll', onScroll);
      pointer?.destroy();
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
  const onKeyDown = createKeyDownHandler(surface);
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
    if (joined.length > 0) {
      ops.push({
        op: 'insertText',
        paragraphId: start.paragraphId,
        offset: start.offset,
        text: joined,
      });
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
    commit(
      () => session.applyTreeOps(ops, selectionMark()),
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
  const scroller = container.closest('.docx-editor__scroll-container');
  let scrollScheduled = false;
  const onScroll = (): void => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    const raf = container.ownerDocument.defaultView?.requestAnimationFrame;
    const run = (): void => {
      scrollScheduled = false;
      rematerialize();
    };
    if (raf) raf(run);
    else queueMicrotask(run);
  };
  scroller?.addEventListener('scroll', onScroll, { passive: true });

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
      focus: () => pagesLayer.focus(),
    },
    options.pointer ? { mode: options.pointer } : {}
  );

  render();
  return { ok: true, surface };
}
