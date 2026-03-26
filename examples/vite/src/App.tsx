import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  DocxEditor,
  type DocxEditorRef,
  createEmptyDocument,
  type Document,
} from '@eigenpal/docx-js-editor';
import { ExampleSwitcher } from '../../shared/ExampleSwitcher';
import { GitHubBadge } from '../../shared/GitHubBadge';

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: '#f8fafc',
  },
  // Desktop header - single row
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    gap: '12px',
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  headerCenter: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  // Mobile header - stacked rows
  mobileHeader: {
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
  },
  mobileHeaderTop: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    gap: '6px',
  },
  mobileHeaderFileName: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 10px',
    borderTop: '1px solid #f1f5f9',
    position: 'relative',
  },
  fileName: {
    fontSize: '13px',
    color: '#64748b',
    padding: '4px 10px',
    background: '#f1f5f9',
    borderRadius: '6px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '200px',
  },
  fileInputLabel: {
    padding: '6px 12px',
    background: '#0f172a',
    color: '#fff',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  fileInputHidden: {
    display: 'none',
  },
  button: {
    padding: '6px 12px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: '#334155',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  newButton: {
    padding: '6px 12px',
    background: '#f1f5f9',
    color: '#334155',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  status: {
    fontSize: '12px',
    color: '#64748b',
    padding: '4px 8px',
    background: '#f1f5f9',
    borderRadius: '4px',
  },
  // Mobile menu button (...)
  menuButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    background: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '18px',
    color: '#334155',
    lineHeight: 1,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  // Mobile menu dropdown
  menuDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    padding: '4px',
    zIndex: 200,
    minWidth: '150px',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#334155',
    borderRadius: '6px',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    width: '100%',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
};

function useResponsiveLayout() {
  const calcZoom = () => {
    const pageWidth = 816 + 48; // 8.5in * 96dpi + padding
    const vw = window.innerWidth;
    return vw < pageWidth ? Math.max(0.35, Math.floor((vw / pageWidth) * 20) / 20) : 1.0;
  };

  const [zoom, setZoom] = useState(calcZoom);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => {
      setZoom(calcZoom());
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { zoom, isMobile };
}

const hoverHandlers = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = '#f1f5f9';
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = 'transparent';
  },
};

