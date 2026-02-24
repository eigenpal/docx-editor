import React, { useState, useRef, useCallback } from 'react';
import {
  DocxEditor,
  type DocxEditorRef,
  createEmptyDocument,
  type Document,
  PluginHost,
  templatePlugin,
} from '@eigenpal/docx-js-editor';

function createTemplateDocument(): Document {
  const doc = createEmptyDocument();
  const body = doc.package.document;

  if (body.content.length > 0 && body.content[0].type === 'paragraph') {
    body.content[0].content = [
      {
        type: 'run',
        content: [{ type: 'text', text: 'Dear {name},' }],
      },
    ];
  }

  body.content.push(
    { type: 'paragraph', content: [], formatting: {} },
    {
      type: 'paragraph',
      content: [
        {
          type: 'run',
          content: [{ type: 'text', text: 'Thank you for your order. Here are your items:' }],
        },
      ],
      formatting: {},
    },
    { type: 'paragraph', content: [], formatting: {} },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: '{#items}' }] }],
      formatting: {},
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'run',
          content: [
            { type: 'text', text: '  \u2022 {items.name} - ${items.price} x {items.quantity}' },
          ],
        },
      ],
      formatting: {},
    },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: '{/items}' }] }],
      formatting: {},
    },
    { type: 'paragraph', content: [], formatting: {} },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: '{#hasDiscount}' }] }],
      formatting: {},
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'run',
          content: [{ type: 'text', text: 'Discount applied: {discountPercent}%' }],
        },
      ],
      formatting: {},
    },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: '{/hasDiscount}' }] }],
      formatting: {},
    },
    { type: 'paragraph', content: [], formatting: {} },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: 'Total: ${total}' }] }],
      formatting: {},
    },
    { type: 'paragraph', content: [], formatting: {} },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: 'Best regards,' }] }],
      formatting: {},
    },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: '{company.name}' }] }],
      formatting: {},
    }
  );

  return doc;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: '#f8fafc',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    margin: 0,
    color: '#0f172a',
    letterSpacing: '-0.025em',
    whiteSpace: 'nowrap',
  },
  titleLink: {
    textDecoration: 'none',
    color: 'inherit',
  },
  badge: {
    fontSize: '11px',
    color: '#fff',
    padding: '3px 8px',
    background: '#3b82f6',
    borderRadius: '4px',
    fontWeight: 500,
  },
  fileName: {
    fontSize: '13px',
    color: '#64748b',
    padding: '4px 10px',
    background: '#f1f5f9',
    borderRadius: '6px',
  },
  fileInputLabel: {
    padding: '8px 14px',
    background: '#0f172a',
    color: '#fff',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'background 0.15s',
  },
  fileInputHidden: {
    display: 'none',
  },
  button: {
    padding: '8px 14px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: '#334155',
    transition: 'all 0.15s',
  },
  newButton: {
    padding: '8px 14px',
    background: '#f1f5f9',
    color: '#334155',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  status: {
    fontSize: '12px',
    color: '#64748b',
    padding: '4px 8px',
    background: '#f1f5f9',
    borderRadius: '4px',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
};

export function App() {
  const editorRef = useRef<DocxEditorRef>(null);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(() =>
    createTemplateDocument()
  );
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('template.docx');
  const [status, setStatus] = useState<string>('');

  const handleNewDocument = useCallback(() => {
    setCurrentDocument(createTemplateDocument());
    setDocumentBuffer(null);
    setFileName('template.docx');
    setStatus('');
  }, []);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setStatus('Loading...');
      const buffer = await file.arrayBuffer();
      setCurrentDocument(null);
      setDocumentBuffer(buffer);
      setFileName(file.name);
      setStatus('');
    } catch {
      setStatus('Error loading file');
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;

    try {
      setStatus('Saving...');
      const buffer = await editorRef.current.save();
      if (buffer) {
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'document.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('Saved!');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch {
      setStatus('Save failed');
    }
  }, [fileName]);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <a
            href="https://github.com/eigenpal/docx-js-editor"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.titleLink}
          >
            <h1 style={styles.title}>@eigenpal/docx-js-editor</h1>
          </a>
          <span style={styles.badge}>Docxtemplater Plugin</span>
          {fileName && <span style={styles.fileName}>{fileName}</span>}
        </div>
        <div style={styles.headerRight}>
          <label style={styles.fileInputLabel}>
            <input
              type="file"
              accept=".docx"
              onChange={handleFileSelect}
              style={styles.fileInputHidden}
            />
            Open DOCX
          </label>
          <button style={styles.newButton} onClick={handleNewDocument}>
            New Template
          </button>
          <button style={styles.button} onClick={handleSave}>
            Save
          </button>
          {status && <span style={styles.status}>{status}</span>}
        </div>
      </header>

      <main style={styles.main}>
        <PluginHost plugins={[templatePlugin]}>
          <DocxEditor
            ref={editorRef}
            document={documentBuffer ? undefined : currentDocument}
            documentBuffer={documentBuffer}
            onChange={() => {}}
            onError={(error: Error) => {
              console.error('Editor error:', error);
              setStatus(`Error: ${error.message}`);
            }}
            onFontsLoaded={() => console.log('Fonts loaded')}
            showToolbar={true}
            showRuler={true}
            showZoomControl={true}
            showPageNumbers={false}
            initialZoom={1.0}
          />
        </PluginHost>
      </main>
    </div>
  );
}
