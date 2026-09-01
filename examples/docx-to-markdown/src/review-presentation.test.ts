import { describe, expect, test } from 'bun:test';
import type {
  MarkdownComment,
  MarkdownPage,
  MarkdownReviewBinding,
} from '@docx-editor.dev/docx-to-markdown';
import {
  indexPageReviewSelections,
  pageCommentThreads,
  pageReviewSelectionKey,
} from './review-presentation';

const page = (markdown: string): MarkdownPage => ({
  id: 'page-1',
  number: 1,
  markdown,
  headerMarkdown: '',
  footerMarkdown: '',
  comments: [],
  trackedChanges: [],
});

const binding = (
  artifactId: string,
  options: Partial<MarkdownReviewBinding> = {}
): MarkdownReviewBinding => ({
  artifactId,
  artifactKind: 'comment',
  occurrenceIndex: 0,
  projection: { kind: 'page', pageIndex: 0, pageNumber: 1, field: 'markdown' },
  ranges: [{ start: 0, end: 4, unit: 'utf16-code-unit', precision: 'exact' }],
  coverage: 'complete',
  ...options,
});

describe('review presentation index', () => {
  test('distinguishes exact, partial, containing, and unmapped bindings', () => {
    const index = indexPageReviewSelections(
      [page('text and more')],
      [
        binding('exact'),
        binding('partial', { coverage: 'partial' }),
        binding('construct', {
          ranges: [
            { start: 0, end: 4, unit: 'utf16-code-unit', precision: 'containing-construct' },
          ],
        }),
        binding('unmapped', {
          ranges: [],
          coverage: 'none',
          unmappedReason: 'not-represented-in-markdown',
        }),
      ]
    );
    expect(index.get(pageReviewSelectionKey(1, 'exact'))?.label).toBe('Selected text');
    expect(index.get(pageReviewSelectionKey(1, 'partial'))?.label).toBe(
      'Partial Markdown selection'
    );
    expect(index.get(pageReviewSelectionKey(1, 'construct'))?.label).toBe(
      'Containing Markdown construct'
    );
    expect(index.get(pageReviewSelectionKey(1, 'unmapped'))).toMatchObject({
      markdown: '',
      label: 'Partial Markdown selection',
      unmappedReasons: ['not-represented-in-markdown'],
    });
  });

  test('indexes a dense binding set by artifact key', () => {
    const bindings = Array.from({ length: 2_000 }, (_, index) => binding(`artifact-${index}`));
    const indexed = indexPageReviewSelections([page('text')], bindings);
    expect(indexed.size).toBe(2_000);
    expect(indexed.get(pageReviewSelectionKey(1, 'artifact-1999'))?.markdown).toBe('text');
  });

  test('keeps unplaced replies and nested descendants in the page root thread', () => {
    const comment = (
      id: string,
      parentId: string | undefined,
      replyIds: readonly string[]
    ): MarkdownComment => ({
      kind: 'comment',
      id,
      author: id,
      initials: id,
      text: id,
      resolved: false,
      ...(parentId ? { parentId } : {}),
      replyIds,
      orphaned: false,
      occurrences: [],
    });
    const root = comment('root', undefined, ['child']);
    const child = comment('child', 'root', ['grandchild']);
    const grandchild = comment('grandchild', 'child', []);
    const byId = new Map([root, child, grandchild].map((entry) => [entry.id, entry]));
    expect(pageCommentThreads([root], byId)).toEqual([
      {
        root,
        replies: [
          { comment: child, depth: 1 },
          { comment: grandchild, depth: 2 },
        ],
      },
    ]);
  });
});
