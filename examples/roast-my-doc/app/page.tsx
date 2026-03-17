'use client';

import { useState, useRef, useCallback } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-js-editor';

type Phase = 'upload' | 'roasting' | 'result';

interface RoastStats {
  commentsAdded: number;
  proposalsAdded: number;
  errors: number;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [roastedBuffer, setRoastedBuffer] = useState<ArrayBuffer | null>(null);
  const [stats, setStats] = useState<RoastStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [roastMessage, setRoastMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<DocxEditorRef>(null);

  const roastMessages = [
    'Reading your masterpiece...',
    'Sharpening the red pen...',
    'Finding things to roast...',
    'Composing witty remarks...',
    'Adding spicy comments...',
    'Almost done destroying your confidence...',
  ];

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith('.docx')) {
      setError('Please upload a .docx file');
      return;
    }
    setFile(f);
    setError(null);
    setStats(null);
    setRoastedBuffer(null);
    setPhase('upload');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleRoast = async () => {
    if (!file) return;
    setPhase('roasting');
    setError(null);

    let msgIndex = 0;
    setRoastMessage(roastMessages[0]);
    const interval = setInterval(() => {
      msgIndex = (msgIndex + 1) % roastMessages.length;
      setRoastMessage(roastMessages[msgIndex]);
    }, 2500);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/roast', {
        method: 'POST',
        body: formData,
      });

      clearInterval(interval);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Roast failed');
      }

      const statsHeader = response.headers.get('X-Roast-Stats');
      if (statsHeader) {
        setStats(JSON.parse(statsHeader));
      }

      const buffer = await response.arrayBuffer();
      setRoastedBuffer(buffer);
      setPhase('result');
    } catch (err) {
      clearInterval(interval);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('upload');
    }
  };

  const handleDownload = () => {
    if (!roastedBuffer || !file) return;
    const blob = new Blob([roastedBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roasted-${file.name}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStartOver = () => {
    setPhase('upload');
    setFile(null);
    setRoastedBuffer(null);
    setStats(null);
    setError(null);
  };

  // ── ROASTING PHASE ──
  if (phase === 'roasting') {
    return (
      <div style={styles.fullScreen}>
        <style>{keyframes}</style>
        <div style={styles.roastingCard}>
          <div style={styles.fireEmoji}>&#128293;</div>
          <div style={styles.roastingTitle}>Roasting...</div>
          <div style={styles.roastingMessage}>{roastMessage}</div>
          <div style={styles.spinner} />
        </div>
      </div>
    );
  }

  // ── RESULT PHASE — show roasted doc in the editor ──
  if (phase === 'result' && roastedBuffer) {
    return (
      <div style={styles.resultContainer}>
        <div style={styles.resultHeader}>
          <div style={styles.resultHeaderLeft}>
            <span style={{ fontSize: 24 }}>&#128293;</span>
            <span style={styles.resultTitle}>Roast Complete</span>
            {stats && (
              <span style={styles.resultStats}>
                {stats.commentsAdded} comments &middot; {stats.proposalsAdded} suggestions
                {stats.errors > 0 ? ` \u00b7 ${stats.errors} skipped` : ''}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.downloadBtn} onClick={handleDownload}>
              Download .docx
            </button>
            <button style={styles.startOverBtn} onClick={handleStartOver}>
              Roast another
            </button>
          </div>
        </div>
        <div style={styles.editorWrap}>
          <DocxEditor ref={editorRef} documentBuffer={roastedBuffer} />
        </div>
      </div>
    );
  }

  // ── UPLOAD PHASE ──
  return (
    <div style={styles.fullScreen}>
      <style>{keyframes}</style>
      <div style={styles.uploadCard}>
        <div style={{ fontSize: 64, marginBottom: 4 }}>&#128293;</div>
        <h1 style={styles.title}>Roast My Doc</h1>
        <p style={styles.subtitle}>
          Upload a DOCX and let AI tear it apart with witty comments and tracked change suggestions.
          See the results live in the editor.
        </p>

        <div
          style={{
            ...styles.dropZone,
            ...(dragOver ? styles.dropZoneActive : {}),
            ...(file ? styles.dropZoneHasFile : {}),
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {file ? (
            <div>
              <div style={{ fontSize: 40, marginBottom: 8 }}>&#128196;</div>
              <div style={styles.fileName}>{file.name}</div>
              <div style={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 48, marginBottom: 8 }}>&#128293;</div>
              <div style={styles.dropText}>Drop your DOCX here</div>
              <div style={styles.dropHint}>or click to browse</div>
            </div>
          )}
        </div>

        <button
          style={{
            ...styles.roastButton,
            ...(file ? {} : styles.roastButtonDisabled),
          }}
          onClick={handleRoast}
          disabled={!file}
        >
          ROAST IT
        </button>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>
          Powered by{' '}
          <a
            href="https://www.npmjs.com/package/@eigenpal/docx-editor-agent-use"
            style={styles.link}
          >
            @eigenpal/docx-editor-agent-use
          </a>
          {' + '}
          <a href="https://platform.openai.com" style={styles.link}>
            OpenAI
          </a>
        </div>
      </div>
    </div>
  );
}

const keyframes = `
@keyframes spin {
  to { transform: rotate(360deg); }
}
`;

const styles: Record<string, React.CSSProperties> = {
  fullScreen: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    padding: 20,
  },
  uploadCard: {
    background: '#fff',
    borderRadius: 20,
    padding: '48px 40px',
    maxWidth: 500,
    width: '100%',
    textAlign: 'center' as const,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  },
  title: { fontSize: 36, fontWeight: 900, margin: '0 0 8px', color: '#1a1a2e' },
  subtitle: { fontSize: 15, color: '#64748b', margin: '0 0 32px', lineHeight: 1.6 },
  dropZone: {
    border: '2px dashed #cbd5e1',
    borderRadius: 14,
    padding: '40px 20px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginBottom: 24,
  },
  dropZoneActive: { borderColor: '#e74c3c', background: '#fef2f2' },
  dropZoneHasFile: {
    borderColor: '#22c55e',
    borderStyle: 'solid' as const,
    background: '#f0fdf4',
  },
  dropText: { fontSize: 16, fontWeight: 600, color: '#334155' },
  dropHint: { fontSize: 13, color: '#94a3b8', marginTop: 4 },
  fileName: { fontSize: 15, fontWeight: 600, color: '#166534', wordBreak: 'break-all' as const },
  fileSize: { fontSize: 13, color: '#64748b', marginTop: 4 },
  roastButton: {
    width: '100%',
    padding: '18px 24px',
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: 2,
    color: '#fff',
    background: 'linear-gradient(135deg, #e74c3c, #c0392b)',
    border: 'none',
    borderRadius: 14,
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginBottom: 20,
    boxShadow: '0 4px 14px rgba(231, 76, 60, 0.4)',
  },
  roastButtonDisabled: { opacity: 0.35, cursor: 'not-allowed', boxShadow: 'none' },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 20,
  },
  footer: { fontSize: 13, color: '#94a3b8' },
  link: { color: '#3b82f6', textDecoration: 'none' },
  // Roasting
  roastingCard: {
    background: '#fff',
    borderRadius: 20,
    padding: '60px 48px',
    maxWidth: 420,
    width: '100%',
    textAlign: 'center' as const,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  },
  fireEmoji: { fontSize: 72, marginBottom: 16 },
  roastingTitle: { fontSize: 28, fontWeight: 900, color: '#1a1a2e', marginBottom: 8 },
  roastingMessage: { fontSize: 15, color: '#64748b', marginBottom: 32, minHeight: 22 },
  spinner: {
    width: 40,
    height: 40,
    border: '4px solid #f1f5f9',
    borderTop: '4px solid #e74c3c',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 0.8s linear infinite',
  },
  // Result
  resultContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    overflow: 'hidden',
    background: '#f8fafc',
  },
  resultHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
    flexShrink: 0,
  },
  resultHeaderLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  resultTitle: { fontSize: 16, fontWeight: 800, color: '#1a1a2e' },
  resultStats: { fontSize: 13, color: '#64748b', marginLeft: 8 },
  downloadBtn: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    background: '#e74c3c',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  startOverBtn: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  editorWrap: { flex: 1, overflow: 'hidden' },
};
