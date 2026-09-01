import { describe, expect, test } from 'bun:test';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import { exportMarkdownFrom } from '../src/index.ts';
import type { AnchoredDrawingRecord } from '@docx-editor.dev/core/layout';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '@docx-editor.dev/core/layout';

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
            box: { x: 0, y: 0, width: text.length, height: 10 },
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
  const exportLayout = {
    ...layout,
    reviewArtifacts: layout.reviewArtifacts ?? Object.freeze([]),
  } as ExportSemanticLayout;
  return {
    layout: async () => exportLayout,
    layoutFor: async () => exportLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };
}

describe('Markdown semantic-record policies', () => {
  test('preserves both list and outline semantics for numbered headings', async () => {
    const heading = paragraph('numbered-heading', 'Scope');
    const authored = heading as unknown as {
      outlineLevel: number | null;
      marker: { level: number; numFmt: string; ordinal: number };
    };
    authored.outlineLevel = 0;
    authored.marker = { level: 0, numFmt: 'decimal', ordinal: 3 };
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [{ index: 0, fragments: [heading] }],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('3. # Scope');
    expect(result.pagination).toEqual({
      basis: 'docx-editor-layout',
      stability: 'snapshot',
      wordCompatibility: 'not-guaranteed',
      layoutRevision: 1,
      displayMode: 'original',
    });
    expect(Object.isFrozen(result.reviewArtifacts)).toBe(true);
  });

  test('preserves visual segment order when resolved revisions merge paragraph offsets', async () => {
    const merged = paragraph('absorbed', '');
    const mergedLine = merged.lines[0]! as unknown as { spans: unknown[] };
    mergedLine.spans = [
      {
        range: { paragraphId: 'absorbed', start: 0, end: 1 },
        text: 'A',
        style: {},
        box: { x: 0, y: 0, width: 1, height: 10 },
      },
      {
        range: { paragraphId: 'absorbed', start: 1, end: 2 },
        text: 'B',
        style: { bold: true },
        box: { x: 1, y: 0, width: 1, height: 10 },
      },
      {
        range: { paragraphId: 'survivor', start: 0, end: 1 },
        text: 'C',
        style: {},
        box: { x: 2, y: 0, width: 1, height: 10 },
      },
    ];
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [{ index: 0, fragments: [merged] }],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('A**B**C');
  });

  test('preserves a drawing-only paragraph segment after merged revision text', async () => {
    const merged = paragraph('absorbed', 'A');
    const mergedLine = merged.lines[0]! as unknown as { drawings: unknown[] };
    mergedLine.drawings = [
      {
        paragraphId: 'survivor',
        start: 0,
        advanceStart: 10,
        accessibility: { label: 'X' },
      },
    ];
    const layout = {
      revision: 1,
      displayMode: 'proposed',
      pages: [{ index: 0, fragments: [merged] }],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout), {
      image: () => ({ url: 'image.png' }),
    });

    expect(result.markdown).toBe('A![X](image.png)');
  });

  test('emits Office Math fallback text rather than the atomic object marker', async () => {
    const equation = paragraph('equation', '\uFFFC');
    const equationSpan = equation.lines[0]!.spans[0]! as {
      equation?: { fallbackText: string };
    };
    equationSpan.equation = { fallbackText: 'x < y' };
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [{ index: 0, fragments: [equation] }],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('x &lt; y');
    expect(result.markdown).not.toContain('\uFFFC');
  });

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

  test('represents sanitized drawing links and deletion attribution', async () => {
    const drawing = {
      ...anchor('Linked image'),
      hyperlinkHref: 'https://example.com/a(b)',
      revisions: [{ kind: 'delete' }],
    } as unknown as AnchoredDrawingRecord;
    const layout = {
      revision: 1,
      displayMode: 'all-markup',
      pages: [{ index: 0, fragments: [], anchoredDrawings: [drawing] }],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout), {
      image: () => ({ url: 'image.png' }),
    });

    expect(result.markdown).toBe('~~[![Linked image](image.png)](https://example.com/a%28b%29)~~');
  });

  test('indexes repeated header and footer tables per page occurrence', async () => {
    const furnitureTable = (tableId: string, text: string): TableFragmentRecord =>
      ({
        kind: 'table',
        id: `${tableId}:fragment`,
        tableId,
        fragmentIndex: 0,
        columnEdges: [0, 100],
        rows: [
          {
            id: `${tableId}:row`,
            isHeaderRow: false,
            isHeaderRepeat: false,
            isContinuation: false,
            cells: [
              {
                gridColumn: 0,
                gridSpan: 1,
                vMergeContinue: false,
                blocks: [paragraph(`${tableId}:paragraph`, text)],
              },
            ],
          },
        ],
      }) as unknown as TableFragmentRecord;
    const layout = {
      revision: 1,
      displayMode: 'proposed',
      pages: [0, 1].map((index) => ({
        index,
        fragments: [],
        header: { fragments: [furnitureTable('repeated-header', 'H')] },
        footer: { fragments: [furnitureTable('repeated-footer', 'F')] },
      })),
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.pages.map((page) => page.headerMarkdown)).toEqual([
      '| H |\n| --- |',
      '| H |\n| --- |',
    ]);
    expect(result.pages.map((page) => page.footerMarkdown)).toEqual([
      '| F |\n| --- |',
      '| F |\n| --- |',
    ]);
  });

  test('preserves authored row order when a later row is incorrectly marked as a header', async () => {
    const row = (id: string, text: string, isHeaderRow: boolean) => ({
      id,
      isHeaderRow,
      isHeaderRepeat: false,
      isContinuation: false,
      cells: [
        {
          gridColumn: 0,
          gridSpan: 1,
          vMergeContinue: false,
          blocks: [paragraph(`${id}:paragraph`, text)],
        },
      ],
    });
    const table = {
      kind: 'table',
      id: 'authored-order:fragment',
      tableId: 'authored-order',
      fragmentIndex: 0,
      columnEdges: [0, 100],
      rows: [row('first', 'FIRST', false), row('second', 'SECOND', true)],
    } as unknown as TableFragmentRecord;
    const layout = {
      revision: 1,
      displayMode: 'proposed',
      pages: [{ index: 0, fragments: [table] }],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('| FIRST |\n| --- |\n| SECOND |');
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
    expect(result.pages[0]?.markdown).toContain('| A |');
    expect(result.pages[0]?.markdown).not.toContain('A continued');
    expect(result.pages[1]?.markdown).toContain('| A continued |');
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

  test('joins page-split lists while page projections rebase orphan items and continuations', async () => {
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
    expect(result.markdown).toBe('12. first continued');
    expect(result.pages[1]?.markdown).toBe('continued');
    expect(micromark(result.markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })).toBe(
      '<ol start="12">\n<li>first continued</li>\n</ol>'
    );
    expect(
      micromark(result.pages[1]?.markdown ?? '', {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
      })
    ).toBe('<p>continued</p>');
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
    const html = micromark(result.markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    expect(html).toContain('<li>\n<p>parent</p>\n<ol>');
    expect(html).not.toContain('<pre>');
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
    expect(result.markdown).toBe('100. list A\n\n- list B');
    const html = micromark(result.markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    expect(html).toContain('<ol start="100">');
    expect(html).toContain('<ul>');
    expect(html).not.toContain('<pre>');
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

  test('emits delimiter cells for trailing grid gaps when the first row is short', async () => {
    const table = {
      kind: 'table',
      id: 'short-header:f0',
      tableId: 'short-header',
      fragmentIndex: 0,
      columnEdges: [0, 50, 100, 150],
      rows: [
        {
          id: 'header',
          isHeaderRow: true,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('header-cell', 'Header')],
            },
          ],
        },
        {
          id: 'body',
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 2,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('body-cell', 'Trailing')],
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

    expect(result.markdown).toBe('| Header |  |  |\n| --- | --- | --- |\n|  |  | Trailing |');
  });

  test('flattens horizontal grid spans into explicit empty GFM cells', async () => {
    const table = {
      kind: 'table',
      id: 'horizontal-merge:f0',
      tableId: 'horizontal-merge',
      fragmentIndex: 0,
      columnEdges: [0, 50, 100, 150],
      rows: [
        {
          id: 'header',
          isHeaderRow: true,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 2,
              vMergeContinue: false,
              blocks: [paragraph('wide-header', 'Wide')],
            },
            {
              gridColumn: 2,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('tail-header', 'Tail')],
            },
          ],
        },
        {
          id: 'body',
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('body-a', 'A')],
            },
            {
              gridColumn: 1,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('body-b', 'B')],
            },
            {
              gridColumn: 2,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('body-c', 'C')],
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

    expect(result.markdown).toBe('| Wide |  | Tail |\n| --- | --- | --- |\n| A | B | C |');
  });

  test('renders vertical-merge continuation cells as empty even when records carry blocks', async () => {
    const table = {
      kind: 'table',
      id: 'vertical-merge:f0',
      tableId: 'vertical-merge',
      fragmentIndex: 0,
      columnEdges: [0, 50, 100],
      rows: [
        {
          id: 'header',
          isHeaderRow: true,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('merged-header', 'Merged')],
            },
            {
              gridColumn: 1,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('value-header', 'Value')],
            },
          ],
        },
        {
          id: 'continuation',
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: true,
              blocks: [paragraph('ignored-continuation', 'Must not leak')],
            },
            {
              gridColumn: 1,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph('visible-value', 'Visible')],
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

    expect(result.markdown).toBe('| Merged | Value |\n| --- | --- |\n|  | Visible |');
    expect(result.markdown).not.toContain('Must not leak');
  });

  test('omits a rows-less table without manufacturing a header or delimiter row', async () => {
    const table = {
      kind: 'table',
      id: 'empty-table:f0',
      tableId: 'empty-table',
      fragmentIndex: 0,
      columnEdges: [0, 50, 100],
      rows: [],
    } as unknown as TableFragmentRecord;
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [{ index: 0, fragments: [table] }],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('');
    expect(result.pages[0]?.markdown).toBe('');
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

  test('keeps multiple note paragraphs as indented GFM continuation blocks', async () => {
    const reference = paragraph('body-multi-note', '');
    const span = reference.lines[0]!.spans[0]! as { noteNav?: unknown };
    span.noteNav = { direction: 'to-note', scopeId: 'footnote:multi' };
    const layout = {
      revision: 1,
      displayMode: 'proposed',
      pages: [
        {
          index: 0,
          fragments: [reference],
          footnotes: {
            notes: [
              {
                scopeId: 'footnote:multi',
                fragments: [paragraph('note-first', 'First'), paragraph('note-second', 'Second')],
              },
            ],
          },
        },
      ],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('[^1]\n\n[^1]: First\n    \n    Second');
  });

  test('labels mixed footnotes and endnotes in body-reference order', async () => {
    const footnoteReference = paragraph('footnote-reference', '');
    const footnoteSpan = footnoteReference.lines[0]!.spans[0]! as { noteNav?: unknown };
    footnoteSpan.noteNav = { direction: 'to-note', scopeId: 'footnote:7' };
    const endnoteReference = paragraph('endnote-reference', '');
    const endnoteSpan = endnoteReference.lines[0]!.spans[0]! as { noteNav?: unknown };
    endnoteSpan.noteNav = { direction: 'to-note', scopeId: 'endnote:9' };
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [
        {
          index: 0,
          fragments: [endnoteReference, footnoteReference],
          footnotes: {
            kind: 'footnotes',
            notes: [
              {
                noteKind: 'footnote',
                scopeId: 'footnote:7',
                fragments: [paragraph('footnote-body', 'Footnote text')],
              },
            ],
          },
          endnotes: {
            kind: 'endnotes',
            notes: [
              {
                noteKind: 'endnote',
                scopeId: 'endnote:9',
                fragments: [paragraph('endnote-body', 'Endnote text')],
              },
            ],
          },
        },
      ],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('[^1]\n\n[^2]\n\n[^2]: Footnote text\n\n[^1]: Endnote text');
    expect(result.pages[0]?.markdown).toBe(result.markdown);
  });

  test('omitted textbox citations cannot shift visible note numbering', async () => {
    const visibleReference = paragraph('body', '');
    const visibleSpan = visibleReference.lines[0]!.spans[0]! as { noteNav?: unknown };
    visibleSpan.noteNav = { direction: 'to-note', scopeId: 'footnote:2' };
    const hiddenReference = paragraph('textbox', '');
    const hiddenSpan = hiddenReference.lines[0]!.spans[0]! as { noteNav?: unknown };
    hiddenSpan.noteNav = { direction: 'to-note', scopeId: 'footnote:1' };
    const layout = {
      revision: 1,
      pages: [
        {
          index: 0,
          fragments: [visibleReference],
          anchoredDrawings: [
            anchor('Textbox', true) as AnchoredDrawingRecord & {
              textboxStory: { fragments: ParagraphFragmentRecord[] };
            },
          ],
          footnotes: {
            notes: [
              { scopeId: 'footnote:1', fragments: [paragraph('hidden-note', 'Hidden note')] },
              { scopeId: 'footnote:2', fragments: [paragraph('note', 'Visible note')] },
            ],
          },
        },
      ],
    } as unknown as SemanticLayout;
    const textbox = layout.pages[0]!.anchoredDrawings![0]! as AnchoredDrawingRecord & {
      textboxStory: { fragments: ParagraphFragmentRecord[] };
    };
    textbox.textboxStory.fragments = [hiddenReference];

    const result = await exportMarkdownFrom(session(layout));

    expect(result.markdown).toBe('[^1]\n\n[^1]: Visible note');
    expect(result.markdown).not.toContain('[^2]');
    expect(result.markdown).not.toContain('Hidden note');
  });

  test('keeps logical note lists nested across pages while page definitions rebase them', async () => {
    const reference = (id: string, scopeId: string): ParagraphFragmentRecord => {
      const block = paragraph(id, '');
      const span = block.lines[0]!.spans[0]! as { noteNav?: unknown };
      span.noteNav = { direction: 'to-note', scopeId };
      return block;
    };
    const marker = (
      numId: string,
      level: number,
      numFmt: 'decimal' | 'bullet'
    ): NonNullable<ParagraphFragmentRecord['marker']> =>
      ({
        numId,
        level,
        numFmt,
        ...(numFmt === 'decimal' ? { ordinal: 1 } : {}),
      }) as NonNullable<ParagraphFragmentRecord['marker']>;
    const footnoteScope = 'footnote:1';
    const endnoteScope = 'endnote:1';
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [
        {
          index: 0,
          fragments: [
            reference('footnote-reference-1', footnoteScope),
            reference('endnote-reference-1', endnoteScope),
          ],
          footnotes: {
            notes: [
              {
                scopeId: footnoteScope,
                fragments: [
                  paragraph('footnote-parent', 'Foot parent', {
                    marker: marker('foot-list', 0, 'decimal'),
                  }),
                ],
              },
            ],
          },
          endnotes: {
            notes: [
              {
                scopeId: endnoteScope,
                fragments: [
                  paragraph('endnote-parent', 'End parent', {
                    marker: marker('end-list', 0, 'decimal'),
                  }),
                ],
              },
            ],
          },
        },
        {
          index: 1,
          fragments: [
            reference('footnote-reference-2', footnoteScope),
            reference('endnote-reference-2', endnoteScope),
          ],
          footnotes: {
            notes: [
              {
                scopeId: footnoteScope,
                fragments: [
                  paragraph('footnote-child', 'Foot child', {
                    marker: marker('foot-list', 1, 'bullet'),
                  }),
                ],
              },
            ],
          },
          endnotes: {
            notes: [
              {
                scopeId: endnoteScope,
                fragments: [
                  paragraph('endnote-child', 'End child', {
                    marker: marker('end-list', 1, 'bullet'),
                  }),
                ],
              },
            ],
          },
        },
      ],
    } as unknown as SemanticLayout;

    const result = await exportMarkdownFrom(session(layout));
    const parsed = micromark(result.markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    expect(parsed).toContain('<p>Foot parent</p>\n<ul>\n<li>Foot child</li>');
    expect(parsed).toContain('<p>End parent</p>\n<ul>\n<li>End child</li>');
    expect(parsed).not.toContain('<pre>');

    const secondPage = result.pages[1]?.markdown ?? '';
    expect(secondPage).toContain('[^1]: - Foot child');
    expect(secondPage).toContain('[^2]: - End child');
    const parsedSecondPage = micromark(secondPage, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    expect(parsedSecondPage).toContain('<ul>\n<li>Foot child</li>');
    expect(parsedSecondPage).toContain('<ul>\n<li>End child</li>');
    expect(parsedSecondPage).not.toContain('<pre>');
  });

  test('rebases list continuations inside page-local note definitions', async () => {
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
    expect(result.pages[1]?.markdown).toBe('> **Footnote 1 (continued):**\n>\n> continued');
    expect(
      micromark(result.pages[1]?.markdown ?? '', {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
      })
    ).toBe(
      '<blockquote>\n<p><strong>Footnote 1 (continued):</strong></p>\n<p>continued</p>\n</blockquote>'
    );
  });
});
