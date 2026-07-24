// Browser harness for the PRODUCTION React adapter (comprehensive 4.4/4.8). Unlike DocxEditable
// (which drives the engine mount directly), this renders the real @docx-editor.dev/react DocxEditor
// with DOCX bytes and exposes the stable engine-neutral EditorDriver on window, so a browser test
// exercises the actual published package entry: props -> createEditor -> layout -> paint -> save.

import React, { useEffect, useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import { createEditorDriver, type EditorDriver } from '@docx-editor.dev/engine-editor';
import type { Editor } from '@docx-editor.dev/react';

declare global {
  interface Window {
    __docxAdapterDriver?: EditorDriver;
    __docxAdapterHarness?: {
      setZoom(zoom: number): void;
      getZoom(): number;
    };
  }
}

export function DocxAdapterHarness({
  fixtureUrl,
  initialZoom = 1,
}: {
  readonly fixtureUrl: string;
  readonly initialZoom?: number;
}): React.ReactElement {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [zoom, setZoom] = useState(initialZoom);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const b = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
        if (!cancelled) setBytes(b);
      } catch (e) {
        if (!cancelled) setStatus(`Could not fetch fixture (${(e as Error).message}).`);
      }
    })();
    return () => {
      cancelled = true;
      delete window.__docxAdapterDriver;
      delete window.__docxAdapterHarness;
    };
  }, [fixtureUrl]);

  useEffect(() => {
    window.__docxAdapterHarness = {
      setZoom: (next) => setZoom(next),
      getZoom: () => zoom,
    };
  }, [zoom]);

  const onReady = (editor: Editor): void => {
    const driver = createEditorDriver(editor);
    window.__docxAdapterDriver = driver;
    setStatus(driver.editable() ? 'Editable (paragraphs)' : 'Read-only (contains tables/SDTs)');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '8px 12px', font: '13px system-ui, sans-serif', color: '#333', borderBottom: '1px solid #e0e0e0' }}>
        <span data-testid="adapter-status">{status}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
        {bytes && <DocxEditor document={bytes} zoom={zoom} onReady={onReady} />}
      </div>
    </div>
  );
}
