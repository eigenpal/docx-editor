import { expect, test } from 'bun:test';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import { exportMarkdownLayout } from '../src/index.ts';

test('uses all-markup consistently when a raw Core layout omits displayMode', () => {
  const layout = {
    revision: 1,
    reviewArtifacts: [],
    pages: [
      {
        index: 0,
        fragments: [
          {
            kind: 'paragraph',
            id: 'deleted:f0',
            paragraphId: 'deleted',
            fragmentIndex: 0,
            styleId: null,
            outlineLevel: null,
            alignment: 'left',
            lines: [
              {
                range: { paragraphId: 'deleted', start: 0, end: 8 },
                spans: [
                  {
                    range: { paragraphId: 'deleted', start: 0, end: 8 },
                    text: 'Old text',
                    style: {},
                    revisions: [{ kind: 'delete' }],
                    box: { x: 0, y: 0, width: 8, height: 10 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ExportSemanticLayout;

  const result = exportMarkdownLayout(layout);

  expect(result.markdown).toBe('~~Old text~~');
  expect(result.pagination.displayMode).toBe('all-markup');
});
