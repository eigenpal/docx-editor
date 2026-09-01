import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DocxEditor, useFonts, type DocxEditorRef } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { googleFonts } from '@docx-editor.dev/fonts/google';
import {
  exportMarkdown,
  type ExportFontResolutionReport,
  type MarkdownComment,
  type MarkdownExportResult,
  type MarkdownPage,
} from '@docx-editor.dev/docx-to-markdown';
import { BrandLogo } from '../../shared/BrandLogo';
import {
  canCopyExport,
  copyableMarkdown,
  DOCUMENT_EXPORT_START,
  markdownBusyPresentation,
  shouldRefreshMarkdownForChange,
  type ExportActivity,
  type ExportStatus,
} from './export-state';
import { developerPanelContent, type DeveloperPanelTab } from './developer-reference';
import { createLatestOperationGate } from './latest-operation';
import { HighlightedCode } from './HighlightedCode';
import { MarkdownBlock } from './MarkdownBlock';
import { PageReviewArtifacts } from './PageReviewArtifacts';
import { markdownPageToReveal, type PreviewMode } from './preview-navigation';
import { indexPageReviewSelections, type PageReviewSelectionIndex } from './review-presentation';
import {
  clampSplit,
  desktopSplitBounds,
  MAX_SOURCE_PERCENT,
  MIN_SOURCE_PERCENT,
} from './split-layout';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const LIVE_EXPORT_DELAY_MS = 550;
const REVIEW_MODULES = [reviewModule()];
const EDITOR_PACKAGED_FONTS = packagedFonts();
const GOOGLE_FONT_FALLBACK = googleFonts({
  onFailure: (failure) => console.warn(`[google-fonts] ${failure.diagnostic}`),
});
type MobilePane = 'source' | 'markdown';

interface ExportViewState {
  readonly status: ExportStatus;
  readonly result: MarkdownExportResult | null;
  readonly error: string | null;
  readonly fontReport: ExportFontResolutionReport | null;
}

const EMPTY_EXPORT: ExportViewState = {
  status: 'idle',
  result: null,
  error: null,
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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5h5m4 0h5M8 3v4M3 15h5m4 0h5m-5-2v4M3 10h9m4 0h1m-5-2v4" />
    </svg>
  );
}

function Spinner() {
  return <span className="md-spinner" aria-hidden="true" />;
}

const MARKDOWN_LOADING_MESSAGES = [
  'Markdowning with page boundaries intact',
  'Keeping headers and footers close to their pages',
  'Giving tables, lists, and review notes careful treatment',
  'Making the document citation-ready',
] as const;

function MarkdownLoadingState({ status }: { readonly status: 'queued' | 'exporting' }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    setMessageIndex(0);
    if (status === 'queued') return;
    const timer = window.setInterval(
      () => setMessageIndex((current) => (current + 1) % MARKDOWN_LOADING_MESSAGES.length),
      1_800
    );
    return () => window.clearInterval(timer);
  }, [status]);

  return (
    <div className="md-export-loading" aria-label="Building page-aware Markdown">
      <div className="md-export-loading__indicator">
        <Spinner />
        <span>{status === 'queued' ? 'Catching up with your edits' : 'Building Markdown'}</span>
      </div>
      <strong>Preparing a page-aware export</strong>
      <p aria-hidden="true">
        {status === 'queued'
          ? 'Waiting for a quiet moment before the next layout pass'
          : MARKDOWN_LOADING_MESSAGES[messageIndex]}
      </p>
    </div>
  );
}

