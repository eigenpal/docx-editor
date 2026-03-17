'use client';

import { useState, useRef, useCallback } from 'react';

interface RoastStats {
  commentsAdded: number;
  proposalsAdded: number;
  errors: number;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<RoastStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith('.docx')) {
      setError('Please upload a .docx file');
      return;
    }
    setFile(f);
    setError(null);
    setStats(null);
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
    setLoading(true);
    setError(null);
    setStats(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/roast', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Roast failed');
      }

      const statsHeader = response.headers.get('X-Roast-Stats');
      if (statsHeader) {
        setStats(JSON.parse(statsHeader));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `roasted-${file.name}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Roast My Doc</h1>
        <p style={styles.subtitle}>
          Upload a DOCX file and let AI tear it apart with witty comments and tracked change
          suggestions. Open the result in Word to see the carnage.
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
              <div style={styles.fileIcon}>&#128196;</div>
              <div style={styles.fileName}>{file.name}</div>
              <div style={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          ) : (
            <div>
              <div style={styles.uploadIcon}>&#128293;</div>
              <div style={styles.dropText}>Drop your DOCX here</div>
              <div style={styles.dropHint}>or click to browse</div>
            </div>
          )}
        </div>

        <button
          style={{
            ...styles.button,
            ...(loading || !file ? styles.buttonDisabled : {}),
          }}
          onClick={handleRoast}
          disabled={loading || !file}
        >
          {loading ? 'Roasting...' : 'Roast It'}
        </button>

        {error && <div style={styles.error}>{error}</div>}

        {stats && (
          <div style={styles.stats}>
            <div style={styles.statsTitle}>Roast Complete</div>
            <div style={styles.statsGrid}>
              <div style={styles.stat}>
                <div style={styles.statNumber}>{stats.commentsAdded}</div>
                <div style={styles.statLabel}>comments</div>
              </div>
              <div style={styles.stat}>
                <div style={styles.statNumber}>{stats.proposalsAdded}</div>
                <div style={styles.statLabel}>suggestions</div>
              </div>
              {stats.errors > 0 && (
                <div style={styles.stat}>
                  <div style={{ ...styles.statNumber, color: '#ef4444' }}>{stats.errors}</div>
                  <div style={styles.statLabel}>skipped</div>
                </div>
              )}
            </div>
            <div style={styles.statsHint}>Open the downloaded file in Word to see the roast</div>
          </div>
        )}

        <div style={styles.footer}>
          Powered by{' '}
          <a
            href="https://www.npmjs.com/package/@eigenpal/docx-editor-agent-use"
            style={styles.link}
          >
            @eigenpal/docx-editor-agent-use
          </a>
          {' + '}
          <a href="https://docs.anthropic.com" style={styles.link}>
            Claude API
          </a>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    padding: 20,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '48px 40px',
    maxWidth: 480,
    width: '100%',
    textAlign: 'center' as const,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  },
  title: {
    fontSize: 32,
    fontWeight: 800,
    margin: '0 0 8px',
    color: '#1a1a2e',
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    margin: '0 0 32px',
    lineHeight: 1.5,
  },
  dropZone: {
    border: '2px dashed #cbd5e1',
    borderRadius: 12,
    padding: '40px 20px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginBottom: 24,
  },
  dropZoneActive: {
    borderColor: '#e74c3c',
    background: '#fef2f2',
  },
  dropZoneHasFile: {
    borderColor: '#22c55e',
    borderStyle: 'solid' as const,
    background: '#f0fdf4',
  },
  uploadIcon: { fontSize: 48, marginBottom: 8 },
  dropText: { fontSize: 16, fontWeight: 600, color: '#334155' },
  dropHint: { fontSize: 13, color: '#94a3b8', marginTop: 4 },
  fileIcon: { fontSize: 40, marginBottom: 8 },
  fileName: { fontSize: 15, fontWeight: 600, color: '#166534', wordBreak: 'break-all' as const },
  fileSize: { fontSize: 13, color: '#64748b', marginTop: 4 },
  button: {
    width: '100%',
    padding: '14px 24px',
    fontSize: 16,
    fontWeight: 700,
    color: '#fff',
    background: 'linear-gradient(135deg, #e74c3c, #c0392b)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 20,
  },
  stats: {
    background: '#f0fdf4',
    borderRadius: 12,
    padding: '20px',
    marginBottom: 20,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#166534',
    marginBottom: 12,
  },
  statsGrid: {
    display: 'flex',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 8,
  },
  stat: { textAlign: 'center' as const },
  statNumber: { fontSize: 28, fontWeight: 800, color: '#166534' },
  statLabel: { fontSize: 12, color: '#64748b', textTransform: 'uppercase' as const },
  statsHint: { fontSize: 13, color: '#64748b', marginTop: 8 },
  footer: {
    fontSize: 13,
    color: '#94a3b8',
  },
  link: {
    color: '#3b82f6',
    textDecoration: 'none',
  },
};
