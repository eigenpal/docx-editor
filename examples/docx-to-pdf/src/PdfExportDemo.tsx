/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DocxEditor, useFonts, type DocxEditorRef } from '@docx-editor.dev/react';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { BrandLogo } from '../../shared/BrandLogo';
import { PdfViewer, preparePdfPreview } from './PdfViewer';
import { PdfProgress, formatDuration } from './PdfProgress';
import { readConversionResponse, type ConversionPayload } from './conversion-response';
import { clampSplit, desktopSplitBounds, type SplitBounds } from './split-layout';
import {
  diagnosticSummary,
  emptyStateMessage,
  formatBytes,
  generateLabel,
  isPdfBusy,
  shouldMarkStale,
  type PdfConversion,
  type PdfStatus,
} from './pdf-export-state';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const EDITOR_PACKAGED_FONTS = packagedFonts();
type MobilePane = 'source' | 'pdf';

/** A finished conversion as the preview shows it; the caller owns the object URL. */
function conversionResult(
  payload: ConversionPayload & { pdf: string },
  cached = false
): PdfConversion {
  const bytes = Uint8Array.from(atob(payload.pdf), (character) => character.charCodeAt(0));
  return {
    url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })),
    bytes: bytes.byteLength,
    pageCount: payload.pageCount ?? 0,
    diagnostics: payload.diagnostics ?? [],
    timings: cached ? undefined : payload.timings,
    cached,
  };
}

/**
 * The sample's PDF, converted when the demo was built, or `null` to convert it live.
 *
 * A missing file comes back from the host's SPA fallback as HTML, which fails the parse and
 * lands here too.
 */