function DeveloperView({
  tab,
  result,
  status,
  error,
  onTabChange,
}: {
  readonly tab: DeveloperPanelTab;
  readonly result: MarkdownExportResult | null;
  readonly status: ExportStatus;
  readonly error: string | null;
  readonly onTabChange: (tab: DeveloperPanelTab) => void;
}) {
  const content = useMemo(
    () => developerPanelContent(tab, result, status, error),
    [error, result, status, tab]
  );
  return (
    <section className="md-developer-view" aria-labelledby="developer-view-title">
      <header className="md-developer-view__header">
        <strong id="developer-view-title">Use the export API</strong>
        <span>One call returns logical and page-aware Markdown.</span>
      </header>
      <div className="md-developer-tabs" role="group" aria-label="Developer reference">
        <button
          type="button"
          aria-pressed={tab === 'example'}
          onClick={() => onTabChange('example')}
        >
          Example
        </button>
        <button
          type="button"
          aria-pressed={tab === 'response'}
          onClick={() => onTabChange('response')}
        >
          Response
        </button>
      </div>
      <HighlightedCode
        code={content}
        language={tab === 'example' ? 'typescript' : 'json'}
        label={tab === 'example' ? 'TypeScript code example' : 'JSON API response'}
      />
    </section>
  );
}

function PageField({
  kind,
  markdown,
  mode,
}: {
  readonly kind: 'header' | 'body' | 'footer';
  readonly markdown: string;
  readonly mode: Exclude<PreviewMode, 'developer'>;
}) {
  if (!markdown && kind !== 'body') return null;
  return (
    <section className={`md-page-field md-page-field--${kind}`} aria-label={`${kind} Markdown`}>
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
  commentById,
  selectionIndex,
  mode,
  showHeaders,
  showFooters,
  showComments,
  showTrackedChanges,
  onRevealDocumentPage,
}: {
  readonly page: MarkdownPage;
  readonly commentById: ReadonlyMap<string, MarkdownComment>;
  readonly selectionIndex: PageReviewSelectionIndex;
  readonly mode: Exclude<PreviewMode, 'developer'>;
  readonly showHeaders: boolean;
  readonly showFooters: boolean;
  readonly showComments: boolean;
  readonly showTrackedChanges: boolean;
  readonly onRevealDocumentPage: (pageNumber: number) => void;
}) {
  const revealPage = () => onRevealDocumentPage(page.number);
  return (
    <article className="md-page-wrap" id={`markdown-page-${page.number}`}>
      <div className="md-page-meta">
        <button type="button" onClick={revealPage}>
          <span>Page {page.number}</span>
          <span className="md-page-meta__action">View in DOCX</span>
        </button>
      </div>
      <div className="md-page-sheet">
        {showHeaders ? (
          <PageField kind="header" markdown={page.headerMarkdown} mode={mode} />
        ) : null}
        <PageField kind="body" markdown={page.markdown} mode={mode} />
        <PageReviewArtifacts
          page={page}
          commentById={commentById}
          selectionIndex={selectionIndex}
          showComments={showComments}
          showTrackedChanges={showTrackedChanges}
          mode={mode}
        />
        {showFooters ? (
          <PageField kind="footer" markdown={page.footerMarkdown} mode={mode} />
        ) : null}
      </div>
    </article>
  );
}

