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

import { openTreeSession, type TreeDocxSession } from '@docx-editor.dev/engine-binding';
import {
  caretAt,
  createFixedMeasurer,
  createLayoutScheduler,
  hitTestSemantic,
  layoutSemanticDocument,
  moveCaret,
  selectionRects,
  type LayoutScope,
  type NavigationCommand,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
  type TextMeasurer,
} from '@docx-editor.dev/engine-layout';
import { paintSemanticLayout } from '@docx-editor.dev/engine-output';

export interface PaginatedSurfaceOptions {
  readonly measurer?: TextMeasurer;
  /** Points to CSS pixels. */
  readonly scale?: number;
  readonly onChange?: (state: PaginatedSurfaceState) => void;
}

export interface PaginatedSurfaceState {
  readonly revision: number;
  readonly pageCount: number;
  readonly selection: SemanticSelection;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastRejection: string | null;
}

export interface PaginatedSurface {
  readonly session: TreeDocxSession;
  layout(): SemanticLayout;
  state(): PaginatedSurfaceState;
  /** Move the caret to a point in surface coordinates. */
  clickAt(point: { x: number; y: number }, extend?: boolean): void;
  type(text: string): void;
  deleteBackward(): void;
  splitParagraph(): void;
  navigate(command: NavigationCommand, extend?: boolean): void;
  /** Reverse the last history entry and put the caret back where it was made. */
  undo(): void;
  redo(): void;
  focus(): void;
  destroy(): void;
}

