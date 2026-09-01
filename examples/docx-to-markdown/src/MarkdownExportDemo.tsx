import { useCallback, useEffect, useRef, useState } from 'react';
import { DocxEditor, useFonts, type DocxEditorRef } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { googleFonts } from '@docx-editor.dev/fonts/google';
import {
  exportMarkdown,
  type ExportFontResolutionReport,
  type MarkdownExportResult,
  type MarkdownPage,
} from '@docx-editor.dev/docx-to-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { BrandLogo } from '../../shared/BrandLogo';
import { canCopyExport, type ExportStatus } from './export-state';
import { createLatestOperationGate } from './latest-operation';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const LIVE_EXPORT_DELAY_MS = 550;
const REVIEW_MODULES = [reviewModule()];
const EDITOR_PACKAGED_FONTS = packagedFonts();
const GOOGLE_FONT_FALLBACK = googleFonts({
  onFailure: (failure) => console.warn(`[google-fonts] ${failure.diagnostic}`),
});

type PreviewMode = 'rendered' | 'source';

interface ExportViewState {
  readonly status: ExportStatus;
  readonly result: MarkdownExportResult | null;
  readonly error: string | null;
  readonly durationMs: number | null;
  readonly fontReport: ExportFontResolutionReport | null;
}

const EMPTY_EXPORT: ExportViewState = {
  status: 'idle',
  result: null,
  error: null,
  durationMs: null,
  fontReport: null,
};

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 11.5V16h12v-4.5" />
    </svg>
  );
}

function CopyIcon({ copied }: { readonly copied: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {copied ? (
        <path d="m4 10.5 3.5 3.5L16 5.5" />
      ) : (
        <>
          <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
          <path d="M4.5 13.5h-.25A1.75 1.75 0 0 1 2.5 11.75v-7.5A1.75 1.75 0 0 1 4.25 2.5h7.5a1.75 1.75 0 0 1 1.75 1.75v.25" />
        </>
      )}
    </svg>
  );
}

function Spinner() {
  return <span className="md-spinner" aria-hidden="true" />;
}

