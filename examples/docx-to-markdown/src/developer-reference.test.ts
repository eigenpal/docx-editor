import { describe, expect, test } from 'bun:test';
import type {
  ExportFontResolutionReport,
  MarkdownExportResult,
} from '@docx-editor.dev/docx-to-markdown';
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

  test('shows the complete API response without demo-only truncation', () => {
    const pageText = 'x'.repeat(1_000);
    const result = {
      pages: Array.from({ length: 28 }, (_, index) => ({
        id: `page-${index}`,
        number: index + 1,
        markdown: `${pageText}-${index + 1}`,
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
      markdown: `${pageText}-complete-document`,
    } as const satisfies MarkdownExportResult;

    const response = developerPanelContent('response', result);
    expect(response).toContain('"id": "page-27"');
    expect(response).toContain('"number": 28');
    expect(response).toContain('complete-document');
    expect(response).not.toContain('$preview');
    expect(response).not.toContain('pagesOmitted');
  });

  test('preserves long strings and the tails of every nested result collection', () => {
    const longMarkdown = `${'m'.repeat(9_000)}-LONG_STRING_TAIL`;
    const collection = (prefix: string) =>
      Array.from({ length: 24 }, (_, index) => ({ id: `${prefix}-${index}` }));
    const fontResolution = {
      requestedFamilies: Array.from({ length: 24 }, (_, index) => `REQUESTED_FONT-${index}`),
      defaultFamily: 'Calibri',
      families: Array.from({ length: 24 }, (_, familyIndex) => ({
        family: `FONT_FAMILY-${familyIndex}`,
        coverage: 'complete' as const,
        faces: Array.from({ length: 24 }, (_, faceIndex) => ({
          weight: faceIndex % 2 === 0 ? (400 as const) : (700 as const),
          style: faceIndex % 3 === 0 ? ('italic' as const) : ('normal' as const),
          sourceFamily: `FONT_FACE-${faceIndex}`,
          via: faceIndex % 2 === 0 ? ('direct' as const) : ('substitution' as const),
        })),
      })),
      originFailures: Array.from({ length: 24 }, (_, index) => ({
        originIndex: index,
        originName: `FONT_FAILURE-${index}`,
        cause: `failure-${index}`,
      })),
    } satisfies ExportFontResolutionReport;
    const result = {
      pages: [
        {
          id: 'page-1',
          number: 1,
          markdown: longMarkdown,
          headerMarkdown: '',
          footerMarkdown: '',
          comments: collection('PAGE_COMMENT'),
          trackedChanges: collection('PAGE_CHANGE'),
        },
      ],
      reviewArtifacts: collection('GLOBAL_ARTIFACT'),
      reviewBindings: Array.from({ length: 24 }, (_, index) => ({
        artifactId: `GLOBAL_BINDING-${index}`,
      })),
      fontResolution,
      pagination: { source: 'layout-engine' },
      markdown: longMarkdown,
    } as unknown as MarkdownExportResult;

    const response = developerPanelContent('response', result);
    expect(response).toContain('LONG_STRING_TAIL');
    expect(response).toContain('PAGE_COMMENT-23');
    expect(response).toContain('PAGE_CHANGE-23');
    expect(response).toContain('GLOBAL_ARTIFACT-23');
    expect(response).toContain('GLOBAL_BINDING-23');
    expect(response).toContain('REQUESTED_FONT-23');
    expect(response).toContain('FONT_FAMILY-23');
    expect(response).toContain('FONT_FACE-23');
    expect(response).toContain('FONT_FAILURE-23');
    expect(response).not.toContain('omitted');
  });

  test('contains response formatting failures', () => {
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
