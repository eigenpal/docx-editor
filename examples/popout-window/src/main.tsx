// Pop the editor out into its own browser window, and bring it back.
//
// `DocxEditor.Root` stays in this window, so the document, undo history,
// selection and comments survive every move. `DocxEditor.Window` renders its
// children in a pop-out window while `open` is true, and in place otherwise.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocxEditor } from '@docx-editor.dev/react';
// PRO: comments, suggesting, and tracked changes.
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import '@docx-editor.dev/core/styles/editor.css';

// Created once: the editor reads its modules when it is created.
const modules = [reviewModule()];

function App() {
  const [popped, setPopped] = useState(false);

  return (
    <DocxEditor.Root document="blank" modules={modules} author="Ada Lovelace">
      <DocxEditor.Window open={popped} onClose={() => setPopped(false)}>
        <div className="docx-editor" style={{ height: '100vh' }}>
          <button onClick={() => setPopped(!popped)}>{popped ? 'Bring back' : 'Pop out'}</button>
          <DocxEditor.Toolbar />
          <DocxEditor.Viewport style={{ height: '100%' }}>
            <DocxEditor.Content />
            <DocxEditor.ContextMenu />
            <DocxEditorReview />
          </DocxEditor.Viewport>
        </div>
      </DocxEditor.Window>
    </DocxEditor.Root>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
