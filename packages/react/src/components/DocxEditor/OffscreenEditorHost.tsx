/**
 * The body's ProseMirror editor — off-screen, and the only editor there is.
 *
 * This is the half of the dual-rendering model nobody sees. ProseMirror owns
 * everything about *editing*: the document, undo history, the keymap, IME
 * composition, clipboard, selection. It just doesn't own the pixels. Its
 * `EditorView` is mounted 9999px to the left of the viewport, and what the user
 * looks at is a completely separate DOM tree that the painter rebuilds from this
 * view's state.
 *
 * The reason is fidelity. ProseMirror renders through `toDOM`, which produces a
 * flowing HTML document — one long column of text. A Word document is not that:
 * it is a sequence of fixed-size pages with hard breaks, repeated table headers,
 * footnotes pinned to the bottom of the page that references them. You cannot
 * get there from `toDOM`. So the editing model and the presentation are split,
 * and this component is the editing side of the split.
 *
 * Practical consequence, and the one thing to remember: **fixing `toDOM` for a
 * visual bug changes nothing the user can see.** The visible pages come from
 * `painter-model/paintPage.ts`.
 *
 * The host stays focusable — it is off-screen, not hidden. `aria-hidden` would
 * take it out of the accessibility tree, and `display: none` would stop it
 * receiving keys; either one silently breaks screen readers and typing. It is
 * moved, not removed.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { Plugin, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { undo, redo } from 'prosemirror-history';
import { CellSelection } from 'prosemirror-tables';

import {
  schema,
  createDocumentStylesPlugin,
  createDocumentContextPlugin,
} from '@eigenpal/docx-editor-core/prosemirror';
import { toProseDoc, fromProseDoc } from '@eigenpal/docx-editor-core/prosemirror/conversion';
import {
  createStarterKit,
  ExtensionManager,
} from '@eigenpal/docx-editor-core/prosemirror/extensions';
import type { Document, StyleDefinitions } from '@eigenpal/docx-editor-core/types/document';

import 'prosemirror-view/style/prosemirror.css';

/**
 * The imperative surface the editor shell drives ProseMirror through.
 *
 * Everything that mutates editing state goes through here rather than through
 * props, because editing is not a function of render: a keystroke must land on
 * the document *now*, not on the next React commit.
 */
export interface OffscreenEditorHostRef {
  /** The live `EditorView`, or null before mount. */
  getView(): EditorView | null;
  /** The current editing state. */
  getState(): EditorState | null;
  /** The off-screen element the view is mounted in — the IME anchor hangs off this. */
  getHostElement(): HTMLElement | null;
  /** The editing state, converted back to the document model. */
  getDocument(): Document | null;

  focus(): void;
  blur(): void;
  isFocused(): boolean;

  dispatch(transaction: Transaction): void;
  /** Place a text selection. Collapsed when `head` is omitted. */
  setSelection(anchor: number, head?: number): void;
  /** Select the node at `pos` — an image, a table. */
  setNodeSelection(pos: number): void;
  /** Select a rectangle of table cells (a drag across a table). */
  setCellSelection(anchorCellPos: number, headCellPos: number): void;

  undo(): void;
  redo(): void;
}

export interface OffscreenEditorHostProps {
  document: Document | null;
  styles?: StyleDefinitions | null;
  /** Content width the document is laid out at, px. */
  widthPx?: number;
  readOnly?: boolean;
  externalPlugins?: Plugin[];
  extensionManager?: ExtensionManager;

  /** Every transaction, after it has landed. */
  onTransaction?: (transaction: Transaction, state: EditorState) => void;
  /** Selection-affecting transactions, after they have landed. */
  onSelectionChange?: (state: EditorState) => void;
  /** The view is up and the document is loaded — time for the first layout. */
  onEditorViewReady?: (view: EditorView) => void;
  /** Return true to swallow the key; ProseMirror's keymap never sees it. */
  onKeyDown?: (view: EditorView, event: KeyboardEvent) => boolean;
}

/**
 * Off-screen, not hidden. See the module note: `display: none` and
 * `aria-hidden` both break editing in ways that are hard to attribute later.
 */
const OFFSCREEN: CSSProperties = {
  position: 'fixed',
  left: -9999,
  top: 0,
  opacity: 0,
  zIndex: -1,
  pointerEvents: 'none',
};

const NO_PLUGINS: Plugin[] = [];

