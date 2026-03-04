import { useRef, useState, useCallback } from 'react';
import {
  DocxEditor,
  type DocxEditorRef,
  PluginHost,
  createEmptyDocument,
} from '@eigenpal/docx-js-editor';
import { wordCountPlugin } from './wordCountPlugin';

export function App() {
  const editorRef = useRef<DocxEditorRef>(null);
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setDocumentBuffer(await file.arrayBuffer());
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Hello World Plugin</h1>
        <label
          style={{
            padding: '6px 12px',
            background: '#0f172a',
            color: '#fff',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <input
            type="file"
            accept=".docx"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          Open DOCX
        </label>
      </header>

      <main style={{ flex: 1, overflow: 'hidden' }}>
        <PluginHost plugins={[wordCountPlugin]}>
          <DocxEditor
            ref={editorRef}
            document={documentBuffer ? undefined : createEmptyDocument()}
            documentBuffer={documentBuffer ?? undefined}
            showToolbar
            showRuler
          />
        </PluginHost>
      </main>
    </div>
  );
}
