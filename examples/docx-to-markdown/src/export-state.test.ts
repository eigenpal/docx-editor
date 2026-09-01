import { describe, expect, it } from 'bun:test';
import {
  canCopyExport,
  copyableMarkdown,
  DOCUMENT_EXPORT_START,
  markdownBusyPresentation,
  shouldRefreshMarkdownForChange,
  type ExportStatus,
} from './export-state';

describe('Markdown export actions', () => {
  it('only copies a confirmed current snapshot', () => {
    const unavailable: ExportStatus[] = ['idle', 'queued', 'exporting', 'error'];

    for (const status of unavailable) expect(canCopyExport(status, true)).toBe(false);
    expect(canCopyExport('ready', false)).toBe(false);
    expect(canCopyExport('ready', true)).toBe(true);
  });

  it('copies only the completed Markdown value', () => {
    expect(copyableMarkdown('ready', 'document')).toBe('document');
    expect(copyableMarkdown('exporting', 'stale document')).toBeNull();
    expect(copyableMarkdown('ready', null)).toBeNull();
  });

  it('replaces stale pages for document loads but preserves context for live edits', () => {
    for (const status of ['queued', 'exporting'] as const) {
      expect(markdownBusyPresentation(status, true, 'document')).toBe('replace');
      expect(markdownBusyPresentation(status, false, 'live-edit')).toBe('replace');
      expect(markdownBusyPresentation(status, true, 'live-edit')).toBe('overlay');
    }

    expect(markdownBusyPresentation('ready', true, 'document')).toBe('none');
    expect(markdownBusyPresentation('error', true, 'document')).toBe('none');
  });

  it('drops the previous document snapshot when an accepted replacement begins', () => {
    const previous = {
      status: 'ready' as const,
      result: { markdown: 'confidential document A' },
      error: 'old error',
      fontReport: { requestedFamilies: ['Old Font'] },
    };

    const replacement = { ...previous, ...DOCUMENT_EXPORT_START };
    expect(replacement).toEqual({
      status: 'exporting',
      result: null,
      error: null,
      fontReport: null,
    });
  });

  it('ignores mount notifications but refreshes every authored identity delta', () => {
    expect(shouldRefreshMarkdownForChange({})).toBe(false);
    expect(shouldRefreshMarkdownForChange({ created: [] })).toBe(true);
    expect(shouldRefreshMarkdownForChange({ deleted: ['block-a'] })).toBe(true);
    expect(shouldRefreshMarkdownForChange({ dirty: ['block-b'] })).toBe(true);
  });
});
