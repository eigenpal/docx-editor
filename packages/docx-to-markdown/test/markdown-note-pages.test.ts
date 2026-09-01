import { expect, test } from 'bun:test';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import type { ParagraphFragmentRecord, SemanticLayout } from '@docx-editor.dev/core/layout';
import { exportMarkdownFrom } from '../src/index.ts';

function paragraph(
  id: string,
  text: string,
  marker?: NonNullable<ParagraphFragmentRecord['marker']>
): ParagraphFragmentRecord {
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
    ...(marker ? { marker } : {}),
  } as unknown as ParagraphFragmentRecord;
}

test('renders an endnote continuation on a page without its reference', async () => {
  const scopeId = 'endnote:1';
  const reference = paragraph('reference', '');
  const referenceSpan = reference.lines[0]!.spans[0]! as { noteNav?: unknown };
  referenceSpan.noteNav = { direction: 'to-note', scopeId };
  const marker = (
    level: number,
    numFmt: 'decimal' | 'bullet'
  ): NonNullable<ParagraphFragmentRecord['marker']> =>
    ({
      numId: 'end-list',
      level,
      numFmt,
      ...(numFmt === 'decimal' ? { ordinal: 1 } : {}),
    }) as NonNullable<ParagraphFragmentRecord['marker']>;
  const layout = {
    revision: 1,
    displayMode: 'original',
    pages: [
      {
        index: 0,
        fragments: [reference],
        endnotes: {
          notes: [
            {
              scopeId,
              fragments: [paragraph('parent', 'End parent', marker(0, 'decimal'))],
            },
          ],
        },
      },
      {
        index: 1,
        fragments: [],
        endnotes: {
          notes: [
            {
              scopeId,
              fragments: [paragraph('child', 'End child', marker(1, 'bullet'))],
            },
          ],
        },
      },
    ],
  } as unknown as SemanticLayout;
  const exportLayout = { ...layout, reviewArtifacts: Object.freeze([]) } as ExportSemanticLayout;
  const session: ExportSession = {
    layout: async () => exportLayout,
    layoutFor: async () => exportLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };

  const result = await exportMarkdownFrom(session);
  const fullHtml = micromark(result.markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
  expect(fullHtml).toContain('<p>End parent</p>\n<ul>\n<li>End child</li>');

  const pageHtml = micromark(result.pages[1]?.markdown ?? '', {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
  expect(pageHtml).toContain('<strong>Endnote 1 (continued):</strong>');
  expect(pageHtml).toContain('<ul>\n<li>End child</li>');
  expect(pageHtml).not.toContain('<pre>');
});

test('labels a held-over note normally on its first rendered page', async () => {
  const scopeId = 'footnote:held';
  const reference = paragraph('held-reference', '');
  const referenceSpan = reference.lines[0]!.spans[0]! as { noteNav?: unknown };
  referenceSpan.noteNav = { direction: 'to-note', scopeId };
  const layout = {
    revision: 1,
    displayMode: 'original',
    pages: [
      { index: 0, fragments: [reference] },
      {
        index: 1,
        fragments: [],
        footnotes: { notes: [{ scopeId, fragments: [paragraph('held-first', 'Held body')] }] },
      },
      {
        index: 2,
        fragments: [],
        footnotes: {
          notes: [{ scopeId, fragments: [paragraph('held-continuation', 'More body')] }],
        },
      },
    ],
  } as unknown as SemanticLayout;
  const exportLayout = { ...layout, reviewArtifacts: Object.freeze([]) } as ExportSemanticLayout;
  const session: ExportSession = {
    layout: async () => exportLayout,
    layoutFor: async () => exportLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };

  const result = await exportMarkdownFrom(session);

  expect(result.pages[1]?.markdown).toContain('[^1]: Held body');
  expect(result.pages[1]?.markdown).not.toContain('(continued)');
  expect(result.pages[2]?.markdown).toContain('Footnote 1 (continued)');
});
