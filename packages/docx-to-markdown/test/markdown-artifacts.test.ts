import { expect, test } from 'bun:test';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import { exportMarkdownFrom } from '../src/index.ts';

function session(layout: SemanticLayout): ExportSession {
  const exportLayout = layout as ExportSemanticLayout;
  return {
    layout: async () => exportLayout,
    layoutFor: async () => exportLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };
}

test('makes paginated review artifacts primary while retaining unplaced artifacts globally', async () => {
  const anchoredComment = {
    kind: 'comment',
    id: 'comment-1',
    author: 'Ada',
    initials: 'AL',
    text: 'Check this',
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [
      {
        pageIndex: 1,
        physicalPageNumber: 2,
        story: 'footer',
        rootStory: 'footer',
        textboxPath: [],
        noteScopeId: null,
        noteAreaKind: null,
        source: {
          partName: '/word/footer1.xml',
          start: { paragraphId: 'footer-p', offset: 0 },
          end: { paragraphId: 'footer-p', offset: 3 },
        },
      },
    ],
  } as const;
  const unplacedChange = {
    kind: 'tracked-change',
    id: 'change-1',
    change: 'insert',
    author: 'Grace',
    text: 'Pending',
    replacedText: '',
    nesting: 0,
    readOnly: false,
    replyIds: [],
    occurrences: [],
  } as const;
  const layout = {
    revision: 1,
    pages: [
      { id: 'page-a', index: 0, fragments: [] },
      { id: 'page-b', index: 1, fragments: [] },
    ],
    reviewArtifacts: [anchoredComment, unplacedChange],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  expect(result.pages.map(({ id, number }) => ({ id, number }))).toEqual([
    { id: 'page-a', number: 1 },
    { id: 'page-b', number: 2 },
  ]);
  expect(result.pages[0]?.comments).toEqual([]);
  expect(result.pages[1]?.comments).toEqual([anchoredComment]);
  expect(result.pages[1]?.trackedChanges).toEqual([]);
  expect(result.reviewArtifacts).toEqual([anchoredComment, unplacedChange]);
});
