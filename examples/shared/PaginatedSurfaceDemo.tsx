// Browser harness for the ENGINE-OWNED PAGINATED SURFACE (task 8.4).
//
// Reachable at `?paginated=1`. Painted pages from semantic layout records, with the caret,
// selection and hit testing answered from those same records. There is no contenteditable
// holding the document — the only editable element is the offscreen input host that gives
// the browser somewhere to put focus and the IME.

import { useEffect, useRef, useState } from 'react';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceState,
} from '@docx-editor.dev/engine-editor';
import { DEFAULT_FONT_STACK } from './canvasMeasurer.ts';
import { createExactMeasurer } from './exactMeasurer.ts';

/** Layout units (points) to CSS pixels, at 96 dpi. */
const SCALE = 96 / 72;

declare global {
  interface Window {
    __docxPaginated?: PaginatedSurface;
  }
}

export function PaginatedSurfaceDemo({ fixtureUrl }: { fixtureUrl: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [state, setState] = useState<PaginatedSurfaceState | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let surface: PaginatedSurface | null = null;
    let cancelled = false;

    void (async () => {
      const response = await fetch(fixtureUrl);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (cancelled || !mountRef.current) return;
      // A real measurer, injected by the HOST: layout stays DOM-free and reads the font's
      // own tables. Paint with the very face it measured, or agreement is lost at the
      // renderer instead of at the measurer.
      const exact = await createExactMeasurer(SCALE);
      if (cancelled || !mountRef.current) return;
      mountRef.current.style.fontFamily = exact.fontFamily ?? DEFAULT_FONT_STACK;
      const result = mountPaginatedSurface(mountRef.current, bytes, {
        onChange: setState,
        scale: SCALE,
        measurer: exact.measurer,
      });
      if (!result.ok) {
        setStatus(`Rejected: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`);
        return;
      }
      surface = result.surface;
      window.__docxPaginated = surface;
      setStatus(
        `Paginated — ${surface.state().pageCount} pages, ` +
          `${surface.session.paragraphIds().length} paragraphs (semantic layout)`
      );
      setState(surface.state());
      surface.focus();
    })();

    return () => {
      cancelled = true;
      surface?.destroy();
      delete window.__docxPaginated;
    };
  }, [fixtureUrl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
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
        <button type="button" onClick={() => window.__docxPaginated?.session.undo()}>
          Undo
        </button>
        <button
          type="button"
          onClick={() => {
            const surface = window.__docxPaginated;
            if (!surface) return;
            setSaved(`${surface.session.save().length} bytes saved and reopened OK`);
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

      <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <div ref={mountRef} data-testid="paginated-mount" className="docx-paginated-surface" />
      </div>
    </div>
  );
}
