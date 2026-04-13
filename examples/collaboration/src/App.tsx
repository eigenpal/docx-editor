import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-js-editor';
import { GitHubBadge } from '../../shared/GitHubBadge';
import { AvatarStack } from './AvatarStack';
import { useCollaboration } from './useCollaboration';
import { getOrCreateRoomFromUrl, loadOrCreateUser } from './identity';

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: '#f8fafc',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  status: {
    fontSize: 12,
    color: '#64748b',
    padding: '4px 8px',
    background: '#f1f5f9',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  },
  shareButton: {
    padding: '6px 12px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    whiteSpace: 'nowrap',
  },
};

const statusDotStyle = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  display: 'inline-block',
  marginRight: 6,
});

function useResponsiveLayout() {
  const calcZoom = () => {
    const pageWidth = 816 + 48;
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

export function App() {
  const [user] = useState(loadOrCreateUser);
  const [room] = useState(getOrCreateRoomFromUrl);
  const [shareCopied, setShareCopied] = useState(false);

  const { plugins, users, status, comments, setComments } = useCollaboration(room, user);
  const { zoom: autoZoom, isMobile } = useResponsiveLayout();

  // Empty document acts purely as a schema seed. ySyncPlugin populates the real
  // content from the Y.Doc, which is why we set externalContent on the editor.
  const seedDocument = useMemo(() => createEmptyDocument(), []);

  const handleCopyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      setShareCopied(false);
    }
  }, []);

  const renderLogo = useCallback(() => <GitHubBadge />, []);

  const renderTitleBarRight = useCallback(
    () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <AvatarStack users={users} />
        <span style={styles.status} title={`Room: ${room}`}>
          <span
            style={statusDotStyle(
              status === 'connected' ? '#22c55e' : status === 'connecting' ? '#eab308' : '#ef4444'
            )}
          />
          {status === 'connected'
            ? `Live · ${room}`
            : status === 'connecting'
              ? 'Connecting…'
              : 'Offline'}
        </span>
        <button style={styles.shareButton} onClick={handleCopyShareLink}>
          {shareCopied ? 'Link copied!' : 'Share link'}
        </button>
      </div>
    ),
    [users, room, status, handleCopyShareLink, shareCopied]
  );

  return (
    <div style={styles.container}>
      <main style={styles.main}>
        <DocxEditor
          document={seedDocument}
          externalContent
          externalPlugins={plugins}
          comments={comments}
          onCommentsChange={setComments}
          author={user.name}
          showToolbar
          showRuler={!isMobile}
          showZoomControl
          initialZoom={autoZoom}
          renderLogo={renderLogo}
          documentName={`Shared document — ${room}`}
          renderTitleBarRight={renderTitleBarRight}
        />
      </main>
    </div>
  );
}
