import { useState } from 'react';
import type { MarkdownComment, MarkdownPage } from '@docx-editor.dev/docx-to-markdown';
import { MarkdownBlock } from './MarkdownBlock';
import { PageReviewArtifacts } from './PageReviewArtifacts';
import type { PreviewMode } from './preview-navigation';
import type { PageReviewSelectionIndex } from './review-presentation';

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

export function MarkdownPagePreview({
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
  const [expanded, setExpanded] = useState({ comments: false, changes: false });
  const reviews = [
    { key: 'comments' as const, label: 'comments', count: showComments ? page.comments.length : 0 },
    {
      key: 'changes' as const,
      label: 'tracked changes',
      count: showTrackedChanges ? page.trackedChanges.length : 0,
    },
  ].filter(({ count }) => count > 0);
  return (
    <article className="md-page-wrap" id={`markdown-page-${page.number}`}>
      <div className="md-page-meta">
        <span className="md-page-number">Page {page.number}</span>
        {reviews.map(({ key, label, count }) => (
          <button
            key={key}
            className="md-page-review-toggle"
            type="button"
            aria-expanded={expanded[key]}
            aria-controls={`markdown-page-${page.number}-${key}`}
            onClick={() => setExpanded((value) => ({ ...value, [key]: !value[key] }))}
          >
            {expanded[key] ? 'Hide' : 'See'} {label} <span>{count}</span>
          </button>
        ))}
        <button
          className="md-page-reveal"
          type="button"
          onClick={() => onRevealDocumentPage(page.number)}
          aria-label={`View in DOCX, page ${page.number}`}
        >
          View in DOCX
        </button>
      </div>
      <div className="md-page-layout">
        {reviews.map(({ key, label }) => (
          <section
            key={key}
            id={`markdown-page-${page.number}-${key}`}
            className="md-page-review"
            aria-label={`Page ${page.number} ${label}`}
            hidden={!expanded[key]}
          >
            {expanded[key] ? (
              <PageReviewArtifacts
                page={page}
                commentById={commentById}
                selectionIndex={selectionIndex}
                showComments={key === 'comments'}
                showTrackedChanges={key === 'changes'}
                mode="rendered"
              />
            ) : null}
          </section>
        ))}
        <div
          className="md-page-sheet"
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              (event.target instanceof Element &&
                event.target.closest(
                  'a, button, input, select, textarea, summary, [contenteditable="true"]'
                )) ||
              window.getSelection()?.isCollapsed === false
            )
              return;
            onRevealDocumentPage(page.number);
          }}
        >
          {showHeaders ? (
            <PageField kind="header" markdown={page.headerMarkdown} mode={mode} />
          ) : null}
          <PageField kind="body" markdown={page.markdown} mode={mode} />
          {showFooters ? (
            <PageField kind="footer" markdown={page.footerMarkdown} mode={mode} />
          ) : null}
        </div>
      </div>
    </article>
  );
}
