// Framework-agnostic DOCX editor mount (queue item 3). The one implementation the React
// and Vue editable components share, so both adapters have identical load/edit/save
// behavior. An editable (paragraph-only) document mounts a minimal ProseMirror view whose
// every change maps to one DocOp transaction against the canonical store; a document with
// tables/SDTs opens READ-ONLY through the engine preview (real geometry, nothing
// flattened). Exposes an engine-neutral EditorDriver for browser smoke tests.
//
// Text insertion, deletion, selection, Backspace/Delete (paragraph join), paragraph SPLIT
// (Enter), and undo/redo are handled by the ProseMirror base keymap + history; every
// resulting change maps to DocOps. A split mints a new tail block in the store; after the
// commit the view re-tags its projected paragraphs with the store's ids by position, so
// identity and the caret survive without a full reprojection. Multi-paragraph paste and
// block reorder still fail closed (they map to no supported op) and snap back.

import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { captureSelection, resolveSelection } from '@docx-editor.dev/engine-binding';
import { openDocxSession, type DocxEditorSession } from './docxEditorSession.ts';
import { renderDocxPreview, renderModelPreview } from './enginePreview.ts';

/** Engine-neutral test/automation boundary — identical shape in both adapters. */
export interface EditorDriver {
  readonly editable: boolean;
  /** Body text from the CANONICAL model (not the ProseMirror view). */
  getBodyText(): string;
  /** Prove the round-trip: save the canonical model to DOCX, reopen it, return its body
   *  text. A committed edit must survive this. */
  saveAndReopenText(): string;
}

export interface MountedEditor {
  readonly session: DocxEditorSession;
  readonly driver: EditorDriver;
  destroy(): void;
}

/** Mount an editor (or read-only preview) for `bytes` into `container`. */
export function mountDocxEditor(container: HTMLElement, bytes: Uint8Array): MountedEditor {
  const session = openDocxSession(bytes);
  const driver: EditorDriver = {
    editable: session.editable,
    getBodyText: () => session.bodyText(),
    saveAndReopenText: () => openDocxSession(session.save()).bodyText(),
  };

  if (!session.editable) {
    // Read-only: render the whole document (paragraphs + real tables/SDTs) through the
    // engine preview. Nothing is editable; nothing is flattened.
    renderDocxPreview(bytes, container, {});
    return { session, driver, destroy: () => container.replaceChildren() };
  }

  // Build once so the initial state and the reject snap-back share the same plugins
  // (history + keymaps must survive a rejected edit). Enter (paragraph split) is handled by
  // the base keymap; the forward mapper turns it into one splitParagraph DocOp.
  const plugins = [
    history(),
    keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
    keymap(baseKeymap),
  ];
  // Two panes: the ProseMirror EDIT surface (left) and the paginated DISPLAY the canonical
  // model repaints into (right). Typing updates store.model, then the paginated pane is
  // re-laid-out from store.model — so the visible page reflects the canonical state, not
  // just the raw contentEditable surface.
  const doc = container.ownerDocument ?? document;
  container.replaceChildren();
  container.classList.add('docx-editable');
  container.style.cssText = 'display:flex; gap:16px; height:100%; min-height:0';
  const editPane = doc.createElement('div');
  editPane.className = 'docx-edit-pane';
  editPane.style.cssText = 'flex:0 0 42%; min-width:0; overflow:auto; padding:8px 12px; outline:none';
  const pagedPane = doc.createElement('div');
  pagedPane.className = 'docx-paged-pane';
  pagedPane.style.cssText = 'flex:1; min-width:0; overflow:auto; background:#eceff1; padding:12px';
  container.append(editPane, pagedPane);

  // The paginated pane is a full re-layout of the whole model. Typing commits one edit per
  // keystroke, so painting synchronously each time re-lays-out the entire document per key.
  // Coalesce with requestAnimationFrame: many commits within a frame collapse to ONE repaint
  // from the latest canonical model. (No rAF — e.g. a headless environment — paints inline.)
  const raf = (container.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined))
    ?.requestAnimationFrame;
  let repaintQueued = false;
  const paintNow = () => renderModelPreview(session.currentModel(), pagedPane, {}, doc);
  const repaintPaged = () => {
    if (!raf) return paintNow();
    if (repaintQueued) return;
    repaintQueued = true;
    raf(() => {
      repaintQueued = false;
      paintNow();
    });
  };

  let reconciling = false;
  let pendingCompositionCommit = false;
  const view = new EditorView(editPane, {
    state: EditorState.create({ doc: session.projectDoc(), plugins }),
    editable: () => session.editable,
    // While an IME composition is active, ProseMirror mutates the DOM directly and dispatches
    // interim transactions; committing (which would reproject on a rejection) mid-composition
    // disrupts the IME. Defer the commit and flush it once composition ends (compositionend).
    handleDOMEvents: {
      compositionend: () => {
        const win = container.ownerDocument?.defaultView;
        const flush = () => {
          if (!pendingCompositionCommit) return;
          pendingCompositionCommit = false;
          if (!reconciling) commitEdit();
        };
        // Let ProseMirror apply its final composition transaction first, then commit.
        if (win?.requestAnimationFrame) win.requestAnimationFrame(flush);
        else flush();
        return false;
      },
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (reconciling || !tr.docChanged) return;
      if (view.composing) {
        pendingCompositionCommit = true; // defer until compositionend
        return;
      }
      commitEdit();
    },
  });

  // Map the current view doc to the store. On a refused edit, snap back to the canonical
  // projection (never let the view diverge); on a committed edit, re-tag new paragraphs and
  // repaint the paginated display.
  function commitEdit() {
    const state = view.state;
    const res = session.applyPmDoc(state.doc);
    if (res.rejected) {
      reconciling = true;
      // Capture the caret as an authored anchor (paragraph semId + offset) BEFORE reverting,
      // then restore it against the reverted doc so a refused edit doesn't also jump the cursor
      // to the top. A deleted/new paragraph collapses to a surviving boundary.
      const anchor = captureSelection(state);
      const canonical = session.projectDoc();
      const revert = state.tr.replaceWith(0, state.doc.content.size, canonical.content).setMeta('addToHistory', false);
      try {
        revert.setSelection(resolveSelection(anchor, revert.doc));
      } catch {
        // Fall back to the default mapped selection if the anchor cannot be resolved.
      }
      view.dispatch(revert);
      reconciling = false;
    }
    if (res.committed) {
      syncSemIds();
      repaintPaged();
    }
  }

  // Re-tag the view's projected paragraphs with the canonical block ids by position. After a
  // split the store mints a new tail id; the PM tail still reads semId=null. One
  // attribute-only, history-excluded transaction reconciles identity WITHOUT reprojecting
  // the whole document, so the caret and undo stack are untouched.
  function syncSemIds() {
    const ids = session.bodyBlockIds();
    let tr = view.state.tr;
    let changed = false;
    let idx = 0;
    view.state.doc.forEach((node, offset) => {
      const id = ids[idx];
      if (node.type.name === 'paragraph' && id && node.attrs.semId !== id) {
        tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, semId: id });
        changed = true;
      }
      idx += 1;
    });
    if (!changed) return;
    reconciling = true;
    view.dispatch(tr.setMeta('addToHistory', false));
    reconciling = false;
  }
  paintNow(); // initial paginated render from the loaded model — synchronous so it's visible at once
  return { session, driver, destroy: () => view.destroy() };
}
