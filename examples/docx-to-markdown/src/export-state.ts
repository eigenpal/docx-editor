export type ExportStatus = 'idle' | 'queued' | 'exporting' | 'ready' | 'error';
export type ExportActivity = 'document' | 'live-edit';
export type MarkdownBusyPresentation = 'none' | 'replace' | 'overlay';

export const DOCUMENT_EXPORT_START = Object.freeze({
  status: 'exporting' as const,
  result: null,
  error: null,
  fontReport: null,
});

interface DocumentChangeProvenance {
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
  readonly dirty?: readonly string[];
}

export function shouldRefreshMarkdownForChange(change: DocumentChangeProvenance): boolean {
  return change.created !== undefined || change.deleted !== undefined || change.dirty !== undefined;
}

export function markdownBusyPresentation(
  status: ExportStatus,
  hasResult: boolean,
  activity: ExportActivity
): MarkdownBusyPresentation {
  if (status !== 'queued' && status !== 'exporting') return 'none';
  return activity === 'document' || !hasResult ? 'replace' : 'overlay';
}

export function canCopyExport(status: ExportStatus, hasResult: boolean): boolean {
  return status === 'ready' && hasResult;
}

/** Return the last complete full-document Markdown projection. */
export function copyableMarkdown(status: ExportStatus, markdown: string | null): string | null {
  return canCopyExport(status, markdown !== null) ? markdown : null;
}
