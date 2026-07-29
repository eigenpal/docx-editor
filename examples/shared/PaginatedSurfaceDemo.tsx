// The DEFAULT editor surface: painted pages from semantic layout records.
//
// Mounted through the PACKAGED React host, not the engine mount, so what the demo exercises
// is the adapter a consumer installs. Driving the engine directly proved the engine and left
// the adapter untested in a browser.

import { useEffect, useRef, useState } from 'react';
import type { PaginatedSurfaceState, TextMeasurer } from '@docx-editor.dev/engine-editor';
import { PaginatedDocxEditorShell } from '@docx-editor.dev/react';
import { createExactMeasurer } from './exactMeasurer.ts';

/** Layout units (points) to CSS pixels, at 96 dpi. */
const SCALE = 96 / 72;

export function PaginatedSurfaceDemo({ fixtureUrl }: { fixtureUrl: string }) {
  const editorRef = useRef<PaginatedDocxEditorHandle | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [state, setState] = useState<PaginatedSurfaceState | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [source, setSource] = useState<Uint8Array | null>(null);
  const [measurer, setMeasurer] = useState<TextMeasurer | null>(null);
  const [fontFamily, setFontFamily] = useState<string | null>(null);

  // Mounted through the PACKAGED React host rather than the engine mount, so the demo
  // exercises the adapter a consumer actually installs. Calling the engine directly proved
  // the engine and left the adapter untested in a browser.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(fixtureUrl);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A real measurer, injected by the HOST: layout stays DOM-free and reads the font's
      // own tables. Paint with the very face it measured, or agreement is lost at the
      // renderer instead of at the measurer.
      const exact = await createExactMeasurer(SCALE);
      if (cancelled) return;
      setMeasurer(() => exact.measurer);
      setFontFamily(exact.fontFamily);
      setSource(bytes);
    })();
    return () => {
      cancelled = true;
    };
  }, [fixtureUrl]);

  useEffect(() => {
    if (!state) return;
    setStatus(`Paginated — ${state.pageCount} pages (semantic layout)`);
  }, [state]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid var(--doc-border)',
          fontSize: 13,
          flexWrap: 'wrap',
          position: 'sticky',
          top: 0,
          background: 'var(--doc-surface, #fff)',
          zIndex: 2,
        }}
      >
        <strong data-testid="paginated-status">{status}</strong>
        <span data-testid="paginated-revision">rev {state?.revision ?? 0}</span>
        <span data-testid="paginated-caret">
          caret {state ? `${state.selection.head.offset}` : '-'}
        </span>
        <button type="button" onClick={() => editorRef.current?.undo()}>
          Undo
        </button>
        <button type="button" onClick={() => editorRef.current?.redo()}>
          Redo
        </button>
        <button
          type="button"
          onClick={() => {
            const bytes = editorRef.current?.save();
            if (bytes) setSaved(`${bytes.length} bytes saved and reopened OK`);
          }}
        >
          Save
        </button>
        {state?.lastRejection ? (
          <span data-testid="paginated-rejection" style={{ color: '#b00' }}>
            refused: {state.lastRejection}
          </span>
        ) : null}
        {saved ? <span data-testid="paginated-saved">{saved}</span> : null}
      </div>

      <div
        data-testid="paginated-mount"
        // The measured face is applied here so runs naming no font inherit exactly what the
        // shaper measured; see `exactMeasurer`.
        style={{ flex: 1, minHeight: 0, ...(fontFamily ? { fontFamily } : {}) }}
      >
        {source && measurer ? (
          <PaginatedDocxEditorShell
            source={source}
            scale={SCALE}
            measurer={measurer}
            onStateChange={setState}
            onError={(reason, detail) =>
              setStatus(`Rejected: ${reason}${detail ? ` (${detail})` : ''}`)
            }
          />
        ) : null}
      </div>
    </div>
  );
}
