/**
 * HiddenHeaderFooterPMs — persistent off-screen ProseMirror EditorViews for
 * every distinct header/footer part in the loaded document.
 *
 * Phase 1 of the HF editing unification (see
 * `openspec/changes/unify-hf-editing/`). The unification deletes the visible
 * inline overlay's PM and routes HF editing through the body's hidden-PM +
 * visible-painter model. This component is the first step: one hidden
 * `EditorView` per distinct HF `rId` from `Document.package.headers` and
 * `.footers`, mounted off-screen, always alive.
 *
 * Slot keying is by `rId`, NOT by `(hdrFtrType, kind)` — two sections that
 * share a header by referencing the same `rId` (the ECMA-376 §17.10.1
 * sharing-by-reference pattern) share one EditorView. The set is enumerated
 * as `Document.package.headers ∪ Document.package.footers` — every entry in
 * those two `Map<string, HeaderFooter>` maps gets one EditorView.
 *
 * In phase 1 these EditorViews carry no user input; the inline overlay still
 * owns editing. They exist so the painter pipeline can read from
 * `view.state.doc` (via `convertHeaderFooterPmDocToContent`) and stay in
 * lockstep with the future single source of truth. Subsequent phases move
 * click routing, selection drawing, and finally focus into these views.
 */

import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  memo,
  useCallback,
  useMemo,
} from 'react';
import { EditorState } from 'prosemirror-state';
import type { EditorState as EditorStateT } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  schema,
  createDocumentStylesPlugin,
  createDocumentContextPlugin,
} from '@docx-editor.dev/core/prosemirror';
import {
  createSuggestionModePlugin,
  setSuggestionMode,
} from '@docx-editor.dev/core/prosemirror/plugins';
import {
  headerFooterToProseDoc,
  proseDocToBlocks,
} from '@docx-editor.dev/core/prosemirror/conversion';
import { createStarterKit } from '@docx-editor.dev/core/prosemirror/extensions';
import { ExtensionManager } from '@docx-editor.dev/core/prosemirror/extensions';
import type {
  Document,
  HeaderFooter,
  StyleDefinitions,
  Theme,
} from '@docx-editor.dev/core/types/document';

import 'prosemirror-view/style/prosemirror.css';

export type HfPartKind = 'header' | 'footer';

export interface HfPartKey {
  /** Part-relationship id (`rId`) — the spec-faithful slot identity. */
  rId: string;
  /** Whether this rId belongs to `package.headers` or `package.footers`. */
  kind: HfPartKind;
}

export interface HiddenHeaderFooterPMsRef {
  /**
   * Look up the persistent EditorView for a given HF part. Returns `null`
   * before mount or when the rId is not present in the loaded document.
   */
  getView(rId: string): EditorView | null;
  /** Get all active EditorViews mapped by rId. */
  getViews(): Map<string, EditorView>;
}

