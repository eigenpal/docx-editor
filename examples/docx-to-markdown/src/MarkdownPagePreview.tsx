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
  const revealPage = () => onRevealDocumentPage(page.number);
  const reviewCount =
    (showComments ? page.comments.length : 0) +
    (showTrackedChanges ? page.trackedChanges.length : 0);
  return (
    <article
      className={`md-page-wrap${reviewCount ? ' md-page-wrap--with-review' : ''}`}
      id={`markdown-page-${page.number}`}
    >
      <div className="md-page-meta">
        <button type="button" onClick={revealPage}>
          <span>Page {page.number}</span>
          <span className="md-page-meta__action">View in DOCX</span>
        </button>
      </div>
      <div className="md-page-layout">
        <div className="md-page-sheet">
          {showHeaders ? (
            <PageField kind="header" markdown={page.headerMarkdown} mode={mode} />
          ) : null}
          <PageField kind="body" markdown={page.markdown} mode={mode} />
          {showFooters ? (
            <PageField kind="footer" markdown={page.footerMarkdown} mode={mode} />
          ) : null}
        </div>
        {reviewCount > 0 ? (
          <details className="md-page-review" open>
            <summary>
              Review · Page {page.number}
              <span>{reviewCount}</span>
            </summary>
            <PageReviewArtifacts
              page={page}
              commentById={commentById}
              selectionIndex={selectionIndex}
              showComments={showComments}
              showTrackedChanges={showTrackedChanges}
              mode={mode}
            />
          </details>
        ) : null}
      </div>
    </article>
  );
}
