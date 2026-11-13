import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { DocxEditor, useDocxEditor, useFonts } from '@docx-editor.dev/react';
import type { DocumentSource } from '@docx-editor.dev/core/contracts/editor';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { ReviewPanel, reviewModule } from '@gw/docx-review';
import '@docx-editor.dev/core/styles/editor.css';
import '@gw/docx-review/styles.css';

const MODULES = new URLSearchParams(location.search).has('nomodule') ? [] : [reviewModule()];

/** Exposes the editor to the end-to-end probes. */
function TestBridge() {
  const editor = useDocxEditor();
  useEffect(() => {
    (window as unknown as { __editor: unknown }).__editor = editor;
  }, [editor]);
  return null;
}

function App() {
  const [doc, setDoc] = useState<DocumentSource>();
  const fonts = useFonts(packagedFonts());
  useEffect(() => {
    void fetch('/test.docx')
      .then((r) => r.arrayBuffer())
      .then(setDoc);
  }, []);
  return (
    <DocxEditor.Root
      {...(doc ? { document: doc } : {})}
      fonts={fonts}
      modules={MODULES}
      author="Advisor"
    >
      <TestBridge />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DocxEditor.Toolbar>
          <DocxEditor.Toolbar.Group id="review">
            <DocxEditor.Toolbar.AddComment />
          </DocxEditor.Toolbar.Group>
        </DocxEditor.Toolbar>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <DocxEditor.Viewport style={{ flex: 1, minWidth: 0 }}>
            <DocxEditor.Content />
          </DocxEditor.Viewport>
          <div style={{ width: 320, borderLeft: '1px solid #ddd' }}>
            <ReviewPanel />
          </div>
        </div>
      </div>
    </DocxEditor.Root>
  );
}
createRoot(document.getElementById('app')!).render(<App />);
