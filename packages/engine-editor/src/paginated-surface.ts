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
  createFixedMeasurer,
  createLayoutScheduler,
  geometryOfSection,
  readSectionProperties,
  documentOrder,
  layoutSemanticDocument,
  moveCaret,
  paragraphTextFromLayout,
  spansInSelection,
  wordBoundary,
  type LayoutScope,
  type SectionProperties,
  type NavigationCommand,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
  type TextMeasurer,
} from '@docx-editor.dev/engine-layout';
import { paintSemanticLayout } from '@docx-editor.dev/engine-output';
import { applySelectionToDom, selectionsEqual, semanticSelectionFromDom } from './dom-selection.ts';

export interface PaginatedSurfaceOptions {
  readonly measurer?: TextMeasurer;
  /** Points to CSS pixels. */
  readonly scale?: number;
  readonly onChange?: (state: PaginatedSurfaceState) => void;
}

/**
 * What the selection is currently formatted as.
 *
 * A value is present only when EVERY span in the selection agrees on it: a selection running
 * from 11pt into 14pt has no font size, and a toolbar should show a blank rather than pick
 * one of the two and imply the whole selection is that.
 */
export interface SurfaceFormatting {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
  readonly superscript: boolean;
  readonly subscript: boolean;
  readonly fontFamily: string | null;
  /** Half-points, the unit OOXML stores and the picker expects. */
  readonly fontSizeHalfPoints: number | null;
  readonly color: string | null;
  readonly highlight: string | null;
  readonly alignment: 'left' | 'center' | 'right' | 'both' | null;
  readonly styleId: string | null;
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
  type(text: string): void;
  deleteBackward(): void;
  /** Delete forward — the Delete key, and `deleteContentForward` from an IME. */
  deleteForward(): void;
  /** Delete to the previous word boundary — Alt/Ctrl+Backspace. */
  deleteWordBackward(): void;
  /** Delete to the next word boundary — Alt/Ctrl+Delete. */
  deleteWordForward(): void;
  splitParagraph(): void;
  /** A tab character as a `w:tab` element, not a literal tab in the run text. */
  insertTab(): void;
  /** A `w:br` — Shift+Enter, a line break inside the same paragraph. */
  insertLineBreak(): void;
  /** Select the whole document. */
  selectAll(): void;
  /** Set the selection directly, for a host driving the surface programmatically. */
  setSelection(next: SemanticSelection): void;
  /** Toggle a run property over the selection, e.g. `b`, `i`, `u`. */
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  /**
   * SET a run property over the selection, rather than toggling it.
   *
   * Font family, size and colour are values, not switches: picking Arial twice must leave
   * the text in Arial, which a toggle would not.
   */
  setRunProperty(localName: string, attributes?: Record<string, string>): void;
  /** Set a property on every paragraph the selection touches — alignment, style, spacing. */
  setParagraphProperty(localName: string, attributes?: Record<string, string>): void;
  /** Formatting as it stands at the selection, for a toolbar to reflect. */
  formatting(): SurfaceFormatting;
  /**
   * The section the document declares: page size, margins, columns, orientation.
   *
   * What a ruler is made of, and what pagination is measured against.
   */
  sectionProperties(): SectionProperties;
  /** The selected text, for copy and cut. */
  selectedText(): string;
  /** Remove the selection, if any. Returns whether anything was deleted. */
  deleteSelection(): boolean;
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
  let currentLayout = layoutOnce();
  let desiredX: number | null = null;

  /**
   * The page the DOCUMENT asks for, not a constant.
   *
   * Read once per pass rather than cached: a section property is part of the tree, so an
   * edit can change it, and paginating an A4 document onto Letter puts every page break in
   * the wrong place before anything is painted.
   */
  function geometry(): ReturnType<typeof geometryOfSection> {
    return geometryOfSection(readSectionProperties(session.part()));
  }

