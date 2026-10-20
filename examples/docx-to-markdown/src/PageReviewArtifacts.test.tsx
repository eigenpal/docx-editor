import { render, fireEvent, cleanup } from '@testing-library/react';
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
  'page review starts closed and expands outside the paper in %s mode',
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
    let revealed = 0;
    const preview = (showComments: boolean) => (
      <MarkdownPagePreview
        page={page}
        commentById={new Map([[root.id, root]])}
        selectionIndex={indexPageReviewSelections([page], [])}
        mode={mode}
        showHeaders
        showFooters
        showComments={showComments}
        showTrackedChanges
        onRevealDocumentPage={(number) => {
          revealed = number;
        }}
      />
    );
    const view = render(preview(true));
    try {
      const paper = view.container.querySelector('.md-page-sheet')!;
      expect(paper.textContent).toContain('Footer content');
      const button = view.getByRole('button', { name: 'See comments 1' });
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(view.queryByText('root text')).toBeNull();
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      const panel = view.getByRole('region', { name: 'Page 1 comments' });
      expect(panel.id).toBe(button.getAttribute('aria-controls')!);
      expect(panel.textContent).toContain('root text');
      expect(panel.querySelector('.md-review-message')).not.toBeNull();
      expect(paper.textContent).not.toContain('root text');
      expect(panel.parentElement).toBe(paper.parentElement);
      fireEvent.click(view.getByRole('button', { name: 'View in DOCX, page 1' }));
      expect(revealed).toBe(1);
      revealed = 0;
      fireEvent.click(view.getByRole('region', { name: 'body Markdown' }));
      expect(revealed).toBe(1);
      revealed = 0;
      fireEvent.click(paper, { ctrlKey: true });
      expect(revealed).toBe(0);
      const link = document.createElement('a');
      link.href = '#reference';
      link.textContent = 'Reference';
      paper.append(link);
      fireEvent.click(link);
      expect(revealed).toBe(0);
      link.remove();
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(paper);
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.click(paper);
      expect(revealed).toBe(0);
      selection.removeAllRanges();
      fireEvent.click(button);
      expect(view.queryByText('root text')).toBeNull();
      view.rerender(preview(false));
      expect(view.queryByRole('button', { name: /comments/ })).toBeNull();
    } finally {
      view.unmount();
      cleanup();
    }
  }
);
