import { describe, expect, test } from 'bun:test';
import type { MarkdownExportResult } from '@docx-editor.dev/docx-to-markdown';
import { developerPanelContent } from './developer-reference';

describe('developer reference', () => {
  test('does not inspect or serialize the result while showing the code example', () => {
    const hostile = Object.defineProperty({}, 'pages', {
      get: () => {
        throw new Error('result was inspected');
      },
    }) as MarkdownExportResult;

    expect(developerPanelContent('example', hostile)).toContain('exportMarkdown(bytes)');
  });

  test('bounds large live responses and contains formatting failures', () => {
    const largeText = 'x'.repeat(1_000_000);
    const result = {
      pages: Array.from({ length: 100 }, (_, index) => ({
        id: `page-${index}`,
        number: index + 1,
        markdown: largeText,
        headerMarkdown: '',
        footerMarkdown: '',
        comments: [],
        trackedChanges: [],
      })),
      reviewArtifacts: [],
      reviewBindings: [],
      fontResolution: null,
      pagination: {
        source: 'layout-engine',
        scope: 'export-snapshot',
        layoutRevision: 1,
        displayMode: 'all-markup',
      },
      markdown: largeText,
    } as const satisfies MarkdownExportResult;

    const response = developerPanelContent('response', result);
    expect(response.length).toBeLessThan(50_000);
    expect(response).toContain('97');
    expect(response).toContain('characters omitted');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(developerPanelContent('response', cyclic as unknown as MarkdownExportResult)).toContain(
      'could not be formatted safely'
    );
  });

  test('distinguishes updating and terminal errors without exposing stale data', () => {
    const stale = { markdown: 'stale secret' } as MarkdownExportResult;
    expect(developerPanelContent('response', null, 'exporting')).toContain('Updating');
    const failed = developerPanelContent('response', null, 'error', 'Invalid DOCX package');
    expect(failed).toContain('export failed');
    expect(failed).toContain('Invalid DOCX package');
    expect(developerPanelContent('response', stale, 'error', 'Stopped')).not.toContain(
      'stale secret'
    );
  });
});
