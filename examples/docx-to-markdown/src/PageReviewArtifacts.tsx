import type { MarkdownComment, MarkdownPage } from '@docx-editor.dev/docx-to-markdown';
import { MarkdownBlock } from './MarkdownBlock';
import {
  pageReviewSelectionKey,
  pageCommentThreads,
  type PageReviewSelectionIndex,
  type ReviewSelectionPresentation,
} from './review-presentation';

interface PageReviewArtifactsProps {
  readonly page: MarkdownPage;
  readonly commentById: ReadonlyMap<string, MarkdownComment>;
  readonly selectionIndex: PageReviewSelectionIndex;
  readonly showComments: boolean;
  readonly showTrackedChanges: boolean;
  readonly mode: 'rendered' | 'source';
}

export function PageReviewArtifacts({
  page,
  commentById,
  selectionIndex,
  showComments,
  showTrackedChanges,
  mode,
}: PageReviewArtifactsProps) {
  const comments = showComments ? page.comments : [];
  const trackedChanges = showTrackedChanges ? page.trackedChanges : [];
  if (comments.length === 0 && trackedChanges.length === 0) return null;

  const selectionFor = (artifactId: string): ReviewSelectionPresentation | undefined =>
    selectionIndex.get(pageReviewSelectionKey(page.number, artifactId));
  const commentThreads = pageCommentThreads(comments, commentById);

  if (mode === 'source') {
    const lines: string[] = [];
    if (comments.length > 0) {
      lines.push('Comments', '');
      for (const { root: comment, replies } of commentThreads) {
        const selected = selectionFor(comment.id);
        lines.push(
          `${selected?.label ?? 'Markdown selection'}: ${selected?.markdown || '(not represented in this Markdown page)'}`
        );
        if (selected?.unmappedReasons.length) {
          lines.push(`Mapping: ${selected.unmappedReasons.join(', ')}`);
        }
        lines.push(`${comment.author || 'Unknown author'}: ${comment.text || '(empty comment)'}`);
        for (const reply of replies) {
          const indent = '  '.repeat(Math.min(reply.depth, 8));
          lines.push(
            `${indent}${reply.comment.author || 'Unknown author'}: ${reply.comment.text || '(empty reply)'}`
          );
        }
        lines.push('');
      }
    }
    if (trackedChanges.length > 0) {
      lines.push('Tracked changes', '');
      for (const change of trackedChanges) {
        const selected = selectionFor(change.id);
        lines.push(
          `${selected?.label ?? 'Markdown selection'}: ${selected?.markdown || '(not represented in this Markdown page)'}`
        );
        if (selected?.unmappedReasons.length) {
          lines.push(`Mapping: ${selected.unmappedReasons.join(', ')}`);
        }
        lines.push(
          `${change.author || 'Unknown author'} · ${change.change.replace(/([A-Z])/g, ' $1')}: ${change.text || change.replacedText || '(structural change)'}`
        );
        lines.push('');
      }
    }
    return (
      <aside className="md-review-artifacts md-review-artifacts--source" aria-label="Page review">
        <pre className="md-source md-review-source">
          <code>{lines.join('\n').trimEnd()}</code>
        </pre>
      </aside>
    );
  }

  return (
    <aside className="md-review-artifacts" aria-label={`Review artifacts on page ${page.number}`}>
      {comments.length > 0 ? (
        <section className="md-review-group" aria-label="Comments">
          <div className="md-review-artifacts__heading">
            <span>Comments</span>
            <span>{comments.length}</span>
          </div>
          {commentThreads.map(({ root: comment, replies }) => {
            const selected = selectionFor(comment.id);
            return (
              <article key={`comment:${comment.id}`} className="md-review-thread">
                <div className="md-review-selection">
                  <span>{selected?.label ?? 'Markdown selection'}</span>
                  {selected?.markdown ? (
                    <MarkdownBlock>{selected.markdown}</MarkdownBlock>
                  ) : (
                    <p>
                      Not represented in this Markdown page
                      {selected?.unmappedReasons.length
                        ? ` · ${selected.unmappedReasons.join(', ')}`
                        : ''}
                    </p>
                  )}
                </div>
                <div className="md-review-message">
                  <div>
                    <strong>{comment.author || 'Unknown author'}</strong>
                    <span>{comment.resolved ? 'Resolved' : 'Open'}</span>
                  </div>
                  <p>{comment.text || 'Empty comment'}</p>
                </div>
                {replies.map((reply) => (
                  <div
                    key={reply.comment.id}
                    className="md-review-message md-review-message--reply"
                    style={{ marginLeft: Math.min(reply.depth, 4) * 18 }}
                  >
                    <div>
                      <strong>{reply.comment.author || 'Unknown author'}</strong>
                      <span>Reply</span>
                    </div>
                    <p>{reply.comment.text || 'Empty reply'}</p>
                  </div>
                ))}
              </article>
            );
          })}
        </section>
      ) : null}
      {trackedChanges.length > 0 ? (
        <section className="md-review-group" aria-label="Tracked changes">
          <div className="md-review-artifacts__heading">
            <span>Tracked changes</span>
            <span>{trackedChanges.length}</span>
          </div>
          {trackedChanges.map((change) => {
            const selected = selectionFor(change.id);
            return (
              <article key={`change:${change.id}`} className="md-review-thread">
                <div className="md-review-selection">
                  <span>{selected?.label ?? 'Markdown selection'}</span>
                  {selected?.markdown ? <MarkdownBlock>{selected.markdown}</MarkdownBlock> : null}
                </div>
                <div className="md-review-message md-review-message--change">
                  <div>
                    <strong>{change.author || 'Unknown author'}</strong>
                    <span>{change.change.replace(/([A-Z])/g, ' $1')}</span>
                  </div>
                  <p>{change.text || change.replacedText || 'Structural document change'}</p>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
    </aside>
  );
}
