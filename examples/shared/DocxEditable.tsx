// React editable-preview component (queue item 3). Thin wrapper over the shared
// framework-agnostic mount: fetches a DOCX, mounts the editor (or read-only preview), and
// exposes the engine-neutral EditorDriver on window for the browser smoke test. Its Vue
// counterpart is DocxEditable.vue — the two MUST stay behavior-identical.

import React, { useEffect, useRef, useState } from 'react';
import { mountDocxEditor, type EditorDriver } from './mountDocxEditor.ts';

declare global {
  interface Window {
    __docxEditorDriver?: EditorDriver;
  }
}

export interface DocxEditableProps {
  readonly fixtureUrl: string;
}

export function DocxEditable({ fixtureUrl }: DocxEditableProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('Loading…');
  const [reopened, setReopened] = useState<string | null>(null);

  useEffect(() => {
    let mounted: ReturnType<typeof mountDocxEditor> | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const bytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
        if (cancelled || !host.current) return;
        host.current.replaceChildren();
        mounted = mountDocxEditor(host.current, bytes);
        window.__docxEditorDriver = mounted.driver;
        setStatus(mounted.session.editable ? 'Editable (paragraphs)' : 'Read-only (contains tables/SDTs)');
      } catch (e) {
        if (!cancelled) setStatus(`Could not open this file (${(e as Error).message}).`);
      }
    })();
    return () => {
      cancelled = true;
      mounted?.destroy();
      if (window.__docxEditorDriver === mounted?.driver) delete window.__docxEditorDriver;
    };
  }, [fixtureUrl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', font: '13px system-ui, sans-serif', color: '#333', borderBottom: '1px solid #e0e0e0' }}>
        <span data-testid="editor-status">{status}</span>
        <button
          type="button"
          data-testid="save-reopen"
          onClick={() => setReopened(window.__docxEditorDriver?.saveAndReopenText() ?? '')}
          style={{ font: 'inherit', padding: '4px 10px', cursor: 'pointer' }}
        >
          Save &amp; reopen
        </button>
        {reopened !== null && (
          <span data-testid="reopened-text" style={{ color: '#555' }}>
            Reopened: {reopened.replace(/\n/g, ' / ')}
          </span>
        )}
      </div>
      <div ref={host} data-testid="editor-host" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px', outline: 'none' }} />
    </div>
  );
}