async function fetchSamplePdf(): Promise<PdfConversion | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}sample-pdf.json`);
    if (!response.ok) return null;
    const payload = (await response.json()) as ConversionPayload;
    return payload.pdf ? conversionResult({ ...payload, pdf: payload.pdf }, true) : null;
  } catch {
    return null;
  }
}
/** The `.DOCX` mark from the site header, wearing a PDF band. */
function PdfIcon() {
  return (
    <svg
      viewBox="0 0 70 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      style={{ width: '14px', height: 'auto', flexShrink: 0 }}
    >
      <path
        d="M2 2H48L68 22V78H2V2Z"
        fill="#FAF9F8"
        stroke="#201F1E"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M48 2V22H68"
        fill="#FBE4E1"
        stroke="#201F1E"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M48 2V22H68L48 2Z" fill="#FBE4E1" />
      <rect x="13" y="32" width="28" height="4" fill="#201F1E" opacity="0.25" />
      <rect x="13" y="42" width="38" height="4" fill="#201F1E" opacity="0.15" />
      <rect x="13" y="52" width="33" height="4" fill="#201F1E" opacity="0.15" />
      <rect x="13" y="62" width="36" height="4" fill="#201F1E" opacity="0.15" />
      <rect x="13" y="82" width="44" height="16" fill="#B3261E" stroke="#201F1E" strokeWidth="3" />
      <text
        x="35"
        y="94"
        textAnchor="middle"
        fill="#FAF9F8"
        fontSize="11"
        fontWeight="900"
        fontFamily="system-ui, sans-serif"
      >
        .PDF
      </text>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PdfExportDemo({ embedded = false }: { readonly embedded?: boolean }) {
  const editor = useRef<DocxEditorRef>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workbench = useRef<HTMLElement>(null);
  const conversion = useRef(0);
  const revision = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  // Set when a document is opened, cleared when its editor is ready and conversion starts.
  const convertOnReady = useRef(false);

  const [document, setDocument] = useState<Uint8Array | 'blank'>('blank');
  const [status, setStatus] = useState<PdfStatus>('idle');
  const [result, setResult] = useState<PdfConversion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('source');
  const [sourceWidth, setSourceWidth] = useState(50);
  const [splitBounds, setSplitBounds] = useState<SplitBounds>(() => desktopSplitBounds(0));
  const [resizing, setResizing] = useState(false);
  const fonts = useFonts(EDITOR_PACKAGED_FONTS);

  // One object URL at a time: the previous preview is revoked as soon as a new one replaces
  // it, and the last one when the demo unmounts, so a long editing session does not retain
  // every PDF it produced.
  useEffect(() => () => inFlight.current?.abort(), []);
  useEffect(() => {
    const url = result?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result?.url]);

  useLayoutEffect(() => {
    const element = workbench.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const bounds = desktopSplitBounds(entry?.contentRect.width ?? 0);
      setSplitBounds(bounds);
      setSourceWidth((current) => clampSplit(current, bounds));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const cancelConversion = useCallback(() => {
    conversion.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const loadSample = useCallback(async () => {
    cancelConversion();
    // Resolve against the app base, not the page URL: on the dedicated host the page is `/`
    // and a relative `sample.docx` would ask the SPA catch-all for HTML.
    const [response, samplePdf] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}sample.docx`).catch(() => null),
      fetchSamplePdf(),
    ]);
    if (!response?.ok) {
      if (samplePdf) URL.revokeObjectURL(samplePdf.url);
      // Say so: an empty editor with no explanation reads as a broken page.
      setStatus('error');
      setError('The sample document could not be loaded. Open a DOCX of your own instead.');
      return;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // The unedited sample shows its build-time PDF at once. Without one, it converts like
    // any opened document.
    convertOnReady.current = samplePdf === null;
    setDocument(bytes);
    setStatus(samplePdf ? 'ready' : 'preparing');
    setResult(samplePdf);
    setError(null);
  }, [cancelConversion]);

  useEffect(() => {
    void loadSample();
  }, [loadSample]);

  const generate = useCallback(async () => {
    if (inFlight.current) return;
    const current = ++conversion.current;
    const savedRevision = revision.current;
    const abort = new AbortController();
    inFlight.current = abort;
    setStatus('preparing');
    preparePdfPreview();
    setError(null);
    try {
      const saved = await editor.current?.save();
      if (current !== conversion.current) return;
      if (!saved) throw new Error('The document is not ready. Try again once it has loaded.');
      if (saved.byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error(`The document exceeds the ${formatBytes(MAX_DOCUMENT_BYTES)} demo limit.`);
      }
      // Best effort, with the diagnostics shown: a document that names a font this host does
      // not have, or draws a shape the writer does not, still comes back as pages, and the
      // meta line under them says what was approximated. A strict conversion refuses the
      // whole document over one such span, which is the right default for an automated
      // pipeline and the wrong one for a page whose point is to show the document.
      const response = await fetch('/api/convert?fidelityPolicy=best-effort', {
        method: 'POST',
        headers: { Accept: 'application/x-ndjson' },
        body: saved,
        signal: abort.signal,
      });
      // A host with no conversion service answers with its own 404 or 405 page, not JSON.
      // Say what is missing instead of surfacing a parse error.
      if (response.status === 404 || response.status === 405) {
        if (current !== conversion.current) return;
        setStatus('error');
        setError(
          'No conversion service is available on this host. Run `bun run dev:pdf` locally to convert.'
        );
        return;
      }
      const payload = await readConversionResponse(response, (progress) => {
        if (current !== conversion.current) return;
        setStatus(progress.phase === 'starting' ? 'starting' : 'converting');
      });
      if (current !== conversion.current) return;
      if (!response.ok || !payload.pdf) {
        setStatus('error');
        setError(payload.message ?? 'The document could not be converted.');
        return;
      }
      setResult(conversionResult({ ...payload, pdf: payload.pdf }));
      setStatus(savedRevision === revision.current ? 'ready' : 'stale');
    } catch (cause) {
      if (current !== conversion.current || abort.signal.aborted) return;
      setStatus('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === conversion.current) inFlight.current = null;
    }
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_DOCUMENT_BYTES) {
        // Say so. Returning silently left the previous document in place with no explanation.
        setStatus('error');
        setError(`The document exceeds the ${formatBytes(MAX_DOCUMENT_BYTES)} demo limit.`);
        return;
      }
      cancelConversion();
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Convert as soon as the editor has the document; the pane shows progress meanwhile.
      convertOnReady.current = true;
      setDocument(bytes);
      setStatus('preparing');
      setResult(null);
      setError(null);
    },
    [cancelConversion]
  );

  const stale = status === 'stale';
  const busy = isPdfBusy(status);

  return (
    <div
      className={`pdf-demo${embedded ? ' pdf-demo--embedded' : ''}${resizing ? ' pdf-demo--resizing' : ''}`}
      style={{ ['--pdf-source-width' as string]: `${sourceWidth}%` }}
      data-mobile-pane={mobilePane}
    >
      <input
        ref={fileInput}
        type="file"
        accept={`${DOCX_MIME},.docx`}
        className="pdf-visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openFile(file);
        }}
      />

      <header className="pdf-topbar">
        <div className="pdf-topbar-pane pdf-topbar-pane--source">
          {embedded ? (
            <div className="pdf-export-identity pdf-source-identity">
              <strong>Word document</strong>
            </div>
          ) : (
            <div className="pdf-brand-lockup">
              <BrandLogo />
              <div className="pdf-product-title">
                <strong>DOCX to PDF</strong>
              </div>
            </div>
          )}
          <div className="pdf-mobile-tabs" role="group" aria-label="Demo view">
            <button
              type="button"
              aria-pressed={mobilePane === 'source'}
              aria-controls="docx-source-panel"
              onClick={() => setMobilePane('source')}
            >
              Source
            </button>
            <button
              type="button"
              aria-pressed={mobilePane === 'pdf'}
              aria-controls="pdf-preview-panel"
              onClick={() => setMobilePane('pdf')}
            >
              PDF
            </button>
          </div>
          <div className="pdf-source-actions">
            {!embedded && (
              <button
                type="button"
                className="pdf-button pdf-button--compact pdf-button--quiet"
                onClick={() => void loadSample()}
              >
                Reset
              </button>
            )}
            <button
              type="button"
              className="pdf-button pdf-button--compact pdf-button--primary"
              onClick={() => fileInput.current?.click()}
              title="Open a DOCX"
            >
              <UploadIcon />
              <span>Open DOCX</span>
            </button>
          </div>
        </div>
        <div className="pdf-topbar-divider" aria-hidden="true" />
        <div className="pdf-topbar-pane pdf-topbar-pane--preview">
          <div className="pdf-export-identity">
            <PdfIcon />
            <strong>PDF</strong>
          </div>
          <div className="pdf-preview-controls">
            {result ? (
              <button
                type="button"
                className={`pdf-button pdf-button--compact ${stale ? 'pdf-button--primary' : 'pdf-button--quiet'}`}
                onClick={() => void generate()}
                disabled={busy}
                // The document is converted on request, not on every keystroke: a page of PDF
                // is expensive to produce and nobody wants one per character.
                title="Convert the current document to PDF"
              >
                {generateLabel(status, result !== null)}
              </button>
            ) : null}
          </div>
          <div className="pdf-preview-actions">
            {result ? (
              <a
                className="pdf-icon-button"
                title="Download PDF"
                aria-label="Download PDF"
                href={result?.url ?? '#'}
                download="document.pdf"
                aria-disabled={result === null}
                onClick={(event) => {
                  if (!result) event.preventDefault();
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 3v9m-3-3 3 3 3-3M4 12v4h12v-4" />
                </svg>
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main ref={workbench} className="pdf-workbench">
        <section
          id="docx-source-panel"
          className="pdf-panel pdf-panel--editor"
          aria-label="Editable DOCX document"
        >
          <div className="pdf-editor-frame">
            <DocxEditor
              ref={editor}
              document={document}
              fonts={fonts}
              author="PDF demo"
              title="Document"
              onOpen={() => fileInput.current?.click()}
              onReady={() => {
                if (!convertOnReady.current) return;
                convertOnReady.current = false;
                void generate();
              }}
              onChange={(change) => {
                if (!shouldMarkStale(change)) return;
                revision.current += 1;
                setStatus((current) => (isPdfBusy(current) ? current : 'stale'));
              }}
              navigation={false}
              menu={false}
              zoomMode="auto"
              onFontError={(fontError) => console.warn(`[editor-fonts] ${fontError.message}`)}
            />
          </div>
        </section>

        <div
          className="pdf-resize-handle"
          role="separator"
          aria-label="Resize document and PDF panes"
          aria-orientation="vertical"
          aria-valuemin={Number(splitBounds.min.toFixed(1))}
          aria-valuemax={Number(splitBounds.max.toFixed(1))}
          aria-valuenow={Number(sourceWidth.toFixed(1))}
          tabIndex={0}
          onDoubleClick={() => setSourceWidth(clampSplit(50, splitBounds))}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 5 : 2;
            if (event.key === 'ArrowLeft')
              setSourceWidth((current) => clampSplit(current - step, splitBounds));
            if (event.key === 'ArrowRight')
              setSourceWidth((current) => clampSplit(current + step, splitBounds));
          }}
          onPointerDown={(event) => {
            const element = workbench.current;
            if (!element) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing(true);
            const move = (pointer: PointerEvent) => {
              const box = element.getBoundingClientRect();
              if (box.width <= 0) return;
              const percent = ((pointer.clientX - box.left) / box.width) * 100;
              setSourceWidth(clampSplit(percent, splitBounds));
            };
            const stop = () => {
              setResizing(false);
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', stop);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', stop);
          }}
        />

        <section
          id="pdf-preview-panel"
          className="pdf-panel pdf-panel--preview"
          aria-label="Converted PDF"
        >
          {result && busy ? <PdfProgress status={status} overlay /> : null}
          {result && error ? (
            <div className="pdf-error" role="alert">
              {error}
            </div>
          ) : null}
          {result ? (
            <>
              <div
                className={`pdf-preview-viewer${stale || busy ? ' pdf-preview-viewer--stale' : ''}`}
              >
                <PdfViewer src={result.url} />
              </div>
              {stale ? (
                <div className="pdf-stale-overlay">
                  <div className="pdf-stale-card" role="status">
                    <p>The document changed since this PDF was generated.</p>
                    <button
                      type="button"
                      className="pdf-button pdf-button--primary pdf-generate-action"
                      onClick={() => void generate()}
                    >
                      Regenerate PDF
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="pdf-page-meta" role="status" aria-live="polite">
                {result.pageCount} page{result.pageCount === 1 ? '' : 's'} ·{' '}
                {formatBytes(result.bytes)}
                {result.timings?.workerStartupMs !== undefined
                  ? ` · Worker startup ${formatDuration(result.timings.workerStartupMs)}`
                  : ''}
                {result.cached ? ' · Generated when the demo was built' : ''}
                {result.timings?.generationMs !== undefined
                  ? ` · Generated in ${formatDuration(result.timings.generationMs)}`
                  : ''}
                {result.diagnostics.length > 0 ? (
                  <details className="pdf-diagnostics">
                    <summary>
                      {result.diagnostics.length} diagnostic
                      {result.diagnostics.length === 1 ? '' : 's'}
                    </summary>
                    <ul>
                      {diagnosticSummary(result.diagnostics).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </>
          ) : busy ? (
            <PdfProgress status={status} />
          ) : (
            <div className="pdf-empty-state">
              {status === 'error' ? (
                <p className="pdf-empty-error" role="alert">
                  {emptyStateMessage(status, error)}
                </p>
              ) : null}
              <button
                type="button"
                className="pdf-button pdf-button--primary pdf-generate-action"
                onClick={() => void generate()}
              >
                {status === 'error' ? 'Try again' : 'Generate PDF'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