  function layoutOnce(): SemanticLayout {
    return layoutSemanticDocument(session.part(), session.revision(), {
      measurer,
      geometry: geometry(),
    });
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
    run: (scope: LayoutScope) =>
      layoutSemanticDocument(session.part(), scope.revision, {
        measurer,
        geometry: geometry(),
      }),
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
    paintSemanticLayout(pagesLayer, currentLayout, {
      scale,
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
    syncDomSelection();
    options.onChange?.(currentState());
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
    applySelectionToDom(pagesLayer, selection, document.getSelection());
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
      if (position.offset === 0) {
        // Backspace at the start of a paragraph pulls it into the previous one. Refusing
        // here made the key look broken: a caret at the paragraph start is where a user
        // presses Backspace precisely because they want the paragraphs merged.
        const order = documentOrder(currentLayout);
        const index = order.indexOf(position.paragraphId);
        const previous = order[index - 1];
        if (!previous) return;
        const joinAt = textOf(previous).length;
        commit(() =>
          session.applyTreeOps(
            [{ op: 'joinParagraphs', firstId: previous, secondId: position.paragraphId }],
            selectionMark()
          )
        );
        setSelection(collapsedAt({ paragraphId: previous, offset: joinAt }));
        return;
      }
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
      // Enter REPLACES a selection, like every other insertion, and splits at its START —
      // splitting at the head left the selected text in place and cut the paragraph at
      // whichever end the user happened to drag to.
      const position = orderedStart();
      const before = session.paragraphIds();
      commit(() =>
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

    deleteWordBackward() {
      if (surface.deleteSelection()) return;
      const head = selection.head;
      const target = wordBoundary(textOf(head.paragraphId), head.offset, -1);
      if (target === head.offset) {
        surface.deleteBackward();
        return;
      }
      commit(() =>
        session.applyTreeOps(
          [{ op: 'deleteText', paragraphId: head.paragraphId, start: target, end: head.offset }],
          selectionMark()
        )
      );
      setSelection(collapsedAt({ ...head, offset: target }));
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
      commit(() =>
        session.applyTreeOps(
          [{ op: 'joinParagraphs', firstId: position.paragraphId, secondId: next }],
          selectionMark()
        )
      );
      setSelection(collapsedAt(position));
    },

    insertTab() {
      const start = orderedStart();
      commit(() =>
        session.applyTreeOps(
          [
            ...deleteSelectionOps(),
            { op: 'insertTab', paragraphId: start.paragraphId, offset: start.offset },
          ],
          selectionMark()
        )
      );
      setSelection(collapsedAt({ ...start, offset: start.offset + 1 }));
    },

    insertLineBreak() {
      const start = orderedStart();
      commit(() =>
        session.applyTreeOps(
          [
            ...deleteSelectionOps(),
            { op: 'insertHardBreak', paragraphId: start.paragraphId, offset: start.offset },
          ],
          selectionMark()
        )
      );
      setSelection(collapsedAt({ ...start, offset: start.offset + 1 }));
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
              properties: mergedProperties(selectionRunProperties(), {
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
        properties: mergedProperties(paragraphPropertiesOf(paragraphId), {
          localName,
          ...(attributes ? { attributes } : {}),
        }),
      }));
      if (ops.length === 0) return;
      commit(() => session.applyTreeOps(ops, selectionMark()));
    },

    sectionProperties: () => readSectionProperties(session.part()),

    formatting() {
      const spans = spansInSelection(currentLayout, selection);
      const styles = spans.map((span) => span.style);
      // Agreement across the WHOLE selection, or nothing. `every` over an empty list is
      // true, so an empty selection reports the caret paragraph's alignment and no run
      // properties — which is what a toolbar should show with nothing selected.
      const agreed = <T>(pick: (style: (typeof styles)[number]) => T): T | null => {
        if (styles.length === 0) return null;
        const first = pick(styles[0]!);
        return styles.every((style) => pick(style) === first) ? first : null;
      };
      const properties = paragraphPropertiesOf(selection.head.paragraphId);
      const jc = properties.find((property) => property.localName === 'jc')?.attributes?.val;
      const style = properties.find((property) => property.localName === 'pStyle')?.attributes?.val;
      return {
        bold: styles.length > 0 && styles.every((entry) => entry.bold),
        italic: styles.length > 0 && styles.every((entry) => entry.italic),
        underline: styles.length > 0 && styles.every((entry) => entry.underline !== null),
        strikethrough: styles.length > 0 && styles.every((entry) => entry.strike),
        superscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'superscript'),
        subscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'subscript'),
        fontFamily: agreed((entry) => entry.fontFamily),
        fontSizeHalfPoints: (() => {
          const points = agreed((entry) => entry.fontSizePt);
          return points === null ? null : Math.round(points * 2);
        })(),
        color: agreed((entry) => entry.color),
        highlight: agreed((entry) => entry.highlight),
        alignment:
          jc === 'center' || jc === 'right' || jc === 'both' ? jc : jc === 'end' ? 'right' : 'left',
        styleId: style ?? null,
      } satisfies SurfaceFormatting;
    },

    toggleRunProperty(localName, attributes) {
      const { from, to } = orderedRange();
      // A collapsed caret has no range to format. Stored marks — formatting that applies to
      // the NEXT character typed — are a separate lane; refusing is honest rather than
      // formatting a character the user did not select.
      if (from.paragraphId !== to.paragraphId || from.offset === to.offset) return;
      const active = isRunPropertyActive(localName);
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
                selectionRunProperties(),
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
      if (from.paragraphId === to.paragraphId) {
        return textOf(from.paragraphId).slice(from.offset, to.offset);
      }
      const order = documentOrder(currentLayout);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return '';
      const parts = [textOf(from.paragraphId).slice(from.offset)];
      for (let index = firstIndex + 1; index < lastIndex; index += 1) {
        parts.push(textOf(order[index]!));
      }
      parts.push(textOf(to.paragraphId).slice(0, to.offset));
      // Paragraphs are newline-separated, which is what a paste target expects.
      return parts.join('\n');
    },

    deleteSelection() {
      const ops = deleteSelectionOps();
      if (ops.length === 0) return false;
      const start = orderedStart();
      commit(() => session.applyTreeOps(ops, selectionMark()));
      setSelection(collapsedAt(start));
      return true;
    },

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
      setSelection(clampedToDocument(selection));
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

  /**
   * Whether a run property is already set across the WHOLE selection.
   *
   * Word's rule, and the one that makes a toggle feel right: a partly-bold selection goes
   * fully bold on the first press rather than clearing the bold that is there.
   */
  function isRunPropertyActive(localName: string): boolean {
    const spans = spansInSelection(currentLayout, selection);
    if (spans.length === 0) return false;
    const flagOf = (span: (typeof spans)[number]): boolean => {
      switch (localName) {
        case 'b':
          return span.style.bold;
        case 'i':
          return span.style.italic;
        case 'u':
          return span.style.underline !== null;
        default:
          return false;
      }
    };
    return spans.every(flagOf);
  }

  /**
   * Merge one property into a set, replacing any entry with the same name.
   *
   * `setRunProperties` and `setParagraphProperties` REPLACE the whole container, so sending
   * one property alone deleted every other: pressing Bold stripped a run's font, size and
   * colour, and pressing Centre stripped a paragraph's style, numbering and indents.
   */
  function mergedProperties(
    existing: readonly { localName: string; attributes?: Record<string, string> }[],
    incoming: { localName: string; attributes?: Record<string, string> }
  ): { localName: string; attributes?: Record<string, string> }[] {
    const kept = existing.filter((entry) => entry.localName !== incoming.localName);
    return [...kept, incoming];
  }

  /** The run properties in force across the selection, taken from its first span. */
  function selectionRunProperties(): readonly {
    localName: string;
    attributes?: Record<string, string>;
  }[] {
    const spans = spansInSelection(currentLayout, selection);
    return spans[0]?.props ?? [];
  }

  /** A paragraph's own properties, read back from the layout records. */
  function paragraphPropertiesOf(
    paragraphId: string
  ): readonly { localName: string; attributes?: Record<string, string> }[] {
    for (const page of currentLayout.pages) {
      for (const fragment of page.fragments) {
        if (fragment.paragraphId === paragraphId) return fragment.props;
      }
    }
    return [];
  }

  /** A selection guaranteed to address content that exists at the current revision. */
  function clampedToDocument(next: SemanticSelection): SemanticSelection {
    const ids = session.paragraphIds();
    const fallback = ids[0];
    const clampPosition = (position: SemanticPosition): SemanticPosition => {
      const paragraphId = ids.includes(position.paragraphId)
        ? position.paragraphId
        : (fallback ?? position.paragraphId);
      const length = textOf(paragraphId).length;
      return { paragraphId, offset: Math.max(0, Math.min(position.offset, length)) };
    };
    return { anchor: clampPosition(next.anchor), head: clampPosition(next.head) };
  }

  function collapsedAt(position: SemanticPosition): SemanticSelection {
    return { anchor: position, head: position };
  }

  /** The selection in DOCUMENT order, whichever way the user dragged it. */
  function orderedRange(): { from: SemanticPosition; to: SemanticPosition } {
    const { anchor, head } = selection;
    if (anchor.paragraphId === head.paragraphId) {
      return anchor.offset <= head.offset ? { from: anchor, to: head } : { from: head, to: anchor };
    }
    const order = documentOrder(currentLayout);
    return order.indexOf(anchor.paragraphId) <= order.indexOf(head.paragraphId)
      ? { from: anchor, to: head }
      : { from: head, to: anchor };
  }

  function orderedStart(): SemanticPosition {
    return orderedRange().from;
  }

  /** Model text of a paragraph, read back from the layout records. */
  function textOf(paragraphId: string): string {
    return paragraphTextFromLayout(currentLayout, paragraphId);
  }

  /**
   * Ops that remove the current selection, or none when it is collapsed.
   *
   * A selection spanning paragraphs is trimmed at both ends and then JOINED back into one,
   * which is what makes selecting three paragraphs and typing behave like every other
   * editor. The order matters: trim first, join after, so each join sees the text that is
   * meant to survive rather than the text being removed.
   */
  function deleteSelectionOps(): Parameters<TreeDocxSession['applyTreeOps']>[0] {
    const { from, to } = orderedRange();
    if (from.paragraphId === to.paragraphId) {
      if (from.offset === to.offset) return [];
      return [
        { op: 'deleteText', paragraphId: from.paragraphId, start: from.offset, end: to.offset },
      ];
    }

    const order = documentOrder(currentLayout);
    const firstIndex = order.indexOf(from.paragraphId);
    const lastIndex = order.indexOf(to.paragraphId);
    if (firstIndex === -1 || lastIndex === -1) return [];

    const ops: Parameters<TreeDocxSession['applyTreeOps']>[0][number][] = [];
    // Tail of the first paragraph.
    const firstText = textOf(from.paragraphId);
    if (from.offset < firstText.length) {
      ops.push({
        op: 'deleteText',
        paragraphId: from.paragraphId,
        start: from.offset,
        end: firstText.length,
      });
    }
    // Whole paragraphs in between.
    for (let index = firstIndex + 1; index < lastIndex; index += 1) {
      const id = order[index]!;
      const length = textOf(id).length;
      if (length > 0) ops.push({ op: 'deleteText', paragraphId: id, start: 0, end: length });
    }
    // Head of the last paragraph.
    if (to.offset > 0) {
      ops.push({ op: 'deleteText', paragraphId: to.paragraphId, start: 0, end: to.offset });
    }
    // Then collapse the emptied paragraphs into the first one.
    for (let index = firstIndex + 1; index <= lastIndex; index += 1) {
      ops.push({ op: 'joinParagraphs', firstId: from.paragraphId, secondId: order[index]! });
    }
    return ops;
  }

  // Event wiring lives HERE rather than in each host, so React, Vue and a plain page get
  // identical behaviour instead of three hand-written keymaps that drift.
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
   * Deliberately narrow: one paragraph, expressed as a single replace of the differing
   * middle. Anything wider would be guessing at what changed.
   */
  function reconcileParagraphFromDom(paragraphId: string): void {
    const painted = paintedTextOf(paragraphId);
    if (painted === null) return;
    const modelText = textOf(paragraphId);
    if (painted === modelText) return;

    let prefix = 0;
    while (
      prefix < painted.length &&
      prefix < modelText.length &&
      painted[prefix] === modelText[prefix]
    ) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < painted.length - prefix &&
      suffix < modelText.length - prefix &&
      painted[painted.length - 1 - suffix] === modelText[modelText.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const inserted = painted.slice(prefix, painted.length - suffix);
    const ops: Parameters<TreeDocxSession['applyTreeOps']>[0][number][] = [];
    if (modelText.length - suffix > prefix) {
      ops.push({ op: 'deleteText', paragraphId, start: prefix, end: modelText.length - suffix });
    }
    if (inserted.length > 0) {
      ops.push({ op: 'insertText', paragraphId, offset: prefix, text: inserted });
    }
    if (ops.length === 0) return;
    commit(() => session.applyTreeOps(ops, selectionMark()));
    setSelection(collapsedAt({ paragraphId, offset: prefix + inserted.length }));
  }

  /** The text the browser currently shows for a paragraph, across all its painted lines. */
  function paintedTextOf(paragraphId: string): string | null {
    const spans = pagesLayer.querySelectorAll('[data-paragraph-id][data-start]');
    const pieces: { start: number; text: string }[] = [];
    for (const span of spans) {
      const element = span as HTMLElement;
      if (element.dataset.paragraphId !== paragraphId) continue;
      const start = Number(element.dataset.start);
      if (!Number.isInteger(start)) continue;
      pieces.push({ start, text: element.textContent ?? '' });
    }
    if (pieces.length === 0) return null;
    pieces.sort((a, b) => a.start - b.start);
    return pieces.map((piece) => piece.text).join('');
  }

  const NAVIGATION: Record<string, NavigationCommand> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Home: 'lineStart',
    End: 'lineEnd',
  };

  /** Run-property shortcuts, matching Word and every browser editor. */
  const FORMATTING: Record<string, { localName: string; attributes?: Record<string, string> }> = {
    b: { localName: 'b' },
    i: { localName: 'i' },
    u: { localName: 'u', attributes: { val: 'single' } },
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const accel = event.metaKey || event.ctrlKey;
    const command = NAVIGATION[event.key];
    if (command) {
      let scoped: NavigationCommand = command;
      if (event.key === 'Home' || event.key === 'End') {
        // Ctrl/Cmd+Home and End address the document rather than the line.
        if (accel) scoped = event.key === 'Home' ? 'documentStart' : 'documentEnd';
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        // Word-wise motion: Alt on macOS, Ctrl elsewhere. Both are accepted rather than
        // sniffing the platform, so a mac keyboard on Linux still behaves.
        (event.altKey || event.ctrlKey)
      ) {
        scoped = event.key === 'ArrowLeft' ? 'wordLeft' : 'wordRight';
      } else if (accel && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        scoped = event.key === 'ArrowUp' ? 'documentStart' : 'documentEnd';
      }
      surface.navigate(scoped, event.shiftKey);
      event.preventDefault();
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      // A page is a real unit here — the surface knows where every page starts — so this
      // moves by pages rather than by a guessed number of lines.
      surface.navigate(event.key === 'PageUp' ? 'documentStart' : 'documentEnd', event.shiftKey);
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace') {
      surface.deleteBackward();
      event.preventDefault();
      return;
    }
    if (event.key === 'Delete') {
      surface.deleteForward();
      event.preventDefault();
      return;
    }
    if (event.key === 'Tab') {
      surface.insertTab();
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      // Shift+Enter is a line break inside the paragraph, not a new paragraph.
      if (event.shiftKey) surface.insertLineBreak();
      else surface.splitParagraph();
      event.preventDefault();
      return;
    }
    if (accel && event.key.toLowerCase() === 'a') {
      surface.selectAll();
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && FORMATTING[event.key.toLowerCase()]) {
      const property = FORMATTING[event.key.toLowerCase()]!;
      surface.toggleRunProperty(property.localName, property.attributes);
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

  /**
   * Clipboard.
   *
   * PLAIN TEXT only, deliberately: writing HTML would invite reading it back, and pasted
   * HTML is attacker-controlled markup that has no business reaching a sink here. Rich
   * paste belongs behind the same bounded parse the file path uses.
   */
  const onCopy = (event: ClipboardEvent): void => {
    const text = surface.selectedText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };

  const onCut = (event: ClipboardEvent): void => {
    const text = surface.selectedText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    surface.deleteSelection();
    event.preventDefault();
  };

  const onPaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData('text/plain');
    event.preventDefault();
    if (!text) return;
    insertPlainText(text);
  };

  /** Insert text, turning newlines into real paragraph splits rather than literal characters. */
  function insertPlainText(text: string): void {
    // Normalized first: a Windows clipboard carries CRLF, and a literal CR in run text is
    // not a paragraph break in OOXML — it is a stray control character.
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    surface.deleteSelection();
    for (let index = 0; index < lines.length; index += 1) {
      if (index > 0) surface.splitParagraph();
      const line = lines[index]!;
      if (line.length > 0) surface.type(line);
    }
  }

  /** Plain text from an input event's data transfer, if it carries any. */
  function dataTransferText(event: InputEvent): string | null {
    const data = event.dataTransfer;
    if (!data) return null;
    // `text/plain` ONLY. `text/html` from a drag is markup from anywhere on the machine.
    const text = data.getData('text/plain');
    return text.length > 0 ? text : null;
  }

  const onBeforeInput = (event: InputEvent): void => {
    // PREVENTED FIRST, dispatched second.
    //
    // The pages are editable, so anything this handler does not recognise is a mutation the
    // browser performs on the painted DOM: Format-menu bold, emacs kill-line, transpose,
    // yank, insert-list, drop. The model never sees it, and worse, every span after it keeps
    // a `data-start` that no longer matches its text — so the NEXT keystroke commits at the
    // wrong offset. An unknown input type must be dropped, never passed through.
    event.preventDefault();

    if (composing) {
      // The IME owns the DOM until it finishes; reconciliation happens at composition end.
      return;
    }

    if (event.inputType === 'insertText' && event.data != null) {
      surface.type(event.data);
      return;
    }
    if (event.inputType === 'insertFromPaste') {
      // The paste handler already ran and did the work.
      return;
    }
    if (event.inputType === 'insertReplacementText') {
      // Autocorrect, dictation and smart substitutions arrive this way — NOT from a paste.
      // The replacement text is on the event; applying it is how a correction survives
      // instead of being silently dropped.
      const replacement = event.data ?? dataTransferText(event);
      if (replacement) surface.type(replacement);
      return;
    }
    if (event.inputType === 'deleteContentBackward') {
      surface.deleteBackward();
      return;
    }
    if (event.inputType === 'deleteWordBackward') {
      surface.deleteWordBackward();
      return;
    }
    if (event.inputType === 'deleteContentForward') {
      surface.deleteForward();
      return;
    }
    if (event.inputType === 'deleteWordForward') {
      surface.deleteWordForward();
      return;
    }
    if (event.inputType === 'insertLineBreak') {
      surface.insertLineBreak();
      return;
    }
    if (event.inputType === 'insertFromDrop' || event.inputType === 'insertFromPasteAsQuotation') {
      // Plain text only, like paste: dropped content carries `text/html` from anywhere on the
      // machine, and parsing it here would be exactly the HTML-from-a-string sink the file
      // path is bounded to avoid.
      const dropped = dataTransferText(event);
      if (dropped) insertPlainText(dropped);
      return;
    }
    if (event.inputType === 'insertParagraph') {
      surface.splitParagraph();
    }
  };

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

  render();
  return { ok: true, surface };
}