export const OffscreenEditorHost = memo(
  forwardRef<OffscreenEditorHostRef, OffscreenEditorHostProps>(function OffscreenEditorHost(
    {
      document,
      styles,
      widthPx,
      readOnly = false,
      externalPlugins = NO_PLUGINS,
      extensionManager,
      onTransaction,
      onSelectionChange,
      onEditorViewReady,
      onKeyDown,
    },
    ref
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    /**
     * The `document` prop is a *round trip*, not an input.
     *
     * Every edit makes the host serialize its state back out (`getDocument`),
     * the shell hands that to `onDocumentChange`, and the app stores it — and
     * feeds it straight back in as `document`. So the prop's identity changes on
     * every single keystroke.
     *
     * Rebuilding the view for those would be catastrophic and nearly invisible:
     * the new view starts with its selection at the top of the document, so the
     * NEXT character is inserted at position 0. Typing "abc" produces "cba", and
     * everything downstream (undo history, IME composition) is destroyed each
     * keypress too.
     *
     * So we remember what we emitted, and only treat a document we did NOT emit
     * as a genuine load. The view is then rebuilt for exactly one reason: a
     * different document was opened.
     */
    const emittedDocsRef = useRef(new WeakSet<Document>());

    const documentRef = useRef(document);
    documentRef.current = document;
    const stylesRef = useRef(styles);
    stylesRef.current = styles;

    /**
     * The load counter is derived DURING RENDER, not in an effect.
     *
     * That matters. An effect that bumped a state counter would schedule a
     * second render, and the view would only be rebuilt on the render *after*
     * the new document arrived — leaving the previous view live for one commit.
     * Anything typed in that window goes into a view that is about to be
     * destroyed, so it is silently lost. (Typing into a freshly-created document
     * dropped its first few characters exactly this way: "Hello World" came out
     * as " World".)
     *
     * Comparing against a ref during render is React's sanctioned way to adjust
     * for a changed prop without the extra pass, and it is idempotent: a second
     * render with the same document sees the ref already updated and does nothing.
     */
    const loadKeyRef = useRef(0);
    const lastDocRef = useRef<Document | null | undefined>(undefined);

    if (lastDocRef.current !== document) {
      const isOwnWriteback = document != null && emittedDocsRef.current.has(document);
      lastDocRef.current = document;
      if (!isOwnWriteback) loadKeyRef.current += 1;
    }
    const loadKey = loadKeyRef.current;

    // Callbacks go through refs so the parent can pass fresh closures every
    // render without tearing down the EditorView. Recreating the view would
    // destroy the undo history and the IME composition in progress — which is
    // exactly what happens if these end up in the effect's dependencies.
    const onTransactionRef = useRef(onTransaction);
    onTransactionRef.current = onTransaction;
    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;
    const onReadyRef = useRef(onEditorViewReady);
    onReadyRef.current = onEditorViewReady;
    const onKeyDownRef = useRef(onKeyDown);
    onKeyDownRef.current = onKeyDown;
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;

    // The extension set is fixed for the life of the view: it builds the schema,
    // and a schema swap would invalidate every position in the document.
    const ownManager = useMemo(
      () => (extensionManager ? null : new ExtensionManager(createStarterKit())),
      [extensionManager]
    );
    const manager = extensionManager ?? ownManager!;

    // Rebuild the view only for a genuine document LOAD — see the note above.
    // Keying this on the `document` prop instead would tear the view down on
    // every keystroke.
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      manager.buildSchema();

      const loaded = documentRef.current;
      const pmDoc = loaded
        ? toProseDoc(loaded, { styles: stylesRef.current ?? undefined })
        : undefined;

      const state = EditorState.create({
        schema,
        doc: pmDoc,
        plugins: [
          // Suggestion mode must precede extension keymaps so its
          // handleKeyDown (Enter → pPrIns, Backspace → pPrDel) wins over
          // BaseKeymap's split/join. Matches Vue body + HF plugin order.
          ...externalPlugins,
          ...manager.getPlugins(),
          createDocumentStylesPlugin(stylesRef.current),
          createDocumentContextPlugin({
            theme: loaded?.package?.theme ?? null,
            defaultTableStyleId: loaded?.package?.settings?.defaultTableStyle ?? null,
          }),
        ],
      });

      const view: EditorView = new EditorView(host, {
        state,
        editable: () => !readOnlyRef.current,
        handleKeyDown: (v, event) => onKeyDownRef.current?.(v, event) ?? false,
        dispatchTransaction(transaction) {
          const next = view.state.apply(transaction);
          view.updateState(next);

          onTransactionRef.current?.(transaction, next);

          // `selectionSet` covers an explicit selection move; a document change
          // moves the selection implicitly (the caret advances as you type).
          // `storedMarksSet` covers empty-paragraph formatting toggles that
          // don't move the caret — toolbar state must still refresh.
          if (transaction.selectionSet || transaction.docChanged || transaction.storedMarksSet) {
            onSelectionChangeRef.current?.(next);
          }
        },
      });

      viewRef.current = view;
      manager.initializeRuntime();
      onReadyRef.current?.(view);

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // Everything else (styles, theme, the plugin set, the callbacks) is read
      // through a ref at construction or at call time. Putting any of them in the
      // deps would recreate the view on an unrelated re-render and take the undo
      // history — and any in-flight IME composition — with it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadKey, manager]);

    // `editable` reads the ref, so a read-only flip needs a nudge to re-evaluate
    // rather than a rebuild.
    useEffect(() => {
      viewRef.current?.setProps({ editable: () => !readOnly });
    }, [readOnly]);

    useEffect(() => {
      return () => ownManager?.destroy();
    }, [ownManager]);

    const dispatch = useCallback((transaction: Transaction) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(transaction);
    }, []);

    useImperativeHandle(
      ref,
      (): OffscreenEditorHostRef => ({
        getView: () => viewRef.current,
        getState: () => viewRef.current?.state ?? null,
        getHostElement: () => hostRef.current,

        getDocument: () => {
          const view = viewRef.current;
          if (!view) return null;
          // The loaded document is the base: it carries everything ProseMirror
          // doesn't model — headers, footnotes, styles, the parts we round-trip
          // verbatim. Serializing the PM doc alone would silently drop them.
          const next = fromProseDoc(view.state.doc, documentRef.current ?? undefined);
          // Remember it, so when the app hands it back to us as a prop we know
          // it is our own echo and not a new document to load.
          emittedDocsRef.current.add(next);
          return next;
        },

        focus: () => viewRef.current?.focus(),
        blur: () => viewRef.current?.dom.blur(),
        isFocused: () => viewRef.current?.hasFocus() ?? false,

        dispatch,

        setSelection: (anchor: number, head?: number) => {
          const view = viewRef.current;
          if (!view) return;

          // A position from a click or a search result can outrun the document
          // if it raced an edit. Clamping beats throwing: the caret lands at the
          // end instead of the editor dying.
          const size = view.state.doc.content.size;
          const from = clamp(anchor, 0, size);
          const to = clamp(head ?? anchor, 0, size);

          const selection = TextSelection.create(view.state.doc, from, to);
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        },

        setNodeSelection: (pos: number) => {
          const view = viewRef.current;
          if (!view) return;
          const size = view.state.doc.content.size;
          const at = clamp(pos, 0, Math.max(0, size - 1));
          try {
            const selection = NodeSelection.create(view.state.doc, at);
            view.dispatch(view.state.tr.setSelection(selection));
          } catch {
            // Not a selectable node at that position — leave the selection alone
            // rather than moving the caret somewhere the user didn't click.
          }
        },

        setCellSelection: (anchorCellPos: number, headCellPos: number) => {
          const view = viewRef.current;
          if (!view) return;
          try {
            const anchor = view.state.doc.resolve(anchorCellPos);
            const head = view.state.doc.resolve(headCellPos);
            view.dispatch(view.state.tr.setSelection(new CellSelection(anchor, head)));
          } catch {
            // Not inside a table — the drag didn't start in one.
          }
        },

        undo: () => {
          const view = viewRef.current;
          if (view) undo(view.state, view.dispatch);
        },
        redo: () => {
          const view = viewRef.current;
          if (view) redo(view.state, view.dispatch);
        },
      }),
      [dispatch, document]
    );

    // `paged-editor__hidden-pm` is part of the host contract, not decoration:
    // it is how the outside world reaches the real editor. Tests focus through
    // it, the scroll-restore path queries `.paged-editor__hidden-pm .ProseMirror`
    // for the live view, and the Vue adapter puts the same class on its own
    // off-screen host so both are addressable the same way.
    //
    // Portal to document.body (not the React `document` prop) so focus()/
    // scrollIntoView on the off-screen PM cannot scroll the paged scroller.
    return createPortal(
      <div
        ref={hostRef}
        className="paged-editor__hidden-pm"
        style={{ ...OFFSCREEN, width: widthPx }}
      />,
      globalThis.document.body
    );
  })
);

OffscreenEditorHost.displayName = 'OffscreenEditorHost';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