function ToggleSwitch({
  checked,
  onChange,
  leftLabel,
  rightLabel,
  ariaLabel,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  leftLabel: string;
  rightLabel: string;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
      onClick={onChange}
    >
      <span
        style={{
          fontSize: '12px',
          color: checked ? '#64748b' : '#0f172a',
          fontWeight: checked ? 400 : 600,
          whiteSpace: 'nowrap',
        }}
      >
        {leftLabel}
      </span>
      <div
        style={{
          width: '32px',
          height: '18px',
          borderRadius: '9px',
          background: checked ? '#0f172a' : '#cbd5e1',
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: '#fff',
            position: 'absolute',
            top: '2px',
            left: checked ? '16px' : '2px',
            transition: 'left 0.2s',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}
        />
      </div>
      <span
        style={{
          fontSize: '12px',
          color: checked ? '#0f172a' : '#64748b',
          fontWeight: checked ? 600 : 400,
          whiteSpace: 'nowrap',
        }}
      >
        {rightLabel}
      </span>
    </div>
  );
}

function MobileMenu({
  onFileSelect,
  onNew,
  onSave,
  status,
  readOnly,
  onToggleReadOnly,
  toolbarMode,
  onToggleToolbar,
}: {
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNew: () => void;
  onSave: () => void;
  status: string;
  readOnly: boolean;
  onToggleReadOnly: () => void;
  toolbarMode: 'compact' | 'ribbon';
  onToggleToolbar: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'absolute', right: '10px' }}>
      <button style={styles.menuButton} onClick={() => setOpen(!open)} aria-label="Actions menu">
        ···
      </button>
      {open && (
        <div style={styles.menuDropdown}>
          <label style={styles.menuItem} {...hoverHandlers}>
            <input
              type="file"
              accept=".docx"
              onChange={(e) => {
                onFileSelect(e);
                setOpen(false);
              }}
              style={{ display: 'none' }}
            />
            Open DOCX
          </label>
          <button
            style={styles.menuItem}
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            {...hoverHandlers}
          >
            New
          </button>
          <button
            style={styles.menuItem}
            onClick={() => {
              onSave();
              setOpen(false);
            }}
            {...hoverHandlers}
          >
            Save
          </button>
          <button
            style={styles.menuItem}
            onClick={() => {
              onToggleReadOnly();
              setOpen(false);
            }}
            {...hoverHandlers}
          >
            {readOnly ? 'Switch to Editing' : 'Switch to Read Only'}
          </button>
          <button
            style={styles.menuItem}
            onClick={() => {
              onToggleToolbar();
              setOpen(false);
            }}
            {...hoverHandlers}
          >
            {toolbarMode === 'ribbon' ? 'Switch to Compact' : 'Switch to Ribbon'}
          </button>
          {status && (
            <div style={{ padding: '6px 12px', fontSize: '12px', color: '#64748b' }}>{status}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function App() {
  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const toolbarParam = queryParams.get('toolbar');
  const initialToolbarMode: 'compact' | 'ribbon' = toolbarParam === 'ribbon' ? 'ribbon' : 'compact';
  const readOnlyFromQuery =
    queryParams.get('readOnly') === '1' || queryParams.get('readOnly') === 'true';
  const showToolbarWhenReadOnly =
    queryParams.get('showToolbarWhenReadOnly') !== '0' &&
    queryParams.get('showToolbarWhenReadOnly') !== 'false';
  const demoParam = queryParams.get('demo');
  const shouldLoadDemo = demoParam !== '0' && demoParam !== 'false';
  const randomAuthor = useMemo(
    () => `Docx Editor User ${Math.floor(Math.random() * 900) + 100}`,
    []
  );
  const editorRef = useRef<DocxEditorRef>(null);
  const hasUserDocumentRef = useRef(false);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('docx-editor-demo.docx');
  const [status, setStatus] = useState<string>('');
  const [readOnly, setReadOnly] = useState(readOnlyFromQuery);
  const [toolbarMode, setToolbarMode] = useState<'compact' | 'ribbon'>(initialToolbarMode);
  const { zoom: autoZoom, isMobile } = useResponsiveLayout();

  useEffect(() => {
    let cancelled = false;
    if (!shouldLoadDemo) {
      setCurrentDocument(createEmptyDocument());
      setFileName('Untitled.docx');
      return () => {
        cancelled = true;
      };
    }
    fetch('/docx-editor-demo.docx')
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        if (cancelled || hasUserDocumentRef.current) return;
        setDocumentBuffer(buffer);
        setFileName('docx-editor-demo.docx');
      })
      .catch(() => {
        if (cancelled || hasUserDocumentRef.current) return;
        setCurrentDocument(createEmptyDocument());
        setFileName('Untitled.docx');
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadDemo]);

  const updateQueryParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set(key, value);
    const search = params.toString();
    const url = search
      ? `${window.location.pathname}?${search}${window.location.hash}`
      : `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, '', url);
  }, []);

  const handleNewDocument = useCallback(() => {
    hasUserDocumentRef.current = true;
    setCurrentDocument(createEmptyDocument());
    setDocumentBuffer(null);
    setFileName('Untitled.docx');
    setStatus('');
  }, []);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      hasUserDocumentRef.current = true;
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

  const handleDocumentChange = useCallback((_doc: Document) => {
    // no-op
  }, []);

  const handleError = useCallback((error: Error) => {
    console.error('Editor error:', error);
    setStatus(`Error: ${error.message}`);
  }, []);

  const handleFontsLoaded = useCallback(() => {
    console.log('Fonts loaded');
  }, []);

  const handleToggleToolbar = useCallback(() => {
    setToolbarMode((current) => {
      const next = current === 'compact' ? 'ribbon' : 'compact';
      updateQueryParam('toolbar', next);
      return next;
    });
  }, [updateQueryParam]);

  return (
    <div style={styles.container}>
      {isMobile ? (
        <header style={styles.mobileHeader}>
          <div style={styles.mobileHeaderTop}>
            <GitHubBadge />
            <ExampleSwitcher current="Vite" />
          </div>
          <div style={styles.mobileHeaderFileName}>
            {fileName && <span style={styles.fileName}>{fileName}</span>}
            <MobileMenu
              onFileSelect={handleFileSelect}
              onNew={handleNewDocument}
              onSave={handleSave}
              status={status}
              readOnly={readOnly}
              onToggleReadOnly={() => setReadOnly((v) => !v)}
              toolbarMode={toolbarMode}
              onToggleToolbar={handleToggleToolbar}
            />
          </div>
        </header>
      ) : (
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <GitHubBadge />
            <ExampleSwitcher current="Vite" />
          </div>
          <div style={styles.headerCenter}>
            {fileName && <span style={styles.fileName}>{fileName}</span>}
            <ToggleSwitch
              checked={!readOnly}
              onChange={() => setReadOnly((v) => !v)}
              leftLabel="Viewing"
              rightLabel="Editing"
              ariaLabel="Editing mode"
            />
            <ToggleSwitch
              checked={toolbarMode === 'ribbon'}
              onChange={handleToggleToolbar}
              leftLabel="Compact"
              rightLabel="Ribbon"
              ariaLabel="Toolbar mode"
              testId="toolbar-mode-toggle"
            />
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
              New
            </button>
            <button style={styles.button} onClick={handleSave}>
              Save
            </button>
            {status && <span style={styles.status}>{status}</span>}
          </div>
        </header>
      )}

      <main style={styles.main}>
        <DocxEditor
          ref={editorRef}
          document={documentBuffer ? undefined : currentDocument}
          documentBuffer={documentBuffer}
          author={randomAuthor}
          onChange={handleDocumentChange}
          onError={handleError}
          onFontsLoaded={handleFontsLoaded}
          toolbar={toolbarMode}
          showToolbarWhenReadOnly={showToolbarWhenReadOnly}
          showRuler={!isMobile}
          showZoomControl={true}
          showPageNumbers={false}
          initialZoom={autoZoom}
          readOnly={readOnly}
        />
      </main>
    </div>
  );
}
