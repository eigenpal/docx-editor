// Pop the editor panel out into its own browser window and bring it back.
//
// `DocxEditor.Root` stays in this window for the whole session, so the editor instance, its
// undo history, selection and any collaboration session survive every move.
// `DocxEditor.Window` renders the panel in the pop-out while `popped` is true.

import { useEffect, useState } from 'react';
import { DocxEditor, useEditorState } from '@docx-editor.dev/react';
// PRO: comments and tracked changes, to show the review chrome working in the pop-out too.
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';

/** Read once, when the instance is created: a stable array keeps the editor from remounting. */
const MODULES = [reviewModule()];

function UndoStatus() {
  const canUndo = useEditorState((snapshot) => snapshot.canUndo);
  return (
    <span className="popout-demo-status">{canUndo ? 'Undo available' : 'Nothing to undo'}</span>
  );
}

/** The pop-out demo: one editor, two windows. */
export function PopoutDemo({ fixtureUrl }: { fixtureUrl: string }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [popped, setPopped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(fixtureUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (!cancelled) setBytes(new Uint8Array(buffer));
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureUrl]);

  if (!bytes) return <p className="popout-demo-loading">Loading document…</p>;

  return (
    <DocxEditor.Root document={bytes} modules={MODULES} author="Demo Reviewer">
      <main className="popout-demo">
        {popped ? (
          <p className="popout-demo-placeholder">
            The editor is open in another window. Edit there, then bring it back: the undo history,
            the caret and the selection come with it.
          </p>
        ) : null}
        <DocxEditor.Window
          open={popped}
          onClose={() => setPopped(false)}
          // A served blank page rather than `about:blank`, so browser automation can drive it.
          url={`${import.meta.env.BASE_URL}popout.html`}
          title="Document (pop-out)"
        >
          <div className="docx-editor popout-demo-panel">
            <div className="popout-demo-bar">
              <button type="button" onClick={() => setPopped(!popped)}>
                {popped ? 'Bring back' : 'Pop out'}
              </button>
              <UndoStatus />
            </div>
            <DocxEditor.Toolbar />
            <DocxEditor.Viewport style={{ flex: 1, minHeight: 0 }}>
              <DocxEditor.HeaderFooterChrome />
              <DocxEditor.Content />
              <DocxEditor.ContextMenu />
              <DocxEditor.HyperLink />
              <DocxEditorReview />
            </DocxEditor.Viewport>
          </div>
        </DocxEditor.Window>
      </main>
    </DocxEditor.Root>
  );
}
