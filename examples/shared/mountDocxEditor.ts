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

  const repaintPaged = () => renderModelPreview(session.currentModel(), pagedPane, {}, doc);

  let reconciling = false;
  const view = new EditorView(editPane, {
    state: EditorState.create({ doc: session.projectDoc(), plugins }),
    editable: () => session.editable,
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (reconciling || !tr.docChanged) return;
      const res = session.applyPmDoc(next.doc);
      // If the store refused the edit (a structural change or a read-only block), snap the
      // view's content back to the canonical projection so the view can never diverge from
      // the model. Keep it out of the undo history and guard reentrancy so the prior undo
      // stack and the plugins survive.
      if (res.rejected) {
        reconciling = true;
        const canonical = session.projectDoc();
        view.dispatch(
          view.state.tr.replaceWith(0, view.state.doc.content.size, canonical.content).setMeta('addToHistory', false),
        );
        reconciling = false;
      }
      // A committed edit changed the canonical model — re-tag any new paragraphs with the
      // ids the store minted (so a split's tail keeps identity for the next edit), then
      // repaint the paginated display from the canonical model.
      if (res.committed) {
        syncSemIds();
        repaintPaged();
      }
    },
  });

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
  repaintPaged(); // initial paginated render from the loaded model
  return { session, driver, destroy: () => view.destroy() };
}
