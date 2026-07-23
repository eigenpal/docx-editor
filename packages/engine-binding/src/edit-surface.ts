// ProseMirror edit-surface mount (document-engine 4.2 / comprehensive 4.2). The PM-aware half of the
// editor, moved out of examples into the sole PM-integration package: it mounts a minimal
// ProseMirror EditorView into a host element and turns every change into ONE DocOp transaction
// against the canonical store (through the session). It does NOT paint — layout/display is the
// caller's concern (engine-binding may not import engine-layout/output) — it just calls
// `onModelChanged` after each committed edit / undo / redo so the caller repaints from
// `session.currentModel()`. The returned handle is PM-FREE, so a PM-free Editor facade can own it
// without leaking the view.
//
// Text insertion, deletion, selection, Backspace/Delete (paragraph join), paragraph SPLIT (Enter),
// and undo/redo run through the PM base keymap + our store-backed history; every resulting change
// maps to DocOps. A split mints a new tail block in the store; after the commit the view re-tags its
// projected paragraphs with the store's ids by position, so identity and the caret survive without a
// full reprojection. Multi-paragraph paste and block reorder still fail closed and snap back.

import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { captureSelection, resolveSelection, type SelectionAnchor } from './selection.ts';
import type { DocxEditorSession } from './session.ts';

/** A PM-FREE handle to a mounted edit surface — no EditorView or PM type leaks out. */
export interface EditSurface {
  /** Whether this surface is actually editable (false when the session opened read-only). */
  readonly editable: boolean;
  /** Move focus into the edit surface. */
  focus(): void;
  /** Tear down the view and stop any deferred callback from touching it. */
  destroy(): void;
}

export interface MountEditSurfaceOptions {
  /** Called after every committed edit, undo, or redo — the caller repaints from
   *  `session.currentModel()`. Not called for a rejected (snapped-back) edit. */
  onModelChanged?: () => void;
}

/** Mount a ProseMirror edit surface for `session` into `editHost`. When the session is read-only the
 *  surface mounts nothing and reports `editable: false` (the caller renders a read-only preview). */
export function mountEditSurface(
  editHost: HTMLElement,
  session: DocxEditorSession,
  options: MountEditSurfaceOptions = {},
): EditSurface {
  if (!session.editable) {
    return { editable: false, focus: () => {}, destroy: () => {} };
  }
  const onModelChanged = options.onModelChanged ?? (() => {});

  // Undo/redo drive the CANONICAL store, not ProseMirror's view history: a structural edit
  // (split/join/insert) deletes/mints block ids, so replaying the view's own history would restore
  // stale ids the mapper rejects. Instead Mod-z/Mod-y rewind the store and reproject. Enter
  // (paragraph split) is handled by the base keymap; the mapper turns it into a DocOp.
  const plugins = [
    keymap({ 'Mod-z': () => doUndo(), 'Mod-y': () => doRedo(), 'Shift-Mod-z': () => doRedo() }),
    keymap(baseKeymap),
  ];

  let reconciling = false;
  let pendingCompositionCommit = false;
  let destroyed = false; // guards deferred composition flush against a torn-down view
  // Our OWN composition flag, held true from compositionstart until the post-compositionend flush.
  // ProseMirror clears `view.composing` and THEN dispatches the final composed transaction, so
  // relying on view.composing would let that last transaction commit early with the wrong anchor.
  let imeComposing = false;
  // The caret BEFORE a deferred IME composition began — so the composition's flushed commit stores
  // the correct pre-edit anchor (undo must return to where the composition started).
  let compositionBeforeSel: SelectionAnchor | undefined;

  const view = new EditorView(editHost, {
    state: EditorState.create({ doc: session.projectDoc(), plugins }),
    editable: () => session.editable,
    // While an IME composition is active, ProseMirror mutates the DOM directly and dispatches
    // interim (and a final) transaction; committing (which would reproject on a rejection) disrupts
    // the IME. Defer every transaction from compositionstart until one flush after compositionend,
    // then commit ONCE with the pre-composition caret.
    handleDOMEvents: {
      compositionstart: () => {
        imeComposing = true;
        compositionBeforeSel = captureSelection(view.state); // caret before the composition
        return false;
      },
      compositionend: () => {
        const win = editHost.ownerDocument?.defaultView;
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

  // Commit a deferred IME composition once, with the pre-composition caret. Idempotent and safe
  // after teardown, so it can be driven from either compositionend's rAF or a mid-composition blur
  // without double-committing or touching a destroyed view.
  function flushComposition() {
    imeComposing = false;
    const before = compositionBeforeSel;
    compositionBeforeSel = undefined;
    if (!pendingCompositionCommit || destroyed) return;
    pendingCompositionCommit = false;
    if (!reconciling) commitEdit(before);
  }

  // Selection history keyed by UNDO-STACK DEPTH (not revision — the store mints a fresh revision on
  // every undo, so a revision key never matches on the way back). selectionAt[d] is the caret to
  // restore when the store's undo stack is at depth d. `undoDepth` mirrors the store's history
  // length: a forward commit increments it, undo decrements, redo increments.
  const selectionAt = new Map<number, SelectionAnchor>();
  let undoDepth = 0;
  selectionAt.set(0, captureSelection(view.state));

  // Map the current view doc to the store. On a refused edit, snap back to the canonical projection
  // (never let the view diverge); on a committed edit, re-tag new paragraphs and notify the caller.
  function commitEdit(beforeSel?: SelectionAnchor) {
    const res = session.applyPmDoc(view.state.doc);
    if (res.rejected) reprojectFromModel(); // a refused edit snaps the view back so it can never diverge
    if (res.committed) {
      if (beforeSel) selectionAt.set(undoDepth, beforeSel); // caret at the level we're leaving
      undoDepth += 1;
      syncSemIds();
      selectionAt.set(undoDepth, captureSelection(view.state)); // post-edit caret (for redo)
      onModelChanged();
    }
  }

  // Replace the view's content with the current canonical projection, restoring the caret from
  // `anchor` (or the current caret) so a snap-back or an undo/redo does not jump the cursor to the
  // top. History-excluded and reentrancy-guarded so it never re-triggers a commit.
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
  // level we land on; always consume the key so the browser never runs its own contentEditable undo.
  function doUndo(): boolean {
    if (session.undo()) {
      undoDepth = Math.max(0, undoDepth - 1);
      reprojectFromModel(selectionAt.get(undoDepth));
      onModelChanged();
    }
    return true;
  }
  function doRedo(): boolean {
    if (session.redo()) {
      undoDepth += 1;
      reprojectFromModel(selectionAt.get(undoDepth));
      onModelChanged();
    }
    return true;
  }

  // Re-tag the view's projected paragraphs with the canonical block ids by position. After a split
  // the store mints a new tail id; the PM tail still reads semId=null. One attribute-only,
  // history-excluded transaction reconciles identity WITHOUT reprojecting the whole document, so the
  // caret and undo stack are untouched.
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

  return {
    editable: true,
    focus: () => view.focus(),
    destroy: () => {
      destroyed = true; // stop any queued composition flush from touching the view
      view.destroy();
    },
  };
}