export interface HiddenHeaderFooterPMsProps {
  /** The loaded document — its `package.headers` / `package.footers` drives slot enumeration. */
  document: Document | null;
  /** Document styles, threaded into `headerFooterToProseDoc` for style resolution. */
  styles?: StyleDefinitions | null;
  /** Document theme, threaded for themed cell shading on initial PM build. */
  theme?: Theme | null;
  /** Suggestion mode active state */
  isSuggesting?: boolean;
  /** Active author for suggestion mode */
  author?: string;
  /** `defaultTabMark` from `state.doc.attrs.defaultTabMarkTwips`, threaded to the HF PM doc. */
  defaultTabMarkTwips?: number | null;
  /**
   * Called after every transaction lands on any HF EditorView. Phase 5 of
   * HF editing unification (openspec/changes/unify-hf-editing/) — the
   * persistent PM is now the sole editor and its transactions need to
   * trigger relayout (so the painter repaints) plus caret reposition.
   */
  onTransaction?: (rId: string, view: EditorView, docChanged: boolean) => void;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

interface MountedView {
  rId: string;
  kind: HfPartKind;
  view: EditorView;
  /** The DOM node `view` is mounted to (one `<div>` per rId inside the off-screen host). */
  mountNode: HTMLElement;
}

function buildInitialState(
  hf: HeaderFooter,
  styles: StyleDefinitions | null | undefined,
  theme: Theme | null | undefined,
  defaultTabMarkTwips: number | null | undefined,
  defaultTableStyleId: string | null | undefined,
  mgr: ExtensionManager,
  isSuggesting: boolean,
  author: string
): EditorState {
  const pmDoc = headerFooterToProseDoc(hf.content, {
    styles: styles ?? undefined,
    theme: theme ?? null,
    defaultTabMarkTwips: defaultTabMarkTwips ?? null,
  });
  // Header/footer paragraphs share the document's style table, so they get the
  // same style-aware behavior (e.g. Enter after a heading → body text).
  const styleResolverPlugin = createDocumentStylesPlugin(styles);
  // Document context (theme + settings `w:defaultTableStyle`) so inserting a
  // table in a header/footer adopts the default table style too.
  const documentContextPlugin = createDocumentContextPlugin({
    theme: theme ?? null,
    defaultTableStyleId: defaultTableStyleId ?? null,
  });
  const suggestionPlugin = createSuggestionModePlugin(isSuggesting, author);
  return EditorState.create({
    doc: pmDoc,
    schema,
    plugins: [suggestionPlugin, ...mgr.getPlugins(), styleResolverPlugin, documentContextPlugin],
  });
}

function enumerateSlots(doc: Document | null): HfPartKey[] {
  if (!doc?.package) return [];
  const out: HfPartKey[] = [];
  const headers = doc.package.headers;
  if (headers) {
    for (const rId of headers.keys()) out.push({ rId, kind: 'header' });
  }
  const footers = doc.package.footers;
  if (footers) {
    // A document SHOULD NOT register the same `rId` under both headers and
    // footers — the OOXML schema keeps them disjoint per
    // `headerReference` vs `footerReference`. Defensive: dedupe anyway.
    for (const rId of footers.keys()) {
      if (!headers || !headers.has(rId)) out.push({ rId, kind: 'footer' });
    }
  }
  return out;
}

export const HiddenHeaderFooterPMs = memo(
  forwardRef<HiddenHeaderFooterPMsRef, HiddenHeaderFooterPMsProps>(function HiddenHeaderFooterPMs(
    {
      document,
      styles,
      theme,
      isSuggesting = false,
      author = 'User',
      defaultTabMarkTwips,
      onTransaction,
    },
    ref
  ) {
    // Keep the callback stable across renders — every HF EditorView's
    // `dispatchTransaction` closes over it, so going through a ref lets
    // the parent pass a fresh callback each render without recreating
    // the EditorViews.
    const onTransactionRef = useRef(onTransaction);
    onTransactionRef.current = onTransaction;

    // styleId for newly inserted tables — fixed per document load (a primitive,
    // so safe in the effect deps unlike the `document` object whose identity
    // changes on every body transaction).
    const defaultTableStyleId = document?.package?.settings?.defaultTableStyle ?? null;

    const isSuggestingRef = useRef(isSuggesting);
    isSuggestingRef.current = isSuggesting;
    const authorRef = useRef(author);
    authorRef.current = author;

    useEffect(() => {
      for (const { view } of mountedRef.current.values()) {
        setSuggestionMode(isSuggesting, view.state, view.dispatch, author);
      }
    }, [isSuggesting, author]);
    // Refs for the document writeback closure inside `dispatchTransaction`.
    // The EditorView is created once per rId; without a ref the
    // closure would capture the initial `document` and never see updates
    // (Map identity changes when `loadDocument` runs but the closure
    // would still write to the old map).
    const documentRef = useRef(document);
    documentRef.current = document;
    const syncHfBlocksToDocumentRef = useRef<
      ((rId: string, kind: HfPartKind, state: EditorStateT) => void) | null
    >(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef<Map<string, MountedView>>(new Map());
    const managersRef = useRef<Map<string, ExtensionManager>>(new Map());

    // Writeback: serialize the persistent PM's doc back into
    // `Document.package.headers[rId].content` (or `.footers[rId].content`)
    // so `save()` reads the latest HF content. This used to live in the
    // inline overlay's save-on-close path only; with the persistent PM
    // as sole editor, edits typed before close were lost. Now every doc
    // change syncs.
    syncHfBlocksToDocumentRef.current = (rId: string, kind: HfPartKind, state: EditorStateT) => {
      const doc = documentRef.current;
      const pkg = doc?.package;
      if (!pkg) return;
      const bag = kind === 'header' ? pkg.headers : pkg.footers;
      const hf = bag?.get(rId);
      if (!hf) return;
      // `proseDocToBlocks` returns `(Paragraph | Table)[]`; assign in
      // place — the bag Map is the canonical reference shared across
      // sections, so mutating `hf.content` propagates to every section
      // that references the same rId (the spec-faithful sharing pattern).
      hf.content = proseDocToBlocks(state.doc);
      // First edit invalidates the captured original XML — serialize from the
      // model from here on so the user's change actually lands in the export.
      hf.verbatimXml = undefined;
    };

    // Resolve a HeaderFooter from doc by rId — used both at mount and when
    // a slot's content needs to be re-synced (e.g. after the inline editor
    // saves via the existing onSave flow).
    const resolveHf = useCallback(
      (rId: string, kind: HfPartKind): HeaderFooter | null => {
        const pkg = document?.package;
        if (!pkg) return null;
        const bag = kind === 'header' ? pkg.headers : pkg.footers;
        return bag?.get(rId) ?? null;
      },
      [document]
    );

    // Enumerate target slots from the current document. Memoize on identity
    // of the headers/footers Maps so we don't churn the EditorViews when
    // unrelated parts of `document` change.
    const slots = useMemo<HfPartKey[]>(
      () => enumerateSlots(document),
      // Re-enumerate when the Maps themselves are swapped. Mutations to the
      // existing Map (inline editor save mutates in place today) won't
      // trigger this; that's intentional for phase 1 — the inline editor's
      // save path will be plumbed through to dispatch a transaction on the
      // persistent PM in phase 5.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [document?.package?.headers, document?.package?.footers]
    );

    // Mount / unmount EditorViews when the slot set changes.
    useEffect(() => {
      if (!hostRef.current) return;
      const host = hostRef.current;
      const want = new Map(slots.map((s) => [s.rId, s] as const));
      const have = mountedRef.current;

      // Tear down any rIds no longer present.
      for (const [rId, mounted] of have) {
        if (!want.has(rId)) {
          mounted.view.destroy();
          mounted.mountNode.remove();
          managersRef.current.get(rId)?.destroy();
          managersRef.current.delete(rId);
          have.delete(rId);
        }
      }

      // Bring up any rIds we don't yet have.
      for (const slot of slots) {
        if (have.has(slot.rId)) continue;
        const hf = resolveHf(slot.rId, slot.kind);
        if (!hf) continue;

        const mgr = new ExtensionManager(createStarterKit());
        mgr.buildSchema();
        mgr.initializeRuntime();
        managersRef.current.set(slot.rId, mgr);

        // `document` in this closure is the Document model (DOCX), not the
        // browser DOM `Document`. Create the mount node via the host's owner.
        const node = host.ownerDocument.createElement('div');
        node.dataset.hfRId = slot.rId;
        node.dataset.hfKind = slot.kind;
        host.appendChild(node);

        const state = buildInitialState(
          hf,
          styles,
          theme,
          defaultTabMarkTwips,
          defaultTableStyleId,
          mgr,
          isSuggestingRef.current,
          authorRef.current
        );
        const slotRId = slot.rId;
        const slotKind = slot.kind;
        const view: EditorView = new EditorView(node, {
          state,
          // The persistent PM is the sole HF editor. Every transaction
          // (typing, click → setSelection, undo/redo) needs to:
          //   1. Re-run the layout pipeline so the painter repaints.
          //   2. Reposition the caret overlay.
          //   3. Sync `view.state.doc` back into `Document.package.headers/footers`
          //      so `save()` doesn't lose unsaved HF edits.
          // (1) + (2) ride through `onTransaction`; (3) happens here.
          dispatchTransaction(tr) {
            const newState = view.state.apply(tr);
            view.updateState(newState);
            if (tr.docChanged) syncHfBlocksToDocumentRef.current?.(slotRId, slotKind, newState);
            onTransactionRef.current?.(slotRId, view, tr.docChanged);
          },
        });
        have.set(slot.rId, { rId: slot.rId, kind: slot.kind, view, mountNode: node });
      }
      // Note: `document` intentionally excluded from deps. Slot enumeration
      // already flows through `slots`, and `resolveHf` reads from the same
      // ref; depending on `document` directly causes a full HF EditorView
      // re-mount on every body PM transaction (each Document.applyTransaction
      // returns a new identity), which destroys IME state and selection.
    }, [slots, resolveHf, styles, theme, defaultTabMarkTwips, defaultTableStyleId]);

    // Tear everything down on unmount.
    useEffect(() => {
      const have = mountedRef.current;
      const mgrs = managersRef.current;
      return () => {
        for (const { view, mountNode } of have.values()) {
          view.destroy();
          mountNode.remove();
        }
        have.clear();
        for (const mgr of mgrs.values()) mgr.destroy();
        mgrs.clear();
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getView(rId: string): EditorView | null {
          return mountedRef.current.get(rId)?.view ?? null;
        },
        getViews(): Map<string, EditorView> {
          const map = new Map<string, EditorView>();
          for (const [rId, mounted] of mountedRef.current) {
            map.set(rId, mounted.view);
          }
          return map;
        },
      }),
      []
    );

    // Off-screen host — positioned the same way `OffscreenEditorHost` is, so
    // the EditorViews retain focusability and keyboard routing while being
    // visually absent. NOT `aria-hidden` (the body PM also avoids it) —
    // the editor remains in the accessibility tree, and screen readers /
    // focus management treat it as a real input. `pointer-events: none`
    // blocks mouse but does not block programmatic `view.focus()`.
    return (
      <div
        ref={hostRef}
        style={{
          position: 'fixed',
          left: -9999,
          top: 0,
          opacity: 0,
          zIndex: -1,
          pointerEvents: 'none',
        }}
      />
    );
  })
);

HiddenHeaderFooterPMs.displayName = 'HiddenHeaderFooterPMs';
