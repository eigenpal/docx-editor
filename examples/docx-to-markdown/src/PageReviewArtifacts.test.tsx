import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarkdownComment, MarkdownPage } from '@docx-editor.dev/docx-to-markdown';
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
