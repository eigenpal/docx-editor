import { describe, expect, it } from 'bun:test';
import { canCopyExport, copyableMarkdown, type ExportStatus } from './export-state';

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
});
