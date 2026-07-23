// Framework-agnostic DOCX editor mount (queue item 3). The one implementation the React
// and Vue editable components share, so both adapters have identical load/edit/save
// behavior. An editable (paragraph-only) document mounts a minimal ProseMirror view whose
// every change maps to one DocOp transaction against the canonical store; a document with
// tables/SDTs opens READ-ONLY through the engine preview (real geometry, nothing
// flattened). Exposes an engine-neutral EditorDriver for browser smoke tests.
//
// Text insertion, deletion, selection, Enter (split), Backspace/Delete (join), and undo/
// redo are handled by the ProseMirror base keymap + history; every resulting change maps
// to DocOps. Rich formatting and structural editing are later increments.

import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { openDocxSession, type DocxEditorSession } from './docxEditorSession.ts';
import { renderDocxPreview } from './enginePreview.ts';

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

  const view = new EditorView(container, {
    state: EditorState.create({
      doc: session.projectDoc(),
      plugins: [
        history(),
        keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
        keymap(baseKeymap),
      ],
    }),
    editable: () => session.editable,
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (!tr.docChanged) return;
      const res = session.applyPmDoc(next.doc);
      // If the store refused the edit (it would disturb a read-only block), snap the view
      // back to the canonical projection so the view can never diverge from the model.
      if (res.rejected) view.updateState(EditorState.create({ doc: session.projectDoc() }));
    },
  });
  container.classList.add('docx-editable');
  return { session, driver, destroy: () => view.destroy() };
}
