import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarkdownComment, MarkdownPage } from '@docx-editor.dev/docx-to-markdown';
import { MarkdownPagePreview } from './MarkdownPagePreview';
import { PageReviewArtifacts } from './PageReviewArtifacts';
import { indexPageReviewSelections } from './review-presentation';

const comment = (
  id: string,
  parentId: string | undefined,
  replyIds: readonly string[]
): MarkdownComment => ({
  kind: 'comment',
  id,
  author: id,
  initials: id,
  text: `${id} text`,
  resolved: false,
  ...(parentId ? { parentId } : {}),
  replyIds,
  orphaned: false,
  occurrences: [],
});

describe('PageReviewArtifacts', () => {
  test.each(['rendered', 'source'] as const)(
    'renders document-wide unplaced descendants in %s mode',
    (mode) => {
      const root = comment('root', undefined, ['child']);
      const child = comment('child', 'root', ['grandchild']);
      const grandchild = comment('grandchild', 'child', []);
      const page: MarkdownPage = {
        id: 'page-1',
        number: 1,
        markdown: 'selected text',
        headerMarkdown: '',
        footerMarkdown: '',
        comments: [root],
        trackedChanges: [],
      };
      const bindings = [
        {
          artifactId: root.id,
          artifactKind: 'comment' as const,
          occurrenceIndex: 0,
          projection: {
            kind: 'page' as const,
            pageIndex: 0,
            pageNumber: 1,
            field: 'markdown' as const,
          },
          ranges: [
            {
              start: 0,
              end: 8,
              unit: 'utf16-code-unit' as const,
              precision: 'exact' as const,
            },
          ],
          coverage: 'complete' as const,
        },
      ];
      const byId = new Map([root, child, grandchild].map((entry) => [entry.id, entry]));
      const html = renderToStaticMarkup(
        <PageReviewArtifacts
          page={page}
          commentById={byId}
          selectionIndex={indexPageReviewSelections([page], bindings)}
          showComments
          showTrackedChanges
          mode={mode}
        />
      );
      expect(html).toContain('Selected text');
      expect(html).toContain('root text');
      expect(html).toContain('child text');
      expect(html).toContain('grandchild text');
      expect(html.indexOf('root text')).toBeLessThan(html.indexOf('child text'));
      expect(html.indexOf('child text')).toBeLessThan(html.indexOf('grandchild text'));
    }
  );
});

test.each(['rendered', 'source'] as const)(
  'page review stays outside the document paper in %s mode',
  (mode) => {
    const root = comment('root', undefined, []);
    const page: MarkdownPage = {
      id: 'page-1',
      number: 1,
      markdown: 'Body content',
      headerMarkdown: 'Header content',
      footerMarkdown: 'Footer content',
      comments: [root],
      trackedChanges: [],
    };
    const preview = (showComments: boolean) =>
      renderToStaticMarkup(
        <MarkdownPagePreview
          page={page}
          commentById={new Map([[root.id, root]])}
          selectionIndex={indexPageReviewSelections([page], [])}
          mode={mode}
          showHeaders
          showFooters
          showComments={showComments}
          showTrackedChanges
          onRevealDocumentPage={() => {}}
        />
      );
    const document = new DOMParser().parseFromString(preview(true), 'text/html');
    const paper = document.querySelector('.md-page-sheet')!;
    const review = document.querySelector('details')!;
    expect(paper.textContent).toContain('Footer content');
    expect(paper.textContent).not.toContain('root text');
    expect(review.textContent).toContain('root text');
    expect(review.parentElement).toBe(paper.parentElement);
    expect(review.querySelector('summary')?.textContent).toContain('Review · Page 1');
    expect(preview(false)).not.toContain('<details');
  }
);