export type OpenPaginatedResult =
  | { readonly ok: true; readonly surface: PaginatedSurface }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };

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
  const document = container.ownerDocument;

  const pagesLayer = document.createElement('div');
  pagesLayer.className = 'docx-pages';
  pagesLayer.style.position = 'relative';

  const overlay = document.createElement('div');
  overlay.className = 'docx-overlay';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.pointerEvents = 'none';

  // Focus lives on a real focusable element so the browser has somewhere to put the caret,
  // the IME candidate window and autofill — without any of them owning the document.
  const inputHost = document.createElement('div');
  inputHost.className = 'docx-input-host';
  inputHost.contentEditable = 'true';
  inputHost.setAttribute('role', 'textbox');
  inputHost.setAttribute('aria-multiline', 'true');
  inputHost.style.position = 'absolute';
  inputHost.style.width = '1px';
  inputHost.style.height = '1px';
  inputHost.style.opacity = '0';
  inputHost.style.outline = 'none';
  inputHost.style.left = '0px';
  inputHost.style.top = '0px';

  container.style.position = 'relative';
  container.replaceChildren(pagesLayer, overlay, inputHost);

  const firstParagraph = session.paragraphIds()[0] ?? '';
  let selection: SemanticSelection = {
    anchor: { paragraphId: firstParagraph, offset: 0 },
    head: { paragraphId: firstParagraph, offset: 0 },
  };
  let lastRejection: string | null = null;
  let currentLayout = layoutOnce();
  let desiredX: number | null = null;

  function layoutOnce(): SemanticLayout {
    return layoutSemanticDocument(session.part(), session.revision(), { measurer });
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
    run: (scope: LayoutScope) =>
      layoutSemanticDocument(session.part(), scope.revision, { measurer }),
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
    };
  }

  function render(): void {
    paintSemanticLayout(pagesLayer, currentLayout, { scale });
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
    renderOverlay();
    options.onChange?.(currentState());
  }

  function renderOverlay(): void {
    const children: HTMLElement[] = [];
    for (const rect of selectionRects(currentLayout, selection)) {
      const element = document.createElement('div');
      element.className = 'docx-selection-rect';
      element.style.position = 'absolute';
      const origin = pageOrigin(rect.pageIndex);
      element.style.left = `${(rect.x + origin.x) * scale}px`;
      element.style.top = `${(rect.y + origin.y) * scale}px`;
      element.style.width = `${rect.width * scale}px`;
      element.style.height = `${rect.height * scale}px`;
      children.push(element);
    }
    const caret = caretAt(currentLayout, selection.head);
    if (caret) {
      // Keep the offscreen input host ON the caret. It is where focus lives, so if it sat
      // at the end of the container instead, focusing would scroll the document to the
      // bottom — and the browser would put the IME candidate window there too.
      const origin = pageOrigin(caret.pageIndex);
      inputHost.style.left = `${(caret.x + origin.x) * scale}px`;
      inputHost.style.top = `${(caret.y + origin.y) * scale}px`;
      const element = document.createElement('div');
      element.className = 'docx-caret';
      element.style.position = 'absolute';
      element.style.left = `${(caret.x + origin.x) * scale}px`;
      element.style.top = `${(caret.y + origin.y) * scale}px`;
      element.style.height = `${caret.height * scale}px`;
      element.style.width = '2px';
      children.push(element);
    }
    overlay.replaceChildren(...children);
  }

  /**
   * Where a page's CONTENT origin sits in surface coordinates.
   *
   * Line and span boxes are content-relative, and the painter nests them inside a content
   * div offset by the margins — so the overlay has to apply the same offset on BOTH axes or
   * the caret drifts off the page. It was drawn outside the sheet entirely when only the
   * vertical offset was applied.
   */
  /**
   * The page a surface-space y lands on.
   *
   * Clamped rather than nullable: a click in the gap between two sheets, or past the last
   * one, still has to put the caret somewhere, and the nearest page is the answer the user
   * means.
   */
  function pageAt(y: number): number {
    const pages = currentLayout.pages;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]!;
      if (y < page.box.y + page.box.height) return index;
    }
    return Math.max(0, pages.length - 1);
  }

  function pageOrigin(pageIndex: number): { x: number; y: number } {
    const page = currentLayout.pages[pageIndex];
    if (!page) return { x: 0, y: 0 };
    return { x: page.contentBox.x, y: page.contentBox.y };
  }

  function commit(run: () => ReturnType<TreeDocxSession['applyPmDoc']> | boolean): void {
    // Ops go through the session, so the tree stays the only state. A refusal is surfaced
    // rather than silently dropped: the view is repainted from what the model actually
    // holds, so the user never keeps looking at an edit that will not be saved.
    const result = run();
    if (typeof result !== 'boolean' && result.rejected) {
      lastRejection = String(result.reason ?? 'rejected');
    } else {
      lastRejection = null;
    }
    // A committed edit repaints through the scheduler's publish; a REFUSED one commits
    // nothing, so the surface still has to refresh the state it just changed.
    if (!flushLayout()) render();
  }

  function setSelection(next: SemanticSelection, keepDesiredX = false): void {
    selection = next;
    if (!keepDesiredX) desiredX = null;
    renderOverlay();
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

    clickAt(point, extend = false) {
      // Which PAGE was clicked has to be resolved first and passed on. Caret stops are
      // page-relative, so page 1 line 3 and page 4 line 3 sit at the same y — hit testing
      // without the page index matched whichever the tie-break happened to reach, and a
      // click near the top of the first page could put the caret in the last paragraph of
      // the document.
      const pageIndex = pageAt(point.y / scale);
      const origin = pageOrigin(pageIndex);
      const hit = hitTestSemantic(currentLayout, {
        x: point.x / scale - origin.x,
        y: point.y / scale - origin.y,
        pageIndex,
      });
      if (!hit) return;
      setSelection({ anchor: extend ? selection.anchor : hit.position, head: hit.position });
      inputHost.focus();
    },

    type(text) {
      // Insert at the selection's START, not at its head. Deleting a selection removes the
      // range beginning at the start, so inserting at the head — which may be the far end —
      // puts the text where the removed characters used to be rather than where the user
      // was typing.
      const start = orderedStart();
      commit(() =>
        session.applyTreeOps(
          [
            ...deleteSelectionOps(),
            { op: 'insertText', paragraphId: start.paragraphId, offset: start.offset, text },
          ],
          selectionMark()
        )
      );
      setSelection(
        collapsedAt({ paragraphId: start.paragraphId, offset: start.offset + text.length })
      );
    },

    deleteBackward() {
      const ops = deleteSelectionOps();
      if (ops.length > 0) {
        const start = orderedStart();
        commit(() => session.applyTreeOps(ops, selectionMark()));
        setSelection(collapsedAt(start));
        return;
      }
      const position = selection.head;
      if (position.offset === 0) return; // joining paragraphs is the split/join lane
      commit(() =>
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
        )
      );
      setSelection(collapsedAt({ ...position, offset: position.offset - 1 }));
    },

    splitParagraph() {
      const position = selection.head;
      const before = session.paragraphIds();
      commit(() =>
        session.applyTreeOps(
          [
            {
              op: 'splitParagraph',
              paragraphId: position.paragraphId,
              offset: position.offset,
            },
          ],
          selectionMark()
        )
      );
      // The tail is the id the store minted that was not there before.
      const after = session.paragraphIds();
      const tail = after.find((id) => !before.includes(id));
      if (tail) setSelection(collapsedAt({ paragraphId: tail, offset: 0 }));
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

    undo: () => restoreSelection(session.undo()),
    redo: () => restoreSelection(session.redo()),
    focus: () => inputHost.focus(),
    destroy() {
      container.removeEventListener('pointerdown', onPointerDown);
      inputHost.removeEventListener('keydown', onKeyDown);
      inputHost.removeEventListener('beforeinput', onBeforeInput as EventListener);
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
      render();
      return;
    }
    setSelection({
      anchor: { paragraphId: mark.paragraphId, offset: mark.start },
      head: { paragraphId: mark.paragraphId, offset: mark.end },
    });
  }

  /**
   * The current selection as a history mark, or null when it spans paragraphs.
   *
   * A mark addresses ONE paragraph, and a cross-paragraph selection has no honest single-id
   * form; recording the head's paragraph would put the caret somewhere the user never had it.
   */
  function selectionMark(): { paragraphId: string; start: number; end: number } | null {
    if (selection.anchor.paragraphId !== selection.head.paragraphId) return null;
    const start = Math.min(selection.anchor.offset, selection.head.offset);
    const end = Math.max(selection.anchor.offset, selection.head.offset);
    return { paragraphId: selection.head.paragraphId, start, end };
  }

  function collapsedAt(position: SemanticPosition): SemanticSelection {
    return { anchor: position, head: position };
  }

  function orderedStart(): SemanticPosition {
    const { anchor, head } = selection;
    if (anchor.paragraphId !== head.paragraphId) return anchor;
    return anchor.offset <= head.offset ? anchor : head;
  }

  /** Ops that remove the current selection, or none when it is collapsed. */
  function deleteSelectionOps(): Parameters<TreeDocxSession['applyTreeOps']>[0] {
    const { anchor, head } = selection;
    if (anchor.paragraphId !== head.paragraphId) return []; // multi-paragraph is the next lane
    const start = Math.min(anchor.offset, head.offset);
    const end = Math.max(anchor.offset, head.offset);
    if (start === end) return [];
    return [{ op: 'deleteText', paragraphId: anchor.paragraphId, start, end }];
  }

  // Event wiring lives HERE rather than in each host, so React, Vue and a plain page get
  // identical behaviour instead of three hand-written keymaps that drift.
  const onPointerDown = (event: PointerEvent): void => {
    const rect = container.getBoundingClientRect();
    surface.clickAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, event.shiftKey);
    event.preventDefault();
  };

  const NAVIGATION: Record<string, NavigationCommand> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Home: 'lineStart',
    End: 'lineEnd',
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const command = NAVIGATION[event.key];
    if (command) {
      // Ctrl/Cmd+Home and End address the document rather than the line.
      const scoped =
        (event.metaKey || event.ctrlKey) && (event.key === 'Home' || event.key === 'End')
          ? event.key === 'Home'
            ? 'documentStart'
            : 'documentEnd'
          : command;
      surface.navigate(scoped, event.shiftKey);
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace') {
      surface.deleteBackward();
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      surface.splitParagraph();
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      // Undo and redo publish a model change like any other commit, so the scheduler
      // repaints. What the scheduler cannot supply is WHERE the caret belongs: offsets in
      // the reverted tree do not correspond to offsets in the one that replaced it, so the
      // entry's own selection is restored.
      if (event.shiftKey) surface.redo();
      else surface.undo();
      event.preventDefault();
    }
  };

  const onBeforeInput = (event: InputEvent): void => {
    if (event.inputType === 'insertText' && event.data != null) {
      surface.type(event.data);
      event.preventDefault();
      return;
    }
    if (event.inputType === 'deleteContentBackward') {
      surface.deleteBackward();
      event.preventDefault();
      return;
    }
    if (event.inputType === 'insertParagraph') {
      surface.splitParagraph();
      event.preventDefault();
    }
  };

  container.addEventListener('pointerdown', onPointerDown);
  inputHost.addEventListener('keydown', onKeyDown);
  inputHost.addEventListener('beforeinput', onBeforeInput as EventListener);

  render();
  return { ok: true, surface };
}
