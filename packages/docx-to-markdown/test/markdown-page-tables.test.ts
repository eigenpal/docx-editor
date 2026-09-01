import { expect, test } from 'bun:test';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { exportMarkdownFrom } from '../src/index.ts';

function paragraph(id: string, text: string): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${id}:f0`,
    paragraphId: id,
    fragmentIndex: 0,
    styleId: null,
    outlineLevel: null,
    alignment: 'left',
    lines: [
      {
        range: { paragraphId: id, start: 0, end: text.length },
        spans: [
          {
            range: { paragraphId: id, start: 0, end: text.length },
            text,
            style: {},
            box: { x: 0, y: 0, width: text.length, height: 10 },
          },
        ],
      },
    ],
  } as unknown as ParagraphFragmentRecord;
}

function session(layout: SemanticLayout): ExportSession {
  const exportLayout = { ...layout, reviewArtifacts: Object.freeze([]) } as ExportSemanticLayout;
  return {
    layout: async () => exportLayout,
    layoutFor: async () => exportLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };
}

test('keeps nested table fragments inside their physical page projection', async () => {
  const nested = (fragmentIndex: number, text: string): TableFragmentRecord =>
    ({
      kind: 'table',
      id: `nested:f${fragmentIndex}`,
      tableId: 'nested',
      fragmentIndex,
      columnEdges: [0, 50],
      rows: [
        {
          id: `nested-row-${fragmentIndex}`,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph(`nested-p-${fragmentIndex}`, text)],
            },
          ],
        },
      ],
    }) as unknown as TableFragmentRecord;
  const outer = (fragmentIndex: number, text: string): TableFragmentRecord =>
    ({
      kind: 'table',
      id: `outer-split:f${fragmentIndex}`,
      tableId: 'outer-split',
      fragmentIndex,
      columnEdges: [0, 100],
      rows: [
        {
          id: `outer-row-${fragmentIndex}`,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [nested(fragmentIndex, text)],
            },
          ],
        },
      ],
    }) as unknown as TableFragmentRecord;
  const layout = {
    revision: 1,
    pages: [
      { index: 0, fragments: [outer(0, 'Only page one')] },
      { index: 1, fragments: [outer(1, 'Only page two')] },
    ],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  expect(result.markdown).toContain('Only page one');
  expect(result.markdown).toContain('Only page two');
  expect(result.pages[0]?.markdown).toContain('Only page one');
  expect(result.pages[0]?.markdown).not.toContain('Only page two');
  expect(result.pages[1]?.markdown).toContain('Only page two');
  expect(result.pages[1]?.markdown).not.toContain('Only page one');
});

test('does not append a same-page repeated header to its original row', async () => {
  const row = (id: string, text: string, repeat = false) => ({
    id,
    isHeaderRow: id === 'header',
    isHeaderRepeat: repeat,
    isContinuation: false,
    cells: [
      { gridColumn: 0, gridSpan: 1, vMergeContinue: false, blocks: [paragraph(`${text}:p`, text)] },
    ],
  });
  const fragment = (fragmentIndex: number, rows: ReturnType<typeof row>[]) =>
    ({
      kind: 'table',
      id: `same-page:f${fragmentIndex}`,
      tableId: 'same-page',
      fragmentIndex,
      columnEdges: [0, 100],
      rows,
    }) as unknown as TableFragmentRecord;
  const layout = {
    revision: 1,
    pages: [
      {
        index: 0,
        fragments: [
          fragment(0, [row('header', 'Header'), row('a', 'A')]),
          fragment(1, [row('header', 'Header', true), row('b', 'B')]),
        ],
      },
    ],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  expect(result.pages[0]?.markdown.match(/Header/g)).toHaveLength(1);
  expect(result.pages[0]?.markdown).toContain('| A |');
  expect(result.pages[0]?.markdown).toContain('| B |');
});
