// The DEFAULT editor surface: painted pages from semantic layout records.
//
// Mounted through the PACKAGED React host, not the engine mount, so what the demo exercises
// is the adapter a consumer installs. Driving the engine directly proved the engine and left
// the adapter untested in a browser.

import { useEffect, useRef, useState } from 'react';
import type { PaginatedSurfaceState, TextMeasurer } from '@docx-editor.dev/core-contract/editor';
import { PaginatedDocxEditorShell } from '@docx-editor.dev/react';
import { createExactMeasurer } from './exactMeasurer.ts';
import { BrandLogo } from './BrandLogo';
import { AdapterSwitcher } from './AdapterSwitcher';
import { ExampleSwitcher } from './ExampleSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { DEMO_BUTTON, DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON } from './demoButtons';

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
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Serialize and hand the bytes to the browser as a download. */
  const download = (bytes: Uint8Array, name = 'document.docx'): void => {
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    // Revoked immediately: the click has already handed the blob to the download, and
    // holding the URL keeps the whole document alive in memory.
    URL.revokeObjectURL(url);
  };

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
    setStatus(`${state.pageCount} pages`);
  }, [state]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div data-testid="paginated-mount" style={{ flex: 1, minHeight: 0 }}>
        {source && measurer ? (
          <PaginatedDocxEditorShell
            ref={editorRef}
            colorMode={colorMode}
            source={source}
            documentName="Sample Document"
            // The measured face goes to the DOCUMENT, not to the chrome around it.
            {...(fontFamily ? { documentFontFamily: fontFamily } : {})}
            scale={SCALE * zoom}
            onZoomChange={setZoom}
            measurer={measurer}
            onStateChange={setState}
            onSave={(bytes) => setSaved(`${bytes.length} bytes saved`)}
            // The demo owns the title-bar slots, exactly as the adapter harness does: brand
            // lockup and the adapter/example switchers on the left, document actions right.
            renderTitleBarRight={() => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ThemeToggle value={colorMode} onChange={setColorMode} />
                <button
                  type="button"
                  style={DEMO_PRIMARY_BUTTON}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Open DOCX
                </button>
                <button
                  type="button"
                  style={DEMO_SECONDARY_BUTTON}
                  onClick={() => {
                    // A new document is the fixture reopened: the surface has no
                    // document-creation lane yet, and inventing one here would put the
                    // shape of an empty document in the demo instead of the engine.
                    void fetch(fixtureUrl)
                      .then((response) => response.arrayBuffer())
                      .then((buffer) => setSource(new Uint8Array(buffer)));
                  }}
                >
                  New
                </button>
                <button
                  type="button"
                  style={DEMO_BUTTON}
                  onClick={() => {
                    const bytes = editorRef.current?.save();
                    if (bytes) download(bytes);
                  }}
                >
                  Save
                </button>
              </div>
            )}
            renderTitleBarLeft={() => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BrandLogo />
                <AdapterSwitcher current="react" />
                <ExampleSwitcher current="Vite" />
              </div>
            )}
            onError={(reason, detail) =>
              setStatus(`Rejected: ${reason}${detail ? ` (${detail})` : ''}`)
            }
          />
        ) : null}
      </div>

      {/* Opening a document is a FILE READ, so it goes through an input the user drives —
          the surface is never handed a URL to fetch on its own. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          void file.arrayBuffer().then((buffer) => {
            setSaved(null);
            setSource(new Uint8Array(buffer));
          });
          // Cleared so choosing the SAME file twice fires a change event the second time.
          event.target.value = '';
        }}
      />

      {/* A DEV INDICATOR, not chrome: pinned out of the way so the editor above it is the
          editor a user would see, while the revision and caret stay one glance away. */}
      <div
        data-testid="paginated-status"
        style={{
          position: 'fixed',
          left: 12,
          bottom: 12,
          zIndex: 50,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '6px 10px',
          borderRadius: 999,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: '#fff',
          background: 'rgba(24,24,27,0.85)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}
      >
        <span>{status}</span>
        <span data-testid="paginated-revision">rev {state?.revision ?? 0}</span>
        <span data-testid="paginated-caret">
          caret {state ? state.selection.head.offset : '-'}
        </span>
        {state?.lastRejection ? (
          <span data-testid="paginated-rejection" style={{ color: '#fca5a5' }}>
            refused: {state.lastRejection}
          </span>
        ) : null}
        {saved ? <span data-testid="paginated-saved">{saved}</span> : null}
      </div>
    </div>
  );
}