function coverageLabel(report: ExportFontResolutionReport | null): string | null {
  if (!report) return null;
  const unresolved = report.families
    .filter((family) => family.coverage !== 'complete')
    .map((family) => family.family);
  if (unresolved.length > 0) return `Incomplete font-face coverage: ${unresolved.join(', ')}`;
  if (report.originFailures.length > 0)
    return 'A font source failed; requested face coverage remains complete';
  return null;
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
  const workbench = useRef<HTMLElement>(null);
  const previewScroll = useRef<HTMLDivElement>(null);
  const editorSelectionCleanup = useRef<(() => void) | null>(null);
  const latestEditorPage = useRef(1);
  const sourcePointerReveal = useRef(false);
  const exportTimer = useRef<number | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const sourceLoadController = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  const copiedTimer = useRef<number | null>(null);
  const [operations] = useState(createLatestOperationGate);
  const fonts = useFonts(EDITOR_PACKAGED_FONTS, GOOGLE_FONT_FALLBACK);
  const [document, setDocument] = useState<Uint8Array>();
  const [exportView, setExportView] = useState<ExportViewState>(EMPTY_EXPORT);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('rendered');
  const [mobilePane, setMobilePane] = useState<MobilePane>('source');
  const [sourceWidth, setSourceWidth] = useState(50);
  const [splitBounds, setSplitBounds] = useState({
    min: MIN_SOURCE_PERCENT,
    max: MAX_SOURCE_PERCENT,
  });
  const [resizing, setResizing] = useState(false);
  const [showHeaders, setShowHeaders] = useState(true);
  const [showFooters, setShowFooters] = useState(true);
  const [showComments, setShowComments] = useState(true);
  const [showTrackedChanges, setShowTrackedChanges] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [developerPanelTab, setDeveloperPanelTab] = useState<DeveloperPanelTab>('example');
  const [exportActivity, setExportActivity] = useState<ExportActivity>('document');

  const revealMarkdownPage = useCallback((pageNumber: number) => {
    const scroller = previewScroll.current;
    const page = scroller?.querySelector<HTMLElement>(`#markdown-page-${pageNumber}`);
    if (!scroller || !page) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const pageBox = page.getBoundingClientRect();
    const target = scroller.scrollTop + pageBox.top - scrollerBox.top - 12;
    if (Math.abs(scroller.scrollTop - target) < 2) return;
    scroller.scrollTo({
      top: target,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);

  const revealDocumentPage = useCallback((pageNumber: number) => {
    latestEditorPage.current = pageNumber;
    setMobilePane('source');
    window.requestAnimationFrame(() => {
      editor.current?.getEditor()?.scrollToPage(pageNumber);
    });
  }, []);

  useEffect(() => {
    const pageNumber = markdownPageToReveal(
      previewMode,
      exportView.status,
      exportView.result !== null,
      latestEditorPage.current
    );
    if (pageNumber === null) return;
    const frame = window.requestAnimationFrame(() => revealMarkdownPage(pageNumber));
    return () => window.cancelAnimationFrame(frame);
  }, [exportView.result, exportView.status, previewMode, revealMarkdownPage]);

  useEffect(
    () => () => {
      editorSelectionCleanup.current?.();
      editorSelectionCleanup.current = null;
    },
    []
  );

  useEffect(() => {
    const element = workbench.current;
    if (!element) return;
    const updateBounds = (): void => {
      if (window.matchMedia('(max-width: 900px)').matches) {
        setSplitBounds({ min: MIN_SOURCE_PERCENT, max: MAX_SOURCE_PERCENT });
        return;
      }
      const width = element.getBoundingClientRect().width;
      if (width <= 0) return;
      const next = desktopSplitBounds(width);
      setSplitBounds(next);
      setSourceWidth((current) => clampSplit(current, next));
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
    async (bytes: Uint8Array, operation: number, activity: ExportActivity) => {
      if (!operations.isCurrent(operation)) return;
      setExportActivity(activity);
      const controller = new AbortController();
      exportController.current = controller;
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
        fontReport = result.fontResolution;
        if (!operations.isCurrent(operation)) return;
        setExportView({
          status: 'ready',
          result,
          error: null,
          fontReport,
        });
      } catch (error) {
        if (controller.signal.aborted || !operations.isCurrent(operation)) return;
        setExportView((current) => ({
          ...current,
          status: 'error',
          error: errorMessage(error),
          fontReport,
        }));
      } finally {
        if (exportController.current === controller) exportController.current = null;
      }
    },
    [operations]
  );

  const openBytes = useCallback(
    (bytes: Uint8Array, _name: string, operation: number) => {
      if (!operations.isCurrent(operation)) return;
      latestEditorPage.current = 1;
      sourcePointerReveal.current = false;
      setDocument(bytes);
      void runExport(bytes, operation, 'document');
    },
    [operations, runExport]
  );

  const loadSample = useCallback(() => {
    const operation = beginOperation();
    const controller = new AbortController();
    sourceLoadController.current = controller;
    setExportActivity('document');
    setExportView(DOCUMENT_EXPORT_START);
    void fetch(`${import.meta.env.BASE_URL}sample.docx`, { signal: controller.signal })
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
      // A validation error is terminal for whatever was in flight: supersede any queued live
      // export, or its later completion silently overwrites this banner with 'ready'.
      const refuse = (message: string): void => {
        beginOperation();
        if (exportTimer.current !== null) {
          window.clearTimeout(exportTimer.current);
          exportTimer.current = null;
        }
        setExportView((current) => ({ ...current, status: 'error', error: message }));
      };
      if (!file.name.toLowerCase().endsWith('.docx') && file.type !== DOCX_MIME) {
        refuse('Choose a .docx file.');
        return;
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        refuse('This demo accepts DOCX files up to 64 MiB.');
        return;
      }
      const operation = beginOperation();
      setExportActivity('document');
      setExportView(DOCUMENT_EXPORT_START);
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
    setExportActivity('live-edit');
    setExportView((current) => ({ ...current, status: 'queued', error: null }));
    exportTimer.current = window.setTimeout(() => {
      exportTimer.current = null;
      if (!operations.isCurrent(operation)) return;
      // Every exit must leave a terminal status: a null editor ref (unmount race) or a null
      // save() result would otherwise pin the UI at 'queued' with Copy disabled forever.
      const settle = (buffer: ArrayBuffer | null | undefined): Promise<void> | undefined => {
        if (!operations.isCurrent(operation)) return undefined;
        if (buffer) return runExport(new Uint8Array(buffer), operation, 'live-edit');
        setExportView((current) => ({
          ...current,
          status: current.result ? 'ready' : 'idle',
        }));
        return undefined;
      };
      const saved = editor.current?.save();
      if (!saved) {
        settle(null);
        return;
      }
      void saved.then(settle).catch((error) => {
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
    const markdown = copyableMarkdown(exportView.status, exportView.result?.markdown ?? null);
    if (markdown === null) return;
    void navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(true);
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1_500);
      })
      .catch((error) => console.warn(`[clipboard] ${errorMessage(error)}`));
  }, [exportView.result, exportView.status]);

  const fontStatus = coverageLabel(exportView.fontReport);
  const commentById = useMemo(() => {
    const indexed = new Map<string, MarkdownComment>();
    for (const artifact of exportView.result?.reviewArtifacts ?? []) {
      if (artifact.kind === 'comment') indexed.set(artifact.id, artifact);
    }
    return indexed;
  }, [exportView.result]);
  const reviewSelectionIndex = useMemo(
    () =>
      indexPageReviewSelections(
        exportView.result?.pages ?? [],
        exportView.result?.reviewBindings ?? []
      ),
    [exportView.result]
  );
  const busyPresentation = markdownBusyPresentation(
    exportView.status,
    exportView.result !== null,
    exportActivity
  );
  const busy = busyPresentation !== 'none';
  const loadingStatus =
    busyPresentation === 'replace' &&
    (exportView.status === 'queued' || exportView.status === 'exporting')
      ? exportView.status
      : null;
  const canCopy = canCopyExport(exportView.status, exportView.result !== null);
  const exportStatusLabel =
    exportView.status === 'queued'
      ? 'Waiting for your pause'
      : exportView.status === 'exporting'
        ? 'Updating Markdown export'
        : exportView.status === 'error'
          ? exportView.result
            ? 'Export failed; showing the last successful snapshot'
            : 'Export failed'
          : exportView.status === 'ready'
            ? 'Markdown export ready'
            : 'Preparing sample';
  const layoutStyle = {
    '--md-source-width': `${sourceWidth}%`,
  } as CSSProperties;

  const resizeFromPointer = useCallback(
    (clientX: number) => {
      const bounds = workbench.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0) return;
      const next = ((clientX - bounds.left) / bounds.width) * 100;
      setSourceWidth(clampSplit(next, splitBounds));
    },
    [splitBounds]
  );

  return (
    <div
      className={`md-demo${resizing ? ' md-demo--resizing' : ''}`}
      data-mobile-pane={mobilePane}
      style={layoutStyle}
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
        <div className="md-topbar-pane md-topbar-pane--source">
          <div className="md-brand-lockup">
            <BrandLogo />
            <div className="md-product-title">
              <strong>DOCX to Markdown</strong>
            </div>
          </div>
          <div className="md-mobile-tabs" role="group" aria-label="Demo view">
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
              aria-pressed={mobilePane === 'markdown'}
              aria-controls="markdown-preview-panel"
              onClick={() => setMobilePane('markdown')}
            >
              Markdown
            </button>
          </div>
          <div className="md-source-actions">
            <button
              type="button"
              className="md-button md-button--compact md-button--quiet"
              onClick={() => loadSample()}
            >
              Reset
            </button>
            <button
              type="button"
              className="md-button md-button--compact md-button--primary"
              onClick={() => fileInput.current?.click()}
              title="Open or drop a DOCX"
            >
              <UploadIcon />
              <span>Open DOCX</span>
            </button>
          </div>
        </div>
        <div className="md-topbar-divider" aria-hidden="true" />
        <div className="md-topbar-pane md-topbar-pane--preview">
          <div className="md-export-identity">
            <strong>Markdown</strong>
          </div>
          <div className="md-preview-controls">
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
              <button
                type="button"
                aria-pressed={previewMode === 'developer'}
                onClick={() => setPreviewMode('developer')}
              >
                Code
              </button>
            </div>
            <details className="md-settings" hidden={previewMode === 'developer'}>
              <summary
                className="md-icon-button"
                aria-label={
                  fontStatus
                    ? `Page display and font fidelity settings; ${fontStatus}`
                    : 'Page display settings'
                }
                title={
                  fontStatus ? 'Page display and font fidelity settings' : 'Page display settings'
                }
              >
                <SettingsIcon />
              </summary>
              <div className="md-settings-popover">
                <div className="md-settings-heading">
                  <strong>Page display</strong>
                  <span>Choose what appears in the preview.</span>
                </div>
                <label className="md-setting-row">
                  <span>Page headers</span>
                  <input
                    type="checkbox"
                    checked={showHeaders}
                    onChange={(event) => setShowHeaders(event.target.checked)}
                  />
                </label>
                <label className="md-setting-row">
                  <span>Page footers</span>
                  <input
                    type="checkbox"
                    checked={showFooters}
                    onChange={(event) => setShowFooters(event.target.checked)}
                  />
                </label>
                <label className="md-setting-row">
                  <span>Comments</span>
                  <input
                    type="checkbox"
                    checked={showComments}
                    onChange={(event) => setShowComments(event.target.checked)}
                  />
                </label>
                <label className="md-setting-row">
                  <span>Tracked changes</span>
                  <input
                    type="checkbox"
                    checked={showTrackedChanges}
                    onChange={(event) => setShowTrackedChanges(event.target.checked)}
                  />
                </label>
                {fontStatus ? <div className="md-settings-note">{fontStatus}</div> : null}
              </div>
            </details>
          </div>
          <div className="md-preview-actions">
            <button
              type="button"
              className="md-icon-button md-copy-action"
              onClick={copyMarkdown}
              disabled={!canCopy}
              aria-label={copied ? 'Markdown copied' : 'Copy full-document Markdown'}
              title={copied ? 'Copied' : 'Copy Markdown'}
            >
              <CopyIcon copied={copied} />
            </button>
          </div>
        </div>
      </header>
      <span className="md-visually-hidden" role="status" aria-live="polite">
        {exportStatusLabel}
      </span>

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

      <main ref={workbench} className="md-workbench">
        <section
          id="docx-source-panel"
          className="md-panel md-panel--editor"
          aria-label="Editable DOCX document"
        >
          <div
            className="md-editor-frame"
            onPointerDownCapture={(event) => {
              sourcePointerReveal.current =
                event.target instanceof Element && event.target.closest('.docx-page') !== null;
            }}
          >
            <DocxEditor
              ref={editor}
              document={document}
              fonts={fonts}
              modules={REVIEW_MODULES}
              author="Markdown demo"
              title="Document"
              onOpen={() => fileInput.current?.click()}
              onChange={(change) => {
                // Core emits one provenance-free change when a new document mounts so
                // subscribed hosts re-read it. The document export already in flight owns
                // that load; only authored commits carry identity deltas and need a refresh.
                if (!shouldRefreshMarkdownForChange(change)) return;
                scheduleLiveExport();
              }}
              onReady={(instance) => {
                editorSelectionCleanup.current?.();
                latestEditorPage.current = instance.snapshot().page.current;
                revealMarkdownPage(latestEditorPage.current);
                editorSelectionCleanup.current = instance.on('selectionChange', (snapshot) => {
                  const pageChanged = latestEditorPage.current !== snapshot.page.current;
                  latestEditorPage.current = snapshot.page.current;
                  const pointerRequested = sourcePointerReveal.current;
                  sourcePointerReveal.current = false;
                  if (pageChanged || pointerRequested) revealMarkdownPage(snapshot.page.current);
                });
              }}
              navigation={false}
              menu={false}
              zoomMode="auto"
              onFontError={(error) => console.warn(`[editor-fonts] ${error.message}`)}
            >
              <DocxEditorReview />
            </DocxEditor>
          </div>
        </section>

        <div
          className="md-resize-handle"
          role="separator"
          aria-label="Resize source and Markdown panes"
          aria-orientation="vertical"
          aria-valuemin={Number(splitBounds.min.toFixed(1))}
          aria-valuemax={Number(splitBounds.max.toFixed(1))}
          aria-valuenow={Number(sourceWidth.toFixed(1))}
          tabIndex={0}
          onDoubleClick={() => setSourceWidth(clampSplit(50, splitBounds))}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 5 : 2;
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setSourceWidth((current) => Math.max(splitBounds.min, current - step));
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              setSourceWidth((current) => Math.min(splitBounds.max, current + step));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setSourceWidth(splitBounds.min);
            } else if (event.key === 'End') {
              event.preventDefault();
              setSourceWidth(splitBounds.max);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing(true);
            resizeFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (resizing && event.currentTarget.hasPointerCapture(event.pointerId)) {
              resizeFromPointer(event.clientX);
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            setResizing(false);
          }}
          onPointerCancel={() => setResizing(false)}
        />

        <section
          id="markdown-preview-panel"
          className="md-panel md-panel--preview"
          aria-label={
            previewMode === 'developer'
              ? 'DOCX to Markdown API reference'
              : 'Live paginated Markdown'
          }
        >
          <div ref={previewScroll} className="md-preview-scroll" aria-busy={busy}>
            {previewMode === 'developer' ? (
              <DeveloperView
                tab={developerPanelTab}
                result={exportView.status === 'ready' ? exportView.result : null}
                status={exportView.status}
                error={exportView.error}
                onTabChange={setDeveloperPanelTab}
              />
            ) : loadingStatus ? (
              <MarkdownLoadingState status={loadingStatus} />
            ) : (
              <>
                {busyPresentation === 'overlay' ? (
                  <div className="md-live-update" role="status">
                    <Spinner />
                    <span>
                      {exportView.status === 'queued'
                        ? 'Changes pending—Markdown will update when you pause'
                        : 'Updating page-aware Markdown'}
                    </span>
                  </div>
                ) : null}
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
                    className={`md-pages${busyPresentation === 'overlay' ? ' md-pages--updating' : ''}${exportView.status === 'error' ? ' md-pages--stale' : ''}`}
                  >
                    {exportView.result.pages.map((page) => (
                      <MarkdownPagePreview
                        key={page.id}
                        page={page}
                        commentById={commentById}
                        selectionIndex={reviewSelectionIndex}
                        mode={previewMode}
                        showHeaders={showHeaders}
                        showFooters={showFooters}
                        showComments={showComments}
                        showTrackedChanges={showTrackedChanges}
                        onRevealDocumentPage={revealDocumentPage}
                      />
                    ))}
                  </div>
                ) : exportView.error ? null : (
                  <div className="md-empty-state" role="status">
                    <Spinner />
                    <span>Preparing Markdown…</span>
                  </div>
                )}
              </>
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