function MarkdownBlock({ children }: { readonly children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function PageField({
  label,
  markdown,
  mode,
}: {
  readonly label: 'Header' | 'Body' | 'Footer';
  readonly markdown: string;
  readonly mode: PreviewMode;
}) {
  if (!markdown && label !== 'Body') return null;
  return (
    <section className={`md-page-field md-page-field--${label.toLowerCase()}`}>
      {label !== 'Body' ? <span className="md-page-field__label">{label}</span> : null}
      {mode === 'rendered' ? (
        markdown ? (
          <MarkdownBlock>{markdown}</MarkdownBlock>
        ) : (
          <p className="md-page-empty">No body content on this page</p>
        )
      ) : (
        <pre className="md-source">
          <code>{markdown || ' '}</code>
        </pre>
      )}
    </section>
  );
}

function MarkdownPagePreview({
  page,
  mode,
}: {
  readonly page: MarkdownPage;
  readonly mode: PreviewMode;
}) {
  const reviewCount = page.comments.length + page.trackedChanges.length;
  return (
    <article className="md-page-wrap" id={`markdown-page-${page.number}`}>
      <div className="md-page-meta">
        <span>Page {page.number}</span>
        {reviewCount > 0 ? (
          <span className="md-review-count">
            {reviewCount} review {reviewCount === 1 ? 'artifact' : 'artifacts'}
          </span>
        ) : null}
      </div>
      <div className="md-page-sheet">
        <PageField label="Header" markdown={page.headerMarkdown} mode={mode} />
        <PageField label="Body" markdown={page.markdown} mode={mode} />
        <PageField label="Footer" markdown={page.footerMarkdown} mode={mode} />
      </div>
    </article>
  );
}

function coverageLabel(report: ExportFontResolutionReport | null): string | null {
  if (!report) return null;
  const incomplete = report.families.filter((family) => family.coverage !== 'complete').length;
  if (report.originFailures.length > 0) return 'Font fallback used';
  if (incomplete > 0)
    return `${incomplete} font ${incomplete === 1 ? 'family' : 'families'} approximated`;
  return 'Fonts settled';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function carriesFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files');
}

export function MarkdownExportDemo() {
  const editor = useRef<DocxEditorRef>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportTimer = useRef<number | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const sourceLoadController = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  const copiedTimer = useRef<number | null>(null);
  const [operations] = useState(createLatestOperationGate);
  const fonts = useFonts(EDITOR_PACKAGED_FONTS, GOOGLE_FONT_FALLBACK);
  const [document, setDocument] = useState<Uint8Array>();
  const [documentName, setDocumentName] = useState('sample');
  const [exportView, setExportView] = useState<ExportViewState>(EMPTY_EXPORT);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('rendered');
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  const beginOperation = useCallback(() => {
    const operation = operations.begin();
    sourceLoadController.current?.abort('superseded by a newer document operation');
    sourceLoadController.current = null;
    exportController.current?.abort('superseded by a newer document operation');
    exportController.current = null;
    if (exportTimer.current !== null) {
      window.clearTimeout(exportTimer.current);
      exportTimer.current = null;
    }
    return operation;
  }, [operations]);

  const runExport = useCallback(
    async (bytes: Uint8Array, operation: number) => {
      if (!operations.isCurrent(operation)) return;
      const controller = new AbortController();
      exportController.current = controller;
      const began = performance.now();
      let fontReport: ExportFontResolutionReport | null = null;
      setExportView((current) => ({ ...current, status: 'exporting', error: null }));
      try {
        const result = await exportMarkdown(bytes, {
          fallbackFonts: GOOGLE_FONT_FALLBACK,
          resourceTimeoutMs: 30_000,
          signal: controller.signal,
          onFontResolution: (report) => {
            fontReport = report;
          },
        });
        if (!operations.isCurrent(operation)) return;
        setExportView({
          status: 'ready',
          result,
          error: null,
          durationMs: performance.now() - began,
          fontReport,
        });
      } catch (error) {
        if (controller.signal.aborted || !operations.isCurrent(operation)) return;
        setExportView((current) => ({
          ...current,
          status: 'error',
          error: errorMessage(error),
          durationMs: null,
          fontReport,
        }));
      } finally {
        if (exportController.current === controller) exportController.current = null;
      }
    },
    [operations]
  );

  const openBytes = useCallback(
    (bytes: Uint8Array, name: string, operation: number) => {
      if (!operations.isCurrent(operation)) return;
      setDocumentName(name.replace(/\.docx$/i, '') || 'document');
      setDocument(bytes);
      void runExport(bytes, operation);
    },
    [operations, runExport]
  );

  const loadSample = useCallback(() => {
    const operation = beginOperation();
    const controller = new AbortController();
    sourceLoadController.current = controller;
    setExportView((current) => ({ ...current, status: 'exporting', error: null }));
    void fetch('/sample.docx', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Sample document returned HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => openBytes(new Uint8Array(buffer), 'sample.docx', operation))
      .catch((error) => {
        if (controller.signal.aborted || !operations.isCurrent(operation)) return;
        setExportView((current) => ({
          ...current,
          status: 'error',
          error: errorMessage(error),
        }));
      })
      .finally(() => {
        if (sourceLoadController.current === controller) sourceLoadController.current = null;
      });
  }, [beginOperation, openBytes, operations]);

  useEffect(() => {
    loadSample();
    return () => {
      operations.invalidate();
      sourceLoadController.current?.abort('demo unmounted');
      exportController.current?.abort('demo unmounted');
      if (exportTimer.current !== null) window.clearTimeout(exportTimer.current);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, [loadSample, operations]);

  const openFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.docx') && file.type !== DOCX_MIME) {
        setExportView((current) => ({
          ...current,
          status: 'error',
          error: 'Choose a .docx file.',
        }));
        return;
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        setExportView((current) => ({
          ...current,
          status: 'error',
          error: 'This demo accepts DOCX files up to 64 MiB.',
        }));
        return;
      }
      const operation = beginOperation();
      setExportView((current) => ({ ...current, status: 'exporting', error: null }));
      try {
        const buffer = await file.arrayBuffer();
        openBytes(new Uint8Array(buffer), file.name, operation);
      } catch (error) {
        if (!operations.isCurrent(operation)) return;
        setExportView((current) => ({
          ...current,
          status: 'error',
          error: errorMessage(error),
        }));
      }
    },
    [beginOperation, openBytes, operations]
  );

  const scheduleLiveExport = useCallback(() => {
    const operation = beginOperation();
    setExportView((current) => ({ ...current, status: 'queued', error: null }));
    exportTimer.current = window.setTimeout(() => {
      exportTimer.current = null;
      if (!operations.isCurrent(operation)) return;
      void editor.current
        ?.save()
        .then((buffer) => {
          if (buffer && operations.isCurrent(operation)) {
            return runExport(new Uint8Array(buffer), operation);
          }
          return undefined;
        })
        .catch((error) => {
          if (!operations.isCurrent(operation)) return;
          setExportView((current) => ({
            ...current,
            status: 'error',
            error: errorMessage(error),
          }));
        });
    }, LIVE_EXPORT_DELAY_MS);
  }, [beginOperation, operations, runExport]);

  const copyMarkdown = useCallback(() => {
    if (!canCopyExport(exportView.status, exportView.result !== null) || !exportView.result) return;
    void navigator.clipboard
      .writeText(exportView.result.markdown)
      .then(() => {
        setCopied(true);
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1_500);
      })
      .catch((error) => console.warn(`[clipboard] ${errorMessage(error)}`));
  }, [exportView.result, exportView.status]);

  const pageCount = exportView.result?.pages.length ?? 0;
  const fontStatus = coverageLabel(exportView.fontReport);
  const busy = exportView.status === 'queued' || exportView.status === 'exporting';
  const canCopy = canCopyExport(exportView.status, exportView.result !== null);

  return (
    <div
      className="md-demo"
      onDragEnter={(event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (carriesFiles(event.dataTransfer)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (dragDepth.current === 0) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <header className="md-topbar">
        <BrandLogo />
        <div className="md-product-title">
          <span className="md-product-title__arrow" aria-hidden="true">
            →
          </span>
          <div>
            <strong>Page-aware Markdown</strong>
            <span>Live, layout-backed export</span>
          </div>
        </div>
        <div className="md-topbar__actions">
          <div className="md-export-health" role="status" aria-live="polite">
            {busy ? (
              <Spinner />
            ) : (
              <span
                className={`md-live-dot${exportView.status === 'error' ? ' md-live-dot--error' : ''}`}
              />
            )}
            <span className="md-export-health__text">
              {exportView.status === 'queued'
                ? 'Waiting for your pause…'
                : exportView.status === 'exporting'
                  ? 'Laying out document…'
                  : exportView.status === 'error'
                    ? pageCount > 0
                      ? 'Export failed · showing last successful snapshot'
                      : 'Export failed'
                    : pageCount > 0
                      ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}${exportView.durationMs ? ` · ${Math.round(exportView.durationMs)} ms` : ''}`
                      : 'Preparing sample…'}
            </span>
          </div>
          <button type="button" className="md-button md-button--quiet" onClick={() => loadSample()}>
            Reset sample
          </button>
          <button
            type="button"
            className="md-button md-button--primary"
            onClick={() => fileInput.current?.click()}
          >
            <UploadIcon />
            Open DOCX
          </button>
        </div>
      </header>

      <input
        ref={fileInput}
        hidden
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openFile(file);
        }}
      />

      <main className="md-workbench">
        <section className="md-panel md-panel--editor" aria-label="Editable DOCX document">
          <div className="md-panel-head">
            <div>
              <span className="md-panel-kicker">Source</span>
              <strong>DOCX editor</strong>
            </div>
            <span className="md-panel-badge">Word layout</span>
          </div>
          <div className="md-editor-frame">
            <DocxEditor
              ref={editor}
              document={document}
              fonts={fonts}
              modules={REVIEW_MODULES}
              author="Markdown demo"
              title={documentName}
              onTitleChange={setDocumentName}
              onOpen={() => fileInput.current?.click()}
              onChange={scheduleLiveExport}
              navigation={false}
              zoomMode="auto"
              onFontError={(error) => console.warn(`[editor-fonts] ${error.message}`)}
            >
              <DocxEditorReview />
            </DocxEditor>
          </div>
        </section>

        <section className="md-panel md-panel--preview" aria-label="Live paginated Markdown">
          <div className="md-panel-head md-panel-head--preview">
            <div>
              <span className="md-panel-kicker">Export</span>
              <strong>Markdown</strong>
            </div>
            <div className="md-preview-actions">
              {fontStatus ? <span className="md-font-status">{fontStatus}</span> : null}
              <div className="md-segmented" role="group" aria-label="Markdown view">
                <button
                  type="button"
                  aria-pressed={previewMode === 'rendered'}
                  onClick={() => setPreviewMode('rendered')}
                >
                  Preview
                </button>
                <button
                  type="button"
                  aria-pressed={previewMode === 'source'}
                  onClick={() => setPreviewMode('source')}
                >
                  Source
                </button>
              </div>
              <button
                type="button"
                className="md-icon-button"
                onClick={copyMarkdown}
                disabled={!canCopy}
                aria-label={copied ? 'Markdown copied' : 'Copy full-document Markdown'}
                title={copied ? 'Copied' : 'Copy Markdown'}
              >
                <CopyIcon copied={copied} />
              </button>
            </div>
          </div>

          <div className="md-preview-scroll" aria-busy={busy}>
            {exportView.error ? (
              <div className="md-error" role="alert">
                <span className="md-error__icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <strong>Could not export this document</strong>
                  <p>{exportView.error}</p>
                </div>
              </div>
            ) : null}
            {exportView.result ? (
              <div
                className={`md-pages${busy ? ' md-pages--updating' : ''}${exportView.status === 'error' ? ' md-pages--stale' : ''}`}
              >
                {exportView.result.pages.map((page) => (
                  <MarkdownPagePreview key={page.id} page={page} mode={previewMode} />
                ))}
              </div>
            ) : exportView.error ? null : (
              <div className="md-empty-state" role="status">
                <Spinner />
                <strong>Building the first page snapshot</strong>
                <span>Settling fonts, layout, headers, footers, and review artifacts.</span>
              </div>
            )}
          </div>
        </section>
      </main>

      {dragging ? (
        <div className="md-drop-overlay" role="presentation">
          <div className="md-drop-card">
            <span className="md-drop-icon">
              <UploadIcon />
            </span>
            <strong>Drop your DOCX here</strong>
            <span>Document bytes stay local; missing fonts may load from a pinned CDN.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
