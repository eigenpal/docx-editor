import { describe, expect, test } from 'bun:test';
import type { ExportSession } from '../export-session.ts';
import { exportMarkdownFrom } from '../markdown.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../../layout/index.ts';

function paragraph(
  id: string,
  text: string,
  options: Partial<Pick<ParagraphFragmentRecord, 'fragmentIndex' | 'marker'>> = {}
): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${id}:f${options.fragmentIndex ?? 0}`,
    paragraphId: id,
    fragmentIndex: options.fragmentIndex ?? 0,
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
          },
        ],
      },
    ],
    ...(options.marker ? { marker: options.marker } : {}),
  } as unknown as ParagraphFragmentRecord;
}

function anchor(label: string, textbox = false): AnchoredDrawingRecord {
  return {
    accessibility: { label },
    ...(textbox ? { textboxStory: { fragments: [] } } : {}),
  } as unknown as AnchoredDrawingRecord;
}

function session(layout: SemanticLayout): ExportSession {
  return {
    layout: async () => layout,
    layoutFor: async () => layout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };
}

describe('Markdown semantic-record policies', () => {
  test('keeps positioned media in full, page, header, and footer output but omits textboxes', async () => {
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [
        {
          index: 0,
          fragments: [paragraph('p', 'Body')],
          anchoredDrawings: [anchor('Body anchor'), anchor('Textbox', true)],
          header: { fragments: [], anchoredDrawings: [anchor('Header anchor')] },
          footer: { fragments: [], anchoredDrawings: [anchor('Footer anchor')] },
        },
      ],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown).toContain('Body anchor');
    expect(result.pages[0]?.markdown).toContain('Body anchor');
    expect(result.pages[0]?.headerMarkdown).toBe('Header anchor');
    expect(result.pages[0]?.footerMarkdown).toBe('Footer anchor');
    expect(JSON.stringify(result)).not.toContain('Textbox');
  });

  test('deduplicates repeated headers in full output and uses them on continuation pages', async () => {
    const row = (
      id: string,
      text: string,
      flags: { header?: boolean; repeat?: boolean; continuation?: boolean } = {}
    ) => ({
      id,
      isHeaderRow: flags.header ?? false,
      isHeaderRepeat: flags.repeat ?? false,
      isContinuation: flags.continuation ?? false,
      cells: [
        { gridColumn: 0, gridSpan: 1, vMergeContinue: false, blocks: [paragraph(`${id}:p`, text)] },
      ],
    });
    const table = (fragmentIndex: number, rows: ReturnType<typeof row>[]): TableFragmentRecord =>
      ({
        kind: 'table',
        id: `table:f${fragmentIndex}`,
        tableId: 'table',
        fragmentIndex,
        columnEdges: [0, 100],
        rows,
      }) as unknown as TableFragmentRecord;
    const layout = {
      revision: 1,
      pages: [
        { index: 0, fragments: [table(0, [row('h', 'Header', { header: true }), row('a', 'A')])] },
        {
          index: 1,
          fragments: [
            table(1, [
              row('h-repeat', 'Header', { header: true, repeat: true }),
              row('a', 'A continued', { continuation: true }),
            ]),
          ],
        },
      ],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown.match(/Header/g)).toHaveLength(1);
    expect(result.pages[1]?.markdown).toContain('| Header |');
    expect(result.pages[0]?.markdown).toContain('| AA continued |');
    expect(result.pages[1]?.markdown).not.toContain('A continued');
  });

  test('does not duplicate nested tables carried by repeated outer header rows', async () => {
    const nested = (fragmentIndex: number): TableFragmentRecord =>
      ({
        kind: 'table',
        id: `inner:f${fragmentIndex}`,
        tableId: 'inner',
        fragmentIndex,
        columnEdges: [0, 50],
        rows: [
          {
            id: 'inner-row',
            isHeaderRow: false,
            isHeaderRepeat: false,
            cells: [
              {
                gridColumn: 0,
                gridSpan: 1,
                vMergeContinue: false,
                blocks: [paragraph('inner-p', 'Inner')],
              },
            ],
          },
        ],
      }) as unknown as TableFragmentRecord;
    const outer = (fragmentIndex: number, repeat: boolean): TableFragmentRecord =>
      ({
        kind: 'table',
        id: `outer:f${fragmentIndex}`,
        tableId: 'outer',
        fragmentIndex,
        columnEdges: [0, 100],
        rows: [
          {
            id: repeat ? 'outer-header-repeat' : 'outer-header',
            isHeaderRow: true,
            isHeaderRepeat: repeat,
            cells: [
              {
                gridColumn: 0,
                gridSpan: 1,
                vMergeContinue: false,
                blocks: [nested(fragmentIndex)],
              },
            ],
          },
        ],
      }) as unknown as TableFragmentRecord;
    const layout = {
      revision: 1,
      pages: [
        { index: 0, fragments: [outer(0, false)] },
        { index: 1, fragments: [outer(1, true)] },
      ],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown.match(/Inner/g)).toHaveLength(1);
    expect(result.pages[0]?.markdown.match(/Inner/g)).toHaveLength(1);
    expect(result.pages[1]?.markdown.match(/Inner/g)).toHaveLength(1);
  });

  test('joins logical page-split paragraphs while page projections use indent-only list continuations', async () => {
    const marker = {
      numFmt: 'decimal',
      level: 1,
      ordinal: 12,
    } as unknown as NonNullable<ParagraphFragmentRecord['marker']>;
    const first = paragraph('list', 'first ', { marker });
    const continuation = paragraph('list', 'continued', { fragmentIndex: 1 });
    const layout = {
      revision: 1,
      pages: [
        { index: 0, fragments: [first] },
        { index: 1, fragments: [continuation] },
      ],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown).toBe('    12. first continued');
    expect(result.pages[1]?.markdown).toBe('        continued');
  });

  test('indents children by the actual width of wide ordered ancestors', async () => {
    const parent = paragraph('parent', 'parent', {
      marker: { numFmt: 'decimal', level: 0, ordinal: 100 } as NonNullable<
        ParagraphFragmentRecord['marker']
      >,
    });
    const child = paragraph('child', 'child', {
      marker: { numFmt: 'decimal', level: 1, ordinal: 1 } as NonNullable<
        ParagraphFragmentRecord['marker']
      >,
    });
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [{ index: 0, fragments: [parent, child] }],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown).toBe('100. parent\n\n     1. child');
  });

  test('does not inherit indentation across adjacent independent list definitions', async () => {
    const wide = paragraph('wide', 'list A', {
      marker: { numId: 'A', numFmt: 'decimal', level: 0, ordinal: 100 } as NonNullable<
        ParagraphFragmentRecord['marker']
      >,
    });
    const independent = paragraph('independent', 'list B', {
      marker: { numId: 'B', numFmt: 'bullet', level: 1 } as NonNullable<
        ParagraphFragmentRecord['marker']
      >,
    });
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [{ index: 0, fragments: [wide, independent] }],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown).toBe('100. list A\n\n    - list B');
  });

  test('retains leading and interstitial grid columns in GFM tables', async () => {
    const table = {
      kind: 'table',
      id: 'table:f0',
      tableId: 'table',
      fragmentIndex: 0,
      columnEdges: [0, 50, 100, 150],
      rows: [
        {
          id: 'row',
          isHeaderRow: true,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 1,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('shifted', 'Shifted')],
            },
          ],
        },
      ],
    } as unknown as TableFragmentRecord;
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [{ index: 0, fragments: [table] }],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown.split('\n')[0]).toBe('|  | Shifted |  |');
  });

  test('emits note definitions once after their logical body', async () => {
    const reference = paragraph('body', '');
    const span = reference.lines[0]!.spans[0]! as { noteNav?: unknown };
    span.noteNav = { direction: 'to-note', scopeId: 'footnote:1' };
    const layout = {
      revision: 1,
      pages: [
        {
          index: 0,
          fragments: [reference],
          footnotes: {
            notes: [{ scopeId: 'footnote:1', fragments: [paragraph('note', 'Note text')] }],
          },
        },
      ],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown).toBe('[^1]\n\n[^1]: Note text');
    expect(result.pages[0]?.markdown).toBe(result.markdown);
  });

  test('applies list continuation policy inside page-local note definitions', async () => {
    const reference = paragraph('body', '');
    const span = reference.lines[0]!.spans[0]! as { noteNav?: unknown };
    span.noteNav = { direction: 'to-note', scopeId: 'footnote:1' };
    const marker = {
      numFmt: 'decimal',
      level: 0,
      ordinal: 7,
    } as unknown as NonNullable<ParagraphFragmentRecord['marker']>;
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [
        {
          index: 0,
          fragments: [reference],
          footnotes: {
            notes: [
              { scopeId: 'footnote:1', fragments: [paragraph('note-list', 'first ', { marker })] },
            ],
          },
        },
        {
          index: 1,
          fragments: [],
          footnotes: {
            notes: [
              {
                scopeId: 'footnote:1',
                fragments: [paragraph('note-list', 'continued', { fragmentIndex: 1 })],
              },
            ],
          },
        },
      ],
    } as unknown as SemanticLayout;
    const result = await exportMarkdownFrom(session(layout));
    expect(result.markdown).toContain('[^1]: 7. first continued');
    expect(result.pages[0]?.markdown).toContain('[^1]: 7. first ');
    expect(result.pages[1]?.markdown).toContain('[^1]:    continued');
  });
});
