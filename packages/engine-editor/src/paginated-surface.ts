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
  hitTestSemantic,
  layoutSemanticDocument,
  moveCaret,
  selectionRects,
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

  container.style.position = 'relative';
  container.replaceChildren(pagesLayer, overlay, inputHost);

  const firstParagraph = session.paragraphIds()[0] ?? '';
  let selection: SemanticSelection = {
    anchor: { paragraphId: firstParagraph, offset: 0 },
    head: { paragraphId: firstParagraph, offset: 0 },
  };
  let lastRejection: string | null = null;
  let currentLayout = relayout();
  let desiredX: number | null = null;

  function relayout(): SemanticLayout {
    return layoutSemanticDocument(session.part(), session.revision(), { measurer });
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
    renderOverlay();
    options.onChange?.(currentState());
  }

  function renderOverlay(): void {
    const children: HTMLElement[] = [];
    for (const rect of selectionRects(currentLayout, selection)) {
      const element = document.createElement('div');
      element.className = 'docx-selection-rect';
      element.style.position = 'absolute';
      element.style.left = `${rect.x * scale}px`;
      element.style.top = `${(rect.y + pageOffset(rect.pageIndex)) * scale}px`;
      element.style.width = `${rect.width * scale}px`;
      element.style.height = `${rect.height * scale}px`;
      children.push(element);
    }
    const caret = caretAt(currentLayout, selection.head);
    if (caret) {
      const element = document.createElement('div');
      element.className = 'docx-caret';
      element.style.position = 'absolute';
      element.style.left = `${caret.x * scale}px`;
      element.style.top = `${(caret.y + pageOffset(caret.pageIndex)) * scale}px`;
      element.style.height = `${caret.height * scale}px`;
      element.style.width = '2px';
      children.push(element);
    }
    overlay.replaceChildren(...children);
  }

  /** Page-relative geometry to surface coordinates. */
  function pageOffset(pageIndex: number): number {
    const page = currentLayout.pages[pageIndex];
    if (!page) return 0;
    return page.box.y + (page.contentBox.y - page.box.y);
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
    currentLayout = relayout();
    render();
  }

  function setSelection(next: SemanticSelection, keepDesiredX = false): void {
    selection = next;
    if (!keepDesiredX) desiredX = null;
    renderOverlay();
    options.onChange?.(currentState());
  }

  const surface: PaginatedSurface = {
    session,
    layout: () => currentLayout,
    state: currentState,

    clickAt(point, extend = false) {
      const hit = hitTestSemantic(currentLayout, {
        x: point.x / scale,
        y: point.y / scale - pageOffset(0),
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
        session.applyTreeOps([
          ...deleteSelectionOps(),
          { op: 'insertText', paragraphId: start.paragraphId, offset: start.offset, text },
        ])
      );
      setSelection(
        collapsedAt({ paragraphId: start.paragraphId, offset: start.offset + text.length })
      );
    },

    deleteBackward() {
      const ops = deleteSelectionOps();
      if (ops.length > 0) {
        const start = orderedStart();
        commit(() => session.applyTreeOps(ops));
        setSelection(collapsedAt(start));
        return;
      }
      const position = selection.head;
      if (position.offset === 0) return; // joining paragraphs is the split/join lane
      commit(() =>
        session.applyTreeOps([
          {
            op: 'deleteText',
            paragraphId: position.paragraphId,
            start: position.offset - 1,
            end: position.offset,
          },
        ])
      );
      setSelection(collapsedAt({ ...position, offset: position.offset - 1 }));
    },

    splitParagraph() {
      const position = selection.head;
      const before = session.paragraphIds();
      commit(() =>
        session.applyTreeOps([
          {
            op: 'splitParagraph',
            paragraphId: position.paragraphId,
            offset: position.offset,
          },
        ])
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

    focus: () => inputHost.focus(),
    destroy: () => container.replaceChildren(),
  };

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

  render();
  return { ok: true, surface };
}
