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
// paginated-surface-contract.ts, input wiring in surface-input.ts, selection/op planning in
// surface-selection-ops.ts, formatting queries in surface-formatting.ts, and the page
// environment in surface-pages.ts — all re-exported or consumed from this module.

import { openTreeSession, type TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { TreeDocOp } from '@docx-editor.dev/core-contract/store';
import {
  createFixedMeasurer,
  createLayoutScheduler,
  createLayoutSession,
  createParagraphLayoutCache,
  readDocumentSections,
  readSectionProperties,
  storyBlocks,
  documentOrder,
  layoutSemanticDocument,
  moveCaret,
  paragraphTextFromLayout,
  wordBoundary,
  type LayoutScope,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import { paintSemanticLayout } from '@docx-editor.dev/core-contract/output';
import { applySelectionToDom, selectionsEqual, semanticSelectionFromDom } from './dom-selection.ts';
import type {
  OpenPaginatedResult,
  PaginatedSurface,
  PaginatedSurfaceOptions,
  PaginatedSurfaceState,
} from './paginated-surface-contract.ts';
import {
  formattingAt,
  isRunPropertyActive,
  mergedProperties,
  paragraphPropertiesOf,
  selectionRunProperties,
} from './surface-formatting.ts';
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
  paintedTextOf,
  paragraphReplacePlan,
} from './surface-input.ts';
import { createFurnitureSource, equalPageSets, visiblePageSet } from './surface-pages.ts';

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
  const measurer = options.measurer ?? createFixedMeasurer();
  const scale = options.scale ?? 96 / 72;
  // The incremental machinery, actually wired. Without these the surface re-measured and
  // re-placed the entire document on every keystroke, which the caches and the session were
  // built to avoid.
  const layoutCache = createParagraphLayoutCache<never>();
  const layoutSession = createLayoutSession();
  // Identifies WHO measured. A cache keyed on content alone would serve the pre-font layout
  // for the rest of the session once fonts resolve, so the measurer's identity is folded in.
  const producer = options.producer ?? (options.measurer ? 'host-measurer' : 'fixed-measurer');
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

  container.style.position = 'relative';
  container.replaceChildren(pagesLayer);

  const firstParagraph = session.paragraphIds()[0] ?? '';
  let selection: SemanticSelection = {
    anchor: { paragraphId: firstParagraph, offset: 0 },
    head: { paragraphId: firstParagraph, offset: 0 },
  };
  let lastRejection: string | null = null;

  // Phase timers, one slot per phase rather than a log: the state reports the LAST pass,
  // and a host that wants history samples `onChange`. `performance.now()` where the host
  // has one — monotonic, sub-millisecond — and wall clock where it does not (a bare test
  // runtime), which is fine for numbers only ever read by a human.
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  let lastLayoutMs = 0;
  let lastPaintMs = 0;
  let lastSelectionMs = 0;

  // The document's declared geometry plus header/footer stories, laid out per part and
  // memoized in the source itself.
  const furnitureSource = createFurnitureSource({
    session,
    measurer,
    producer,
    cache: layoutCache,
  });

  let currentLayout = layoutOnce();
  let desiredX: number | null = null;

  // The per-section lane: every section paginates against its own geometry, so a
  // landscape section among portrait ones lays out as Word shows it. Re-read per pass
  // for the same reason the geometry is; the sectPr node id is the section's stable
  // identity in the layout context.
  function layoutSections() {
    return readDocumentSections(session.part()).map((section) => ({
      geometry: section.geometry,
      firstBlock: section.firstBlock,
      breakType: section.breakType,
      ...(section.sectPrId !== null ? { id: section.sectPrId } : {}),
    }));
  }

  function layoutOnce(): SemanticLayout {
    const began = now();
    const layout = layoutSemanticDocument(session.part(), session.revision(), {
      measurer,
      geometry: furnitureSource.geometry(),
      sections: layoutSections(),
      cache: layoutCache,
      session: layoutSession,
      producer,
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
        geometry: furnitureSource.geometry(),
        sections: layoutSections(),
        cache: layoutCache,
        session: layoutSession,
        producer,
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

  function render(notifyChange = true): void {
    const paintBegan = now();
    materializedSet = visiblePages();
    paintSemanticLayout(pagesLayer, currentLayout, {
      scale,
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
    const last = currentLayout.pages[currentLayout.pages.length - 1];
    const width = Math.max(0, ...currentLayout.pages.map((page) => page.box.x + page.box.width));
    const height = last ? last.box.y + last.box.height : 0;
    pagesLayer.style.width = `${width * scale}px`;
    pagesLayer.style.height = `${height * scale}px`;
    container.style.width = `${width * scale}px`;
    container.style.height = `${height * scale}px`;
    // Sizing included: the style writes above invalidate layout, and the selection sync
    // right after is what forces the browser to resolve it. Splitting the timer here would
    // book the paint's own cost to the selection phase.
    lastPaintMs = now() - paintBegan;
    syncDomSelection();
    if (notifyChange) options.onChange?.(currentState());
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
    if (equalPageSets(visiblePages(), materializedSet)) return;
    render(false);
  }

  /**
   * Push the model selection into the browser's own selection.
   *
   * The caret and the highlight are the BROWSER's, drawn over the text layout painted — so
   * they follow real glyph shapes instead of the uniform band a hand-drawn rectangle gives,
   * and a caret between two lines of different size looks right without special-casing.
   * Layout still decides where the text is; this only says which characters are selected.
   */
  function syncDomSelection(): void {
    // Only when this surface owns the selection. `render` runs on mount and on every commit
    // — including one from another editor sharing the store — and writing unconditionally
    // yanked the caret out of whatever the user was actually typing in.
    if (!ownsSelection()) return;
    applyingSelection = true;
    const began = now();
    applySelectionToDom(pagesLayer, selection, document.getSelection());
    lastSelectionMs = now() - began;
    // Cleared on a LATER task, because `selectionchange` is queued rather than dispatched
    // synchronously. Clearing it here would defeat the guard in every real browser while
    // still appearing to work under a synchronous test DOM.
    queueMicrotask(() => {
      applyingSelection = false;
    });
  }

  /**
   * Whether writing the selection would take it from someone else.
   *
   * True when focus or the selection is already inside these pages, and also when NOTHING
   * holds a selection — writing one then takes it from nobody. What this refuses is the case
   * that matters: a caret living in another element, which a repaint here would otherwise
   * yank away with no focus change and no interaction.
   */
  function ownsSelection(): boolean {
    const active = document.activeElement;
    if (active && pagesLayer.contains(active)) return true;
    const domSelection = document.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return true;
    const anchor = domSelection.anchorNode;
    if (!anchor) return true;
    // A selection anchored in a subtree that has been removed from the document belongs to
    // nobody — a surface that was torn down, or a re-rendered host. Refusing to write over
    // it would leave this surface unable to show its own caret.
    if (!anchor.isConnected) return true;
    return pagesLayer.contains(anchor);
  }

  function commit(
    run: () => ReturnType<TreeDocxSession['applyPmDoc']> | boolean,
    selectionAfter?: () => SemanticSelection | null
  ): void {
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
    if (!keepDesiredX) desiredX = null;
    syncDomSelection();
    options.onChange?.(currentState());
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

    insertTab() {
      const start = orderedStart();
      commit(
        () =>
          session.applyTreeOps(
            [
              ...deleteSelectionOps(),
              { op: 'insertTab', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

    insertLineBreak() {
      const start = orderedStart();
      commit(
        () =>
          session.applyTreeOps(
            [
              ...deleteSelectionOps(),
              { op: 'insertHardBreak', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

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

    setRunProperty(localName, attributes) {
      const { from, to } = orderedRange();
      if (from.paragraphId !== to.paragraphId || from.offset === to.offset) return;
      commit(() =>
        session.applyTreeOps(
          [
            {
              op: 'setRunProperties',
              paragraphId: from.paragraphId,
              start: from.offset,
              end: to.offset,
              properties: mergedProperties(selectionRunProperties(currentLayout, selection), {
                localName,
                ...(attributes ? { attributes } : {}),
              }),
            },
          ],
          selectionMark()
        )
      );
    },

    setParagraphProperty(localName, attributes) {
      const { from, to } = orderedRange();
      const order = documentOrder(currentLayout);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return;
      // EVERY paragraph the selection touches, not just the one the caret is in: selecting
      // three paragraphs and pressing centre must centre three paragraphs.
      const ops = order.slice(firstIndex, lastIndex + 1).map((paragraphId) => ({
        op: 'setParagraphProperties' as const,
        paragraphId,
        properties: mergedProperties(paragraphPropertiesOf(currentLayout, paragraphId), {
          localName,
          ...(attributes ? { attributes } : {}),
        }),
      }));
      if (ops.length === 0) return;
      commit(() => session.applyTreeOps(ops, selectionMark()));
    },

    sectionProperties: () => readSectionProperties(session.part()),

    sectionPropertiesAt(paragraphId) {
      const sections = readDocumentSections(session.part());
      if (sections.length === 1) return sections[0]!.properties;
      const blocks = storyBlocks(session.part());
      const contains = (node: (typeof blocks)[number], id: string): boolean => {
        if (node.id === id) return true;
        for (const child of node.children) {
          if (child.kind !== 'textValue' && contains(child as (typeof blocks)[number], id)) {
            return true;
          }
        }
        return false;
      };
      const blockIndex = blocks.findIndex(
        (block) => block.id === paragraphId || contains(block, paragraphId)
      );
      // An unknown id falls back to the tail section — the document-wide answer.
      let owner = sections[sections.length - 1]!;
      if (blockIndex !== -1) {
        for (const section of sections) {
          if (section.firstBlock <= blockIndex) owner = section;
          else break;
        }
      }
      return owner.properties;
    },

    setSectionProperties(update) {
      let committed = false;
      commit(() => {
        const result = session.applyTreeOps(
          [{ op: 'setSectionProperties', ...update }],
          selectionMark()
        );
        committed = result.committed;
        return result;
      });
      return committed;
    },

    insertSectionBreak() {
      const start = orderedStart();
      const before = new Set(session.paragraphIds());
      let committed = false;
      commit(
        () => {
          const result = session.applyTreeOps(
            [
              // A break REPLACES a selection, like every other insertion.
              ...deleteSelectionOps(),
              { op: 'splitParagraph', paragraphId: start.paragraphId, offset: start.offset },
              // The HEAD keeps the original id; it ends the new section, cloning the
              // governing setup so the break changes where pages break, not how they look.
              { op: 'setSectionMark', paragraphId: start.paragraphId },
            ],
            selectionMark()
          );
          committed = result.committed;
          return result;
        },
        () => {
          // The caret lands at the start of the tail — the first paragraph of the
          // section the user keeps typing in, exactly where Word puts it.
          const tail = session.paragraphIds().find((id) => !before.has(id));
          return tail ? collapsedAt({ paragraphId: tail, offset: 0 }) : null;
        }
      );
      return committed;
    },

    formatting: () =>
      formattingAt(currentLayout, selection, (paragraphId, runProperties) =>
        session.effectiveRunDefaults(paragraphId, runProperties)
      ),

    toggleRunProperty(localName, attributes) {
      const { from, to } = orderedRange();
      // A collapsed caret has no range to format. Stored marks — formatting that applies to
      // the NEXT character typed — are a separate lane; refusing is honest rather than
      // formatting a character the user did not select.
      if (from.paragraphId !== to.paragraphId || from.offset === to.offset) return;
      const active = isRunPropertyActive(currentLayout, selection, localName);
      commit(() =>
        session.applyTreeOps(
          [
            {
              op: 'setRunProperties',
              paragraphId: from.paragraphId,
              start: from.offset,
              end: to.offset,
              // Toggling OFF sends an explicit `val="0"` rather than dropping the element:
              // the property may be inherited from a style, and removing the local override
              // would let the inherited value come back.
              properties: mergedProperties(
                selectionRunProperties(currentLayout, selection),
                active
                  ? // `w:u` is a closed enumeration, not a boolean: its off value is `none`,
                    // and `val="0"` is an attribute value Word rejects outright.
                    { localName, attributes: { val: localName === 'u' ? 'none' : '0' } }
                  : { localName, ...(attributes ? { attributes } : {}) }
              ),
            },
          ],
          selectionMark()
        )
      );
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
      // Drop pending layout work and stop listening BEFORE the DOM goes, or a commit from
      // another editor sharing this store would paint into a detached container.
      scheduler.cancel();
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
  // themselves are factories in surface-input.ts over the surface interface; this closure
  // only owns the state they cannot — composition flags and the selection mirror.
  //
  // SELECTION GESTURES ARE THE BROWSER'S. Drag, double-click for a word, triple-click for a
  // paragraph, shift-click to extend, and selecting across a page boundary all come free
  // because the painted spans are real text. Re-implementing them from records is how a
  // surface ends up feeling worse than a textarea. Layout still owns geometry: what comes
  // back from the DOM is which CHARACTERS were gestured over, never where they are.
  let applyingSelection = false;
  /**
   * Whether an IME is composing.
   *
   * `beforeinput` for `insertCompositionText` is NOT cancelable — `preventDefault` is a
   * no-op — so composed text unavoidably lands in the painted DOM. The surface therefore
   * stops repainting for the duration (a repaint mid-composition destroys the IME's own
   * anchor and aborts or duplicates the session) and reconciles once when it ends.
   */
  let composing = false;
  /** The paragraph the composition started in, so the right one is reconciled. */
  let composingParagraph: string | null = null;

  /** Mirror the native selection into the model. Ignores selections outside painted text. */
  const adoptDomSelection = (): void => {
    const next = semanticSelectionFromDom(pagesLayer, document.getSelection());
    if (!next || selectionsEqual(next, selection)) return;
    setSelection(next);
  };

  const onSelectionChange = (): void => {
    // Ignore the echo of our own write, and anything happening outside the pages. The flag
    // is cleared on a later task rather than synchronously: browsers QUEUE `selectionchange`
    // rather than firing it from `setBaseAndExtent`, so clearing it in a `finally` would
    // leave it false by the time the echo arrives — and every programmatic selection would
    // be read straight back, fighting the user mid-drag.
    if (applyingSelection) return;
    if (composing) return;
    adoptDomSelection();
  };

  const onCompositionStart = (): void => {
    composing = true;
    composingParagraph = selection.head.paragraphId;
    session.beginComposition();
  };

  const onCompositionEnd = (): void => {
    composing = false;
    const paragraphId = composingParagraph ?? selection.head.paragraphId;
    composingParagraph = null;
    // The composed text is in the DOM and nowhere else. Read it back, diff it against what
    // the model holds for that paragraph, and commit the difference — the only route by
    // which an IME edit can reach the tree, since it could not be intercepted.
    reconcileParagraphFromDom(paragraphId);
    session.endComposition();
    flushLayout();
    render();
  };

  /**
   * Commit whatever the browser wrote into a paragraph that the surface could not intercept.
   *
   * The diff itself lives in surface-input.ts; this applies it and lands the caret.
   */
  function reconcileParagraphFromDom(paragraphId: string): void {
    const painted = paintedTextOf(pagesLayer, paragraphId);
    if (painted === null) return;
    const plan = paragraphReplacePlan(paragraphId, textOf(paragraphId), painted);
    if (!plan) return;
    commit(() => session.applyTreeOps(plan.ops, selectionMark()));
    setSelection(collapsedAt({ paragraphId, offset: plan.caret }));
  }

  const onKeyDown = createKeyDownHandler(surface);
  const { onCopy, onCut, onPaste } = createClipboardHandlers(surface, insertPlainText);
  const onBeforeInput = createBeforeInputHandler(surface, {
    isComposing: () => composing,
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

  render();
  return { ok: true, surface };
}
