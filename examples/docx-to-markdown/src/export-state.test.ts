import { describe, expect, it } from 'bun:test';
import { canCopyExport, copyableMarkdown, type ExportStatus } from './export-state';

describe('Markdown export actions', () => {
  it('only copies a confirmed current snapshot', () => {
    const unavailable: ExportStatus[] = ['idle', 'queued', 'exporting', 'error'];

    for (const status of unavailable) expect(canCopyExport(status, true)).toBe(false);
    expect(canCopyExport('ready', false)).toBe(false);
    expect(canCopyExport('ready', true)).toBe(true);
  });

  it('copies the portable projection rather than revocable preview URLs', () => {
    const preview = '![figure](blob:https://example.test/temporary)';
    const portable = 'figure';
    expect(preview).toContain('blob:');
    expect(copyableMarkdown('ready', portable)).toBe('figure');
    expect(copyableMarkdown('ready', portable)).not.toContain('blob:');
    expect(copyableMarkdown('exporting', portable)).toBeNull();
  });
});
