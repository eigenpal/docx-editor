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
import { captureSelection, resolveSelection, type SelectionAnchor } from '@docx-editor.dev/engine-binding';
import { openDocxSession } from './docxEditorSession.ts';
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
  /** The engine-neutral automation surface (body text, save+reopen, editable). */
  readonly driver: EditorDriver;
  destroy(): void;
}
// NOTE: the raw DocxEditorSession is deliberately NOT exposed. Its undo/redo mutate the store
// directly; calling them outside the mount would bypass the view reprojection, caret restoration,
// and undo-depth bookkeeping, desyncing the view from the model. Undo/redo run only through the
// mount's keymap; consumers read editability via `driver.editable`.

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
    return { driver, destroy: () => container.replaceChildren() };
  }

  // Undo/redo drive the CANONICAL store, not ProseMirror's view history: a structural edit
  // (split/join/insert) deletes/mints block ids, so replaying the view's own history would
  // restore stale ids the mapper rejects. Instead Mod-z/Mod-y rewind the store and reproject.
  // Enter (paragraph split) is handled by the base keymap; the mapper turns it into a DocOp.
  const plugins = [
    keymap({ 'Mod-z': () => doUndo(), 'Mod-y': () => doRedo(), 'Shift-Mod-z': () => doRedo() }),
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
  let destroyed = false; // guards deferred rAF callbacks against a torn-down view
  const paintNow = () => renderModelPreview(session.currentModel(), pagedPane, {}, doc);
  const repaintPaged = () => {
    if (!raf) return paintNow();
    if (repaintQueued) return;
    repaintQueued = true;
    raf(() => {
      repaintQueued = false;
      if (!destroyed) paintNow();
    });
  };

  let reconciling = false;
  let pendingCompositionCommit = false;
  // Our OWN composition flag, held true from compositionstart until the post-compositionend flush.
  // ProseMirror clears `view.composing` and THEN dispatches the final composed transaction, so
  // relying on view.composing would let that last transaction commit early with the wrong anchor.
  let imeComposing = false;
  // The caret BEFORE a deferred IME composition began — so the composition's flushed commit stores
  // the correct pre-edit anchor (undo must return to where the composition started).
  let compositionBeforeSel: SelectionAnchor | undefined;
  const view = new EditorView(editPane, {
    state: EditorState.create({ doc: session.projectDoc(), plugins }),
    editable: () => session.editable,
    // While an IME composition is active, ProseMirror mutates the DOM directly and dispatches
    // interim (and a final) transaction; committing (which would reproject on a rejection)
    // disrupts the IME. Defer every transaction from compositionstart until one flush after
    // compositionend, then commit ONCE with the pre-composition caret.
    handleDOMEvents: {
      compositionstart: () => {
        imeComposing = true;
        compositionBeforeSel = captureSelection(view.state); // caret before the composition
        return false;
      },
      compositionend: () => {
        const win = container.ownerDocument?.defaultView;
        // Let ProseMirror apply its final composition transaction first, then commit once.
        if (win?.requestAnimationFrame) win.requestAnimationFrame(flushComposition);
        else flushComposition();
        return false;
      },
      // If the field loses focus mid-composition (so compositionend may never fire), flush any
      // pending composed edit now so imeComposing can never stick true and freeze future commits.
      blur: () => {
        if (imeComposing) flushComposition();
        return false;
      },
    },
    dispatchTransaction(tr) {
      // Capture the caret BEFORE the edit is applied — the store's model-only history has no
      // selection, so we key a selection by undo depth to restore the pre-edit caret on undo.
      const beforeSel = captureSelection(view.state);
      const next = view.state.apply(tr);
      view.updateState(next);
      if (reconciling || !tr.docChanged) return;
      if (imeComposing) {
        pendingCompositionCommit = true; // defer until the post-compositionend flush
        return;
      }
      commitEdit(beforeSel);
    },
  });

  // Commit a deferred IME composition once, with the pre-composition caret. Idempotent and
  // safe after teardown, so it can be driven from either compositionend's rAF or a mid-
  // composition blur without double-committing or touching a destroyed view.
  function flushComposition() {
    imeComposing = false;
    const before = compositionBeforeSel;
    compositionBeforeSel = undefined;
    if (!pendingCompositionCommit || destroyed) return;
    pendingCompositionCommit = false;
    if (!reconciling) commitEdit(before);
  }

  // Selection history keyed by UNDO-STACK DEPTH (not revision — the store mints a fresh
  // revision on every undo, so a revision key never matches on the way back). selectionAt[d] is
  // the caret to restore when the store's undo stack is at depth d. `undoDepth` mirrors the
  // store's history length: a forward commit increments it, undo decrements, redo increments.
  const selectionAt = new Map<number, SelectionAnchor>();
  let undoDepth = 0;
  selectionAt.set(0, captureSelection(view.state));

  // Map the current view doc to the store. On a refused edit, snap back to the canonical
  // projection (never let the view diverge); on a committed edit, re-tag new paragraphs and
  // repaint the paginated display.
  function commitEdit(beforeSel?: SelectionAnchor) {
    const res = session.applyPmDoc(view.state.doc);
    // A refused edit snaps the view back to the canonical projection so it can never diverge.
    if (res.rejected) reprojectFromModel();
    if (res.committed) {
      if (beforeSel) selectionAt.set(undoDepth, beforeSel); // caret at the level we're leaving
      undoDepth += 1;
      syncSemIds();
      selectionAt.set(undoDepth, captureSelection(view.state)); // post-edit caret (for redo)
      repaintPaged();
    }
  }

  // Replace the view's content with the current canonical projection, restoring the caret from
  // `anchor` (or the current caret) so a snap-back or an undo/redo does not jump the cursor to
  // the top. A deleted/new paragraph collapses to a surviving boundary. History-excluded and
  // reentrancy-guarded so it never re-triggers a commit.
  function reprojectFromModel(anchor?: SelectionAnchor) {
    reconciling = true;
    const a = anchor ?? captureSelection(view.state);
    const canonical = session.projectDoc();
    const tr = view.state.tr
      .replaceWith(0, view.state.doc.content.size, canonical.content)
      .setMeta('addToHistory', false);
    try {
      tr.setSelection(resolveSelection(a, tr.doc));
    } catch {
      // Fall back to the default mapped selection if the anchor cannot be resolved.
    }
    view.dispatch(tr);
    reconciling = false;
  }

  // Mod-z / Mod-y rewind the CANONICAL store and reproject, restoring the caret recorded for the
  // revision we land on; always consume the key so the browser never runs its own contentEditable
  // undo against our managed document.
  function doUndo(): boolean {
    if (session.undo()) {
      undoDepth = Math.max(0, undoDepth - 1);
      reprojectFromModel(selectionAt.get(undoDepth));
      repaintPaged();
    }
    return true;
  }
  function doRedo(): boolean {
    if (session.redo()) {
      undoDepth += 1;
      reprojectFromModel(selectionAt.get(undoDepth));
      repaintPaged();
    }
    return true;
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
  return {
    driver,
    destroy: () => {
      destroyed = true; // stop any queued rAF repaint / composition flush from touching the view
      view.destroy();
    },
  };
}
